import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { CallMessage } from '@raml-kql/extension-api/protocol';
import {
  ExtensionManifestSchema,
  extensionId,
  hostAllowed,
  networkHosts,
  type EntityType,
  type ConfigurationProperty,
  type ExtensionManifest,
  type PermissionDeclaration,
} from '@raml-kql/pack-schema/extension-manifest';
import { z } from 'zod';

import type { ConfigProblem } from '../../shared/config/config-snapshots';
import { AppError } from '../../shared/errors';
import {
  EnrichmentResultSchema,
  ExtensionSourceSchema,
  type EnrichmentResultData,
  type ExtensionInfo,
  type ExtensionSource,
  type ExtensionsSnapshot,
  type InstallPreview,
  type UiRequest,
} from '../../shared/extensions/models';
import { ENTITY_LABELS } from '../../shared/results/entities';
import type { ListStore } from '../config/jsonc-list-store';

import { ExtensionConnection, type ConnectionPort } from './extension-connection';
import {
  extensionError,
  HOST_API_VERSION,
  writePackage,
  type ExtensionPackage,
} from './extension-package';
import type { PermissionBroker } from './permission-broker';

/**
 * Installed extensions and their workers (spec 07): install (with a preview first), enable,
 * disable, uninstall, lazy activation, and the host side of every `ramlKql` call. Permission
 * checks happen here, in main, through the PermissionBroker.
 */
export const InstalledEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  source: ExtensionSourceSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  installedAt: z.string(),
});
export type InstalledEntry = z.infer<typeof InstalledEntrySchema>;

export interface ExtensionHost {
  start(extensionId: string, code: string): Promise<ConnectionPort>;
  stop(extensionId: string): void;
}

export interface SecretStore {
  get(extensionId: string, key: string): Promise<string | undefined>;
  set(extensionId: string, key: string, value: string): Promise<void>;
  delete(extensionId: string, key?: string): Promise<void>;
}

export interface KeyValueStore {
  get(extensionId: string, key: string): Promise<unknown>;
  set(extensionId: string, key: string, value: unknown): Promise<void>;
  clear(extensionId: string): Promise<void>;
}

export interface ExtensionAuditEvent {
  event: 'install' | 'update' | 'uninstall' | 'enable' | 'disable';
  extension: string;
  version: string;
}

export interface ExtensionManagerOptions {
  extensionsDir: string;
  store: ListStore<InstalledEntry>;
  broker: PermissionBroker;
  host: ExtensionHost;
  ui: (request: UiRequest) => Promise<unknown>;
  secrets: SecretStore;
  storage: KeyValueStore;
  /** The raw value of a settings.jsonc key (extension settings aren't in the registry). */
  settingValue: (key: string) => unknown;
  /** HTTP for `net.fetch`, in a session without cookies. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  writeClipboard: (text: string) => Promise<void>;
  env: () => { appVersion: string; theme: string; presentationMode: boolean };
  audit: (event: ExtensionAuditEvent) => void;
  onChange: () => void;
  /** A worker posted to its webview (sidebar view). */
  postToWebview?: (extensionId: string, webviewId: string, message: unknown) => void;
  now?: () => Date;
  /** Activation and call timeouts (tests shorten them). */
  timeouts?: { activateMs?: number; commandMs?: number };
}

/** Host commands extensions may run (spec 07: a public allowlist). */
export const HOST_COMMAND_ALLOWLIST = new Set([
  'query.new',
  'query.run',
  'workbench.view.library',
  'workbench.view.history',
  'workbench.view.targets',
  'workbench.action.showCommands',
]);

const MAX_FETCH_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

interface Invocation {
  id: string;
  runId?: string | undefined;
}

interface Loaded {
  entry: InstalledEntry;
  manifest: ExtensionManifest | undefined;
  dir: string;
  state: ExtensionInfo['state'];
  error?: string | undefined;
  connection?: ExtensionConnection | undefined;
  starting?: Promise<ExtensionConnection> | undefined;
  commands: Set<string>;
  enrichers: Set<string>;
  views: Set<string>;
  invocations: Invocation[];
}

interface PendingInstall {
  pkg: ExtensionPackage;
  source: ExtensionSource;
  created: number;
}

function denied(message: string): AppError {
  return new AppError({ code: 'PERMISSION_DENIED', message, retryable: false, source: 'main' });
}

