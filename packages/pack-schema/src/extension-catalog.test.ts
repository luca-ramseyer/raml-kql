import { describe, expect, it } from 'vitest';

import { ExtensionCatalogFileSchema, parseCatalog } from './extension-catalog';

const entry = {
  id: 'raml.virustotal-enricher',
  displayName: 'VirusTotal Enricher',
  publisher: 'raml',
  description: 'Look up IPs, domains and hashes on VirusTotal.',
  categories: ['Enrichment'],
  package: 'https://github.com/example/raml-kql/releases/latest/download/virustotal-enricher.rkqlx',
};

describe('extension catalog', () => {
  it('accepts a well-formed catalog', () => {
    const file = { schemaVersion: 1, name: 'Raml KQL extensions', extensions: [entry] };
    expect(ExtensionCatalogFileSchema.safeParse(file).success).toBe(true);
    const parsed = parseCatalog(file);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems).toEqual([]);
  });

  it('skips a bad entry and keeps the others', () => {
    const parsed = parseCatalog({
      schemaVersion: 1,
      name: 'x',
      extensions: [
        entry,
        { ...entry, id: 'raml.http', package: 'http://example.com/x.rkqlx' },
        { ...entry, id: 'raml.creds', package: 'https://user:pass@example.com/x.rkqlx' },
        { ...entry, id: 'not an id' },
        'nonsense',
        { ...entry, extra: true },
      ],
    });
    expect(parsed.entries.map((e) => e.id)).toEqual(['raml.virustotal-enricher']);
    expect(parsed.problems).toHaveLength(5);
  });

  it('reports a duplicate id once', () => {
    const parsed = parseCatalog({ schemaVersion: 1, name: 'x', extensions: [entry, entry] });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems[0]).toContain('listed twice');
    expect(
      ExtensionCatalogFileSchema.safeParse({
        schemaVersion: 1,
        name: 'x',
        extensions: [entry, entry],
      }).success,
    ).toBe(false);
  });

  it('refuses anything that is not a catalog', () => {
    expect(() => parseCatalog({ hello: 'world' })).toThrow(/not an extension catalog/);
    expect(() => parseCatalog(null)).toThrow();
    expect(() => parseCatalog({ schemaVersion: 2, name: 'x', extensions: [] })).toThrow();
  });
});
