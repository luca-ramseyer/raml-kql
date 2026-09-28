import type { ResultColumn } from '../../shared/query/models';
import { kqlLiteral, kqlName } from '../../shared/results/kql-literal';
import { valueText } from '../../shared/results/values';
import type { KqlType } from '../../shared/schema/models';

/**
 * Text export formats (spec 06, "Export"). Pure functions over merged rows so every format can
 * be round-trip tested. XLSX is in `xlsx.ts`.
 */

export interface ExportTable {
  name: string;
  columns: ResultColumn[];
  rows: unknown[][];
}

// --- CSV ---------------------------------------------------------------------------------------

export interface CsvOptions {
  delimiter: string;
  /** UTF-8 byte order mark, so Excel detects the encoding. */
  bom: boolean;
}

function csvField(value: unknown, delimiter: string): string {
  const text = valueText(value);
  return text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function toCsv(table: ExportTable, options: CsvOptions): string {
  const line = (values: readonly unknown[]): string =>
    values.map((v) => csvField(v, options.delimiter)).join(options.delimiter);
  const body = [line(table.columns.map((c) => c.name)), ...table.rows.map(line)].join('\r\n');
  return `${options.bom ? '﻿' : ''}${body}\r\n`;
}

// --- JSON --------------------------------------------------------------------------------------

/** `dynamic` values arrive as JSON text from Log Analytics; export them as JSON values. */
function jsonValue(value: unknown, type: KqlType): unknown {
  if (type === 'dynamic' && typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value ?? null;
}

function toObject(table: ExportTable, row: readonly unknown[]): Record<string, unknown> {
  return Object.fromEntries(
    table.columns.map((column, i) => [column.name, jsonValue(row[i], column.type)]),
  );
}

export function toJson(table: ExportTable): string {
  return `${JSON.stringify(
    table.rows.map((row) => toObject(table, row)),
    null,
    2,
  )}\n`;
}

export function toJsonLines(table: ExportTable): string {
  return table.rows.map((row) => `${JSON.stringify(toObject(table, row))}\n`).join('');
}

// --- Markdown ----------------------------------------------------------------------------------

export const MARKDOWN_CELL_LIMIT = 200;

export function toMarkdown(table: ExportTable): { text: string; truncatedCells: number } {
  let truncatedCells = 0;
  const cell = (value: unknown): string => {
    let text = valueText(value);
    if (text.length > MARKDOWN_CELL_LIMIT) {
      truncatedCells += 1;
      text = `${text.slice(0, MARKDOWN_CELL_LIMIT)}…`;
    }
    return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  };
  const header = `| ${table.columns.map((c) => cell(c.name)).join(' | ')} |`;
  const rule = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const rows = table.rows.map(
    (row) => `| ${table.columns.map((_, i) => cell(row[i])).join(' | ')} |`,
  );
  return { text: `${[header, rule, ...rows].join('\n')}\n`, truncatedCells };
}

// --- KQL datatable -----------------------------------------------------------------------------

export const DATATABLE_ROW_LIMIT = 10_000;

export function toDatatable(table: ExportTable): { text: string; truncated: boolean } {
  const truncated = table.rows.length > DATATABLE_ROW_LIMIT;
  const rows = truncated ? table.rows.slice(0, DATATABLE_ROW_LIMIT) : table.rows;
  const schema = table.columns.map((c) => `${kqlName(c.name)}:${c.type}`).join(', ');
  const values = rows.map(
    (row) => `    ${table.columns.map((c, i) => kqlLiteral(row[i], c.type)).join(', ')},`,
  );
  return { text: `datatable(${schema})\n[\n${values.join('\n')}\n]\n`, truncated };
}
