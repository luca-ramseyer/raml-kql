// exceljs is CommonJS: its module object is the default export under Node's ESM interop.
// eslint-disable-next-line import-x/default
import ExcelJS from 'exceljs';

import { dateValue, numberValue, valueText } from '../../shared/results/values';

import type { ExportTable } from './formats';

/**
 * XLSX export (spec 06): one sheet per result table, bold frozen header row, typed cells
 * (numbers as numbers, datetimes as Excel dates in UTC, everything else as text).
 */

/** Excel sheet names: max 31 characters, no `[]:*?/\`, unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, '_').trim() || 'Result').slice(0, 31);
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${String(n)})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export async function toXlsx(tables: readonly ExportTable[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); // eslint-disable-line import-x/no-named-as-default-member -- CJS: no named export under ESM;
  workbook.creator = 'Raml KQL';
  const used = new Set<string>();
  for (const table of tables) {
    const sheet = workbook.addWorksheet(sheetName(table.name, used), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = table.columns.map((column) => ({
      header: column.name,
      key: column.name,
      width: Math.min(60, Math.max(10, column.name.length + 2)),
      ...(column.type === 'datetime' ? { style: { numFmt: 'yyyy-mm-dd hh:mm:ss.000' } } : {}),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of table.rows) {
      sheet.addRow(
        table.columns.map((column, i) => {
          const value = row[i];
          if (value === null || value === undefined) return null;
          switch (column.type) {
            case 'int':
            case 'long':
            case 'real':
            case 'decimal':
              return numberValue(value);
            case 'bool':
              return value === true || valueText(value).toLowerCase() === 'true';
            case 'datetime': {
              const ms = dateValue(value);
              return ms === null ? valueText(value) : new Date(ms);
            }
            default:
              return valueText(value);
          }
        }),
      );
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
