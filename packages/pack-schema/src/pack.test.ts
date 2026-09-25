import { describe, expect, it } from 'vitest';

import { discoverPacks, loadPack } from './pack';
import { checkParameterValue, ParameterSchema } from './schemas';

const MANIFEST = `schemaVersion: 1
id: contoso.identity
name: Identity Hunting
version: 1.3.0
description: Sign-in hunting queries.
tags: [identity]
defaults:
  timespan: P7D
`;

const QUERY = `// ---
// id: failed-signins
// name: Failed sign-ins by user
// description: Users with the most failed sign-ins.
// category: hunting
// tables: [SigninLogs]
// mitre: [T1110, T1110.003]
// parameters:
//   - name: MinFailures
//     type: long
//     default: 10
// ---
SigninLogs
| where TimeGenerated > ago(1d)
| summarize Failures = count() by UserPrincipalName
| where Failures >= MinFailures
`;

function files(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe('discoverPacks', () => {
  it('loads a pack at the repository root', () => {
    const { packs, problems } = discoverPacks(
      files({ 'rkqlpack.yaml': MANIFEST, 'queries/failed-signins.kql': QUERY, 'README.md': '#' }),
    );
    expect(problems).toEqual([]);
    expect(packs).toHaveLength(1);
    const [pack] = packs;
    expect(pack?.manifest).toMatchObject({ id: 'contoso.identity', version: '1.3.0' });
    expect(pack?.queries).toEqual([
      expect.objectContaining({
        id: 'failed-signins',
        file: 'queries/failed-signins.kql',
        tables: ['SigninLogs'],
        parameters: [{ name: 'MinFailures', type: 'long', default: 10 }],
        body: expect.stringContaining('summarize Failures') as string,
      }),
    ]);
    expect(pack?.queries[0]?.body.startsWith('SigninLogs')).toBe(true);
  });

  it('loads several packs from rkql-index.yaml and reports broken ones', () => {
    const { packs, problems } = discoverPacks(
      files({
        'rkql-index.yaml':
          'packs:\n  - path: packs/identity\n  - path: packs/broken\n  - path: ./packs/missing/\n',
        'packs/identity/rkqlpack.yaml': MANIFEST,
        'packs/identity/queries/a.kql': QUERY,
        'packs/broken/rkqlpack.yaml': 'schemaVersion: 1\nid: Not Valid\n',
      }),
    );
    expect(packs.map((p) => p.path)).toEqual(['packs/identity']);
    expect(problems.map((p) => p.file)).toEqual([
      'packs/broken/rkqlpack.yaml',
      'packs/missing/rkqlpack.yaml',
    ]);
    expect(problems[0]?.message).toMatch(/id/);
  });

  it('refuses index paths outside the repository', () => {
    const { problems } = discoverPacks(
      files({ 'rkql-index.yaml': 'packs:\n  - path: ../other\n' }),
    );
    expect(problems[0]?.message).toMatch(/inside the repository/);
  });

  it('says when a repository is not a pack', () => {
    expect(discoverPacks(files({ 'README.md': '' })).problems[0]?.message).toMatch(
      /not a query pack/,
    );
  });

  it('reads sidecar metadata and skips invalid queries with a problem each', () => {
    const { pack } = loadPack(
      files({
        'rkqlpack.yaml': MANIFEST,
        'queries/sidecar.kql': 'Heartbeat | take 1',
        'queries/sidecar.yaml':
          'id: sidecar\nname: Heartbeat\ndescription: One row.\ntables: [Heartbeat]\n',
        'queries/no-meta.kql': 'Heartbeat',
        'queries/typo.kql': QUERY.replace('// category: hunting', '// categroy: hunting'),
        'queries/bad-mitre.kql': QUERY.replace('T1110.003', 'TA0006').replace(
          'failed-signins',
          'x',
        ),
        'queries/dup.kql': QUERY,
        'queries/zz-dup.kql': QUERY,
        'queries/both.kql': QUERY.replace('failed-signins', 'both'),
        'queries/both.yaml': 'id: both\n',
      }),
      '',
    );
    expect(pack?.queries.map((q) => q.id).sort()).toEqual(['failed-signins', 'sidecar']);
    const messages = Object.fromEntries((pack?.problems ?? []).map((p) => [p.file, p.message]));
    expect(messages['queries/no-meta.kql']).toMatch(/No metadata/);
    expect(messages['queries/typo.kql']).toMatch(/categroy/);
    expect(messages['queries/bad-mitre.kql']).toMatch(/T1110/);
    expect(messages['queries/both.kql']).toMatch(/not both/);
    // Files load in sorted order: the second file with the same id is the duplicate.
    expect(messages['queries/zz-dup.kql']).toMatch(/Duplicate query id "failed-signins"/);
  });
});

describe('parameters', () => {
  it('validates enum values and defaults against the type', () => {
    expect(ParameterSchema.safeParse({ name: 'Level', type: 'enum' }).success).toBe(false);
    expect(
      ParameterSchema.safeParse({ name: 'Level', type: 'enum', values: ['a'], default: 'b' })
        .success,
    ).toBe(false);
    expect(ParameterSchema.safeParse({ name: 'N', type: 'long', default: '10' }).success).toBe(
      true,
    );
    expect(ParameterSchema.safeParse({ name: 'N', type: 'int', default: 1.5 }).success).toBe(false);
    expect(ParameterSchema.safeParse({ name: 'has space', type: 'string' }).success).toBe(false);
  });

  it('checks values per type', () => {
    expect(checkParameterValue({ type: 'long' }, '9223372036854775807')).toBeUndefined();
    expect(checkParameterValue({ type: 'long' }, '9223372036854775808')).toMatch(/range/);
    expect(checkParameterValue({ type: 'int' }, 2 ** 31)).toMatch(/32-bit/);
    expect(checkParameterValue({ type: 'datetime' }, '2026-01-31T12:00:00Z')).toBeUndefined();
    expect(checkParameterValue({ type: 'datetime' }, '2026-01-31) | take 1 //')).toBeDefined();
    expect(checkParameterValue({ type: 'timespan' }, '1.5d')).toBeUndefined();
    expect(checkParameterValue({ type: 'timespan' }, '01:30:00')).toBeUndefined();
    expect(checkParameterValue({ type: 'timespan' }, '1d); print 1')).toBeDefined();
    expect(checkParameterValue({ type: 'stringList' }, ['a', 1])).toBeDefined();
    expect(checkParameterValue({ type: 'bool' }, 'true')).toBeDefined();
  });
});
