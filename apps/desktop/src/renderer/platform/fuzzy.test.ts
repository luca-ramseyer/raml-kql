import { describe, expect, it } from 'vitest';

import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches every word, contiguously when possible', () => {
    const match = fuzzyMatch('side bar', 'View: Toggle Primary Side Bar Visibility');
    expect(match).toBeDefined();
    expect(match?.ranges).toEqual([{ start: 21, end: 29 }]);
  });

  it('matches subsequences', () => {
    expect(fuzzyMatch('tgl', 'Toggle')?.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 5 },
    ]);
  });

  it('fails when any word is missing', () => {
    expect(fuzzyMatch('toggle xyz', 'Toggle Panel')).toBeUndefined();
  });

  it('ranks whole-phrase and word-start matches higher', () => {
    const phrase = fuzzyMatch('toggle pan', 'View: Toggle Panel Visibility');
    const scattered = fuzzyMatch('toggle pan', 'View: Toggle Maximized Panel');
    expect(phrase!.score).toBeGreaterThan(scattered!.score);
    const wordStart = fuzzyMatch('set', 'Open Settings');
    const inside = fuzzyMatch('set', 'Reset Zoom');
    expect(wordStart!.score).toBeGreaterThan(inside!.score);
  });

  it('is case-insensitive and matches everything for an empty query', () => {
    expect(fuzzyMatch('THEME', 'Color Theme')).toBeDefined();
    expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, ranges: [] });
  });
});
