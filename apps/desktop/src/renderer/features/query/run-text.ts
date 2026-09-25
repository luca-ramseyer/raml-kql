/**
 * What Shift+Enter runs (spec 05, "Run behaviour"): the selection if there is one, otherwise
 * the block under the cursor (statements separated by blank lines, as in the Log Analytics
 * portal), or everything with `editor.runScope: "all"`. Lines are 1-based like Monaco's.
 */
export interface RunText {
  text: string;
  startLine: number;
  endLine: number;
}

export function queryToRun(
  text: string,
  cursorLine: number,
  scope: 'block' | 'all',
  selection?: { text: string; startLine: number; endLine: number },
): RunText | undefined {
  if (selection !== undefined && selection.text.trim() !== '') {
    return { text: selection.text, startLine: selection.startLine, endLine: selection.endLine };
  }
  const lines = text.split(/\r?\n/);
  if (scope === 'all') {
    return text.trim() === '' ? undefined : { text, startLine: 1, endLine: lines.length };
  }
  const blank = (index: number): boolean => (lines[index] ?? '').trim() === '';
  let index = Math.min(Math.max(cursorLine - 1, 0), lines.length - 1);
  // On a blank line, use the block just above (the portal does the same after typing Enter).
  if (blank(index)) {
    while (index > 0 && blank(index)) index--;
    if (blank(index)) return undefined;
  }
  let start = index;
  while (start > 0 && !blank(start - 1)) start--;
  let end = index;
  while (end < lines.length - 1 && !blank(end + 1)) end++;
  return {
    text: lines.slice(start, end + 1).join('\n'),
    startLine: start + 1,
    endLine: end + 1,
  };
}
