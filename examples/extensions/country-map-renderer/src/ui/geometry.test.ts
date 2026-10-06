import { describe, expect, it } from 'vitest';

import { unwrap } from './geometry';

describe('unwrap', () => {
  it('keeps a ring that crosses the antimeridian continuous', () => {
    // Chukotka: the ring runs east past 180° and comes back as −170°.
    const ring = [
      [170, 65],
      [179, 66],
      [-175, 67],
      [-170, 66],
      [170, 65],
    ];
    const lons = unwrap(ring).map((p) => p[0]);
    expect(lons).toEqual([170, 179, 185, 190, 170]);
    for (let i = 1; i < lons.length; i += 1) {
      expect(Math.abs((lons[i] ?? 0) - (lons[i - 1] ?? 0))).toBeLessThan(180);
    }
  });

  it('leaves an ordinary ring alone', () => {
    const ring = [
      [5, 45],
      [10, 47],
      [8, 46],
    ];
    expect(unwrap(ring)).toEqual(ring);
  });
});
