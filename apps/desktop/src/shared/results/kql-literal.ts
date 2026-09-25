import type { KqlType } from '../schema/models';

import { valueText } from './values';

/** KQL literals for datatable export and "Filter to this value" (spec 06). */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A column name as KQL: bare when it's a plain identifier, otherwise `['…']`. */
export function kqlName(name: string): string {
  return IDENTIFIER.test(name) ? name : `['${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

export function kqlString(text: string): string {
  return `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

/** A value as a KQL literal of its column type (`typename(null)` for empty values). */
export function kqlLiteral(value: unknown, type: KqlType): string {
  if (value === null || value === undefined || (value === '' && type !== 'string')) {
    return type === 'string' ? '""' : `${type}(null)`;
  }
  const text = valueText(value);
  switch (type) {
    case 'string':
      return kqlString(text);
    case 'bool':
      return value === true || text.toLowerCase() === 'true' ? 'true' : 'false';
    case 'int':
    case 'long':
    case 'real':
    case 'decimal': {
      const n = Number(text);
      if (!Number.isFinite(n)) return `${type}(null)`;
      return type === 'real' || type === 'decimal'
        ? `${type}(${text})`
        : `${type}(${String(Math.trunc(n))})`;
    }
    case 'dynamic':
      return `dynamic(${typeof value === 'string' ? value : JSON.stringify(value)})`;
    case 'datetime':
    case 'guid':
    case 'timespan':
      return `${type}(${text})`;
  }
}
