import { z } from 'zod';

/** A tab's time range (spec 05, "Time range picker"). */
export const TIME_PRESET_IDS = ['30m', '1h', '4h', '12h', '24h', '48h', '3d', '7d', '30d'] as const;

export const TimeRangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(TIME_PRESET_IDS) }),
  z.object({ kind: z.literal('custom'), start: z.iso.datetime(), end: z.iso.datetime() }),
]);
export type TimeRangeValue = z.infer<typeof TimeRangeSchema>;

const PRESET_MS: Record<(typeof TIME_PRESET_IDS)[number], number> = {
  '30m': 30 * 60_000,
  '1h': 3_600_000,
  '4h': 4 * 3_600_000,
  '12h': 12 * 3_600_000,
  '24h': 24 * 3_600_000,
  '48h': 48 * 3_600_000,
  '3d': 3 * 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** Milliseconds of an ISO 8601 duration (`P1D`, `PT4H`, `P2W`), or undefined. */
export function durationMs(iso: string): number | undefined {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    iso,
  );
  if (match === null || iso === 'P' || iso.endsWith('T')) return undefined;
  const [, w = '0', d = '0', h = '0', m = '0', s = '0'] = match;
  return (
    ((Number(w) * 7 + Number(d)) * 24 + Number(h)) * 3_600_000 +
    Number(m) * 60_000 +
    Number(s) * 1000
  );
}

/** The smallest preset covering a pack query's `timespan` (the widest preset when longer). */
export function timeRangeForDuration(iso: string | undefined): TimeRangeValue | undefined {
  const ms = iso === undefined ? undefined : durationMs(iso);
  if (ms === undefined || ms <= 0) return undefined;
  const preset = TIME_PRESET_IDS.find((id) => PRESET_MS[id] >= ms) ?? '30d';
  return { kind: 'preset', preset };
}
