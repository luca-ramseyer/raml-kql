import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  discoverPacks,
  formatQueryFile,
  type DiscoveredPacks,
  type LoadedPack,
  type PackQuery,
} from '@raml-kql/pack-schema';
import { z } from 'zod';

import type { ConfigProblem } from '../../shared/config/config-snapshots';
import { AppError } from '../../shared/errors';
import type {
  InstalledPack,
  PackProblemData,
  PackQueryData,
  PackQueryRef,
  PacksSnapshot,
  QueryChange,
  Source,
  SourceInfo,
  SourcePreview,
  UpdatePreview,
} from '../../shared/packs/models';
import { readTextFile, writeTextFileAtomic } from '../config/jsonc';

import {
  checkGitUrl,
  cloneSource,
  commitsBetween,
  fetchLatest,
  readCommitFiles,
} from './git-source';
import { hashFiles, readFolderFiles, sourceError, writeFiles } from './pack-files';
import type { SourcesStore } from './sources-config';

/**
 * Query pack sources (spec 08): add from git or a file, load the packs of each source, check
 * for updates (never applied silently) and remove. Git sources load from their pinned commit;
 * imported files are copied into the source folder. All of it is machine-local
 * (`<config>/sources/`, git-ignored); `sources.jsonc` is the shareable list.
 */
