// exceljs is CommonJS: its module object is the default export under Node's ESM interop.
// eslint-disable-next-line import-x/default
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { ResultColumn } from '../../shared/query/models';

import { toCsv, toDatatable, toJson, toJsonLines, toMarkdown, type ExportTable } from './formats';
import { toXlsx } from './xlsx';

/** Phase 6 acceptance: "Exports round-trip in tests." */

const COLUMNS: ResultColumn[] = [
  { name: '_TenantName', type: 'string', attribution: true },
  { name: 'TimeGenerated', type: 'datetime' },
  { name: 'Count', type: 'long' },
  { name: 'Score', type: 'real' },
  { name: 'Ok', type: 'bool' },
  { name: 'Details', type: 'dynamic' },
  { name: 'Note', type: 'string' },
  { name: 'Odd Name', type: 'string' },
];
const TABLE: ExportTable = {
  name: 'Results',
  columns: COLUMNS,
  rows: [
    ['Contoso', '2026-09-01T10:00:00.123Z', 5, 1.5, true, '{"a":[1,2]}', 'plain', 'x'],
    [
      'Fabrikam',
      '2026-09-02T00:00:00Z',
      null,
      -2,
      false,
      null,
      'comma, "quote"\nnewline | pipe',
      '',
    ],
  ],
};

/** A small RFC 4180 parser for the round-trip test. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}

describe('export formats round-trip', () => {
  it('CSV', () => {
    for (const delimiter of [',', ';', '\t']) {
      const csv = toCsv(TABLE, { delimiter, bom: true });
      expect(csv.startsWith('﻿')).toBe(true);
      const parsed = parseCsv(csv.slice(1), delimiter);
      expect(parsed[0]).toEqual(COLUMNS.map((c) => c.name));
      expect(parsed[1]).toEqual([
        'Contoso',
        '2026-09-01T10:00:00.123Z',
        '5',
        '1.5',
        'true',
        '{"a":[1,2]}',
        'plain',
        'x',
      ]);
      expect(parsed[2]).toEqual([
        'Fabrikam',
        '2026-09-02T00:00:00Z',
        '',
        '-2',
        'false',
        '',
        'comma, "quote"\nnewline | pipe',
        '',
      ]);
    }
    expect(toCsv(TABLE, { delimiter: ',', bom: false }).startsWith('_TenantName')).toBe(true);
  });

  it('JSON and JSON Lines, with dynamic values as JSON', () => {
    const expected = [
      {
        _TenantName: 'Contoso',
        TimeGenerated: '2026-09-01T10:00:00.123Z',
        Count: 5,
        Score: 1.5,
        Ok: true,
        Details: { a: [1, 2] },
        Note: 'plain',
        'Odd Name': 'x',
      },
      {
        _TenantName: 'Fabrikam',
        TimeGenerated: '2026-09-02T00:00:00Z',
        Count: null,
        Score: -2,
        Ok: false,
        Details: null,
        Note: 'comma, "quote"\nnewline | pipe',
        'Odd Name': '',
      },
    ];
    expect(JSON.parse(toJson(TABLE))).toEqual(expected);
    expect(
      toJsonLines(TABLE)
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual(expected);
  });

  it('Markdown, escaping pipes and truncating long cells', () => {
    const long = {
      ...TABLE,
      rows: [...TABLE.rows, ['T', null, 1, 1, true, null, 'y'.repeat(250), '']],
    };
    const { text, truncatedCells } = toMarkdown(long);
    expect(truncatedCells).toBe(1);
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(`| ${COLUMNS.map((c) => c.name).join(' | ')} |`);
    // Split on unescaped pipes and unescape: the cells come back.
    const cells = (line: string): string[] =>
      line
        .slice(2, -2)
        .split(/(?<!\\) \| /)
        .map((c) => c.replace(/\\\|/g, '|').replace(/<br>/g, '\n'));
    expect(cells(lines[3] ?? '')[6]).toBe('comma, "quote"\nnewline | pipe');
    expect(cells(lines[4] ?? '')[6]).toBe(`${'y'.repeat(200)}…`);
  });

  it('KQL datatable with typed literals', () => {
    const { text, truncated } = toDatatable(TABLE);
    expect(truncated).toBe(false);
    expect(text).toBe(
      [
        "datatable(_TenantName:string, TimeGenerated:datetime, Count:long, Score:real, Ok:bool, Details:dynamic, Note:string, ['Odd Name']:string)",
        '[',
        '    "Contoso", datetime(2026-09-01T10:00:00.123Z), long(5), real(1.5), true, dynamic({"a":[1,2]}), "plain", "x",',
        '    "Fabrikam", datetime(2026-09-02T00:00:00Z), long(null), real(-2), false, dynamic(null), "comma, \\"quote\\"\\nnewline | pipe", "",',
        ']',
        '',
      ].join('\n'),
    );
    const many = { ...TABLE, rows: Array.from({ length: 10_001 }, () => TABLE.rows[0] ?? []) };
    expect(toDatatable(many).truncated).toBe(true);
  });

  it('XLSX, one sheet per table with typed cells and a frozen header', async () => {
    const buffer = await toXlsx([TABLE, { ...TABLE, name: 'Results' }]);
    const workbook = new ExcelJS.Workbook(); // eslint-disable-line import-x/no-named-as-default-member -- CJS: no named export under ESM;
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Results', 'Results (2)']);
    const sheet = workbook.worksheets[0];
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet?.getRow(1).values).toEqual([undefined, ...COLUMNS.map((c) => c.name)]);
    const row = sheet?.getRow(2);
    expect(row?.getCell(1).value).toBe('Contoso');
    expect(row?.getCell(2).value).toEqual(new Date('2026-09-01T10:00:00.123Z'));
    expect(row?.getCell(3).value).toBe(5);
    expect(row?.getCell(4).value).toBe(1.5);
    expect(row?.getCell(5).value).toBe(true);
    expect(row?.getCell(6).value).toBe('{"a":[1,2]}');
    expect(sheet?.getRow(3).getCell(3).value).toBeNull();
    expect(sheet?.getRow(3).getCell(7).value).toBe('comma, "quote"\nnewline | pipe');
  });
});
