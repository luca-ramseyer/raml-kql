import { describe, expect, it } from 'vitest';

import { filtersOnTimeGenerated, Kind, type Classification } from './time-filter';

/**
 * A small stand-in for the Kusto classifier (the real one runs in the worker and is covered by
 * e2e/editor.spec.ts): comments, strings, operators, punctuation and identifiers.
 */
function classify(text: string): Classification[] {
  const result: Classification[] = [];
  const pattern =
    /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b(?:where|filter|project|summarize|take|extend)\b)|(!between|between|!in\b|in\b|>=|<=|==|>|<)|([|;(),.])|([A-Za-z_]\w*)|(\d+\w*)/g;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const position = (offset: number): { line: number; character: number } => {
    let line = 0;
    while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? Infinity) <= offset) line++;
    return { line, character: offset - (lineStarts[line] ?? 0) };
  };
  for (const match of text.matchAll(pattern)) {
    const kind =
      match[1] !== undefined
        ? Kind.Comment
        : match[2] !== undefined
          ? Kind.StringLiteral
          : match[3] !== undefined
            ? Kind.QueryOperator
            : match[4] !== undefined
              ? Kind.MathOperator
              : match[5] !== undefined
                ? Kind.Punctuation
                : match[6] !== undefined
                  ? Kind.Column
                  : 0;
    result.push({ ...position(match.index), length: match[0].length, kind });
  }
  return result;
}

const setInQuery = (text: string): boolean => filtersOnTimeGenerated(text, classify(text));

describe('filtersOnTimeGenerated ("Set in query")', () => {
  it.each([
    'SigninLogs | where TimeGenerated > ago(1d)',
    'SigninLogs\n| where TimeGenerated >= ago(7d) and ResultType != "0"',
    'SigninLogs | where TimeGenerated between (ago(2d) .. ago(1d))',
    'SigninLogs | where ago(1d) < TimeGenerated',
    'SigninLogs | filter TimeGenerated > datetime(2026-01-01)',
    'SigninLogs | where ResultType == "0" and TimeGenerated > ago(1h) | take 5',
  ])('detects %j', (query) => {
    expect(setInQuery(query)).toBe(true);
  });

  it.each([
    'SigninLogs | take 10',
    '// where TimeGenerated > ago(1d)\nSigninLogs | take 10',
    'SigninLogs | where Message == "TimeGenerated > ago(1d)"',
    'SigninLogs | project TimeGenerated, UserPrincipalName',
    'SigninLogs | summarize count() by bin(TimeGenerated, 1h)',
    'SigninLogs | where UserPrincipalName == "a" | extend T = TimeGenerated > ago(1d)',
  ])('ignores %j', (query) => {
    expect(setInQuery(query)).toBe(false);
  });

  it('handles classifications that arrive out of order', () => {
    const text = 'SigninLogs | where TimeGenerated > ago(1d)';
    expect(filtersOnTimeGenerated(text, classify(text).reverse())).toBe(true);
  });
});
