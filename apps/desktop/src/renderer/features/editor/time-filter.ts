/**
 * "Set in query" detection (spec 05, "Time range picker"): does the query filter on
 * `TimeGenerated` itself? Uses the Kusto language service's token classification (so comments
 * and strings never count), not a regex over the raw text.
 */

/** Kusto.Language.Editor.ClassificationKind values we use (see monaco-kusto syntaxHighlighting/types). */
export const Kind = {
  Comment: 1,
  Punctuation: 2,
  StringLiteral: 5,
  Column: 7,
  MathOperator: 17,
  QueryOperator: 18,
  Keyword: 20,
} as const;

export interface Classification {
  line: number;
  character: number;
  length: number;
  kind: number;
}

interface Token {
  kind: number;
  text: string;
}

function toTokens(text: string, classifications: readonly Classification[]): Token[] {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  return classifications
    .map((c) => {
      const start = (lineStarts[c.line] ?? 0) + c.character;
      return { start, kind: c.kind, text: text.slice(start, start + c.length) };
    })
    .sort((a, b) => a.start - b.start)
    .map(({ kind, text: tokenText }) => ({ kind, text: tokenText }));
}

const COMPARISONS = new Set(['>', '>=', '<', '<=', '==', 'between', '!between', 'in', '!in']);

/** True when a `where`/`filter` predicate compares TimeGenerated with something. */
export function filtersOnTimeGenerated(
  text: string,
  classifications: readonly Classification[],
): boolean {
  const tokens = toTokens(text, classifications).filter(
    (t) => t.kind !== Kind.Comment && t.text.trim() !== '',
  );
  let inWhere = false;
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;
    const word = token.text.toLowerCase();
    if (token.kind === Kind.QueryOperator && (word === 'where' || word === 'filter')) {
      inWhere = true;
      depth = 0;
      continue;
    }
    if (!inWhere) continue;
    if (token.text === '(') depth++;
    if (token.text === ')') depth--;
    // The predicate ends at the next pipe or statement end at the same nesting level.
    if (depth <= 0 && (token.text === '|' || token.text === ';')) {
      inWhere = false;
      continue;
    }
    // Not only Column: without a schema (no targets) the name is an unresolved identifier.
    if (token.kind !== Kind.StringLiteral && token.text === 'TimeGenerated') {
      const next = tokens[i + 1];
      if (next !== undefined && COMPARISONS.has(next.text.toLowerCase())) return true;
      // Also `ago(1d) < TimeGenerated`, i.e. the column on the right of a comparison.
      const previous = tokens[i - 1];
      if (previous !== undefined && COMPARISONS.has(previous.text.toLowerCase())) return true;
    }
  }
  return false;
}
