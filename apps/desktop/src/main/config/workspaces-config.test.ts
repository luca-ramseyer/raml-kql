import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsoncGroupsStore } from './groups-config';
import { JsoncWorkspacesConfig, MemoryWorkspacesConfig } from './workspaces-config';

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const WS =
  '/subscriptions/00000000-0000-0000-0000-000000000501/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/la-a';
const T = '00000000-0000-0000-0000-00000000c001';

describe('workspaces.jsonc', () => {
  it('patches entries in place, keeping comments', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-ws-'));
    const file = path.join(dir, 'workspaces.jsonc');
    writeFileSync(
      file,
      `{\n  // SOC workspaces\n  "workspaces": {\n    // keep me\n    "${WS}": { "enabled": true }\n  }\n}\n`,
    );
    const store = new JsoncWorkspacesConfig(file);
    await store.patch({
      workspaces: { [WS]: { enabled: false, alias: 'Prod' } },
      tenants: { [T]: { aliasNumber: 1 } },
    });
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('// SOC workspaces');
    expect(text).toContain('// keep me');
    const { config } = await store.read();
    expect(config.workspaces[WS]).toEqual({ enabled: false, alias: 'Prod' });
    expect(config.tenants[T]).toEqual({ aliasNumber: 1 });
  });

  it('merges extended team files underneath, the user file winning per entry', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-ws-'));
    writeFileSync(
      path.join(dir, 'team.jsonc'),
      `{ "tenants": { "${T}": { "alias": "Team alias", "tags": ["bank"] } } }`,
    );
    writeFileSync(
      path.join(dir, 'workspaces.jsonc'),
      `{ "extends": ["./team.jsonc"], "tenants": { "${T}": { "aliasNumber": 3 } } }`,
    );
    const { config } = await new JsoncWorkspacesConfig(path.join(dir, 'workspaces.jsonc')).read();
    expect(config.tenants[T]).toEqual({ alias: 'Team alias', tags: ['bank'], aliasNumber: 3 });
  });

  it('refuses to edit a broken file and reads it as empty', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-ws-'));
    const file = path.join(dir, 'workspaces.jsonc');
    writeFileSync(file, '{ "workspaces": ');
    const store = new JsoncWorkspacesConfig(file);
    await expect(store.patch({ workspaces: { [WS]: { enabled: true } } })).rejects.toThrow(
      /errors/,
    );
    const { config, problems } = await store.read();
    expect(config).toEqual({ workspaces: {}, tenants: {} });
    expect(problems.length).toBeGreaterThan(0);
  });

  it('memory store removes entries set to undefined', async () => {
    const store = new MemoryWorkspacesConfig();
    await store.patch({ workspaces: { [WS]: { enabled: true } } });
    await store.patch({ workspaces: { [WS]: undefined } });
    expect((await store.read()).config.workspaces).toEqual({});
  });
});

describe('groups.jsonc', () => {
  it('reads valid groups, reports invalid ones with lines, and merges extends by id', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-groups-'));
    writeFileSync(
      path.join(dir, 'team.jsonc'),
      '{ "groups": [ { "id": "sentinel", "name": "Team Sentinel", "type": "dynamic", "match": { "sentinel": true } } ] }',
    );
    writeFileSync(
      path.join(dir, 'groups.jsonc'),
      '{\n  "extends": ["./team.jsonc"],\n  "groups": [\n    { "id": "oncall", "name": "On-call", "type": "static", "workspaces": [] },\n    { "id": "bad id!", "name": "x", "type": "static", "workspaces": [] }\n  ]\n}',
    );
    const store = new JsoncGroupsStore(path.join(dir, 'groups.jsonc'));
    const { groups, userGroups, problems } = await store.read();
    expect(groups.map((g) => g.id)).toEqual(['sentinel', 'oncall']);
    expect(userGroups.map((g) => g.id)).toEqual(['oncall']);
    expect(problems[0]).toMatchObject({ file: 'groups.jsonc', line: 5 });
  });
});
