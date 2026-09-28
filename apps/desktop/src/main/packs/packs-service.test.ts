import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { zipSync, strToU8 } from 'fflate';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createRepo, startGitServer, type GitServer } from '../../../test/helpers/git-server';

import { checkGitUrl } from './git-source';
import { readZipFiles } from './pack-files';
import { PacksService, type Credentials } from './packs-service';
import { JsoncSourcesStore } from './sources-config';

const MANIFEST = (version: string) =>
  `schemaVersion: 1\nid: contoso.identity\nname: Contoso Identity\nversion: ${version}\ndescription: Test pack.\n`;

const query = (id: string, body: string) =>
  `// ---\n// id: ${id}\n// name: ${id}\n// description: Test query.\n// tables: [SigninLogs]\n// ---\n${body}\n`;

class MemoryCredentials implements Credentials {
  readonly tokens = new Map<string, string>();
  store(token: string): Promise<string> {
    const ref = `src-${String(this.tokens.size).padStart(8, '0')}`;
    this.tokens.set(ref, token);
    return Promise.resolve(ref);
  }
  get(ref: string): Promise<string | undefined> {
    return Promise.resolve(this.tokens.get(ref));
  }
  delete(ref: string): Promise<void> {
    this.tokens.delete(ref);
    return Promise.resolve();
  }
}

