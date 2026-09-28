import { z } from 'zod';

/**
 * Query pack schemas (spec 08). Packs are data only: KQL plus metadata. Objects are strict so
 * a typo in a pack (`descripton:`) is reported instead of silently ignored.
 */

/** Semantic version (`1.3.0`, `2.0.0-beta.1`). */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** ISO 8601 duration as used by the Log Analytics `timespan` parameter (`P1D`, `PT4H`). */
export const ISO_DURATION = /^P(?!$)(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

/** MITRE ATT&CK technique or sub-technique ID. */
export const MITRE_ID = /^T\d{4}(\.\d{3})?$/;

/** A KQL identifier usable as a `let` name (parameters). */
export const KQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `publisher.name`, lowercase. */
export const PACK_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Query IDs within a pack (file-name-like). */
export const QUERY_ID = /^[a-z0-9][a-z0-9._-]*$/;

export const PARAMETER_TYPES = [
  'string',
  'long',
  'int',
  'real',
  'bool',
  'datetime',
  'timespan',
  'dynamic',
  'enum',
  'stringList',
] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

export const QUERY_CATEGORIES = [
  'hunting',
  'investigation',
  'triage',
  'reporting',
  'health',
] as const;

export const QUERY_SEVERITIES = ['informational', 'low', 'medium', 'high'] as const;

/** A parameter's value: JSON that fits its type (checked by `checkParameterValue`). */
export const ParameterValueSchema = z.union([
  z.string().max(100_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(10_000)).max(10_000),
  z.json(),
]);
export type ParameterValue = z.infer<typeof ParameterValueSchema>;

export const ParameterSchema = z
  .strictObject({
    name: z
      .string()
      .regex(KQL_IDENTIFIER, 'must be a KQL identifier (letters, digits, _)')
      .max(100),
    type: z.enum(PARAMETER_TYPES),
    default: ParameterValueSchema.optional(),
    description: z.string().max(1000).optional(),
    /** `enum` only: the allowed values. */
    values: z.array(z.string().max(1000)).min(1).max(500).optional(),
  })
  .superRefine((parameter, ctx) => {
    if (parameter.type === 'enum' && parameter.values === undefined) {
      ctx.addIssue({ code: 'custom', message: 'enum parameters need `values`', path: ['values'] });
    }
    if (parameter.type !== 'enum' && parameter.values !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: '`values` is only for enum parameters',
        path: ['values'],
      });
    }
    if (parameter.default !== undefined) {
      const problem = checkParameterValue(parameter, parameter.default);
      if (problem !== undefined) {
        ctx.addIssue({ code: 'custom', message: `default ${problem}`, path: ['default'] });
      }
    }
  });
export type Parameter = z.infer<typeof ParameterSchema>;

/** Query metadata of a pack query (front-matter or sidecar `.yaml`). */
export const PackQueryMetaSchema = z.strictObject({
  id: z.string().regex(QUERY_ID, 'lowercase letters, digits, ".", "_" and "-"').max(200),
  name: z.string().min(1).max(300),
  description: z.string().min(1).max(5000),
  category: z.enum(QUERY_CATEGORIES).optional(),
  severity: z.enum(QUERY_SEVERITIES).optional(),
  tables: z.array(z.string().min(1).max(300)).min(1).max(200),
  mitre: z
    .array(z.string().regex(MITRE_ID, 'must look like T1110 or T1110.003'))
    .max(100)
    .optional(),
  tags: z.array(z.string().min(1).max(100)).max(100).optional(),
  timespan: z.string().regex(ISO_DURATION, 'must be an ISO 8601 duration like P1D').optional(),
  render: z.string().max(100).optional(),
  parameters: z
    .array(ParameterSchema)
    .max(50)
    .refine((list) => new Set(list.map((p) => p.name)).size === list.length, {
      message: 'parameter names must be unique',
    })
    .optional(),
  references: z.array(z.url().max(2000)).max(50).optional(),
});
export type PackQueryMeta = z.infer<typeof PackQueryMetaSchema>;

export const PackManifestSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  id: z.string().regex(PACK_ID, 'must be publisher.name, lowercase').max(200),
  name: z.string().min(1).max(200),
  version: z.string().regex(SEMVER, 'must be a semantic version like 1.3.0'),
  description: z.string().min(1).max(5000),
  authors: z.array(z.string().max(300)).max(100).optional(),
  license: z.string().max(100).optional(),
  homepage: z.url().max(2000).optional(),
  minAppVersion: z.string().regex(SEMVER).optional(),
  tags: z.array(z.string().min(1).max(100)).max(100).optional(),
  defaults: z
    .strictObject({
      timespan: z.string().regex(ISO_DURATION, 'must be an ISO 8601 duration like P7D').optional(),
      targetGroup: z.string().max(100).optional(),
    })
    .optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

/** `rkql-index.yaml`: a repository with several packs. */
export const PackIndexSchema = z.strictObject({
  $schema: z.string().optional(),
  packs: z
    .array(
      z.strictObject({
        path: z
          .string()
          .min(1)
          .max(500)
          .refine((p) => !p.split('/').includes('..') && !p.startsWith('/'), {
            message: 'must be a relative path inside the repository',
          }),
      }),
    )
    .min(1)
    .max(200),
});
export type PackIndex = z.infer<typeof PackIndexSchema>;

// --- Parameter values ------------------------------------------------------------------------

const TIMESPAN_LITERAL =
  /^(\d+(\.\d+)?(d|h|m|s|ms|microsecond|microseconds|tick|ticks)|\d{1,2}:\d{2}(:\d{2}(\.\d{1,7})?)?|\d+\.\d{1,2}:\d{2}:\d{2}(\.\d{1,7})?)$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const INT_MIN = -2_147_483_648;
const INT_MAX = 2_147_483_647;
const LONG = /^-?\d{1,19}$/;

/** Why `value` doesn't fit the parameter (undefined when it does). */
export function checkParameterValue(
  parameter: Pick<Parameter, 'type' | 'values'>,
  value: unknown,
): string | undefined {
  switch (parameter.type) {
    case 'string':
      return typeof value === 'string' ? undefined : 'must be a string';
    case 'enum':
      if (typeof value !== 'string') return 'must be a string';
      return parameter.values === undefined || parameter.values.includes(value)
        ? undefined
        : `must be one of ${parameter.values.join(', ')}`;
    case 'int':
      return typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= INT_MIN &&
        value <= INT_MAX
        ? undefined
        : 'must be a whole number (32-bit)';
    case 'long': {
      if (typeof value === 'number') {
        return Number.isSafeInteger(value) ? undefined : 'must be a whole number';
      }
      if (typeof value === 'string' && LONG.test(value)) {
        const big = BigInt(value);
        return big >= -(2n ** 63n) && big < 2n ** 63n ? undefined : 'is out of range for long';
      }
      return 'must be a whole number';
    }
    case 'real':
      return typeof value === 'number' || value === 'nan' || value === '+inf' || value === '-inf'
        ? undefined
        : 'must be a number';
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    case 'datetime':
      return typeof value === 'string' &&
        ISO_DATETIME.test(value) &&
        !Number.isNaN(Date.parse(value))
        ? undefined
        : 'must be an ISO 8601 date/time like 2026-01-31T12:00:00Z';
    case 'timespan':
      return typeof value === 'string' && TIMESPAN_LITERAL.test(value)
        ? undefined
        : 'must be a KQL timespan like 1d, 4h, 30m or 01:30:00';
    case 'dynamic':
      return value === undefined ? 'must be JSON' : undefined;
    case 'stringList':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? undefined
        : 'must be a list of strings';
  }
}
