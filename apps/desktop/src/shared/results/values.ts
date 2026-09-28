import type { KqlType } from '../schema/models';

/** A cell value as text: strings as is, numbers and booleans printed, objects as JSON. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') return '';
  return JSON.stringify(value);
}

const NUMERIC: ReadonlySet<KqlType> = new Set(['int', 'long', 'real', 'decimal']);

export function isNumericType(type: KqlType): boolean {
  return NUMERIC.has(type);
}

/** A value as a number for numeric columns (`null` when not a number). */
export function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

/** A datetime value as epoch milliseconds (`null` when not parseable). */
export function dateValue(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** A comparable key: numbers for numeric, datetime and bool columns, lowercase text otherwise. */
export function sortKey(value: unknown, type: KqlType): number | string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isNumericType(type) || type === 'bool') return numberValue(value);
  if (type === 'datetime') return dateValue(value);
  return valueText(value).toLowerCase();
}