describe('PacksService', () => {
  let root: string;
  let server: GitServer;
  let privateServer: GitServer;
  const dirs: string[] = [];

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'rk-git-'));
    server = await startGitServer(root);
    privateServer = await startGitServer(root, { token: 'test-token-not-real' });
  });
  afterAll(async () => {
    await server.close();
    await privateServer.close();
    rmSync(root, { recursive: true, force: true });
  });
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function create(now = () => new Date('2026-03-01T10:00:00Z')) {
    const config = mkdtempSync(path.join(tmpdir(), 'rk-packs-'));
    dirs.push(config);
    const onChange = vi.fn();
    const credentials = new MemoryCredentials();
    const service = new PacksService({
      sourcesDir: path.join(config, 'sources'),
      stateFile: path.join(config, 'state', 'pack-sources.json'),
      store: new JsoncSourcesStore(path.join(config, 'sources.jsonc')),
      credentials,
      onChange,
      now,
    });
    return { service, config, onChange, credentials };
  }

  it('adds a git source pinned to its commit, updates it after review, and removes it', async () => {
    const repo = createRepo(root, 'identity');
    const first = repo.commit(
      {
        'rkqlpack.yaml': MANIFEST('1.0.0'),
        'queries/a.kql': query('a', 'SigninLogs | take 1'),
        'queries/b.kql': query('b', 'SigninLogs | take 2'),
      },
      'First version',
    );
    let clock = new Date('2026-03-01T10:00:00Z');
    const { service, config, onChange } = create(() => clock);

    const preview = await service.previewGit({ url: server.url('identity') });
    expect(preview).toMatchObject({
      type: 'git',
      sha: first,
      alreadyAdded: false,
      packs: [{ id: 'contoso.identity', version: '1.0.0', queries: 2, conflict: false }],
    });
    const added = await service.add(preview.previewId);
    expect(added.packs.map((p) => p.queries.map((q) => q.id))).toEqual([['a', 'b']]);
    expect(onChange).toHaveBeenCalled();
    // sources.jsonc pins the commit; nothing secret in it.
    const sourcesFile = readFileSync(path.join(config, 'sources.jsonc'), 'utf8');
    expect(sourcesFile).toContain(first);
    expect(sourcesFile).toContain(server.url('identity'));
    // No preview clones are left behind.
    expect(readdirSync(path.join(config, 'sources')).filter((d) => d.startsWith('.'))).toEqual([]);
    expect(
      service.readQuery({
        sourceId: added.sources[0]?.id ?? '',
        packId: 'contoso.identity',
        queryId: 'a',
      }).body,
    ).toBe('SigninLogs | take 1\n');

    // A new commit upstream: nothing changes until the user applies it.
    const second = repo.commit(
      {
        'rkqlpack.yaml': MANIFEST('1.1.0'),
        'queries/a.kql': query('a', 'SigninLogs | take 10'),
        'queries/b.kql': null,
        'queries/c.kql': query('c', 'AuditLogs | take 1'),
      },
      'Second version',
    );
    const sourceId = added.sources[0]?.id ?? '';
    expect(await service.checkUpdates({ force: true })).toEqual({
      checked: 1,
      updates: 1,
      errors: [],
    });
    let snapshot = await service.snapshot();
    expect(snapshot.sources[0]?.update).toEqual({ sha: second, commits: 1 });
    expect(snapshot.packs[0]?.version).toBe('1.0.0');
    // Throttled to once per 24 hours unless forced.
    expect((await service.checkUpdates({ force: false })).checked).toBe(0);
    clock = new Date('2026-03-02T11:00:00Z');
    expect((await service.checkUpdates({ force: false })).checked).toBe(1);

    const update = await service.updatePreview(sourceId);
    expect(update).toMatchObject({
      fromSha: first,
      toSha: second,
      moreCommits: false,
      packs: [{ id: 'contoso.identity', fromVersion: '1.0.0', toVersion: '1.1.0' }],
    });
    expect(update.commits.map((c) => c.message)).toEqual(['Second version']);
    expect(update.changes.map((c) => [c.queryId, c.change]).sort()).toEqual([
      ['a', 'changed'],
      ['b', 'removed'],
      ['c', 'added'],
    ]);
    const changed = update.changes.find((c) => c.queryId === 'a');
    expect(changed?.before).toContain('take 1');
    expect(changed?.after).toContain('take 10');

    await expect(service.applyUpdate(sourceId, first)).rejects.toThrow(/changed since/);
    snapshot = await service.applyUpdate(sourceId, second);
    expect(snapshot.packs[0]?.version).toBe('1.1.0');
    expect(snapshot.packs[0]?.queries.map((q) => q.id)).toEqual(['a', 'c']);
    expect(snapshot.sources[0]?.update).toBeUndefined();
    expect(readFileSync(path.join(config, 'sources.jsonc'), 'utf8')).toContain(second);

    // Reloading from disk (a restart) gives the same packs.
    const again = new PacksService({
      sourcesDir: path.join(config, 'sources'),
      stateFile: path.join(config, 'state', 'pack-sources.json'),
      store: new JsoncSourcesStore(path.join(config, 'sources.jsonc')),
      credentials: new MemoryCredentials(),
      onChange: () => undefined,
    });
    await again.reload();
    expect((await again.snapshot()).packs[0]?.version).toBe('1.1.0');

    snapshot = await service.remove(sourceId);
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.packs).toEqual([]);
    expect(existsSync(path.join(config, 'sources', sourceId))).toBe(false);
  });

  it('asks for a token for private repositories and keeps it out of sources.jsonc', async () => {
    const repo = createRepo(root, 'private');
    repo.commit(
      { 'rkqlpack.yaml': MANIFEST('1.0.0'), 'queries/a.kql': query('a', 'SigninLogs') },
      'Init',
    );
    const { service, config, credentials } = create();
    await expect(service.previewGit({ url: privateServer.url('private') })).rejects.toMatchObject({
      code: 'SOURCE_AUTH_REQUIRED',
    });
    await expect(
      service.previewGit({ url: privateServer.url('private'), token: 'wrong' }),
    ).rejects.toMatchObject({ code: 'SOURCE_AUTH_REQUIRED' });
    const preview = await service.previewGit({
      url: privateServer.url('private'),
      token: 'test-token-not-real',
    });
    const snapshot = await service.add(preview.previewId);
    expect(snapshot.sources[0]?.hasCredential).toBe(true);
    expect([...credentials.tokens.values()]).toEqual(['test-token-not-real']);
    expect(readFileSync(path.join(config, 'sources.jsonc'), 'utf8')).not.toContain('test-token');
    // The stored token is used for update checks.
    expect((await service.checkUpdates({ force: true })).errors).toEqual([]);
    await service.remove(snapshot.sources[0]?.id ?? '');
    expect(credentials.tokens.size).toBe(0);
  });

  it('previews broken repositories without adding them', async () => {
    const repo = createRepo(root, 'broken');
    repo.commit({ 'README.md': '# not a pack' }, 'Init');
    const { service } = create();
    const preview = await service.previewGit({ url: server.url('broken') });
    expect(preview.packs).toEqual([]);
    expect(preview.problems[0]?.message).toMatch(/not a query pack/);
    await expect(service.add(preview.previewId)).rejects.toThrow(/no valid query packs/);
    await expect(service.previewGit({ url: server.url('missing') })).rejects.toMatchObject({
      code: 'SOURCE_ERROR',
    });
  });

  it('imports a .rkqlpack zip, flags pack id conflicts and refuses duplicates', async () => {
    const { service } = create();
    const zip = zipSync({
      'my-pack/rkqlpack.yaml': strToU8(MANIFEST('2.0.0')),
      'my-pack/queries/z.kql': strToU8(query('z', 'Heartbeat | take 1')),
      'my-pack/README.md': strToU8('# readme'),
    });
    const files = readZipFiles(zip);
    expect([...files.keys()].sort()).toEqual(['queries/z.kql', 'rkqlpack.yaml']);
    const preview = await service.previewFiles(files, 'my-pack.rkqlpack');
    const snapshot = await service.add(preview.previewId);
    expect(snapshot.sources[0]).toMatchObject({ type: 'file', label: 'my-pack.rkqlpack' });
    expect(snapshot.packs[0]?.version).toBe('2.0.0');

    const same = await service.previewFiles(files, 'copy.rkqlpack');
    expect(same.alreadyAdded).toBe(true);
    await expect(service.add(same.previewId)).rejects.toThrow(/already added/);

    const other = new Map(files);
    other.set('queries/y.kql', query('y', 'Heartbeat'));
    const conflicting = await service.previewFiles(other, 'fork.rkqlpack');
    expect(conflicting.packs[0]?.conflict).toBe(true);
    // Both are kept, with the source telling them apart.
    const both = await service.add(conflicting.previewId);
    expect(both.packs.map((p) => p.sourceId)).toHaveLength(2);
  });
});

describe('zip and URL safety', () => {
  it('refuses unsafe archive paths and oversized files', () => {
    expect(() => readZipFiles(zipSync({ '../evil.kql': strToU8('x') }))).toThrow(/unsafe path/);
    const big = new Uint8Array(1024 * 1024 + 1).fill(65);
    expect(() => readZipFiles(zipSync({ 'queries/big.kql': big }))).toThrow(/larger than 1 MB/);
    expect(() => readZipFiles(strToU8('not a zip'))).toThrow(/not a valid/);
  });

  it('allows https, and http only to this machine', () => {
    expect(checkGitUrl('https://github.com/contoso/packs/')).toBe(
      'https://github.com/contoso/packs',
    );
    expect(checkGitUrl('http://127.0.0.1:9000/x.git')).toBe('http://127.0.0.1:9000/x.git');
    expect(() => checkGitUrl('http://example.com/x.git')).toThrow(/https/);
    expect(() => checkGitUrl('file:///etc/passwd')).toThrow(/https/);
    expect(() => checkGitUrl('https://user:secret@github.com/x.git')).toThrow(/token/);
    expect(() => checkGitUrl('not a url')).toThrow(/URL/);
  });
});
