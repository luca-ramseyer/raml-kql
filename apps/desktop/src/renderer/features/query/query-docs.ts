import { create } from 'zustand';

/**
 * Query tab documents: the text and time range of each query editor (spec 05). Result data is
 * never kept here. Persistence of tabs arrives in Phase 7.
 */
export const TIME_PRESETS = ['30m', '1h', '4h', '12h', '24h', '48h', '3d', '7d', '30d'] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

export type TimeRange =
  { kind: 'preset'; preset: TimePreset } | { kind: 'custom'; start: string; end: string };

export const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  '30m': 'Last 30 minutes',
  '1h': 'Last hour',
  '4h': 'Last 4 hours',
  '12h': 'Last 12 hours',
  '24h': 'Last 24 hours',
  '48h': 'Last 48 hours',
  '3d': 'Last 3 days',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** ISO 8601 duration for the Log Analytics `timespan` parameter. */
export function presetTimespan(preset: TimePreset): string {
  const value = Number.parseInt(preset, 10);
  return preset.endsWith('m')
    ? `PT${String(value)}M`
    : preset.endsWith('h')
      ? `PT${String(value)}H`
      : `P${String(value)}D`;
}

export interface QueryDoc {
  text: string;
  timeRange: TimeRange;
  /** The query filters on TimeGenerated itself ("Set in query"). */
  timeSetInQuery: boolean;
  /** Last cursor position (restored with the tab). */
  cursor?: { line: number; column: number } | undefined;
  /** The My Queries file this tab edits (relative path) and the text last saved there. */
  file?: { path: string; savedText: string } | undefined;
  /** Restored from the last session: its results were cleared (spec 04). */
  restored?: boolean | undefined;
}

export const STARTER_QUERY = `SigninLogs
| where TimeGenerated > ago(1d)
| summarize SignIns = count(), FailedSignIns = countif(ResultType != "0") by UserPrincipalName
| top 20 by FailedSignIns
`;

export const useQueryDocs = create<{ docs: Record<string, QueryDoc> }>(() => ({ docs: {} }));

export function createQueryDoc(id: string, text = '', extra: Partial<QueryDoc> = {}): void {
  useQueryDocs.setState((state) => ({
    docs: {
      ...state.docs,
      [id]: { text, timeRange: { kind: 'preset', preset: '24h' }, timeSetInQuery: false, ...extra },
    },
  }));
}

/** A linked file has unsaved changes. */
export function isDirty(doc: QueryDoc | undefined): boolean {
  return doc?.file !== undefined && doc.file.savedText !== doc.text;
}

export function updateQueryDoc(id: string, patch: Partial<QueryDoc>): void {
  useQueryDocs.setState((state) => {
    const doc = state.docs[id];
    return doc === undefined ? state : { docs: { ...state.docs, [id]: { ...doc, ...patch } } };
  });
}

export function deleteQueryDoc(id: string): void {
  useQueryDocs.setState((state) => {
    const { [id]: _removed, ...docs } = state.docs;
    return { docs };
  });
}
