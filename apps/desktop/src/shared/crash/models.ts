import { z } from 'zod';

/** Crash records (spec 10): sanitized before they are written, shown or sent. */
export const CrashKindSchema = z.enum([
  'main',
  'renderer',
  'extension',
  'renderer-gone',
  'child-gone',
  'unclean-exit',
]);
export type CrashKind = z.infer<typeof CrashKindSchema>;

export const CrashRecordSchema = z.object({
  id: z.string(),
  ts: z.string(),
  kind: CrashKindSchema,
  message: z.string().max(4000),
  stack: z.string().max(20_000).optional(),
  extensionId: z.string().max(200).optional(),
  appVersion: z.string(),
  electronVersion: z.string(),
  os: z.string(),
});
export type CrashRecord = z.infer<typeof CrashRecordSchema>;

export const PendingCrashesSchema = z.object({
  /** The last session didn't end normally. */
  unclean: z.boolean(),
  records: z.array(CrashRecordSchema),
});
export type PendingCrashes = z.infer<typeof PendingCrashesSchema>;

export const CrashReportSchema = z.object({
  title: z.string().max(300),
  body: z.string().max(100_000),
});
export type CrashReport = z.infer<typeof CrashReportSchema>;

/** Where "Report on GitHub" opens a prefilled issue. */
export const ISSUES_URL = 'https://github.com/luca-ramseyer/raml-kql/issues/new';