function name(manifest: ExtensionManifest | undefined, id: string): string {
  return manifest?.displayName ?? manifest?.name ?? id;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// --- zod schemas for every API call ------------------------------------------------------

const Key = z.string().min(1).max(200);
const CallSchemas = {
  'commands.register': z.object({ id: z.string().max(200) }),
  'commands.unregister': z.object({ id: z.string().max(200) }),
  'commands.execute': z.object({
    id: z.string().max(200),
    args: z.array(z.json()).max(20).default([]),
  }),
  'window.message': z.object({
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().max(2000),
    actions: z.array(z.string().max(100)).max(5),
  }),
  'window.quickPick': z.object({
    items: z
      .array(
        z.object({
          label: z.string().max(500),
          description: z.string().max(500).optional(),
          detail: z.string().max(1000).optional(),
        }),
      )
      .max(1000),
    placeHolder: z.string().max(300).optional(),
  }),
  'window.inputBox': z.object({
    prompt: z.string().max(500).optional(),
    placeHolder: z.string().max(300).optional(),
    value: z.string().max(10_000).optional(),
    password: z.boolean().optional(),
  }),
  'window.progressStart': z.object({ title: z.string().max(300) }),
  'window.progressEnd': z.object({ id: z.number().int() }),
  'enrichment.register': z.object({ id: z.string().max(100) }),
  'views.register': z.object({ viewId: z.string().max(200) }),
  'webview.post': z.object({ webviewId: z.string().max(200), message: z.json() }),
  'net.fetch': z.object({
    url: z.string().max(8000),
    init: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
      headers: z.record(z.string().max(200), z.string().max(8000)).optional(),
      body: z.string().max(5_000_000).optional(),
    }),
  }),
  'secrets.get': z.object({ key: Key }),
  'secrets.set': z.object({ key: Key, value: z.string().max(100_000) }),
  'secrets.delete': z.object({ key: Key }),
  'storage.get': z.object({ key: Key }),
  'storage.set': z.object({ key: Key, value: z.json() }),
  'configuration.get': z.object({ key: Key }),
  'editor.getActiveQuery': z.object({}),
  'editor.insertText': z.object({ text: z.string().max(1_000_000) }),
  'editor.openQueryTab': z.object({
    query: z.string().max(1_000_000),
    title: z.string().max(200).optional(),
  }),
  'clipboard.writeText': z.object({ text: z.string().max(10_000_000) }),
} as const;
type Method = keyof typeof CallSchemas;

