import { presetTimespan, TIME_PRESET_LABELS, type TimeRange } from './query-docs';

/**
 * Time range helpers (spec 05, "Time range picker"). Custom ranges are stored as ISO 8601 UTC
 * instants; `time.displayZone` only changes how they are shown and typed.
 */
export type DisplayZone = 'utc' | 'local';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `2026-09-25 14:30` in the display zone. */
export function formatDateTime(date: Date, zone: DisplayZone): string {
  return zone === 'utc'
    ? `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
    : `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse `YYYY-MM-DD[ HH:mm[:ss]]` in the display zone; `undefined` when invalid. */
export function parseDateTime(text: string, zone: DisplayZone): Date | undefined {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\s*$/.exec(text);
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    // Optional groups that didn't match are undefined at runtime, whatever the typings say.
    .map((part: string | undefined) => (part === undefined ? 0 : Number(part))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date =
    zone === 'utc'
      ? new Date(Date.UTC(year, month - 1, day, hour, minute, second))
      : new Date(year, month - 1, day, hour, minute, second);
  // Reject rollovers such as 2026-02-31.
  const check = zone === 'utc' ? date.getUTCDate() : date.getDate();
  const checkMonth = zone === 'utc' ? date.getUTCMonth() : date.getMonth();
  if (Number.isNaN(date.getTime()) || check !== day || checkMonth !== month - 1) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  return date;
}

export function timeRangeLabel(range: TimeRange, zone: DisplayZone): string {
  if (range.kind === 'preset') return TIME_PRESET_LABELS[range.preset];
  const suffix = zone === 'utc' ? ' (UTC)' : '';
  return `${formatDateTime(new Date(range.start), zone)} – ${formatDateTime(new Date(range.end), zone)}${suffix}`;
}

/**
 * The Log Analytics `timespan` parameter (spec 04), or `undefined` when the query sets its own
 * time filter ("Set in query").
 */
export function timespanFor(range: TimeRange, setInQuery: boolean): string | undefined {
  if (setInQuery) return undefined;
  return range.kind === 'preset' ? presetTimespan(range.preset) : `${range.start}/${range.end}`;
}
