import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueriesService, slugify } from './queries-service';

describe('slugify', () => {
  it('makes safe file names', () => {
    expect(slugify('Failed Sign-ins (Contoso)')).toBe('failed-sign-ins-contoso');
    expect(slugify('Überprüfung')).toBe('uberprufung');
    expect(slugify('../../etc')).toBe('etc');
    expect(slugify('!!!')).toBe('query');
  });
});

describe('QueriesService', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  function create(): { service: QueriesService; root: string; trash: ReturnType<typeof vi.fn> } {
    dir = mkdtempSync(path.join(tmpdir(), 'rk-queries-'));
    const root = path.join(dir, 'queries');
    mkdirSync(root);
    const trash = vi.fn((p: string) => {
      rmSync(p, { recursive: true, force: true });
      return Promise.resolve();
    });
    return { service: new QueriesService({ root, trash, reveal: () => undefined }), root, trash };
  }

  it('refuses paths outside the folder', () => {
    const { service, root } = create();
    expect(() => service.resolve('../outside.kql')).toThrow(/outside/);
    expect(() => service.resolve('a/../../x')).toThrow(/outside/);
    expect(service.resolve('a/b.kql')).toBe(path.join(root, 'a', 'b.kql'));
    expect(service.resolve('')).toBe(path.resolve(root));
  });

  it('saves a new query with front-matter and a free file name', async () => {
    const { service, root } = create();
    const first = await service.save({ name: 'Failed sign-ins', body: 'SigninLogs\n' });
    const second = await service.save({ name: 'Failed sign-ins', body: 'SigninLogs\n' });
    expect(first.path).toBe('failed-sign-ins.kql');
    expect(second.path).toBe('failed-sign-ins-2.kql');
    const text = readFileSync(path.join(root, 'failed-sign-ins.kql'), 'utf8');
    expect(text).toContain('name: Failed sign-ins');
    expect(text).toContain('SigninLogs');
    expect(await service.read(first.path)).toMatchObject({
      name: 'Failed sign-ins',
      body: 'SigninLogs\n',
    });
  });

  it('overwrites an existing file and keeps its front-matter', async () => {
    const { service, root } = create();
    writeFileSync(
      path.join(root, 'kept.kql'),
      '// ---\n// name: Kept\n// tags: [identity]\n// ---\nSigninLogs\n',
    );
    await service.save({ path: 'kept.kql', body: 'AuditLogs\n' });
    const nodes = await service.list();
    expect(nodes).toEqual([{ path: 'kept.kql', kind: 'file', name: 'Kept', tags: ['identity'] }]);
    expect((await service.read('kept.kql')).body).toBe('AuditLogs\n');
  });

  it('lists folders and files, and renames, moves and deletes', async () => {
    const { service, root, trash } = create();
    await service.createFolder('Identity');
    const saved = await service.save({
      name: 'Risky users',
      body: 'AADRiskyUsers',
      folder: 'Identity',
    });
    expect(saved.path).toBe('Identity/risky-users.kql');
    writeFileSync(path.join(root, 'notes.txt'), 'ignored');
    expect((await service.list()).map((n) => n.path)).toEqual([
      'Identity',
      'Identity/risky-users.kql',
    ]);

    const renamed = await service.rename(saved.path, 'Risky users (all)');
    expect(renamed).toMatchObject({
      path: 'Identity/risky-users-all.kql',
      name: 'Risky users (all)',
    });

    const moved = await service.move(renamed.path, '');
    expect(moved).toBe('risky-users-all.kql');
    await expect(service.move('Identity', 'Identity')).rejects.toThrow(/itself/);

    await service.delete(moved);
    expect(trash).toHaveBeenCalledWith(path.join(root, 'risky-users-all.kql'));
    expect(existsSync(path.join(root, 'risky-users-all.kql'))).toBe(false);
    await expect(service.delete('')).rejects.toThrow(/cannot be deleted/);
  });

  it('will not move over an existing file', async () => {
    const { service } = create();
    await service.createFolder('A');
    await service.save({ name: 'Same', body: '1' });
    await service.save({ name: 'Same', body: '2', folder: 'A' });
    await expect(service.move('A/same.kql', '')).rejects.toThrow(/already exists/);
  });

  it('keeps pack metadata and parameters when duplicating a pack query', async () => {
    const { service, root } = create();
    const saved = await service.save({
      name: 'Failed sign-ins',
      body: 'let MinFailures = 10;\nSigninLogs',
      meta: {
        description: 'From a pack.',
        tables: ['SigninLogs'],
        mitre: ['T1110'],
        timespan: 'P7D',
        parameters: [{ name: 'MinFailures', type: 'long', default: 10 }],
      },
    });
    const text = readFileSync(path.join(root, saved.path), 'utf8');
    expect(text).toContain('// mitre:');
    expect(await service.read(saved.path)).toMatchObject({
      name: 'Failed sign-ins',
      timespan: 'P7D',
      parameters: [{ name: 'MinFailures', type: 'long', default: 10 }],
    });
  });

  it('reports user-facing errors as AppErrors', async () => {
    const { service } = create();
    await expect(service.read('missing.kql')).rejects.toMatchObject({
      code: 'FILE_OPERATION_FAILED',
    });
  });
});
