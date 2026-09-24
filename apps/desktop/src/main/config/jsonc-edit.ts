import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  modify,
  parseTree,
  type Edit,
} from 'jsonc-parser';

/**
 * Token kinds from jsonc-parser. Its `SyntaxKind` is a `const enum`, which can't be imported
 * under `verbatimModuleSyntax`, so the values are mirrored here (pinned by a unit test).
 */
export const Tok = {
  Comma: 5,
  LineComment: 12,
  BlockComment: 13,
  LineBreak: 14,
  Trivia: 15,
  EOF: 17,
} as const;

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' } as const;

interface Token {
  kind: number;
  offset: number;
  end: number;
}

/** Significant tokens and comments (no whitespace or line breaks). */
function tokenize(text: string): Token[] {
  const scanner = createScanner(text, false);
  const tokens: Token[] = [];
  for (let kind: number = scanner.scan(); kind !== Tok.EOF; kind = scanner.scan()) {
    if (kind === Tok.Trivia || kind === Tok.LineBreak) continue;
    const offset = scanner.getTokenOffset();
    tokens.push({ kind, offset, end: offset + scanner.getTokenLength() });
  }
  return tokens;
}

const isComment = (token: Token): boolean =>
  token.kind === Tok.LineComment || token.kind === Tok.BlockComment;

/**
 * Remove a top-level property without touching any comment. `jsonc-parser`'s `modify` removes
 * everything between the property and its neighbour, including comments that belong to other
 * settings; spec 09 requires the user's comments to survive programmatic edits.
 */
export function removeTopLevelProperty(text: string, key: string): string {
  const tree = parseTree(text);
  const valueNode = tree === undefined ? undefined : findNodeAtLocation(tree, [key]);
  const property = valueNode?.parent;
  if (property?.type !== 'property') return text;

  const start = property.offset;
  const end = property.offset + property.length;
  const tokens = tokenize(text);
  const edits: Edit[] = [];

  // A comma after the property goes with it; otherwise (last property) remove the comma before.
  const after = tokens.find((token) => token.offset >= end && !isComment(token));
  let removeEnd = end;
  if (after?.kind === Tok.Comma) {
    removeEnd = after.end;
  } else {
    const before = tokens.filter((token) => token.end <= start && !isComment(token)).at(-1);
    if (before?.kind === Tok.Comma) {
      edits.push({ offset: before.offset, length: before.end - before.offset, content: '' });
    }
  }

  // Remove the whole line when nothing but whitespace would remain on it.
  let removeStart = start;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = text.indexOf('\n', removeEnd);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  if (text.slice(lineStart, start).trim() === '' && text.slice(removeEnd, lineEnd).trim() === '') {
    removeStart = lineStart;
    removeEnd = lineEndIndex === -1 ? lineEnd : lineEnd + 1;
  }
  edits.push({ offset: removeStart, length: removeEnd - removeStart, content: '' });
  return applyEdits(text, edits);
}

/** Set (or, with `undefined`, remove) a top-level property, preserving comments. */
export function setTopLevelProperty(text: string, key: string, value: unknown): string {
  if (value === undefined) return removeTopLevelProperty(text, key);
  return applyEdits(text, modify(text, [key], value, { formattingOptions: FORMATTING }));
}
