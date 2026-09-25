import { ParameterSchema, QUERY_CATEGORIES, QUERY_SEVERITIES } from '@raml-kql/pack-schema/schemas';
import { z } from 'zod';

import { ConfigProblemSchema } from '../config/config-snapshots';

/**
 * Query pack sources and installed packs (spec 08). `sources.jsonc` lists the sources; the
 * files live machine-locally in `<config>/sources/<source id>/`.
 */
export const GIT_SHA = /^[0-9a-f]{40}$/;
export const SOURCE_ID = /^(git|file)-[0-9a-f]{12}$/;

const SourceIdSchema = z.string().regex(SOURCE_ID);

export const GitSourceSchema = z.object({
  id: SourceIdSchema,
  type: z.literal('git'),
  url: z.url().max(2000),
  /** Branch or tag; the default branch when omitted. */
  ref: z.string().min(1).max(200).optional(),
  /** The commit the source is pinned to. */
  sha: z.string().regex(GIT_SHA),
  addedAt: z.iso.datetime(),
  /** Reference to a token in OS secure storage (never the token). */
  credentialRef: z
    .string()
    .regex(/^src-[0-9a-f]{8,32}$/)
    .optional(),
});

export const FileSourceSchema = z.object({
  id: SourceIdSchema,
  type: z.literal('file'),
  /** The imported file or folder name (not its path, which is machine-specific). */
  name: z.string().min(1).max(300),
  /** SHA-256 of the imported pack files. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  addedAt: z.iso.datetime(),
});

export const SourceSchema = z.discriminatedUnion('type', [GitSourceSchema, FileSourceSchema]);
export type Source = z.infer<typeof SourceSchema>;
export type GitSource = z.infer<typeof GitSourceSchema>;

export const PackProblemSchema = z.object({
  file: z.string().max(2000),
  message: z.string().max(4000),
});
export type PackProblemData = z.infer<typeof PackProblemSchema>;

export const PackQueryInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(QUERY_CATEGORIES).optional(),
  severity: z.enum(QUERY_SEVERITIES).optional(),
  tables: z.array(z.string()),
  mitre: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  timespan: z.string().optional(),
  render: z.string().optional(),
  parameters: z.array(ParameterSchema).optional(),
  references: z.array(z.string()).optional(),
  /** Path of the `.kql` file in the source. */
  file: z.string(),
});
export type PackQueryInfo = z.infer<typeof PackQueryInfoSchema>;

export const PackQuerySchema = PackQueryInfoSchema.extend({ body: z.string() });
export type PackQueryData = z.infer<typeof PackQuerySchema>;

export const InstalledPackSchema = z.object({
  sourceId: z.string(),
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  authors: z.array(z.string()).optional(),
  license: z.string().optional(),
  homepage: z.string().optional(),
  tags: z.array(z.string()).optional(),
  defaults: z
    .object({ timespan: z.string().optional(), targetGroup: z.string().optional() })
    .optional(),
  queries: z.array(PackQueryInfoSchema),
  problems: z.array(PackProblemSchema),
});
export type InstalledPack = z.infer<typeof InstalledPackSchema>;

export const CommitInfoSchema = z.object({
  oid: z.string(),
  message: z.string().max(2000),
  author: z.string().max(300),
  date: z.iso.datetime(),
});
export type CommitInfo = z.infer<typeof CommitInfoSchema>;

export const SourceInfoSchema = z.object({
  id: z.string(),
  type: z.enum(['git', 'file']),
  /** URL (git) or imported file name (file). */
  label: z.string(),
  ref: z.string().optional(),
  sha: z.string().optional(),
  addedAt: z.string(),
  hasCredential: z.boolean(),
  /** Problems that kept whole packs from loading. */
  problems: z.array(PackProblemSchema),
  /** The source's files are missing or unreadable. */
  error: z.string().optional(),
  /** A newer commit exists (git, after an update check). */
  update: z.object({ sha: z.string(), commits: z.number().int().nonnegative() }).optional(),
  lastCheck: z.string().optional(),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const PacksSnapshotSchema = z.object({
  sources: z.array(SourceInfoSchema),
  packs: z.array(InstalledPackSchema),
  /** sources.jsonc problems. */
  problems: z.array(ConfigProblemSchema),
});
export type PacksSnapshot = z.infer<typeof PacksSnapshotSchema>;

/** What a source contains, shown before it's added. */
export const SourcePreviewSchema = z.object({
  previewId: z.string(),
  type: z.enum(['git', 'file']),
  label: z.string(),
  sha: z.string().optional(),
  packs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      queries: z.number().int(),
      problems: z.array(PackProblemSchema),
      /** Another source already provides a pack with this id (both are kept). */
      conflict: z.boolean(),
    }),
  ),
  problems: z.array(PackProblemSchema),
  /** The same source (URL and ref, or file content) is already added. */
  alreadyAdded: z.boolean(),
});
export type SourcePreview = z.infer<typeof SourcePreviewSchema>;

export const PreviewGitRequestSchema = z
  .object({
    url: z.string().min(1).max(2000),
    ref: z.string().min(1).max(200).optional(),
    /** For private repositories; stored in OS secure storage when the source is added. */
    token: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const ImportResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cancelled') }),
  z.object({ type: z.literal('pack'), preview: SourcePreviewSchema }),
  /** Loose `.kql` files became My Queries. */
  z.object({ type: z.literal('queries'), paths: z.array(z.string()) }),
]);
export type ImportResult = z.infer<typeof ImportResultSchema>;

export const QueryChangeSchema = z.object({
  packId: z.string(),
  packName: z.string(),
  queryId: z.string(),
  name: z.string(),
  change: z.enum(['added', 'removed', 'changed']),
  /** Full `.kql` file text before and after (for the diff). */
  before: z.string().optional(),
  after: z.string().optional(),
});
export type QueryChange = z.infer<typeof QueryChangeSchema>;

export const UpdatePreviewSchema = z.object({
  sourceId: z.string(),
  label: z.string(),
  fromSha: z.string(),
  toSha: z.string(),
  commits: z.array(CommitInfoSchema),
  /** More commits than listed. */
  moreCommits: z.boolean(),
  packs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      fromVersion: z.string().optional(),
      toVersion: z.string().optional(),
    }),
  ),
  changes: z.array(QueryChangeSchema),
  problems: z.array(PackProblemSchema),
});
export type UpdatePreview = z.infer<typeof UpdatePreviewSchema>;

export const PackQueryRefSchema = z
  .object({
    sourceId: z.string().max(100),
    packId: z.string().max(200),
    queryId: z.string().max(200),
  })
  .strict();
export type PackQueryRef = z.infer<typeof PackQueryRefSchema>;

export const SourceRefSchema = z.object({ sourceId: z.string().regex(SOURCE_ID) }).strict();
