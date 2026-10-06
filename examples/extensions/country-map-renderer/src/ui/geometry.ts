import type { Position } from 'geojson';

/**
 * Natural Earth is cut at the antimeridian, so a ring that crosses it (Russia, Fiji,
 * Antarctica) jumps from +180° to −180°, and drawing that as-is paints a straight line across
 * the whole map. Keep each ring continuous by moving a point 360° whenever it would jump,
 * then draw the ring a second time shifted by ±360° so the part that ran off one edge
 * appears on the other (the clip path trims the overflow).
 */
export function unwrap(ring: Position[]): Position[] {
  let offset = 0;
  let previous = ring[0]?.[0] ?? 0;
  return ring.map((point) => {
    const lon = point[0] ?? 0;
    if (lon - previous > 180) offset -= 360;
    else if (previous - lon > 180) offset += 360;
    previous = lon;
    return [lon + offset, point[1] ?? 0];
  });
}