function configurationValue(property: ConfigurationProperty, raw: unknown): unknown {
  const ok =
    (property.type === 'string' && typeof raw === 'string') ||
    (property.type === 'boolean' && typeof raw === 'boolean') ||
    (property.type === 'number' && typeof raw === 'number') ||
    (property.type === 'integer' && typeof raw === 'number' && Number.isInteger(raw));
  if (!ok) return property.default;
  if (property.enum !== undefined && !property.enum.includes(raw as string | number))
    return property.default;
  if (typeof raw === 'number') {
    if (property.minimum !== undefined && raw < property.minimum) return property.default;
    if (property.maximum !== undefined && raw > property.maximum) return property.default;
  }
  return raw;
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = (await reader.read()) as {
      done: boolean;
      value?: Uint8Array;
    };
    if (done || value === undefined) break;
    size += value.length;
    if (size > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error('The response is larger than 10 MB.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class ExtensionManager {
  private loaded: Loaded[] = [];
  private problems: ConfigProblem[] = [];
  private readonly previews = new Map<string, PendingInstall>();
  private nextProgress = 1;
  /** Newer versions found by the update check (git sources). */
  private readonly updates = new Map<string, { version: string; tag: string }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ExtensionManagerOptions) {}

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private dirOf(entry: Pick<InstalledEntry, 'id' | 'version'>): string {
    return path.join(this.options.extensionsDir, `${entry.id}-${entry.version}`);
  }

  private find(id: string): Loaded | undefined {
    return this.loaded.find((l) => l.entry.id === id);
  }

  // --- Loading and snapshots -------------------------------------------------------------

  /** Read `extensions.jsonc` and each installed manifest; start `*` extensions. */
  async load(): Promise<void> {
    const { items, problems } = await this.options.store.read();
    this.problems = problems;
    const previous = new Map(this.loaded.map((l) => [l.entry.id, l]));
    const next: Loaded[] = [];
    for (const entry of items) {
      const running = previous.get(entry.id);
      if (
        running !== undefined &&
        running.entry.version === entry.version &&
        running.entry.enabled === entry.enabled
      ) {
        next.push({ ...running, entry });
        previous.delete(entry.id);
        continue;
      }
      const dir = this.dirOf(entry);
      let manifest: ExtensionManifest | undefined;
      let error: string | undefined;
      try {
        const parsed = ExtensionManifestSchema.safeParse(
          JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')),
        );
        if (parsed.success && extensionId(parsed.data) === entry.id) manifest = parsed.data;
        else error = 'The installed manifest is invalid. Reinstall the extension.';
      } catch {
        error = 'The extension files are missing. Reinstall the extension.';
      }
      next.push({
        entry,
        manifest,
        dir,
        state: error !== undefined ? 'failed' : entry.enabled ? 'inactive' : 'disabled',
        error,
        commands: new Set(),
        enrichers: new Set(),
        views: new Set(),
        invocations: [],
      });
    }
    for (const gone of previous.values()) await this.deactivate(gone);
    this.loaded = next;
    for (const ext of this.loaded) {
      const events = ext.manifest?.activationEvents ?? [];
      if (
        ext.state === 'inactive' &&
        (events.includes('*') || events.includes('onStartupFinished'))
      ) {
        void this.activate(ext).catch(() => undefined);
      }
    }
  }

  private info(
    ext:
      | Loaded
      | { entry: InstalledEntry; manifest: ExtensionManifest; state: ExtensionInfo['state'] },
  ): ExtensionInfo | undefined {
    const { manifest, entry } = ext;
    if (manifest === undefined) {
      return {
        id: entry.id,
        publisher: entry.id.split('.')[0] ?? entry.id,
        name: entry.id.split('.').slice(1).join('.'),
        displayName: entry.id,
        version: entry.version,
        enabled: entry.enabled,
        state: 'failed',
        error: 'error' in ext ? ext.error : undefined,
        source: entry.source,
        sha256: entry.sha256,
        installedAt: entry.installedAt,
        permissions: [],
        contributes: {},
        verified: false,
      };
    }
    const repository =
      typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
    return {
      id: entry.id,
      publisher: manifest.publisher,
      name: manifest.name,
      displayName: name(manifest, entry.id),
      version: manifest.version,
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      ...(repository === undefined ? {} : { repository }),
      ...(manifest.license === undefined ? {} : { license: manifest.license }),
      enabled: entry.enabled,
      state: ext.state,
      ...('error' in ext && ext.error !== undefined ? { error: ext.error } : {}),
      source: entry.source,
      sha256: entry.sha256,
      installedAt: entry.installedAt,
      permissions: manifest.permissions ?? [],
      contributes: manifest.contributes ?? {},
      verified: false,
    };
  }

  /** Git-sourced extensions (for the update check). */
  gitSources(): { id: string; url: string; version: string }[] {
    return this.loaded.flatMap((ext) =>
      ext.entry.source.type === 'git'
        ? [{ id: ext.entry.id, url: ext.entry.source.url, version: ext.entry.version }]
        : [],
    );
  }

  setUpdate(id: string, update: { version: string; tag: string } | undefined): void {
    if (update === undefined) this.updates.delete(id);
    else this.updates.set(id, update);
    this.options.onChange();
  }

  async snapshot(): Promise<ExtensionsSnapshot> {
    return {
      extensions: this.loaded.flatMap((ext) => {
        const info = this.info(ext);
        if (info === undefined) return [];
        const update = this.updates.get(ext.entry.id);
        return [
          update === undefined || update.version === info.version ? info : { ...info, update },
        ];
      }),
      grants: await this.options.broker.grants(),
      problems: this.problems,
    };
  }

  /** Installed file contents (the README for the details view). */
  async readme(id: string): Promise<string | undefined> {
    const ext = this.find(id);
    if (ext === undefined) return undefined;
    for (const file of ['README.md', 'readme.md', 'README']) {
      try {
        return (await readFile(path.join(ext.dir, file), 'utf8')).slice(0, 200_000);
      } catch {
        // try the next name
      }
    }
    return undefined;
  }

  // --- Installing --------------------------------------------------------------------------

  /** Describe a package before installing it (permissions, README, what it replaces). */
  preview(pkg: ExtensionPackage, source: ExtensionSource): InstallPreview {
    for (const [id, pending] of this.previews) {
      if (Date.now() - pending.created > 30 * 60_000) this.previews.delete(id);
    }
    const previewId = randomBytes(12).toString('hex');
    this.previews.set(previewId, { pkg, source, created: Date.now() });
    const id = extensionId(pkg.manifest);
    const existing = this.find(id);
    const entry: InstalledEntry = {
      id,
      version: pkg.manifest.version,
      enabled: true,
      source,
      sha256: pkg.sha256,
      installedAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
    const extension = this.info({ entry, manifest: pkg.manifest, state: 'inactive' });
    if (extension === undefined) throw extensionError('The extension could not be read.');
    const readmeBytes = pkg.files.get('README.md') ?? pkg.files.get('readme.md');
    const previous = existing?.manifest?.permissions ?? [];
    const added = (pkg.manifest.permissions ?? []).filter((p) => {
      const before = previous.find((q) => q.id === p.id);
      if (before === undefined) return true;
      const hosts = networkHosts(p);
      const beforeHosts = networkHosts(before) ?? [];
      return hosts !== undefined && hosts.some((h) => !beforeHosts.includes(h));
    });
    return {
      previewId,
      extension,
      ...(readmeBytes === undefined
        ? {}
        : { readme: new TextDecoder().decode(readmeBytes).slice(0, 200_000) }),
      ...(existing === undefined
        ? {}
        : { replaces: { version: existing.entry.version, addedPermissions: added } }),
    };
  }

  cancelPreview(previewId: string): void {
    this.previews.delete(previewId);
  }

  install(previewId: string): Promise<ExtensionsSnapshot> {
    return this.serialized(async () => {
      const pending = this.previews.get(previewId);
      if (pending === undefined)
        throw extensionError('The install preview expired. Choose the file again.');
      this.previews.delete(previewId);
      const { pkg } = pending;
      const id = extensionId(pkg.manifest);
      const existing = this.find(id);
      const entry: InstalledEntry = {
        id,
        version: pkg.manifest.version,
        enabled: existing?.entry.enabled ?? true,
        source: pending.source,
        sha256: pkg.sha256,
        installedAt: (this.options.now?.() ?? new Date()).toISOString(),
      };
      const dir = this.dirOf(entry);
      await rm(dir, { recursive: true, force: true });
      await writePackage(dir, pkg);
      if (existing !== undefined) {
        await this.deactivate(existing);
        // New or wider permissions start without grants (spec 07, "On update").
        await this.options.broker.retainFor(id, pkg.manifest.permissions ?? []);
        if (existing.entry.version !== entry.version) {
          await rm(existing.dir, { recursive: true, force: true });
        }
      }
      const { items } = await this.options.store.read();
      await this.options.store.write([...items.filter((i) => i.id !== id), entry]);
      this.updates.delete(id);
      this.options.audit({
        event: existing === undefined ? 'install' : 'update',
        extension: id,
        version: entry.version,
      });
      await this.load();
      this.options.onChange();
      return this.snapshot();
    });
  }

  uninstall(id: string): Promise<ExtensionsSnapshot> {
    return this.serialized(async () => {
      const ext = this.find(id);
      if (ext === undefined) throw extensionError('That extension is not installed.');
      await this.deactivate(ext);
      const { items } = await this.options.store.read();
      await this.options.store.write(items.filter((i) => i.id !== id));
      await rm(ext.dir, { recursive: true, force: true });
      await this.options.broker.revoke(id);
      await this.options.secrets.delete(id);
      await this.options.storage.clear(id);
      this.options.audit({ event: 'uninstall', extension: id, version: ext.entry.version });
      await this.load();
      this.options.onChange();
      return this.snapshot();
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<ExtensionsSnapshot> {
    return this.serialized(async () => {
      const ext = this.find(id);
      if (ext === undefined) throw extensionError('That extension is not installed.');
      if (!enabled) await this.deactivate(ext);
      const { items } = await this.options.store.read();
      await this.options.store.write(items.map((i) => (i.id === id ? { ...i, enabled } : i)));
      this.options.audit({
        event: enabled ? 'enable' : 'disable',
        extension: id,
        version: ext.entry.version,
      });
      await this.load();
      this.options.onChange();
      return this.snapshot();
    });
  }

  async revoke(id: string, permission?: string): Promise<ExtensionsSnapshot> {
    await this.options.broker.revoke(id, permission);
    this.options.onChange();
    return this.snapshot();
  }

  // --- Activation --------------------------------------------------------------------------

  private async activate(ext: Loaded): Promise<ExtensionConnection> {
    if (ext.connection !== undefined && ext.state === 'active') return ext.connection;
    if (ext.starting !== undefined) return ext.starting;
    if (ext.manifest === undefined || !ext.entry.enabled) {
      throw extensionError(`${ext.entry.id} is ${ext.entry.enabled ? 'broken' : 'disabled'}.`);
    }
    const manifest = ext.manifest;
    if (manifest.main === undefined)
      throw extensionError(`${name(manifest, ext.entry.id)} has no code to run.`);
    const activateMs = this.options.timeouts?.activateMs ?? 10_000;
    ext.state = 'starting';
    this.options.onChange();
    ext.starting = (async () => {
      let connection: ExtensionConnection | undefined;
      try {
        const code = await readFile(path.join(ext.dir, manifest.main ?? ''), 'utf8');
        const port = await this.options.host.start(ext.entry.id, code);
        connection = new ExtensionConnection(port, {
          handle: (call) => this.handleCall(ext, call),
        });
        ext.connection = connection;
        await connection.waitReady(activateMs);
        const env = this.options.env();
        await connection.invoke(
          'activate',
          {
            extensionId: ext.entry.id,
            version: manifest.version,
            env: { ...env, apiVersion: HOST_API_VERSION },
          },
          activateMs,
        );
        ext.state = 'active';
        ext.error = undefined;
        return connection;
      } catch (error) {
        connection?.close();
        ext.connection = undefined;
        this.options.host.stop(ext.entry.id);
        ext.state = 'failed';
        ext.error = error instanceof Error ? error.message : String(error);
        void this.options
          .ui({
            kind: 'message',
            extension: name(manifest, ext.entry.id),
            severity: 'error',
            message: `${name(manifest, ext.entry.id)} failed to start: ${ext.error}`,
            actions: [],
          })
          .catch(() => undefined);
        throw extensionError(`${name(manifest, ext.entry.id)} failed to start.`, ext.error);
      } finally {
        ext.starting = undefined;
        this.options.onChange();
      }
    })();
    return ext.starting;
  }

  private async deactivate(ext: Loaded): Promise<void> {
    const connection = ext.connection;
    if (connection === undefined) return;
    await connection.invoke('deactivate', {}, 5000).catch(() => undefined);
    connection.close();
    this.options.host.stop(ext.entry.id);
    ext.connection = undefined;
    ext.commands.clear();
    ext.enrichers.clear();
    ext.views.clear();
    ext.state = ext.entry.enabled ? 'inactive' : 'disabled';
  }

  /** settings.jsonc changed: tell running extensions about their own settings that changed. */
  configurationChanged(changed: readonly string[]): void {
    for (const ext of this.loaded) {
      if (ext.connection === undefined || ext.state !== 'active') continue;
      const own = ext.manifest?.contributes?.configuration?.properties ?? {};
      const keys = changed.filter((key) => key in own);
      if (keys.length > 0)
        void ext.connection.invoke('configuration', { keys }, 10_000).catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    for (const ext of this.loaded) await this.deactivate(ext);
  }

  private async withInvocation<T>(
    ext: Loaded,
    runId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    const invocation: Invocation = {
      id: randomBytes(8).toString('hex'),
      ...(runId === undefined ? {} : { runId }),
    };
    ext.invocations.push(invocation);
    try {
      return await work();
    } finally {
      ext.invocations.splice(ext.invocations.indexOf(invocation), 1);
      this.options.broker.endInvocation(invocation.id);
    }
  }

  // --- Commands ------------------------------------------------------------------------------

  private ownerOfCommand(command: string): Loaded | undefined {
    return this.loaded.find((ext) =>
      ext.manifest?.contributes?.commands?.some((c) => c.command === command),
    );
  }

  /**
   * Run a contributed command (from the palette, a menu or a keybinding). From a result cell's
   * menu the arguments carry result values: that needs `results.readSelection`.
   */
  async executeCommand(
    command: string,
    args: unknown[],
    runId?: string,
    fromResults = false,
  ): Promise<unknown> {
    const ext = this.ownerOfCommand(command);
    if (ext === undefined) throw extensionError(`No installed extension provides ${command}.`);
    if (fromResults) {
      const ok = await this.options.broker.check({
        extensionId: ext.entry.id,
        permission: 'results.readSelection',
        declared: this.declared(ext, 'results.readSelection'),
        runId,
        detail: 'read the result value you right-clicked',
      });
      if (!ok) throw denied('Permission denied: results.readSelection.');
    }
    const connection = await this.activate(ext);
    return this.withInvocation(ext, runId, () =>
      connection.invoke('command', { command, args }, this.options.timeouts?.commandMs ?? 120_000),
    );
  }

  // --- Enrichment, result renderers and views ----------------------------------------------

  /** Enrich selected result values (spec 07): one prompt for reading and sending them. */
  async enrich(
    extensionId: string,
    enricherId: string,
    runId: string | undefined,
    entities: { type: EntityType; value: string }[],
  ): Promise<EnrichmentResultData[]> {
    const ext = this.find(extensionId);
    const enricher = ext?.manifest?.contributes?.enrichers?.find((e) => e.id === enricherId);
    if (ext === undefined || enricher === undefined)
      throw extensionError('That enricher is not installed.');
    const wanted = entities.filter((e) => enricher.entityTypes.includes(e.type)).slice(0, 500);
    if (wanted.length === 0) return [];
    const network = this.declared(ext, 'network');
    const hosts = networkHosts(network) ?? [];
    const types = [...new Set(wanted.map((e) => ENTITY_LABELS[e.type]))].join(', ');
    const count = `${String(wanted.length)} ${wanted.length === 1 ? 'value' : 'values'} (${types})`;
    const ok = await this.options.broker.checkMany(
      [
        {
          extensionId,
          permission: 'results.readSelection',
          declared: this.declared(ext, 'results.readSelection'),
          runId,
          detail: '',
        },
        ...(network === undefined
          ? []
          : [
              {
                extensionId,
                permission: 'network',
                declared: network,
                runId,
                host: (hosts[0] ?? '').replace(/^\*\./, ''),
                detail: '',
              },
            ]),
      ],
      hosts.length === 0
        ? `read ${count} from this result`
        : `send ${count} from this result to ${hosts.join(', ')}`,
    );
    if (!ok) throw denied('Permission denied: the values were not sent.');
    const connection = await this.activate(ext);
    const raw = await this.withInvocation(ext, runId, () =>
      connection.invoke(
        'enrich',
        { provider: enricherId, entities: wanted, cancelId: randomBytes(6).toString('hex') },
        this.options.timeouts?.commandMs ?? 120_000,
      ),
    );
    const parsed = z.array(EnrichmentResultSchema).max(1000).safeParse(raw);
    if (!parsed.success)
      throw extensionError(
        `${name(ext.manifest, extensionId)} returned invalid enrichment results.`,
      );
    return parsed.data;
  }

  /** A result renderer wants the active result's rows: `results.read`, per run by default. */
  async resultsAccess(
    extensionId: string,
    runId: string | undefined,
    rows: number,
  ): Promise<boolean> {
    const ext = this.find(extensionId);
    if (ext === undefined) return false;
    return this.options.broker.check({
      extensionId,
      permission: 'results.read',
      declared: this.declared(ext, 'results.read'),
      runId,
      detail: `read ${String(rows)} rows of this result to draw them`,
    });
  }

  /** A contributed sidebar view became visible: start the extension and resolve the view. */
  async resolveView(viewId: string): Promise<void> {
    const ext = this.loaded.find((e) =>
      e.manifest?.contributes?.views?.sidebar?.some((v) => v.id === viewId),
    );
    if (ext === undefined)
      throw extensionError(`No installed extension provides the view ${viewId}.`);
    const connection = await this.activate(ext);
    if (!ext.views.has(viewId)) return; // the extension doesn't talk to its view
    await connection.invoke('webview.resolve', { viewId, webviewId: viewId }, 10_000);
  }

  async webviewMessage(viewId: string, message: unknown): Promise<void> {
    const ext = this.loaded.find((e) => e.views.has(viewId));
    if (ext?.connection === undefined) return;
    await ext.connection.invoke('webview.message', { webviewId: viewId, message }, 10_000);
  }

  /** The installed folder of an extension (the `rkql-ext:` protocol serves files from it). */
  folderOf(extensionId: string): string | undefined {
    const ext = this.find(extensionId);
    return ext?.manifest === undefined || !ext.entry.enabled ? undefined : ext.dir;
  }

  /** Colour themes contributed by enabled extensions (data only: no activation needed). */
  async themes(): Promise<{ extensionId: string; label: string; uiTheme: string; json: string }[]> {
    const out: { extensionId: string; label: string; uiTheme: string; json: string }[] = [];
    for (const ext of this.loaded) {
      if (!ext.entry.enabled || ext.manifest === undefined) continue;
      for (const theme of ext.manifest.contributes?.themes ?? []) {
        try {
          out.push({
            extensionId: ext.entry.id,
            label: theme.label,
            uiTheme: theme.uiTheme,
            json: await readFile(path.join(ext.dir, theme.path), 'utf8'),
          });
        } catch {
          // A missing theme file is reported by the theme list as absent.
        }
      }
    }
    return out;
  }

  // --- The host API --------------------------------------------------------------------------

  private declared(ext: Loaded, permission: string): PermissionDeclaration | undefined {
    return ext.manifest?.permissions?.find((p) => p.id === permission);
  }

  private currentInvocation(ext: Loaded): Invocation | undefined {
    return ext.invocations.at(-1);
  }

  private async require(
    ext: Loaded,
    permission: string,
    detail: string,
    host?: string,
  ): Promise<void> {
    const invocation = this.currentInvocation(ext);
    const ok = await this.options.broker.check({
      extensionId: ext.entry.id,
      permission,
      declared: this.declared(ext, permission),
      runId: invocation?.runId,
      invocationId: invocation?.id,
      host,
      detail,
    });
    if (!ok) {
      const declaration = this.declared(ext, permission);
      const hosts = networkHosts(declaration);
      if (host !== undefined && hosts !== undefined && !hostAllowed(host, hosts)) {
        throw denied(`${host} is not declared in the "network" permission in package.json.`);
      }
      const declared = declaration !== undefined;
      throw denied(
        declared
          ? `Permission denied: ${permission}${host === undefined ? '' : ` (${host})`}.`
          : `Permission ${permission}${host === undefined ? '' : ` for ${host}`} is not declared in package.json.`,
      );
    }
  }

  private async handleCall(ext: Loaded, call: CallMessage): Promise<unknown> {
    const method = call.method as Method;
    const schema = CallSchemas[method] as z.ZodType | undefined;
    if (schema === undefined) throw new Error(`Unknown API call ${call.method}.`);
    const parsed = schema.safeParse(call.args);
    if (!parsed.success) throw new Error(`Invalid arguments for ${call.method}.`);
    return this.dispatch(ext, method, parsed.data as Record<string, unknown>);
  }

  private async dispatch(
    ext: Loaded,
    method: Method,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const extension = name(ext.manifest, ext.entry.id);
    const id = ext.entry.id;
    switch (method) {
      case 'commands.register': {
        const command = String(args['id']);
        if (!ext.manifest?.contributes?.commands?.some((c) => c.command === command)) {
          throw new Error(`${command} is not a command in package.json "contributes.commands".`);
        }
        ext.commands.add(command);
        return undefined;
      }
      case 'commands.unregister':
        ext.commands.delete(String(args['id']));
        return undefined;
      case 'commands.execute': {
        const command = String(args['id']);
        if (ext.manifest?.contributes?.commands?.some((c) => c.command === command)) {
          return this.executeCommand(
            command,
            args['args'] as unknown[],
            this.currentInvocation(ext)?.runId,
          );
        }
        if (!HOST_COMMAND_ALLOWLIST.has(command)) throw denied(`Extensions can't run ${command}.`);
        return this.options.ui({ kind: 'executeHostCommand', extension, command });
      }
      case 'window.message':
        return this.options.ui({
          kind: 'message',
          extension,
          severity: args['severity'] as 'info' | 'warning' | 'error',
          message: String(args['message']),
          actions: args['actions'] as string[],
        });
      case 'window.quickPick':
        return this.options.ui({
          kind: 'quickPick',
          extension,
          items: args['items'] as { label: string }[],
          ...(args['placeHolder'] === undefined
            ? {}
            : { placeHolder: args['placeHolder'] as string }),
        });
      case 'window.inputBox':
        return this.options.ui({ kind: 'inputBox', extension, ...(args as object) });
      case 'window.progressStart': {
        const progressId = this.nextProgress++;
        void this.options.ui({
          kind: 'progress',
          extension,
          progressId,
          title: args['title'] as string,
        });
        return progressId;
      }
      case 'window.progressEnd':
        void this.options.ui({ kind: 'progress', extension, progressId: Number(args['id']) });
        return undefined;
      case 'enrichment.register': {
        const enricher = String(args['id']);
        if (!ext.manifest?.contributes?.enrichers?.some((e) => e.id === enricher)) {
          throw new Error(
            `${enricher} is not an enricher in package.json "contributes.enrichers".`,
          );
        }
        ext.enrichers.add(enricher);
        return undefined;
      }
      case 'views.register': {
        const view = String(args['viewId']);
        if (!ext.manifest?.contributes?.views?.sidebar?.some((v) => v.id === view)) {
          throw new Error(`${view} is not a view in package.json "contributes.views".`);
        }
        ext.views.add(view);
        return undefined;
      }
      case 'webview.post': {
        const webviewId = String(args['webviewId']);
        if (!ext.views.has(webviewId)) throw new Error(`${webviewId} is not a registered view.`);
        this.options.postToWebview?.(id, webviewId, args['message']);
        return undefined;
      }
      case 'net.fetch':
        return this.fetch(
          ext,
          String(args['url']),
          args['init'] as { method?: string; headers?: Record<string, string>; body?: string },
        );
      case 'secrets.get':
        await this.require(ext, 'secrets', 'use its secret storage');
        return (await this.options.secrets.get(id, String(args['key']))) ?? null;
      case 'secrets.set':
        await this.require(ext, 'secrets', 'use its secret storage');
        await this.options.secrets.set(id, String(args['key']), String(args['value']));
        return undefined;
      case 'secrets.delete':
        await this.require(ext, 'secrets', 'use its secret storage');
        await this.options.secrets.delete(id, String(args['key']));
        return undefined;
      case 'storage.get':
        return (await this.options.storage.get(id, String(args['key']))) ?? null;
      case 'storage.set':
        await this.options.storage.set(id, String(args['key']), args['value']);
        return undefined;
      case 'configuration.get': {
        const key = String(args['key']);
        const property = ext.manifest?.contributes?.configuration?.properties[key];
        if (property === undefined) return null;
        return configurationValue(property, this.options.settingValue(key)) ?? null;
      }
      case 'editor.getActiveQuery':
        return (await this.options.ui({ kind: 'editor.getActiveQuery', extension })) ?? null;
      case 'editor.insertText':
        return this.options.ui({
          kind: 'editor.insertText',
          extension,
          text: String(args['text']),
        });
      case 'editor.openQueryTab':
        return this.options.ui({
          kind: 'editor.openQueryTab',
          extension,
          query: String(args['query']),
          ...(args['title'] === undefined ? {} : { title: args['title'] as string }),
        });
      case 'clipboard.writeText':
        await this.require(ext, 'clipboard.write', 'write to the clipboard');
        await this.options.writeClipboard(String(args['text']));
        return undefined;
    }
  }

  private async fetch(
    ext: Loaded,
    rawUrl: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<unknown> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('net.fetch needs an absolute URL.');
    }
    const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
    if (url.protocol !== 'https:' && !local) throw denied('Extensions can only use https:// URLs.');
    if (url.username !== '' || url.password !== '')
      throw denied('URLs with credentials are not allowed.');
    await this.require(ext, 'network', `connect to ${url.host}`, url.hostname);
    const response = await this.options.fetch(url.toString(), {
      method: init.method ?? 'GET',
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.body === undefined ? {} : { body: init.body }),
      // A redirect could lead to a host that wasn't granted: the extension sees the 3xx.
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') headers[key] = value;
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await readLimited(response),
    };
  }
}
