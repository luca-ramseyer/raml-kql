import { describe, expect, it } from 'vitest';

import { durationMs, timeRangeForDuration } from './time-range';

describe('pack timespans', () => {
  it('parse ISO 8601 durations', () => {
    expect(durationMs('P1D')).toBe(86_400_000);
    expect(durationMs('PT4H')).toBe(4 * 3_600_000);
    expect(durationMs('P1W')).toBe(7 * 86_400_000);
    expect(durationMs('PT30M')).toBe(30 * 60_000);
    expect(durationMs('P')).toBeUndefined();
    expect(durationMs('1d')).toBeUndefined();
  });

  it('map to the smallest covering preset', () => {
    expect(timeRangeForDuration('P1D')).toEqual({ kind: 'preset', preset: '24h' });
    expect(timeRangeForDuration('P14D')).toEqual({ kind: 'preset', preset: '30d' });
    expect(timeRangeForDuration('P90D')).toEqual({ kind: 'preset', preset: '30d' });
    expect(timeRangeForDuration('PT2H')).toEqual({ kind: 'preset', preset: '4h' });
    expect(timeRangeForDuration(undefined)).toBeUndefined();
  });
});
