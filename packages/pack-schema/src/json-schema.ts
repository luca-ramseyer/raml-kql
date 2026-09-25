import { z } from 'zod';

import { ExtensionManifestSchema } from './extension-manifest';
import { PackIndexSchema, PackManifestSchema, PackQueryMetaSchema } from './schemas';

/**
 * JSON Schema files for pack authors (spec 08, "Schemas"): editors validate `rkqlpack.yaml`,
 * `rkql-index.yaml` and sidecar query files with `# yaml-language-server: $schema=…`.
 * Cross-field rules (enum `values`, default types) are checked by the zod schemas only.
 */
export const JSON_SCHEMA_FILES = {
  'rkqlpack.schema.json': { schema: PackManifestSchema, title: 'Raml KQL query pack manifest' },
  'rkql-query.schema.json': { schema: PackQueryMetaSchema, title: 'Raml KQL pack query metadata' },
  'rkql-index.schema.json': { schema: PackIndexSchema, title: 'Raml KQL pack index' },
  'rkql-extension.schema.json': {
    schema: ExtensionManifestSchema,
    title: 'Raml KQL extension manifest (package.json)',
  },
} as const;

export function buildJsonSchemas(): Record<keyof typeof JSON_SCHEMA_FILES, string> {
  const out = {} as Record<keyof typeof JSON_SCHEMA_FILES, string>;
  for (const [file, { schema, title }] of Object.entries(JSON_SCHEMA_FILES)) {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    out[file as keyof typeof JSON_SCHEMA_FILES] =
      `${JSON.stringify({ ...json, title }, null, 2)}\n`;
  }
  return out;
}
