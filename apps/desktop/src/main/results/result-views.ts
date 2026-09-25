import type { ResultColumn } from '../../shared/query/models';
import { GroupAggregator, type GroupResult, type GroupSpec } from '../../shared/results/aggregate';
import { displayNameMapper, type DisplayNames } from '../../shared/results/display-names';
import { CHART_ROW_LIMIT, type ChartData } from '../../shared/results/requests';
import { dateValue, numberValue, sortKey, valueText } from '../../shared/results/values';
import {
  isViewActive,
  type ColumnFilter,
  type FilterCondition,
  type ViewPage,
  type ViewState,
} from '../../shared/results/view';

import type { ResultStore } from './result-store';

/**
 * Sorted, filtered and searched views of stored result tables (spec 06), computed next to the
 * data so the grid only ever receives the rows on screen. A view is computed in one pass over
 * the table (filters, then quick search, collecting sort keys for matches) and cached by the
 * table's version, so scrolling a 500k-row sorted view is a lookup.
 */

const DAY_MS = 86_400_000;
const CACHED_VIEWS = 6;

type Predicate = (value: unknown) => boolean;

/** `YYYY-MM-DD[ hh:mm:ss]` from AG Grid's date filter, as the UTC start of that day. */
function dayStart(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const ms = Date.parse(`${text.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function conditionPredicate(condition: FilterCondition): Predicate {
  switch (condition.filterType) {
    case 'text': {
      const needle = (condition.filter ?? '').toLowerCase();
      const text = (value: unknown): string => valueText(value).toLowerCase();
      switch (condition.type) {
        case 'contains':
          return (v) => text(v).includes(needle);
        case 'notContains':
          return (v) => !text(v).includes(needle);
        case 'equals':
          return (v) => text(v) === needle;
        case 'notEqual':
          return (v) => text(v) !== needle;
        case 'startsWith':
          return (v) => text(v).startsWith(needle);
        case 'endsWith':
          return (v) => text(v).endsWith(needle);
        case 'blank':
          return blank;
        case 'notBlank':
          return (v) => !blank(v);
      }
      break;
    }
    case 'number':
    case 'date': {
      const isDate = condition.filterType === 'date';
      const read = isDate ? dateValue : numberValue;
      // Dates compare whole (UTC) days, like AG Grid's date filter.
      const from = isDate ? dayStart(condition.dateFrom) : (condition.filter ?? null);
      const to = isDate ? dayStart(condition.dateTo) : (condition.filterTo ?? null);
      const span = isDate ? DAY_MS : 0;
      const known = (v: unknown, test: (n: number, a: number) => boolean): boolean => {
        const n = read(v);
        return n !== null && from !== null && test(n, from);
      };
      switch (condition.type) {
        case 'equals':
          return (v) => known(v, (n, a) => (isDate ? n >= a && n < a + span : n === a));
        case 'notEqual':
          return (v) => !known(v, (n, a) => (isDate ? n >= a && n < a + span : n === a));
        case 'lessThan':
          return (v) => known(v, (n, a) => n < a);
        case 'lessThanOrEqual':
          return (v) => known(v, (n, a) => (isDate ? n < a + span : n <= a));
        case 'greaterThan':
          return (v) => known(v, (n, a) => (isDate ? n >= a + span : n > a));
        case 'greaterThanOrEqual':
          return (v) => known(v, (n, a) => n >= a);
        case 'inRange':
          return (v) =>
            known(v, (n, a) => to !== null && n >= a && (isDate ? n < to + span : n <= to));
        case 'blank':
          return (v) => read(v) === null;
        case 'notBlank':
          return (v) => read(v) !== null;
      }
      break;
    }
    case 'values': {
      const keys = new Set(condition.values.map((v) => valueText(v)));
      return condition.mode === 'include'
        ? (v) => keys.has(valueText(v))
        : (v) => !keys.has(valueText(v));
    }
  }
  return () => true;
}

export function filterPredicate(filter: ColumnFilter): Predicate {
  if ('conditions' in filter) {
    const predicates = filter.conditions.map(conditionPredicate);
    return filter.operator === 'AND'
      ? (v) => predicates.every((p) => p(v))
      : (v) => predicates.some((p) => p(v));
  }
  return conditionPredicate(filter);
}

/** Positions (in table order) of the rows matching a view, in view order. */
export async function computeView(
  store: ResultStore,
  runId: string,
  tableIndex: number,
  view: ViewState,
  display: DisplayNames | undefined,
): Promise<Uint32Array> {
  const columns = store.columns(runId, tableIndex);
  const mapNames = displayNameMapper(columns, display);
  const filters: { column: number; test: Predicate }[] = Object.entries(view.filters).flatMap(
    ([index, filter]) => {
      const column = Number(index);
      return column < columns.length ? [{ column, test: filterPredicate(filter) }] : [];
    },
  );
  for (const valueFilter of view.valueFilters) {
    if (valueFilter.column >= columns.length) continue;
    filters.push({
      column: valueFilter.column,
      test: filterPredicate({
        filterType: 'values',
        mode: valueFilter.mode,
        values: valueFilter.values,
      }),
    });
  }
  const needle = view.quickSearch.trim().toLowerCase();
  const sorts = view.sort.filter((s) => s.column < columns.length);
  const matches: number[] = [];
  const keys: (number | string | null)[][] = sorts.map(() => []);

  await store.forEachRow(runId, tableIndex, (raw, position) => {
    const row = mapNames(raw);
    for (const { column, test } of filters) if (!test(row[column])) return;
    if (needle !== '' && !row.some((value) => valueText(value).toLowerCase().includes(needle))) {
      return;
    }
    matches.push(position);
    sorts.forEach((s, k) => {
      keys[k]?.push(sortKey(row[s.column], columns[s.column]?.type ?? 'string'));
    });
  });

  const order = Uint32Array.from(matches.keys());
  if (sorts.length > 0) {
    const compare = (a: number, b: number): number => {
      for (const [k, s] of sorts.entries()) {
        const x = keys[k]?.[a] ?? null;
        const y = keys[k]?.[b] ?? null;
        if (x === y) continue;
        // Empty values last, whatever the direction.
        if (x === null) return 1;
        if (y === null) return -1;
        const result = x < y ? -1 : 1;
        return s.direction === 'asc' ? result : -result;
      }
      return a - b; // stable
    };
    order.sort(compare);
  }
  return order.map((i) => matches[i] ?? 0);
}

export class ResultViews {
  private readonly cache = new Map<string, Promise<Uint32Array | undefined>>();

  constructor(private readonly store: ResultStore) {}

  /** Positions of a view, or `undefined` for the plain table (no sort, filter or search). */
  positions(
    runId: string,
    tableIndex: number,
    view: ViewState,
    display: DisplayNames | undefined,
  ): Promise<Uint32Array | undefined> {
    if (!isViewActive(view)) return Promise.resolve(undefined);
    const version = this.store.tableVersion(runId, tableIndex);
    // Display names change what filters and search match (aliased names), so they are part of the key.
    const key = JSON.stringify([runId, tableIndex, version, view, display ?? null]);
    let entry = this.cache.get(key);
    if (entry === undefined) {
      entry = computeView(this.store, runId, tableIndex, view, display);
      this.cache.set(key, entry);
      entry.catch(() => this.cache.delete(key));
      while (this.cache.size > CACHED_VIEWS) {
        const oldest = this.cache.keys().next().value;
        if (oldest === undefined) break;
        this.cache.delete(oldest);
      }
    } else {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, entry);
    }
    return entry;
  }

  async page(request: {
    runId: string;
    tableIndex: number;
    view: ViewState;
    display?: DisplayNames | undefined;
    offset: number;
    limit: number;
  }): Promise<ViewPage> {
    const { runId, tableIndex, offset, limit } = request;
    const columns = this.store.columns(runId, tableIndex);
    const totalRows = this.store.tables(runId).find((t) => t.index === tableIndex)?.rowCount ?? 0;
    const view = await this.positions(runId, tableIndex, request.view, request.display);
    const rowCount = view?.length ?? totalRows;
    const end = Math.min(rowCount, offset + limit);
    const positions: number[] = [];
    for (let i = offset; i < end; i++) positions.push(view === undefined ? i : (view[i] ?? 0));
    const mapNames = displayNameMapper(columns, request.display);
    const rows = (await this.store.rowsAt(runId, tableIndex, positions)).map(mapNames);
    return { rows: rows as ViewPage['rows'], positions, rowCount, totalRows };
  }

  /** Rows of a view (or of given positions) for export, grouping and charts. */
  async rows(request: {
    runId: string;
    tableIndex: number;
    view: ViewState;
    display?: DisplayNames | undefined;
    positions?: readonly number[] | undefined;
  }): Promise<{ columns: ResultColumn[]; rows: unknown[][] }> {
    const columns = this.store.columns(request.runId, request.tableIndex);
    const mapNames = displayNameMapper(columns, request.display);
    const positions =
      request.positions ??
      (await this.positions(request.runId, request.tableIndex, request.view, request.display));
    if (positions === undefined) {
      const rows: unknown[][] = [];
      await this.store.forEachRow(request.runId, request.tableIndex, (row) => {
        rows.push(mapNames(row));
      });
      return { columns, rows };
    }
    const rows = await this.store.rowsAt(request.runId, request.tableIndex, [...positions]);
    return { columns, rows: rows.map(mapNames) };
  }

  /** Visit the rows of a view in view order, in chunks (no full copy of big tables). */
  async forEachViewRow(
    request: {
      runId: string;
      tableIndex: number;
      view: ViewState;
      display?: DisplayNames | undefined;
    },
    /** Return `false` to stop early. */
    visit: (row: unknown[]) => boolean | undefined,
  ): Promise<void> {
    const columns = this.store.columns(request.runId, request.tableIndex);
    const mapNames = displayNameMapper(columns, request.display);
    const positions = await this.positions(
      request.runId,
      request.tableIndex,
      request.view,
      request.display,
    );
    if (positions === undefined) {
      let stopped = false;
      await this.store.forEachRow(request.runId, request.tableIndex, (row) => {
        if (!stopped && visit(mapNames(row)) === false) stopped = true;
      });
      return;
    }
    for (let start = 0; start < positions.length; start += 5000) {
      const chunk = [...positions.subarray(start, start + 5000)];
      for (const row of await this.store.rowsAt(request.runId, request.tableIndex, chunk)) {
        if (visit(mapNames(row)) === false) return;
      }
    }
  }

  async aggregate(request: {
    runId: string;
    tableIndex: number;
    view: ViewState;
    display?: DisplayNames | undefined;
    spec: GroupSpec;
  }): Promise<GroupResult> {
    const aggregator = new GroupAggregator(
      this.store.columns(request.runId, request.tableIndex),
      request.spec,
    );
    await this.forEachViewRow(request, (row) => {
      aggregator.add(row);
    });
    return aggregator.result();
  }

  /** Some columns of a view, for charts (at most CHART_ROW_LIMIT rows). */
  async chartData(request: {
    runId: string;
    tableIndex: number;
    view: ViewState;
    display?: DisplayNames | undefined;
    columns: readonly number[];
  }): Promise<ChartData> {
    const all = this.store.columns(request.runId, request.tableIndex);
    const indexes = request.columns.filter((i) => i < all.length);
    const rows: unknown[][] = [];
    let truncated = false;
    await this.forEachViewRow(request, (row) => {
      if (rows.length >= CHART_ROW_LIMIT) {
        truncated = true;
        return false;
      }
      rows.push(indexes.map((i) => row[i]));
      return true;
    });
    return {
      columns: indexes.map((i) => all[i]).filter((c): c is ResultColumn => c !== undefined),
      rows: rows as ChartData['rows'],
      truncated,
    };
  }

  forget(runId: string): void {
    for (const key of [...this.cache.keys()]) {
      if ((JSON.parse(key) as unknown[])[0] === runId) this.cache.delete(key);
    }
  }
}
