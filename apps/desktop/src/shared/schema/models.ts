import { z } from 'zod';

/**
 * Workspace schemas for IntelliSense (spec 05, "Schema-aware IntelliSense"). Metadata only:
 * table, column and function names and types. Never data.
 */

/** Log Analytics column types, as the Kusto language service knows them. */
export const KqlTypeSchema = z.enum([
  'bool',
  'datetime',
  'dynamic',
  'guid',
  'int',
  'long',
  'real',
  'string',
  'timespan',
  'decimal',
]);
export type KqlType = z.infer<typeof KqlTypeSchema>;

export const SchemaColumnSchema = z.object({
  name: z.string().min(1).max(500),
  type: KqlTypeSchema,
  description: z.string().max(2000).optional(),
});
export type SchemaColumn = z.infer<typeof SchemaColumnSchema>;

export const SchemaTableSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  columns: z.array(SchemaColumnSchema).max(5000),
});
export type SchemaTable = z.infer<typeof SchemaTableSchema>;

export const SchemaFunctionSchema = z.object({
  name: z.string().min(1).max(500),
  /** Parameter list without parentheses, e.g. `start:datetime, end:datetime`. */
  parameters: z.string().max(5000),
  body: z.string().max(100_000),
  description: z.string().max(2000).optional(),
});
export type SchemaFunction = z.infer<typeof SchemaFunctionSchema>;

/** The schema of one workspace. */
export const WorkspaceSchemaDataSchema = z.object({
  tables: z.array(SchemaTableSchema).max(10_000),
  functions: z.array(SchemaFunctionSchema).max(10_000),
});
export type WorkspaceSchemaData = z.infer<typeof WorkspaceSchemaDataSchema>;

/** Availability: in how many of the requested workspaces something exists. */
export const MergedColumnSchema = SchemaColumnSchema.extend({
  available: z.number().int().nonnegative(),
});
export type MergedColumn = z.infer<typeof MergedColumnSchema>;

export const MergedTableSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  available: z.number().int().nonnegative(),
  columns: z.array(MergedColumnSchema),
});
export type MergedTable = z.infer<typeof MergedTableSchema>;

export const MergedFunctionSchema = SchemaFunctionSchema.extend({
  available: z.number().int().nonnegative(),
});
export type MergedFunction = z.infer<typeof MergedFunctionSchema>;

export const MergedSchemaSchema = z.object({
  /** Workspaces whose schema was loaded (the denominator of "available in n/m"). */
  loaded: z.number().int().nonnegative(),
  /** Workspaces whose schema couldn't be loaded (no access, network, ...). */
  failed: z.number().int().nonnegative(),
  tables: z.array(MergedTableSchema),
  functions: z.array(MergedFunctionSchema),
});
export type MergedSchema = z.infer<typeof MergedSchemaSchema>;

export const SchemaRequestSchema = z.object({
  resourceIds: z.array(z.string().min(1).max(1000)).max(5000),
  /** Ignore the disk cache ("Refresh Schema"). */
  refresh: z.boolean().optional(),
});
export type SchemaRequest = z.infer<typeof SchemaRequestSchema>;

/** Map a Log Analytics / ARM type name onto a KQL type (unknown types become `string`). */
export function normalizeKqlType(type: string): KqlType {
  switch (type.toLowerCase()) {
    case 'bool':
    case 'boolean':
      return 'bool';
    case 'datetime':
    case 'date':
      return 'datetime';
    case 'dynamic':
      return 'dynamic';
    case 'guid':
    case 'uniqueid':
      return 'guid';
    case 'int':
    case 'int32':
      return 'int';
    case 'long':
    case 'int64':
      return 'long';
    case 'real':
    case 'double':
      return 'real';
    case 'timespan':
    case 'time':
      return 'timespan';
    case 'decimal':
      return 'decimal';
    default:
      return 'string';
  }
}

const NUMERIC_RANK: Partial<Record<KqlType, number>> = { int: 1, long: 2, real: 3, decimal: 4 };

/**
 * The type to show when workspaces disagree (spec 04, "Schema union"): widen numbers
 * (`int`→`long`→`real`), anything else becomes `string`.
 */
export function widenKqlType(a: KqlType, b: KqlType): KqlType {
  if (a === b) return a;
  const ra = NUMERIC_RANK[a];
  const rb = NUMERIC_RANK[b];
  if (ra !== undefined && rb !== undefined) return ra > rb ? a : b;
  return 'string';
}

/**
 * Union of workspace schemas with availability counts. Tables and functions are matched by
 * name case-sensitively (KQL names are case-sensitive).
 */
export function mergeSchemas(
  schemas: readonly WorkspaceSchemaData[],
  failed: number,
): MergedSchema {
  const tables = new Map<string, { table: MergedTable; columns: Map<string, MergedColumn> }>();
  const functions = new Map<string, MergedFunction>();

  for (const schema of schemas) {
    for (const table of schema.tables) {
      let entry = tables.get(table.name);
      if (entry === undefined) {
        entry = {
          table: { name: table.name, description: table.description, available: 0, columns: [] },
          columns: new Map(),
        };
        tables.set(table.name, entry);
      }
      entry.table.available += 1;
      entry.table.description ??= table.description;
      const seen = new Set<string>();
      for (const column of table.columns) {
        if (seen.has(column.name)) continue;
        seen.add(column.name);
        const existing = entry.columns.get(column.name);
        if (existing === undefined) {
          entry.columns.set(column.name, { ...column, available: 1 });
        } else {
          existing.available += 1;
          existing.type = widenKqlType(existing.type, column.type);
          existing.description ??= column.description;
        }
      }
    }
    for (const fn of schema.functions) {
      const existing = functions.get(fn.name);
      if (existing === undefined) functions.set(fn.name, { ...fn, available: 1 });
      else existing.available += 1;
    }
  }

  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
  return {
    loaded: schemas.length,
    failed,
    tables: [...tables.values()]
      .map(({ table, columns }) => {
        const merged: MergedTable = { ...table, columns: [...columns.values()] };
        if (merged.description === undefined) delete merged.description;
        return merged;
      })
      .sort(byName),
    functions: [...functions.values()].sort(byName),
  };
}