export interface Credentials {
  store(token: string): Promise<string>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

export interface PacksServiceOptions {
  sourcesDir: string;
  /** Machine-local update-check state (`state/pack-sources.json`). */
  stateFile: string;
  store: SourcesStore;
  credentials: Credentials;
  onChange: () => void;
  now?: () => Date;
}

const StateSchema = z.record(
  z.string(),
  z.object({
    lastCheck: z.string().optional(),
    update: z.object({ sha: z.string(), commits: z.number().int() }).optional(),
  }),
);
type SourcesState = z.infer<typeof StateSchema>;

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 30 * 60 * 1000;

interface Preview {
  preview: SourcePreview;
  source: Source;
  /** Git: the clone waiting to be moved into place. */
  tmpDir?: string;
  /** File: the files to write. */
  files?: Map<string, string>;
  token?: string;
  created: number;
}

interface LoadedSource {
  source: Source;
  packs: LoadedPack[];
  problems: PackProblemData[];
  error?: string;
}

function hash12(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function toInstalled(sourceId: string, pack: LoadedPack): InstalledPack {
  const { manifest } = pack;
  return {
    sourceId,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    ...(manifest.authors === undefined ? {} : { authors: manifest.authors }),
    ...(manifest.license === undefined ? {} : { license: manifest.license }),
    ...(manifest.homepage === undefined ? {} : { homepage: manifest.homepage }),
    ...(manifest.tags === undefined ? {} : { tags: manifest.tags }),
    ...(manifest.defaults === undefined ? {} : { defaults: manifest.defaults }),
    queries: pack.queries.map(({ body: _body, ...info }) => info),
    problems: pack.problems,
  };
}

/** A query as one comparable text: metadata as front-matter, then the body. */
function queryText(query: PackQuery): string {
  const { body, file: _file, ...meta } = query;
  return formatQueryFile(meta, body);
}

export class PacksService {
  private loaded: LoadedSource[] = [];
  private problems: ConfigProblem[] = [];
  private readonly previews = new Map<string, Preview>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: PacksServiceOptions) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private dirOf(sourceId: string): string {
    return path.join(this.options.sourcesDir, sourceId);
  }

  private async readState(): Promise<SourcesState> {
    try {
      const text = await readTextFile(this.options.stateFile);
      const parsed = StateSchema.safeParse(text === undefined ? {} : JSON.parse(text));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private async writeState(state: SourcesState): Promise<void> {
    await mkdir(path.dirname(this.options.stateFile), { recursive: true });
    await writeTextFileAtomic(this.options.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  private async filesOf(source: Source): Promise<Map<string, string>> {
    const dir = this.dirOf(source.id);
    return source.type === 'git' ? readCommitFiles(dir, source.sha) : readFolderFiles(dir);
  }

  /** (Re)load every source's packs from disk. */
  async reload(): Promise<void> {
    const { sources, problems } = await this.options.store.read();
    const loaded: LoadedSource[] = [];
    for (const source of sources) {
      try {
        const discovered = discoverPacks(await this.filesOf(source));
        loaded.push({ source, packs: discovered.packs, problems: discovered.problems });
      } catch (error) {
        loaded.push({
          source,
          packs: [],
          problems: [],
          error:
            error instanceof AppError
              ? error.message
              : 'The source files are missing. Remove the source and add it again.',
        });
      }
    }
    this.loaded = loaded;
    this.problems = problems;
  }

  async snapshot(): Promise<PacksSnapshot> {
    const state = await this.readState();
    const sources: SourceInfo[] = this.loaded.map(({ source, problems, error }) => {
      const info = state[source.id];
      const update =
        source.type === 'git' && info?.update !== undefined && info.update.sha !== source.sha
          ? info.update
          : undefined;
      return {
        id: source.id,
        type: source.type,
        label: source.type === 'git' ? source.url : source.name,
        ...(source.type === 'git' && source.ref !== undefined ? { ref: source.ref } : {}),
        ...(source.type === 'git' ? { sha: source.sha } : {}),
        addedAt: source.addedAt,
        hasCredential: source.type === 'git' && source.credentialRef !== undefined,
        problems,
        ...(error === undefined ? {} : { error }),
        ...(update === undefined ? {} : { update }),
        ...(info?.lastCheck === undefined ? {} : { lastCheck: info.lastCheck }),
      };
    });
    const packs = this.loaded.flatMap(({ source, packs: list }) =>
      list.map((pack) => toInstalled(source.id, pack)),
    );
    return { sources, packs, problems: this.problems };
  }

  readQuery(ref: PackQueryRef): PackQueryData {
    const source = this.loaded.find((s) => s.source.id === ref.sourceId);
    const pack = source?.packs.find((p) => p.manifest.id === ref.packId);
    const query = pack?.queries.find((q) => q.id === ref.queryId);
    if (query === undefined) throw sourceError('That pack query is no longer installed.');
    return query;
  }

  // --- Adding sources ----------------------------------------------------------------------

  private toPreview(
    base: Omit<SourcePreview, 'packs' | 'problems' | 'alreadyAdded' | 'previewId'>,
    sourceId: string,
    discovered: DiscoveredPacks,
  ): SourcePreview {
    const installed = new Set(
      this.loaded.flatMap((s) =>
        s.source.id === sourceId ? [] : s.packs.map((p) => p.manifest.id),
      ),
    );
    return {
      ...base,
      previewId: randomBytes(12).toString('hex'),
      packs: discovered.packs.map((pack) => ({
        id: pack.manifest.id,
        name: pack.manifest.name,
        version: pack.manifest.version,
        queries: pack.queries.length,
        problems: pack.problems,
        conflict: installed.has(pack.manifest.id),
      })),
      problems: discovered.problems,
      alreadyAdded: this.loaded.some((s) => s.source.id === sourceId),
    };
  }

  private async expirePreviews(): Promise<void> {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of this.previews) {
      if (preview.created < cutoff) await this.cancelPreview(id);
    }
  }

  /** Clone a git source into a temporary folder and describe what it contains. */
  async previewGit(request: {
    url: string;
    ref?: string | undefined;
    token?: string | undefined;
  }): Promise<SourcePreview> {
    await this.expirePreviews();
    const url = checkGitUrl(request.url);
    const ref = request.ref?.trim() === '' ? undefined : request.ref?.trim();
    const sourceId = `git-${hash12(`${url}#${ref ?? ''}`)}`;
    const tmpDir = path.join(this.options.sourcesDir, `.preview-${randomBytes(8).toString('hex')}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      const sha = await cloneSource({ dir: tmpDir, url, ref, token: request.token });
      const discovered = discoverPacks(await readCommitFiles(tmpDir, sha));
      const preview = this.toPreview({ type: 'git', label: url, sha }, sourceId, discovered);
      this.previews.set(preview.previewId, {
        preview,
        tmpDir,
        created: Date.now(),
        ...(request.token === undefined ? {} : { token: request.token }),
        source: {
          id: sourceId,
          type: 'git',
          url,
          ...(ref === undefined ? {} : { ref }),
          sha,
          addedAt: this.now().toISOString(),
        },
      });
      return preview;
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Describe the packs in imported files (a zip's or a folder's contents). */
  async previewFiles(files: Map<string, string>, name: string): Promise<SourcePreview> {
    await this.expirePreviews();
    const hash = hashFiles(files);
    const sourceId = `file-${hash.slice(0, 12)}`;
    const discovered = discoverPacks(files);
    const preview = this.toPreview({ type: 'file', label: name }, sourceId, discovered);
    this.previews.set(preview.previewId, {
      preview,
      files,
      created: Date.now(),
      source: { id: sourceId, type: 'file', name, hash, addedAt: this.now().toISOString() },
    });
    return preview;
  }

  async cancelPreview(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId);
    this.previews.delete(previewId);
    if (preview?.tmpDir !== undefined) await rm(preview.tmpDir, { recursive: true, force: true });
  }

  /** Add a previewed source. */
  add(previewId: string): Promise<PacksSnapshot> {
    return this.serialized(async () => {
      const pending = this.previews.get(previewId);
      if (pending === undefined) throw sourceError('The preview expired. Add the source again.');
      if (pending.preview.alreadyAdded) throw sourceError('This source is already added.');
      if (pending.preview.packs.length === 0) {
        throw sourceError('The source contains no valid query packs.');
      }
      const target = this.dirOf(pending.source.id);
      await rm(target, { recursive: true, force: true });
      await mkdir(this.options.sourcesDir, { recursive: true });
      let source = pending.source;
      if (pending.tmpDir !== undefined) await rename(pending.tmpDir, target);
      if (pending.files !== undefined) await writeFiles(target, pending.files);
      this.previews.delete(previewId);
      if (source.type === 'git' && pending.token !== undefined) {
        source = { ...source, credentialRef: await this.options.credentials.store(pending.token) };
      }
      const { sources } = await this.options.store.read();
      await this.options.store.write([...sources, source]);
      await this.reload();
      this.options.onChange();
      return this.snapshot();
    });
  }

  remove(sourceId: string): Promise<PacksSnapshot> {
    return this.serialized(async () => {
      const { sources } = await this.options.store.read();
      const source = sources.find((s) => s.id === sourceId);
      if (source === undefined) throw sourceError('That source is not installed.');
      await this.options.store.write(sources.filter((s) => s.id !== sourceId));
      await rm(this.dirOf(sourceId), { recursive: true, force: true });
      if (source.type === 'git' && source.credentialRef !== undefined) {
        await this.options.credentials.delete(source.credentialRef);
      }
      const { [sourceId]: _removed, ...state } = await this.readState();
      await this.writeState(state);
      await this.reload();
      this.options.onChange();
      return this.snapshot();
    });
  }

  // --- Updates -----------------------------------------------------------------------------

  private async tokenOf(source: Source): Promise<string | undefined> {
    return source.type === 'git' && source.credentialRef !== undefined
      ? this.options.credentials.get(source.credentialRef)
      : undefined;
  }

  /**
   * Check git sources for newer commits. `force` ignores the once-per-24-hours throttle
   * (the "Check for Pack Updates" command). Returns how many sources have updates.
   */
  checkUpdates(options: { sourceId?: string; force: boolean }): Promise<{
    checked: number;
    updates: number;
    errors: { label: string; message: string }[];
  }> {
    return this.serialized(async () => {
      const state = await this.readState();
      const now = this.now();
      let checked = 0;
      const errors: { label: string; message: string }[] = [];
      for (const { source } of this.loaded) {
        if (source.type !== 'git') continue;
        if (options.sourceId !== undefined && source.id !== options.sourceId) continue;
        const last = Date.parse(state[source.id]?.lastCheck ?? '');
        if (!options.force && Number.isFinite(last) && now.getTime() - last < CHECK_INTERVAL_MS) {
          continue;
        }
        checked += 1;
        try {
          const dir = this.dirOf(source.id);
          const latest = await fetchLatest({
            dir,
            url: source.url,
            ref: source.ref,
            token: await this.tokenOf(source),
          });
          const entry = { lastCheck: now.toISOString() };
          if (latest === source.sha) state[source.id] = entry;
          else {
            const { commits, more } = await commitsBetween(dir, source.sha, latest);
            state[source.id] = {
              ...entry,
              update: { sha: latest, commits: commits.length + (more ? 1 : 0) },
            };
          }
        } catch (error) {
          errors.push({
            label: source.url,
            message: error instanceof AppError ? error.message : 'The update check failed.',
          });
        }
      }
      await this.writeState(state);
      const updates = this.loaded.filter(
        ({ source }) =>
          source.type === 'git' &&
          state[source.id]?.update !== undefined &&
          state[source.id]?.update?.sha !== source.sha,
      ).length;
      if (checked > 0) this.options.onChange();
      return { checked, updates, errors };
    });
  }

  private gitSource(sourceId: string): Extract<Source, { type: 'git' }> {
    const source = this.loaded.find((s) => s.source.id === sourceId)?.source;
    if (source?.type !== 'git') throw sourceError('That git source is not installed.');
    return source;
  }

  /** What an update changes: commits and added, removed and changed queries. */
  async updatePreview(sourceId: string): Promise<UpdatePreview> {
    const source = this.gitSource(sourceId);
    const update = (await this.readState())[sourceId]?.update;
    if (update === undefined || update.sha === source.sha) {
      throw sourceError('There is no update for this source. Check for updates first.');
    }
    const dir = this.dirOf(sourceId);
    const before = discoverPacks(await readCommitFiles(dir, source.sha));
    const after = discoverPacks(await readCommitFiles(dir, update.sha));
    const { commits, more } = await commitsBetween(dir, source.sha, update.sha);
    const packIds = [...new Set([...before.packs, ...after.packs].map((p) => p.manifest.id))];
    const changes: QueryChange[] = [];
    const packs: UpdatePreview['packs'] = [];
    for (const packId of packIds) {
      const old = before.packs.find((p) => p.manifest.id === packId);
      const next = after.packs.find((p) => p.manifest.id === packId);
      const packName = next?.manifest.name ?? old?.manifest.name ?? packId;
      packs.push({
        id: packId,
        name: packName,
        ...(old === undefined ? {} : { fromVersion: old.manifest.version }),
        ...(next === undefined ? {} : { toVersion: next.manifest.version }),
      });
      const ids = [
        ...new Set([...(old?.queries ?? []), ...(next?.queries ?? [])].map((q) => q.id)),
      ];
      for (const queryId of ids) {
        const a = old?.queries.find((q) => q.id === queryId);
        const b = next?.queries.find((q) => q.id === queryId);
        const textA = a === undefined ? undefined : queryText(a);
        const textB = b === undefined ? undefined : queryText(b);
        if (textA === textB) continue;
        changes.push({
          packId,
          packName,
          queryId,
          name: b?.name ?? a?.name ?? queryId,
          change: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed',
          ...(textA === undefined ? {} : { before: textA }),
          ...(textB === undefined ? {} : { after: textB }),
        });
      }
    }
    return {
      sourceId,
      label: source.url,
      fromSha: source.sha,
      toSha: update.sha,
      commits,
      moreCommits: more,
      packs,
      changes,
      problems: [...after.problems, ...after.packs.flatMap((p) => p.problems)],
    };
  }

  /** Pin the source to the previewed commit. */
  applyUpdate(sourceId: string, sha: string): Promise<PacksSnapshot> {
    return this.serialized(async () => {
      const state = await this.readState();
      if (state[sourceId]?.update?.sha !== sha) {
        throw sourceError('The update changed since it was reviewed. Review it again.');
      }
      const { sources } = await this.options.store.read();
      await this.options.store.write(
        sources.map((s) => (s.id === sourceId && s.type === 'git' ? { ...s, sha } : s)),
      );
      const { update: _update, ...rest } = state[sourceId] ?? {};
      state[sourceId] = rest;
      await this.writeState(state);
      await this.reload();
      this.options.onChange();
      return this.snapshot();
    });
  }

  /** Remove leftover preview clones (after a crash). */
  async cleanUp(): Promise<void> {
    try {
      await stat(this.options.sourcesDir);
    } catch {
      return;
    }
    for (const entry of await readdir(this.options.sourcesDir)) {
      if (entry.startsWith('.preview-')) {
        await rm(path.join(this.options.sourcesDir, entry), { recursive: true, force: true });
      }
    }
  }
}
