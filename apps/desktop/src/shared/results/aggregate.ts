import { z } from 'zod';

import type { ResultColumn } from '../query/models';
import type { KqlType } from '../schema/models';

import { numberValue, sortKey, valueText } from './values';

/**
 * Client-side group-by over merged results (spec 06, "Group-by"): the cross-tenant rollup MTO
 * lacks. Streaming (one row at a time) so it runs over a 1M-row result without copying it, and
 * isolated so a second-stage engine can replace it.
 */
export const AGGREGATIONS = ['count', 'dcount', 'sum', 'avg', 'min', 'max'] as const;
export type AggregationFn = (typeof AGGREGATIONS)[number];

export const GroupSpecSchema = z.object({
  /** Column indexes to group by (may be empty: one total row). */
  groupBy: z.array(z.number().int().nonnegative()).max(10),
  aggregations: z
    .array(
      z.object({
        fn: z.enum(AGGREGATIONS),
        /** Not used by `count`. */
        column: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type GroupSpec = z.infer<typeof GroupSpecSchema>;

export const MAX_GROUPS = 100_000;

interface Accumulator {
  count: number;
  sum: number;
  numbers: number;
  distinct: Set<string> | undefined;
  min: { key: number | string; value: unknown } | undefined;
  max: { key: number | string; value: unknown } | undefined;
}

export interface GroupResult {
  columns: ResultColumn[];
  rows: unknown[][];
  /** More than MAX_GROUPS groups: later groups were dropped. */
  truncated: boolean;
}

export function aggregationName(fn: AggregationFn, column: ResultColumn | undefined): string {
  return fn === 'count' || column === undefined ? 'count_' : `${fn}_${column.name}`;
}

function resultType(fn: AggregationFn, column: ResultColumn | undefined): KqlType {
  switch (fn) {
    case 'count':
    case 'dcount':
      return 'long';
    case 'sum':
    case 'avg':
      return 'real';
    default:
      return column?.type ?? 'string';
  }
}

export class GroupAggregator {
  private readonly groups = new Map<string, { keys: unknown[]; accumulators: Accumulator[] }>();
  private truncated = false;

  constructor(
    private readonly columns: readonly ResultColumn[],
    private readonly spec: GroupSpec,
  ) {}

  add(row: readonly unknown[]): void {
    const keys = this.spec.groupBy.map((index) => row[index] ?? null);
    const id = JSON.stringify(keys.map((k) => valueText(k)));
    let group = this.groups.get(id);
    if (group === undefined) {
      if (this.groups.size >= MAX_GROUPS) {
        this.truncated = true;
        return;
      }
      group = {
        keys,
        accumulators: this.spec.aggregations.map((a) => ({
          count: 0,
          sum: 0,
          numbers: 0,
          distinct: a.fn === 'dcount' ? new Set() : undefined,
          min: undefined,
          max: undefined,
        })),
      };
      this.groups.set(id, group);
    }
    this.spec.aggregations.forEach((aggregation, i) => {
      const acc = group.accumulators[i];
      if (acc === undefined) return;
      acc.count += 1;
      if (aggregation.fn === 'count' || aggregation.column === undefined) return;
      const value = row[aggregation.column];
      if (value === null || value === undefined || value === '') return;
      switch (aggregation.fn) {
        case 'dcount':
          acc.distinct?.add(valueText(value));
          break;
        case 'sum':
        case 'avg': {
          const n = numberValue(value);
          if (n !== null) {
            acc.sum += n;
            acc.numbers += 1;
          }
          break;
        }
        case 'min':
        case 'max': {
          const key = sortKey(value, this.columns[aggregation.column]?.type ?? 'string');
          if (key === null) break;
          if (aggregation.fn === 'min' && (acc.min === undefined || key < acc.min.key)) {
            acc.min = { key, value };
          }
          if (aggregation.fn === 'max' && (acc.max === undefined || key > acc.max.key)) {
            acc.max = { key, value };
          }
          break;
        }
      }
    });
  }

  result(): GroupResult {
    const columns: ResultColumn[] = [
      ...this.spec.groupBy.map((index) => {
        const column = this.columns[index];
        return {
          name: column?.name ?? `Column${String(index)}`,
          type: column?.type ?? ('string' as const),
          ...(column?.attribution === true ? { attribution: true } : {}),
        };
      }),
      ...this.spec.aggregations.map((a) => {
        const column = a.column === undefined ? undefined : this.columns[a.column];
        return { name: aggregationName(a.fn, column), type: resultType(a.fn, column) };
      }),
    ];
    const rows = [...this.groups.values()].map((group) => [
      ...group.keys,
      ...this.spec.aggregations.map((a, i) => {
        const acc = group.accumulators[i];
        if (acc === undefined) return null;
        switch (a.fn) {
          case 'count':
            return acc.count;
          case 'dcount':
            return acc.distinct?.size ?? 0;
          case 'sum':
            return acc.numbers === 0 ? null : acc.sum;
          case 'avg':
            return acc.numbers === 0 ? null : acc.sum / acc.numbers;
          case 'min':
            return acc.min?.value ?? null;
          case 'max':
            return acc.max?.value ?? null;
        }
      }),
    ]);
    // Largest groups first (by the first aggregation), like `summarize … | sort by count_ desc`.
    const first = this.spec.groupBy.length;
    rows.sort((x, y) => (numberValue(y[first]) ?? 0) - (numberValue(x[first]) ?? 0));
    return { columns, rows, truncated: this.truncated };
  }
}
