import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ResultColumn } from '../../shared/query/models';
import type { ExportFormat, ExportRequest, ExportResult } from '../../shared/results/export';
import type { ResultStore } from '../results/result-store';
import type { ResultViews } from '../results/result-views';

import { toCsv, toDatatable, toJson, toJsonLines, toMarkdown, type ExportTable } from './formats';
import { toXlsx } from './xlsx';

/**
 * Exports (spec 06): the one place result data may leave the session, and only by explicit
 * user action. Files are written where the user picks in the native save dialog; clipboard
 * copies go through the main process (the renderer has no clipboard permission).
 */

export interface ExportServiceOptions {
  store: ResultStore;
  views: ResultViews;
  csv: () => { delimiter: string; bom: boolean };
  /** Native save dialog; resolves to undefined when cancelled. */
  saveDialog: (options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }) => Promise<string | undefined>;
  writeClipboard: (text: string) => Promise<void>;
  lastFolder: { get(): string | undefined; set(folder: string): void };
  defaultFolder: () => string;
  now?: () => Date;
}

const EXTENSIONS: Record<ExportFormat, { ext: string; name: string }> = {
  csv: { ext: 'csv', name: 'CSV' },
  json: { ext: 'json', name: 'JSON' },
  jsonl: { ext: 'jsonl', name: 'JSON Lines' },
  xlsx: { ext: 'xlsx', name: 'Excel Workbook' },
  markdown: { ext: 'md', name: 'Markdown' },
  datatable: { ext: 'kql', name: 'KQL' },
};

function pickColumns(table: ExportTable, indexes: readonly number[] | undefined): ExportTable {
  if (indexes === undefined) return table;
  const valid = indexes.filter((i) => i < table.columns.length);
  return {
    name: table.name,
    columns: valid.map((i) => table.columns[i]).filter((c): c is ResultColumn => c !== undefined),
    rows: table.rows.map((row) => valid.map((i) => row[i])),
  };
}

export class ExportService {
  constructor(private readonly options: ExportServiceOptions) {}

  private async tables(request: ExportRequest): Promise<ExportTable[]> {
    const { source } = request;
    if (source.kind === 'rows') {
      return [{ name: source.name, columns: source.columns, rows: source.rows }];
    }
    const empty = { sort: [], filters: {}, quickSearch: '', valueFilters: [] };
    // XLSX of all rows: one sheet per result table (spec 06).
    const indexes =
      request.format === 'xlsx' && source.scope === 'all'
        ? this.options.store.tables(source.runId).map((t) => t.index)
        : [source.tableIndex];
    const tables: ExportTable[] = [];
    for (const tableIndex of indexes) {
      const { columns, rows } = await this.options.views.rows({
        runId: source.runId,
        tableIndex,
        view: source.scope === 'filtered' ? source.view : empty,
        display: request.display,
        positions: source.scope === 'selected' ? source.positions : undefined,
      });
      const name = indexes.length > 1 ? `Table ${String(tableIndex + 1)}` : 'Results';
      tables.push(
        pickColumns(
          { name, columns, rows },
          tableIndex === source.tableIndex ? source.columns : undefined,
        ),
      );
    }
    return tables;
  }

  /** Save a chart image (PNG data URL or SVG markup) where the user picks. */
  async saveImage(format: 'png' | 'svg', data: string): Promise<ExportResult> {
    const stamp = (this.options.now?.() ?? new Date())
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-');
    const folder = this.options.lastFolder.get() ?? this.options.defaultFolder();
    const file = await this.options.saveDialog({
      defaultPath: path.join(folder, `raml-kql-chart-${stamp}.${format}`),
      filters: [{ name: format === 'png' ? 'PNG Image' : 'SVG Image', extensions: [format] }],
    });
    if (file === undefined) return { status: 'cancelled', rows: 0 };
    const content =
      format === 'png' ? Buffer.from(data.slice(data.indexOf(',') + 1), 'base64') : data;
    await writeFile(file, content, { mode: 0o600 });
    this.options.lastFolder.set(path.dirname(file));
    return { status: 'saved', rows: 0, path: file };
  }

  async export(request: ExportRequest): Promise<ExportResult> {
    const tables = await this.tables(request);
    const first = tables[0] ?? { name: 'Results', columns: [], rows: [] };
    const rows = tables.reduce((sum, t) => sum + t.rows.length, 0);
    let notice: string | undefined;
    let content: string | Buffer;
    switch (request.format) {
      case 'csv':
        content = toCsv(first, this.options.csv());
        break;
      case 'json':
        content = toJson(first);
        break;
      case 'jsonl':
        content = toJsonLines(first);
        break;
      case 'markdown': {
        const markdown = toMarkdown(first);
        content = markdown.text;
        if (markdown.truncatedCells > 0) {
          notice = `${String(markdown.truncatedCells)} cells longer than 200 characters were shortened.`;
        }
        break;
      }
      case 'datatable': {
        const datatable = toDatatable(first);
        content = datatable.text;
        if (datatable.truncated) notice = 'Only the first 10,000 rows were included.';
        break;
      }
      case 'xlsx':
        if (request.destination === 'clipboard') {
          throw new Error('Excel workbooks can only be saved to a file.');
        }
        content = await toXlsx(tables);
        break;
    }

    if (request.destination === 'clipboard') {
      await this.options.writeClipboard(
        typeof content === 'string' ? content : content.toString('utf8'),
      );
      return { status: 'copied', rows, ...(notice === undefined ? {} : { notice }) };
    }

    const { ext, name } = EXTENSIONS[request.format];
    const stamp = (this.options.now?.() ?? new Date())
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-');
    const folder = this.options.lastFolder.get() ?? this.options.defaultFolder();
    const file = await this.options.saveDialog({
      defaultPath: path.join(folder, `raml-kql-results-${stamp}.${ext}`),
      filters: [{ name, extensions: [ext] }],
    });
    if (file === undefined) return { status: 'cancelled', rows: 0 };
    await writeFile(file, content, { mode: 0o600 });
    this.options.lastFolder.set(path.dirname(file));
    return { status: 'saved', rows, path: file, ...(notice === undefined ? {} : { notice }) };
  }
}
