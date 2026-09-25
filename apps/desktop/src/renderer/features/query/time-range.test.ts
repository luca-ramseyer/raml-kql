import { describe, expect, it } from 'vitest';

import { presetTimespan } from './query-docs';
import { formatDateTime, parseDateTime, timeRangeLabel, timespanFor } from './time-range';

describe('time range helpers', () => {
  it('formats and parses UTC times', () => {
    const date = new Date('2026-01-31T08:05:00Z');
    expect(formatDateTime(date, 'utc')).toBe('2026-01-31 08:05');
    expect(parseDateTime('2026-01-31 08:05', 'utc')).toEqual(date);
    expect(parseDateTime('2026-01-31T08:05:30', 'utc')).toEqual(new Date('2026-01-31T08:05:30Z'));
    expect(parseDateTime('2026-01-31', 'utc')).toEqual(new Date('2026-01-31T00:00:00Z'));
  });

  it('round-trips local times', () => {
    const date = new Date(2026, 5, 15, 13, 45);
    expect(parseDateTime(formatDateTime(date, 'local'), 'local')).toEqual(date);
  });

  it.each(['', '31.01.2026', '2026-02-31', '2026-13-01', '2026-01-01 24:00', '2026-01-01 10:61'])(
    'rejects %j',
    (text) => {
      expect(parseDateTime(text, 'utc')).toBeUndefined();
    },
  );

  it('labels presets and custom ranges', () => {
    expect(timeRangeLabel({ kind: 'preset', preset: '7d' }, 'utc')).toBe('Last 7 days');
    expect(
      timeRangeLabel(
        { kind: 'custom', start: '2026-01-01T00:00:00.000Z', end: '2026-01-02T12:00:00.000Z' },
        'utc',
      ),
    ).toBe('2026-01-01 00:00 – 2026-01-02 12:00 (UTC)');
  });

  it('builds the API timespan, or none when set in the query', () => {
    expect(presetTimespan('30m')).toBe('PT30M');
    expect(presetTimespan('24h')).toBe('PT24H');
    expect(presetTimespan('3d')).toBe('P3D');
    expect(timespanFor({ kind: 'preset', preset: '1h' }, false)).toBe('PT1H');
    expect(timespanFor({ kind: 'preset', preset: '1h' }, true)).toBeUndefined();
    expect(
      timespanFor(
        { kind: 'custom', start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
        false,
      ),
    ).toBe('2026-01-01T00:00:00Z/2026-01-02T00:00:00Z');
  });
});
