import { createRequire } from 'node:module';

/**
 * The Kusto language service's parser in the main process (spec 08: parameter injection uses
 * the syntax tree). `@kusto/language-service-next` is Bridge.NET output that defines the
 * `Bridge` and `Kusto` globals when its two scripts run. It needs no DOM. Loaded lazily (about
 * 100 ms) on the first query with parameters.
 */

/** The parts of the Kusto API used here. */
interface KustoList<T> {
  Count: number;
  getItem(index: number): T;
}

interface KustoSyntaxNode {
  Kind: number;
  /** Start of the node's text, after leading trivia (comments, whitespace). */
  TextStart: number;
  End: number;
}

interface KustoStatement extends KustoSyntaxNode {
  Name?: { SimpleName: string };
}

interface KustoDiagnostic {
  Code: string;
  Message: string;
  Severity: string;
  Start: number;
  Length: number;
}

interface KustoCode {
  Syntax: {
    Statements?: KustoList<{ Element$1: KustoStatement }>;
  };
  GetDiagnostics(): KustoList<KustoDiagnostic>;
}

interface KustoGlobal {
  Language: {
    KustoCode: { Parse(text: string): KustoCode };
    Syntax: { SyntaxKind: { LetStatement: number } };
  };
}

let kusto: KustoGlobal | undefined;

function load(): KustoGlobal {
  if (kusto !== undefined) return kusto;
  const require = createRequire(import.meta.url);
  require('@kusto/language-service-next/bridge.min.js');
  require('@kusto/language-service-next/Kusto.Language.Bridge.min.js');
  kusto = (globalThis as unknown as { Kusto: KustoGlobal }).Kusto;
  return kusto;
}

export interface TopLevelStatement {
  kind: 'let' | 'other';
  /** The `let` name. */
  name?: string;
  start: number;
  end: number;
}

/** Top-level statements of a query (a `let` inside a function body isn't top level). */
export function topLevelStatements(text: string): TopLevelStatement[] {
  const k = load();
  const statements = k.Language.KustoCode.Parse(text).Syntax.Statements;
  if (statements === undefined) return [];
  const out: TopLevelStatement[] = [];
  for (let i = 0; i < statements.Count; i++) {
    const statement = statements.getItem(i).Element$1;
    const isLet = statement.Kind === k.Language.Syntax.SyntaxKind.LetStatement;
    out.push({
      kind: isLet ? 'let' : 'other',
      ...(isLet && statement.Name !== undefined ? { name: statement.Name.SimpleName } : {}),
      start: statement.TextStart,
      end: statement.End,
    });
  }
  return out;
}

export interface SyntaxDiagnostic {
  code: string;
  message: string;
  offset: number;
}

/** Syntax errors (`KS0xx`), as the editor's pre-flight reports them (spec 04). */
export function syntaxDiagnostics(text: string): SyntaxDiagnostic[] {
  const diagnostics = load().Language.KustoCode.Parse(text).GetDiagnostics();
  const out: SyntaxDiagnostic[] = [];
  for (let i = 0; i < diagnostics.Count; i++) {
    const d = diagnostics.getItem(i);
    if (/^KS0\d\d$/.test(d.Code)) out.push({ code: d.Code, message: d.Message, offset: d.Start });
  }
  return out;
}
