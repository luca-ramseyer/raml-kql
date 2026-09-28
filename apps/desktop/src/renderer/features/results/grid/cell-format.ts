import { dateValue, valueText } from '../../../../shared/results/values';
import type { KqlType } from '../../../../shared/schema/models';

/**
 * Cell display (spec 06): datetimes as `2026-09-24 09:12:03.123` in `time.displayZone`, with
 * UTC and local time in the tooltip; `dynamic` values compact on one line.
 */
export type DisplayZone = 'utc' | 'local';

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export function formatDateTimeCell(value: unknown, zone: DisplayZone): string {
  const ms = dateValue(value);
  if (ms === null) return valueText(value);
  const d = new Date(ms);
  return zone === 'utc'
    ? `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
    : `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function dateTimeTooltip(value: unknown): string | undefined {
  if (dateValue(value) === null) return undefined;
  return `UTC: ${formatDateTimeCell(value, 'utc')}\nLocal: ${formatDateTimeCell(value, 'local')}`;
}

/** Compact one-line text for any cell. */
export function formatCell(value: unknown, type: KqlType, zone: DisplayZone): string {
  if (value === null || value === undefined) return '';
  if (type === 'datetime') return formatDateTimeCell(value, zone);
  if (type === 'dynamic' && typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value) as unknown);
    } catch {
      return value;
    }
  }
  return valueText(value);
}

/** Pretty JSON for the cell details sheet (dynamic values, or JSON-looking strings). */
export function prettyJson(value: unknown): string | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[[{]/.test(trimmed)) return undefined;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return typeof parsed === 'object' && parsed !== null
    ? JSON.stringify(parsed, null, 2)
    : undefined;
}

/** Tab-separated rows for the clipboard (spec 06), with headers on request. */
export function toTsv(
  headers: readonly string[] | undefined,
  rows: readonly (readonly string[])[],
): string {
  const clean = (text: string): string => text.replace(/[\t\r\n]+/g, ' ');
  const lines = rows.map((row) => row.map(clean).join('\t'));
  return [...(headers === undefined ? [] : [headers.map(clean).join('\t')]), ...lines].join('\n');
}

/** Codicon for a column type (header icons). */
export const TYPE_ICONS: Record<KqlType, string> = {
  string: 'symbol-string',
  int: 'symbol-numeric',
  long: 'symbol-numeric',
  real: 'symbol-numeric',
  decimal: 'symbol-numeric',
  bool: 'symbol-boolean',
  datetime: 'calendar',
  timespan: 'watch',
  dynamic: 'json',
  guid: 'key',
};
