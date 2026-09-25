/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson, 2013): keeps the visual shape of a
 * line with far fewer points (spec 06: above 50k points, downsample line charts).
 */
export function lttb(
  points: readonly (readonly [number, number])[],
  threshold: number,
): [number, number][] {
  if (threshold >= points.length || threshold < 3) return points.map((p) => [p[0], p[1]]);
  const sampled: [number, number][] = [];
  const bucketSize = (points.length - 2) / (threshold - 2);
  let a = 0;
  const first = points[0];
  if (first !== undefined) sampled.push([first[0], first[1]]);
  for (let i = 0; i < threshold - 2; i++) {
    // Average of the next bucket.
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += points[j]?.[0] ?? 0;
      avgY += points[j]?.[1] ?? 0;
    }
    const count = Math.max(1, nextEnd - nextStart);
    avgX /= count;
    avgY /= count;
    // The point in this bucket forming the largest triangle with the last point and the average.
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.floor((i + 1) * bucketSize) + 1;
    const [ax, ay] = points[a] ?? [0, 0];
    let maxArea = -1;
    let chosen = start;
    for (let j = start; j < end; j++) {
      const [x, y] = points[j] ?? [0, 0];
      const area = Math.abs((ax - avgX) * (y - ay) - (ax - x) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        chosen = j;
      }
    }
    const point = points[chosen];
    if (point !== undefined) sampled.push([point[0], point[1]]);
    a = chosen;
  }
  const last = points.at(-1);
  if (last !== undefined) sampled.push([last[0], last[1]]);
  return sampled;
}
