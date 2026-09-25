import type { MergedSchema } from '../../../shared/schema/models';
import { TABLE_DESCRIPTIONS } from '../../../shared/schema/table-descriptions';

/**
 * The merged schema as a monaco-kusto `EngineSchema` (spec 05): one synthetic database, with the
 * availability hint ("Available in 3/5 selected workspaces") in every docstring that needs it.
 * Declared structurally so this module (and its tests) don't load Monaco.
 */
export interface KustoColumn {
  name: string;
  type: string;
  docstring?: string;
}
export interface KustoTable {
  name: string;
  entityType: 'Table';
  columns: KustoColumn[];
  docstring?: string;
}
export interface KustoFunction {
  name: string;
  body: string;
  inputParameters: { name: string; type: string; cslType: string }[];
  docstring?: string;
}
export interface KustoDatabase {
  name: string;
  tables: KustoTable[];
  functions: KustoFunction[];
  graphs: [];
  entityGroups: [];
  majorVersion: number;
  minorVersion: number;
}
export interface KustoEngineSchema {
  clusterType: 'Engine';
  cluster: { connectionString: string; databases: KustoDatabase[] };
  database: KustoDatabase;
}

export const SCHEMA_DATABASE_NAME = 'Targets';

export function availabilityText(available: number, total: number): string | undefined {
  if (total === 0 || available >= total) return undefined;
  return available === 0
    ? 'Not in any selected workspace'
    : `Available in ${String(available)}/${String(total)} selected workspaces`;
}

function docstring(...parts: (string | undefined)[]): string | undefined {
  const text = parts.filter((p) => p !== undefined && p !== '').join('\n\n');
  return text === '' ? undefined : text;
}

/** `lookback:timespan, name:string = "x"` → scalar parameters; `undefined` if not parseable. */
export function parseFunctionParameters(
  parameters: string,
): { name: string; type: string; cslType: string }[] | undefined {
  const text = parameters.trim();
  if (text === '') return [];
  const result: { name: string; type: string; cslType: string }[] = [];
  for (const part of text.split(',')) {
    const match = /^\s*([A-Za-z_][\w]*)\s*:\s*([a-z]+)\s*(=.*)?$/.exec(part);
    if (match === null) return undefined; // tabular parameters and other shapes
    const [, name = '', type = ''] = match;
    result.push({ name, type, cslType: type });
  }
  return result;
}

export function toKustoSchema(
  merged: MergedSchema,
  options: {
    hideTablesMissingEverywhere: boolean;
    /**
     * Must increase with every schema sent to the language service: monaco-kusto only rebuilds
     * a cached database whose `majorVersion` went up.
     */
    version: number;
  },
): KustoEngineSchema {
  const total = merged.loaded;
  const tables: KustoTable[] = merged.tables.map((table) => ({
    name: table.name,
    entityType: 'Table',
    columns: table.columns.map((column) => {
      const doc = docstring(
        column.description,
        availabilityText(column.available, table.available),
      );
      return {
        name: column.name,
        type: column.type,
        ...(doc === undefined ? {} : { docstring: doc }),
      };
    }),
    ...withDoc(
      docstring(
        table.description ?? TABLE_DESCRIPTIONS[table.name],
        availabilityText(table.available, total),
      ),
    ),
  }));

  if (!options.hideTablesMissingEverywhere) {
    const known = new Set(merged.tables.map((t) => t.name));
    for (const [name, description] of Object.entries(TABLE_DESCRIPTIONS)) {
      if (known.has(name)) continue;
      tables.push({
        name,
        entityType: 'Table',
        columns: [],
        ...withDoc(docstring(description, availabilityText(0, Math.max(total, 1)))),
      });
    }
  }

  const functions: KustoFunction[] = [];
  for (const fn of merged.functions) {
    const inputParameters = parseFunctionParameters(fn.parameters);
    if (inputParameters === undefined) continue;
    functions.push({
      name: fn.name,
      body: fn.body,
      inputParameters,
      ...withDoc(docstring(fn.description, availabilityText(fn.available, total))),
    });
  }

  const database: KustoDatabase = {
    name: SCHEMA_DATABASE_NAME,
    tables,
    functions,
    graphs: [],
    entityGroups: [],
    majorVersion: options.version,
    minorVersion: 0,
  };
  return {
    clusterType: 'Engine',
    cluster: { connectionString: 'https://targets.invalid', databases: [database] },
    database,
  };
}

function withDoc(doc: string | undefined): { docstring?: string } {
  return doc === undefined ? {} : { docstring: doc };
}
