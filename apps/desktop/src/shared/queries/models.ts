import { PackQueryMetaSchema, ParameterSchema } from '@raml-kql/pack-schema/schemas';
import { z } from 'zod';

import { QUERY_TEXT_MAX } from '../query/models';

/** My Queries (spec 08): `.kql` files in `<config>/queries/`, paths relative to it (POSIX). */
export const QueryPathSchema = z
  .string()
  .min(1)
  .max(1000)
  .refine((p) => !p.startsWith('/') && !p.split('/').some((part) => part === '..' || part === ''), {
    message: 'Invalid path',
  });

export const QueryNodeSchema = z.object({
  path: z.string(),
  kind: z.enum(['folder', 'file']),
  /** Display name: front-matter `name`, else the file name. */
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type QueryNode = z.infer<typeof QueryNodeSchema>;

export const QueriesSnapshotSchema = z.object({ nodes: z.array(QueryNodeSchema) });
export type QueriesSnapshot = z.infer<typeof QueriesSnapshotSchema>;

export const QueryFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  /** The query without front-matter (what the editor shows). */
  body: z.string().max(QUERY_TEXT_MAX),
  /** Valid `parameters` from the front-matter (shown in the parameter bar). */
  parameters: z.array(ParameterSchema).optional(),
  /** ISO 8601 duration from the front-matter. */
  timespan: z.string().optional(),
});
export type QueryFile = z.infer<typeof QueryFileSchema>;

export const SaveQueryRequestSchema = z
  .object({
    /** Existing file to overwrite; omit to create a new one from `name`. */
    path: QueryPathSchema.optional(),
    name: z.string().min(1).max(300).optional(),
    folder: z.union([QueryPathSchema, z.literal('')]).optional(),
    body: z.string().max(QUERY_TEXT_MAX),
    /** Front-matter for a new file (Duplicate to My Queries keeps a pack query's metadata). */
    meta: PackQueryMetaSchema.partial().optional(),
  })
  .strict();
export type SaveQueryRequest = z.infer<typeof SaveQueryRequestSchema>;
