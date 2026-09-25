import { z } from 'zod';

/** A tab's time range (spec 05, "Time range picker"). */
export const TIME_PRESET_IDS = ['30m', '1h', '4h', '12h', '24h', '48h', '3d', '7d', '30d'] as const;

export const TimeRangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), preset: z.enum(TIME_PRESET_IDS) }),
  z.object({ kind: z.literal('custom'), start: z.iso.datetime(), end: z.iso.datetime() }),
]);
export type TimeRangeValue = z.infer<typeof TimeRangeSchema>;
