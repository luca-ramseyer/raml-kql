import { z } from 'zod';

/**
 * Auto-update state (spec 11), shared by the main-process `Updater` and the workbench.
 * Messages never contain URLs with tokens or file paths.
 */
export const UpdateStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('checking') }),
  z.object({ status: z.literal('upToDate') }),
  z.object({ status: z.literal('available'), version: z.string() }),
  z.object({
    status: z.literal('downloading'),
    version: z.string(),
    percent: z.number().min(0).max(100),
  }),
  z.object({ status: z.literal('ready'), version: z.string() }),
  z.object({ status: z.literal('error'), message: z.string().max(500) }),
  /** This install can't update itself (demo mode, a dev build, a deb/rpm install). */
  z.object({ status: z.literal('unsupported'), reason: z.string().max(500) }),
]);
export type UpdateState = z.infer<typeof UpdateStateSchema>;
