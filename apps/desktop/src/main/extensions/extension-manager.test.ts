import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { createExtensionRuntime, type ExtensionModule } from '@raml-kql/extension-api/runtime';
import {
  SIGNATURE_FILE,
  generateSigningKeyPair,
  signFiles,
} from '@raml-kql/pack-schema/extension-signature';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { UiRequest } from '../../shared/extensions/models';
import { MemoryListStore } from '../config/jsonc-list-store';

import type { ConnectionPort } from './extension-connection';
import {
  ExtensionManager,
  type ExtensionHost,
  type ExtensionManagerOptions,
  type InstalledEntry,
} from './extension-manager';
import { toPackage } from './extension-package';
import { ExtensionStorage } from './extension-stores';
import { PermissionBroker, type PersistedGrant, type PromptAnswer } from './permission-broker';

/** Runs extension code in-process with the real runtime, over a real MessageChannel. */
class InProcessHost implements ExtensionHost {
  async start(_id: string, code: string): Promise<ConnectionPort> {
    const { port1, port2 } = new MessageChannel();
    const runtime = createExtensionRuntime({
      postMessage: (message) => {
        port2.postMessage(message);
      },
      onMessage: (listener) => {
        port2.on('message', listener);
      },
    });
    (globalThis as { ramlKql?: unknown }).ramlKql = runtime.api;
    const module = (await import(
      `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    )) as ExtensionModule;
    runtime.setModule(module);
    setTimeout(() => {
      port2.postMessage({ t: 'ready' });
    }, 0);
    return {
      postMessage: (message) => {
        port1.postMessage(message);
      },
      on: (_event, listener) => {
        port1.on('message', (data: unknown) => {
          listener({ data });
        });
      },
      start: () => undefined,
      close: () => {
        port1.close();
      },
    };
  }

  stop(): void {
    (globalThis as { ramlKql?: unknown }).ramlKql = undefined;
  }
}

const enc = (text: string) => new TextEncoder().encode(text);

function probeExtension(port: number) {
  const manifest = {
    name: 'net-probe',
    publisher: 'contoso',
    displayName: 'Net Probe',
    version: '1.0.0',
    engines: { 'raml-kql': '^1.0.0' },
    main: 'dist/extension.js',
    activationEvents: ['onCommand:probe.fetch'],
    permissions: [
      { id: 'network', hosts: ['127.0.0.1'], reason: 'Talk to the test server' },
      { id: 'clipboard.write', reason: 'Copy results' },
    ],
    contributes: {
      commands: [
        { command: 'probe.fetch', title: 'Fetch' },
        { command: 'probe.fetchOther', title: 'Fetch another host' },
        { command: 'probe.secret', title: 'Secret' },
        { command: 'probe.config', title: 'Config' },
      ],
      configuration: { properties: { 'net-probe.limit': { type: 'number', default: 25 } } },
    },
  };
  const code = `
    const api = () => globalThis.ramlKql;
    export function activate(context) {
      context.subscriptions.push(
        api().commands.registerCommand('probe.fetch', async () => {
          const response = await api().net.fetch('http://127.0.0.1:${String(port)}/probe');
          return response.status + ' ' + (await response.text());
        }),
        api().commands.registerCommand('probe.fetchOther', () => api().net.fetch('https://evil.example.com/')),
        api().commands.registerCommand('probe.secret', () => api().secrets.set('k', 'v')),
        api().commands.registerCommand('probe.config', () => api().configuration.get('net-probe.limit')),
      );
    }`;
  return toPackage(
    new Map([
      ['package.json', enc(JSON.stringify(manifest))],
      ['dist/extension.js', enc(code)],
      ['README.md', enc('# Net Probe')],
    ]),
  );
}

describe('ExtensionManager', () => {
  let server: Server;
  let port: number;
  let hits = 0;
  const dirs: string[] = [];

  beforeAll(async () => {
    server = createServer((_request, response) => {
      hits += 1;
      response.end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.close();
  });
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    hits = 0;
  });

  function create(
    answers: PromptAnswer[] = [],
    settings: Record<string, unknown> = {},
    extra: Partial<ExtensionManagerOptions> = {},
  ) {
    const dir = mkdtempSync(path.join(tmpdir(), 'rk-ext-'));
    dirs.push(dir);
    const grants = new MemoryListStore<PersistedGrant>();
    const prompts: UiRequest[] = [];
    const ui = vi.fn((request: UiRequest) => {
      if (request.kind === 'permission') {
        prompts.push(request);
        return Promise.resolve(answers.shift());
      }
      return Promise.resolve(undefined);
    });
    const broker = new PermissionBroker({
      store: grants,
      prompt: (request) => ui({ kind: 'permission', extension: 'Net Probe', ...request }),
      audit: vi.fn(),
    });
    const secrets = {
      get: vi.fn(),
      set: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    const store = new MemoryListStore<InstalledEntry>();
    const manager = new ExtensionManager({
      extensionsDir: path.join(dir, 'extensions'),
      store,
      broker,
      host: new InProcessHost(),
      ui,
      secrets,
      storage: new ExtensionStorage(path.join(dir, 'storage')),
      settingValue: (key) => settings[key],
      fetch: (url, init) => fetch(url, init),
      writeClipboard: vi.fn(() => Promise.resolve()),
      env: () => ({ appVersion: '0.9.0', theme: 'dark', presentationMode: true }),
      audit: vi.fn(),
      onChange: vi.fn(),
      ...extra,
    });
    return { manager, dir, prompts, grants, secrets, store };
  }

  async function installProbe(manager: ExtensionManager) {
    const preview = manager.preview(probeExtension(port), {
      type: 'file',
      name: 'net-probe.rkqlx',
    });
    expect(preview.extension.permissions.map((p) => p.id)).toEqual(['network', 'clipboard.write']);
    expect(preview.readme).toBe('# Net Probe');
    return manager.install(preview.previewId);
  }

  it('installs, and keeps the network closed until the user allows it for the run', async () => {
    const { manager, prompts } = create(['deny', 'run']);
    const snapshot = await installProbe(manager);
    expect(snapshot.extensions[0]).toMatchObject({
      id: 'contoso.net-probe',
      state: 'inactive',
      verified: false,
    });

    await expect(manager.executeCommand('probe.fetch', [], 'run-1')).rejects.toThrow(
      /Permission denied: network/,
    );
    expect(hits).toBe(0);
    expect(prompts[0]).toMatchObject({
      kind: 'permission',
      permission: 'network',
      risk: 'high',
      hosts: ['127.0.0.1'],
      hasRun: true,
    });

    // A new run asks again; this time it is allowed, and only for that run.
    expect(await manager.executeCommand('probe.fetch', [], 'run-2')).toBe('200 hello');
    expect(await manager.executeCommand('probe.fetch', [], 'run-2')).toBe('200 hello');
    expect(hits).toBe(2);
    expect(prompts).toHaveLength(2);
  });

  it('refuses hosts and permissions the manifest does not declare, without asking', async () => {
    const { manager, prompts } = create(['always']);
    await installProbe(manager);
    await expect(manager.executeCommand('probe.fetchOther', [], 'run-1')).rejects.toThrow(
      /not declared/,
    );
    await expect(manager.executeCommand('probe.secret', [], 'run-1')).rejects.toThrow(
      /secrets is not declared/,
    );
    expect(prompts).toEqual([]);
  });

  it('persists "always" grants and revokes them', async () => {
    const { manager, grants } = create(['always']);
    await installProbe(manager);
    await manager.executeCommand('probe.fetch', [], 'run-1');
    expect((await grants.read()).items).toHaveLength(1);
    const snapshot = await manager.revoke('contoso.net-probe', 'network');
    expect(snapshot.grants).toEqual([]);
    expect((await grants.read()).items).toEqual([]);
  });

  it('reads its own settings with defaults and type checks', async () => {
    const withValue = create([], { 'net-probe.limit': 10 });
    await installProbe(withValue.manager);
    expect(await withValue.manager.executeCommand('probe.config', [])).toBe(10);
    const wrongType = create([], { 'net-probe.limit': 'ten' });
    await installProbe(wrongType.manager);
    expect(await wrongType.manager.executeCommand('probe.config', [])).toBe(25);
  });

  it('disables and uninstalls, removing files, grants and secrets', async () => {
    const { manager, dir, secrets } = create(['always']);
    await installProbe(manager);
    await manager.executeCommand('probe.fetch', [], 'run-1');
    let snapshot = await manager.setEnabled('contoso.net-probe', false);
    expect(snapshot.extensions[0]?.state).toBe('disabled');
    await expect(manager.executeCommand('probe.fetch', [], 'run-1')).rejects.toThrow(/disabled/);
    snapshot = await manager.uninstall('contoso.net-probe');
    expect(snapshot.extensions).toEqual([]);
    expect(snapshot.grants).toEqual([]);
    expect(secrets.delete).toHaveBeenCalledWith('contoso.net-probe');
    expect(existsSync(path.join(dir, 'extensions', 'contoso.net-probe-1.0.0'))).toBe(false);
  });

  describe('signed packages ("Verified by Raml KQL")', () => {
    const key = generateSigningKeyPair();
    const trustedKeys = [{ name: 'Raml KQL', publicKeyPem: key.publicKeyPem }];

    function signedProbe(privateKeyPem = key.privateKeyPem) {
      const files = new Map(probeExtension(port).files);
      files.set(SIGNATURE_FILE, signFiles(files, privateKeyPem));
      return toPackage(files);
    }

    it('is not verified when nothing signed it, or when an unknown key did', () => {
      const { manager } = create([], {}, { trustedKeys });
      const unsigned = manager.preview(probeExtension(port), { type: 'file', name: 'x.rkqlx' });
      expect(unsigned.extension.verified).toBe(false);
      const stranger = generateSigningKeyPair();
      const foreign = manager.preview(signedProbe(stranger.privateKeyPem), {
        type: 'file',
        name: 'x.rkqlx',
      });
      expect(foreign.extension.verified).toBe(false);
      expect(foreign.extension.verifiedBy).toBeUndefined();
    });

    it('shows the badge before and after installing a package signed with a trusted key', async () => {
      const { manager } = create([], {}, { trustedKeys });
      const preview = manager.preview(signedProbe(), { type: 'file', name: 'x.rkqlx' });
      expect(preview.extension).toMatchObject({ verified: true, verifiedBy: 'Raml KQL' });
      const snapshot = await manager.install(preview.previewId);
      expect(snapshot.extensions[0]).toMatchObject({ verified: true, verifiedBy: 'Raml KQL' });
    });

    it('checks the installed files again at the next start, and drops the badge when they changed', async () => {
      const first = create([], {}, { trustedKeys });
      const preview = first.manager.preview(signedProbe(), { type: 'file', name: 'x.rkqlx' });
      await first.manager.install(preview.previewId);

      const unchanged = create(
        [],
        {},
        {
          trustedKeys,
          store: first.store,
          extensionsDir: path.join(first.dir, 'extensions'),
        },
      );
      await unchanged.manager.load();
      expect((await unchanged.manager.snapshot()).extensions[0]?.verified).toBe(true);

      writeFileSync(
        path.join(first.dir, 'extensions', 'contoso.net-probe-1.0.0', 'dist', 'extension.js'),
        'export function activate() { /* edited after install */ }',
      );
      const tampered = create(
        [],
        {},
        {
          trustedKeys,
          store: first.store,
          extensionsDir: path.join(first.dir, 'extensions'),
        },
      );
      await tampered.manager.load();
      expect((await tampered.manager.snapshot()).extensions[0]?.verified).toBe(false);

      // The same files with the key no longer trusted (a revoked key): no badge either.
      const revoked = create(
        [],
        {},
        {
          trustedKeys: [],
          store: first.store,
          extensionsDir: path.join(first.dir, 'extensions'),
        },
      );
      await revoked.manager.load();
      expect((await revoked.manager.snapshot()).extensions[0]?.verified).toBe(false);
    });
  });
});
