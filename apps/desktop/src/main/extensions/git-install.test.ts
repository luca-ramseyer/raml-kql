import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRepo, startGitServer, type GitServer } from '../../../test/helpers/git-server';

import { resolveGitExtension } from './git-install';

const manifest = (version: string, engine = '^1.0.0') =>
  JSON.stringify({
    name: 'hello',
    publisher: 'contoso',
    version,
    engines: { 'raml-kql': engine },
    main: 'dist/extension.js',
    contributes: { commands: [{ command: 'hello.world', title: 'Hello' }] },
  });

describe('installing from git', () => {
  let root: string;
  let server: GitServer;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'rk-extgit-'));
    server = await startGitServer(root);
    const repo = createRepo(root, 'hello');
    repo.commit(
      { 'package.json': manifest('1.0.0'), 'dist/extension.js': 'export function activate() {}' },
      'v1',
    );
    repo.tag('v1.0.0');
    repo.commit({ 'package.json': manifest('1.1.0') }, 'v1.1 without dist');
    repo.tag('v1.1.0-beta.1');
    repo.commit({ 'package.json': manifest('2.0.0', '^9.0.0') }, 'needs a newer app');
    repo.tag('v2.0.0');
    const empty = createRepo(root, 'untagged');
    empty.commit({ 'README.md': '# nothing' }, 'init');
  });
  afterAll(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('takes the newest compatible release tag (a prerelease is skipped)', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    const resolved = await resolveGitExtension({ url: server.url('hello'), fetch, tempRoot: root });
    expect(resolved?.tag).toBe('v1.0.0');
    expect(resolved?.pkg.manifest.version).toBe('1.0.0');
    expect(resolved?.sha).toMatch(/^[0-9a-f]{40}$/);
    // Not GitHub or GitLab: no release API calls.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('finds nothing newer than the installed version', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    expect(
      await resolveGitExtension({
        url: server.url('hello'),
        fetch,
        tempRoot: root,
        newerThan: '1.0.0',
      }),
    ).toBeUndefined();
  });

  it('explains repositories without release tags', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(
      resolveGitExtension({ url: server.url('untagged'), fetch, tempRoot: root }),
    ).rejects.toThrow(/no release tags/);
  });
});
