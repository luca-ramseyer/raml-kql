import { create } from 'zustand';

import { AppError } from '../../../shared/errors';
import type { InstalledPack, PackQueryInfo, PacksSnapshot } from '../../../shared/packs/models';
import { timeRangeForDuration } from '../../../shared/query/time-range';
import { notify } from '../../platform/notifications';
import { getBridge, unwrap } from '../../services/ipc';
import { openQueryTab } from '../query/open-query';

/** Installed query packs and their sources (spec 08). */
export const usePacks = create<{ snapshot: PacksSnapshot; loaded: boolean }>(() => ({
  snapshot: { sources: [], packs: [], problems: [] },
  loaded: false,
}));

export function reportPackError(error: unknown, fallback: string): void {
  notify({
    severity: 'error',
    message: error instanceof Error ? error.message : fallback,
    detail: error instanceof AppError ? error.detail : undefined,
    source: 'Query Packs',
  });
}

export async function loadPacks(): Promise<void> {
  try {
    usePacks.setState({ snapshot: await unwrap(getBridge().packs.list()), loaded: true });
  } catch (error) {
    usePacks.setState({ loaded: true });
    reportPackError(error, 'Query packs could not be loaded.');
  }
}

export function setPacksSnapshot(snapshot: PacksSnapshot): void {
  usePacks.setState({ snapshot, loaded: true });
}

/** A unique key for an installed pack (two sources may provide the same pack id). */
export function packKey(pack: Pick<InstalledPack, 'sourceId' | 'id'>): string {
  return `${pack.sourceId}/${pack.id}`;
}

/** The source label when another source provides a pack with the same id (spec 08). */
export function packDisambiguator(
  pack: InstalledPack,
  snapshot: PacksSnapshot,
): string | undefined {
  const twins = snapshot.packs.filter((p) => p.id === pack.id);
  if (twins.length < 2) return undefined;
  return snapshot.sources.find((s) => s.id === pack.sourceId)?.label;
}

export interface PackFilter {
  words: string[];
  tags: string[];
  mitre: string[];
  tables: string[];
  categories: string[];
}

/** Search text: words, plus `tag:`, `mitre:`, `table:` and `category:` filters. */
export function parsePackFilter(search: string): PackFilter {
  const filter: PackFilter = { words: [], tags: [], mitre: [], tables: [], categories: [] };
  for (const token of search.trim().toLowerCase().split(/\s+/)) {
    if (token === '') continue;
    const [, key, value = ''] = /^(tag|mitre|table|category):(.*)$/.exec(token) ?? [];
    if (key === undefined || value === '') filter.words.push(token);
    else if (key === 'tag') filter.tags.push(value);
    else if (key === 'mitre') filter.mitre.push(value);
    else if (key === 'table') filter.tables.push(value);
    else filter.categories.push(value);
  }
  return filter;
}

export function isFilterEmpty(filter: PackFilter): boolean {
  return Object.values(filter).every((list: string[]) => list.length === 0);
}

/**
 * Whether a query matches. `availableTables` (lower case) limits the list to queries whose
 * tables all exist in the current targets' schema.
 */
export function matchesPackQuery(
  pack: InstalledPack,
  query: PackQueryInfo,
  filter: PackFilter,
  availableTables?: ReadonlySet<string>,
): boolean {
  if (
    availableTables !== undefined &&
    !query.tables.every((t) => availableTables.has(t.toLowerCase()))
  ) {
    return false;
  }
  const lower = (list: readonly string[] | undefined) => (list ?? []).map((v) => v.toLowerCase());
  const tags = lower([...(query.tags ?? []), ...(pack.tags ?? [])]);
  const mitre = lower(query.mitre);
  const tables = lower(query.tables);
  if (!filter.tags.every((t) => tags.includes(t))) return false;
  // `mitre:T1110` also matches its sub-techniques.
  if (!filter.mitre.every((m) => mitre.some((id) => id === m || id.startsWith(`${m}.`))))
    return false;
  if (!filter.tables.every((t) => tables.includes(t))) return false;
  if (!filter.categories.every((c) => query.category === c)) return false;
  const text = [query.name, query.description, query.id, pack.name, ...tags, ...mitre, ...tables]
    .join(' ')
    .toLowerCase();
  return filter.words.every((word) => text.includes(word));
}

/** Open a pack query in a tab: its text, parameters and time range; the user presses Run. */
export async function openPackQuery(
  pack: InstalledPack,
  query: PackQueryInfo,
  preview: boolean,
): Promise<void> {
  try {
    const full = await unwrap(
      getBridge().packs.readQuery({ sourceId: pack.sourceId, packId: pack.id, queryId: query.id }),
    );
    const timeRange = timeRangeForDuration(full.timespan ?? pack.defaults?.timespan);
    openQueryTab({
      text: full.body,
      title: full.name,
      preview,
      description: pack.name,
      ...(timeRange === undefined ? {} : { timeRange }),
      ...(full.parameters === undefined ? {} : { parameters: full.parameters }),
    });
  } catch (error) {
    reportPackError(error, 'The query could not be opened.');
  }
}

/** Pack files are read-only: copy a query, with its metadata, into My Queries. */
export async function duplicateToMyQueries(
  pack: InstalledPack,
  query: PackQueryInfo,
): Promise<string | undefined> {
  try {
    const full = await unwrap(
      getBridge().packs.readQuery({ sourceId: pack.sourceId, packId: pack.id, queryId: query.id }),
    );
    const { body, file: _file, id: _id, ...meta } = full;
    const saved = await unwrap(getBridge().queries.save({ name: full.name, body, meta }));
    notify({
      severity: 'info',
      message: `Copied "${full.name}" to My Queries.`,
      source: 'Query Packs',
    });
    return saved.path;
  } catch (error) {
    reportPackError(error, 'The query could not be copied to My Queries.');
    return undefined;
  }
}

export function resetPacks(): void {
  usePacks.setState({ snapshot: { sources: [], packs: [], problems: [] }, loaded: false });
}
