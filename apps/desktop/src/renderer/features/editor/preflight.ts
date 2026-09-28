import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

import { loadMonaco } from './monaco-loader';

/**
 * Pre-flight (spec 04): syntax errors block a run, so a broken query isn't sent to 40
 * workspaces to get 40 identical errors. Kusto syntax diagnostics are the `KS0xx` codes
 * ("Missing …", "Malformed …"); semantic ones (`KS1xx`+, e.g. an unknown table) don't block,
 * because a table may exist in only some workspaces.
 */
export interface SyntaxError_ {
  line: number;
  column: number;
  message: string;
}

interface Diagnostic {
  range: { start: { line: number; character: number } };
  message: string;
  severity?: number;
  code?: string | number;
}

interface ValidatingWorker {
  doValidation(
    uri: string,
    intervals: { start: number; end: number }[],
    includeWarnings?: boolean,
    includeSuggestions?: boolean,
  ): Promise<Diagnostic[]>;
}

export function isSyntaxDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 1 && /^KS0\d\d$/.test(String(diagnostic.code ?? ''));
}

export async function syntaxErrors(
  model: Monaco.editor.ITextModel,
  startLine: number,
  endLine: number,
): Promise<SyntaxError_[]> {
  const loaded = await loadMonaco();
  const accessor = await loaded.kusto.getKustoWorker();
  const worker = (await accessor(model.uri)) as unknown as ValidatingWorker;
  const diagnostics = await worker.doValidation(model.uri.toString(), [], false, false);
  return diagnostics
    .filter(isSyntaxDiagnostic)
    .map((d) => ({
      line: d.range.start.line + 1,
      column: d.range.start.character + 1,
      message: d.message,
    }))
    .filter((e) => e.line >= startLine && e.line <= endLine);
}
