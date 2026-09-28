import { parse, stringify } from 'yaml';
import { z } from 'zod';

/**
 * Query front-matter (spec 08, "Query metadata"): YAML in a KQL comment block at the top of a
 * `.kql` file, so the file still pastes into the portal:
 *
 *     // ---
 *     // name: Failed sign-ins by user
 *     // tags: [bruteforce]
 *     // ---
 *     SigninLogs | …
 *
 * My Queries only need `name`; packs (Phase 8) validate the full schema.
 */
export const QueryMetaSchema = z
  .looseObject({
    id: z.string().max(200).optional(),
    name: z.string().max(300).optional(),
    description: z.string().max(5000).optional(),
    category: z.string().max(100).optional(),
    tags: z.array(z.string().max(100)).max(100).optional(),
    tables: z.array(z.string().max(300)).max(200).optional(),
    mitre: z.array(z.string().max(20)).max(100).optional(),
    timespan: z.string().max(100).optional(),
  })
  .catch({});
export type QueryMeta = z.infer<typeof QueryMetaSchema>;

const MARKER = /^\s*\/\/\s*---\s*$/;

export interface ParsedQueryFile {
  meta: QueryMeta;
  /** The query without the front-matter block. */
  body: string;
  /** Front-matter was present (even if it didn't parse). */
  hasFrontMatter: boolean;
}

export function parseQueryFile(text: string): ParsedQueryFile {
  const content = text.replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  if (!MARKER.test(lines[0] ?? '')) return { meta: {}, body: content, hasFrontMatter: false };
  const end = lines.findIndex((line, i) => i > 0 && MARKER.test(line));
  if (end < 0) return { meta: {}, body: content, hasFrontMatter: false };
  const yamlText = lines
    .slice(1, end)
    .map((line) => line.replace(/^\s*\/\/ ?/, ''))
    .join('\n');
  let meta: QueryMeta = {};
  try {
    meta = QueryMetaSchema.parse(parse(yamlText) ?? {});
  } catch {
    meta = {};
  }
  return { meta, body: lines.slice(end + 1).join('\n'), hasFrontMatter: true };
}

/** A `.kql` file: front-matter (when there is any) followed by the query. */
export function formatQueryFile(meta: QueryMeta, body: string): string {
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return body;
  const yamlText = stringify(Object.fromEntries(entries), { lineWidth: 0 }).trimEnd();
  const comment = yamlText
    .split('\n')
    .map((line) => (line === '' ? '//' : `// ${line}`))
    .join('\n');
  return `// ---\n${comment}\n// ---\n${body}`;
}
