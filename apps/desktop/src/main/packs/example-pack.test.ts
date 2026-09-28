import path from 'node:path';

import { discoverPacks } from '@raml-kql/pack-schema';
import { describe, expect, it } from 'vitest';

import { syntaxDiagnostics, topLevelStatements } from '../kusto/kusto-parser';

import { readFolderFiles } from './pack-files';
import { injectParameters } from './parameters';

/** CLAUDE.md: sample queries are valid KQL, parse cleanly and use TimeGenerated. */
const PACK_DIR = path.resolve(import.meta.dirname, '../../../../../examples/packs/raml.starter');

describe('examples/packs/raml.starter', async () => {
  const { packs, problems } = discoverPacks(await readFolderFiles(PACK_DIR));
  const [pack] = packs;
  const queries = pack?.queries ?? [];

  it('loads without problems', () => {
    expect(problems).toEqual([]);
    expect(pack?.problems).toEqual([]);
    expect(pack?.manifest.id).toBe('raml.starter');
    expect(queries.length).toBeGreaterThanOrEqual(10);
  });

  it.each(queries.map((q) => [q.id, q] as const))('%s is portable, valid KQL', (_id, query) => {
    expect(syntaxDiagnostics(query.body)).toEqual([]);
    expect(query.body).toContain('TimeGenerated');
    expect(query.body).not.toMatch(/\bTimestamp\b/);
    expect(query.body).not.toMatch(/^\s*\./m);
    for (const table of query.tables) expect(query.body).toContain(table);
    // Every parameter has a default `let` in the body, so the query runs in the portal too.
    const lets = topLevelStatements(query.body).flatMap((s) =>
      s.name === undefined ? [] : [s.name],
    );
    for (const parameter of query.parameters ?? []) {
      expect(lets).toContain(parameter.name);
      expect(parameter.default).toBeDefined();
    }
    // Injecting the defaults keeps the query valid.
    const injected = injectParameters(
      query.body,
      (query.parameters ?? []).map((p) => ({
        name: p.name,
        type: p.type,
        ...(p.values === undefined ? {} : { values: p.values }),
        value: p.default ?? '',
      })),
    );
    expect(syntaxDiagnostics(injected)).toEqual([]);
  });
});
