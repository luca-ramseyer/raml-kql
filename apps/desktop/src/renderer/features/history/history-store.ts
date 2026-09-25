import { create } from 'zustand';

import type { HistoryEntry } from '../../../shared/query/history';
import { getBridge, unwrap } from '../../services/ipc';
import { openQueryTab } from '../query/open-query';

/** Query history entries, newest first (spec 05, "History"). */
export const useHistory = create<{ entries: HistoryEntry[]; loaded: boolean }>(() => ({
  entries: [],
  loaded: false,
}));

export async function loadHistory(): Promise<void> {
  try {
    const { entries } = await unwrap(getBridge().history.list());
    useHistory.setState({ entries, loaded: true });
  } catch {
    useHistory.setState({ loaded: true });
  }
}

export async function clearHistory(): Promise<void> {
  await unwrap(getBridge().history.clear());
  useHistory.setState({ entries: [] });
}

/**
 * Search (spec 05): every word must match the query text (so table names match), a tenant's
 * display name or the tab title. Tenant names are the ones on screen, so aliased names match
 * aliases only.
 */
export function filterHistory(
  entries: readonly HistoryEntry[],
  search: string,
  tenantName: (tenantId: string) => string,
): HistoryEntry[] {
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = [
      entry.query,
      entry.tabTitle ?? '',
      ...entry.tenantIds.map((id) => tenantName(id)),
    ]
      .join('\n')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** "Today", "Yesterday", or the date, in local time (grouping by day). */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** The first meaningful line of a query (list label). */
export function queryLabel(query: string): string {
  const line = query
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('//'));
  return line ?? '(empty query)';
}

/** Open a history entry in a tab with its targets and time range. */
export function openHistoryEntry(entry: HistoryEntry, preview: boolean): string {
  return openQueryTab({
    text: entry.query,
    title: entry.tabTitle,
    preview,
    ...(entry.timeRange === undefined ? {} : { timeRange: entry.timeRange }),
    targets: { selected: entry.targets, groupId: entry.groupId },
  });
}
