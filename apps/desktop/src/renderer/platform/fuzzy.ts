/**
 * Fuzzy matching for the quick input, close to VS Code's behaviour: the query is split into
 * words; each word must match the label either contiguously (preferred) or as a subsequence.
 * Returns a score (higher is better) and highlight ranges.
 */

export interface MatchRange {
  start: number;
  end: number;
}

export interface FuzzyMatch {
  score: number;
  ranges: MatchRange[];
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text.charAt(index - 1);
  const ch = text.charAt(index);
  return /[\s:._\-/(]/.test(prev) || (prev === prev.toLowerCase() && ch !== ch.toLowerCase());
}

function matchWord(word: string, target: string): FuzzyMatch | undefined {
  const lowerTarget = target.toLowerCase();
  const lowerWord = word.toLowerCase();

  // 1. Contiguous match, preferring one at a word start.
  let best: FuzzyMatch | undefined;
  for (
    let at = lowerTarget.indexOf(lowerWord);
    at >= 0;
    at = lowerTarget.indexOf(lowerWord, at + 1)
  ) {
    const score = 100 + lowerWord.length * 10 + (isWordStart(target, at) ? 50 : 0) - at * 0.1;
    if (best === undefined || score > best.score) {
      best = { score, ranges: [{ start: at, end: at + lowerWord.length }] };
    }
  }
  if (best !== undefined) return best;

  // 2. Subsequence match, rewarding runs and word starts.
  const ranges: MatchRange[] = [];
  let score = 0;
  let t = 0;
  for (const ch of lowerWord) {
    const found = lowerTarget.indexOf(ch, t);
    if (found < 0) return undefined;
    const last = ranges.at(-1);
    if (last !== undefined && last.end === found) {
      last.end++;
      score += 5;
    } else {
      ranges.push({ start: found, end: found + 1 });
      score += isWordStart(target, found) ? 8 : 1;
    }
    t = found + 1;
  }
  return { score, ranges };
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | undefined {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  if (words.length === 0) return { score: 0, ranges: [] };
  let score = 0;
  const ranges: MatchRange[] = [];
  for (const word of words) {
    const match = matchWord(word, target);
    if (match === undefined) return undefined;
    score += match.score;
    ranges.push(...match.ranges);
  }
  // Prefer targets containing the whole query as typed ("toggle pan" → "Toggle Panel ...").
  const phrase = query.trim().toLowerCase();
  const at = target.toLowerCase().indexOf(phrase);
  if (words.length > 1 && at >= 0) {
    return { score: score + 200, ranges: [{ start: at, end: at + phrase.length }] };
  }
  return { score, ranges: mergeRanges(ranges) };
}
