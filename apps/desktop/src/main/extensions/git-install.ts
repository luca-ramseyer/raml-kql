import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { compareVersions, parseVersion } from '@raml-kql/pack-schema/semver';
import { addRemote, fetch as gitFetch, init, listServerRefs, TREE, walk } from 'isomorphic-git';

import { AppError } from '../../shared/errors';
import { gitHttp as http } from '../network/git-http';
import { checkGitUrl } from '../packs/git-source';
import { safeRelativePath } from '../packs/pack-files';

import {
  EXTENSION_LIMITS,
  extensionError,
  HOST_API_VERSION,
  readExtensionZip,
  toPackage,
  type ExtensionPackage,
} from './extension-package';

/**
 * Installing extensions from a git repository (spec 07, "Install from git URL"): list the
 * `vX.Y.Z` tags, take the newest version whose manifest fits this app, preferring a release
 * asset (`*.rkqlx`) on GitHub or GitLab, else a shallow clone of the tag with a prebuilt
 * `dist/`. The source URL, tag and commit are recorded for pinning.
 */
export interface VersionTag {
  tag: string;
  version: string;
  oid: string;
}

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

function toAppError(error: unknown, url: string): AppError {
  if (error instanceof AppError) return error;
  const e = error as { code?: string; data?: { statusCode?: number }; message?: string };
  if (e.code === 'HttpError' && (e.data?.statusCode === 401 || e.data?.statusCode === 403)) {
    return extensionError(`${url} is private. Only public repositories can be installed from git.`);
  }
  if (e.code === 'HttpError' && e.data?.statusCode === 404) {
    return extensionError(`No git repository found at ${url}.`);
  }
  return extensionError(`Could not read the git repository ${url}.`, e.message);
}

/** Release tags (`v1.2.0` or `1.2.0`), newest first. */
export async function listVersionTags(url: string): Promise<VersionTag[]> {
  let refs: { ref: string; oid: string; peeled?: string }[];
  try {
    refs = await listServerRefs({ http, url, prefix: 'refs/tags/', peelTags: true });
  } catch (error) {
    throw toAppError(error, url);
  }
  const tags: VersionTag[] = [];
  for (const ref of refs) {
    const tag = ref.ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    const version = parseVersion(tag);
    if (version === undefined || version.prerelease.length > 0) continue;
    if (tags.some((t) => t.tag === tag)) continue;
    tags.push({
      tag,
      version: `${String(version.major)}.${String(version.minor)}.${String(version.patch)}`,
      oid: ref.peeled ?? ref.oid,
    });
  }
  return tags.sort((a, b) => {
    const va = parseVersion(a.version);
    const vb = parseVersion(b.version);
    return va === undefined || vb === undefined ? 0 : compareVersions(vb, va);
  });
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > EXTENSION_LIMITS.maxTotalBytes)
    throw extensionError('The release asset is larger than 50 MB.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > EXTENSION_LIMITS.maxTotalBytes)
    throw extensionError('The release asset is larger than 50 MB.');
  return data;
}

/** The `.rkqlx` asset of a GitHub or GitLab release, if there is one. */
export async function fetchReleaseAsset(
  url: string,
  tag: string,
  fetch: HttpFetch,
): Promise<Uint8Array | undefined> {
  const parsed = new URL(url);
  const repoPath = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '');
  let assetUrl: string | undefined;
  try {
    if (parsed.hostname === 'github.com') {
      const response = await fetch(
        `https://api.github.com/repos/${repoPath}/releases/tags/${encodeURIComponent(tag)}`,
        { headers: { accept: 'application/vnd.github+json' } },
      );
      if (response.status === 403 || response.status === 429) {
        throw extensionError('GitHub rate-limited the request. Try again in a few minutes.');
      }
      if (!response.ok) return undefined;
      const release = (await response.json()) as {
        assets?: { name?: string; browser_download_url?: string }[];
      };
      assetUrl = release.assets?.find(
        (a) => a.name?.endsWith('.rkqlx') === true,
      )?.browser_download_url;
    } else if (parsed.hostname === 'gitlab.com') {
      const response = await fetch(
        `https://gitlab.com/api/v4/projects/${encodeURIComponent(repoPath)}/releases/${encodeURIComponent(tag)}`,
      );
      if (!response.ok) return undefined;
      const release = (await response.json()) as {
        assets?: { links?: { name?: string; url?: string }[] };
      };
      assetUrl = release.assets?.links?.find((l) => l.name?.endsWith('.rkqlx') === true)?.url;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    return undefined;
  }
  if (assetUrl === undefined || !assetUrl.startsWith('https://')) return undefined;
  const response = await fetch(assetUrl);
  if (!response.ok) throw extensionError(`The release asset of ${tag} could not be downloaded.`);
  return readLimited(response);
}

/** All files of a commit (no checkout), within the extension limits. */
async function readTreeFiles(dir: string, oid: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  await walk({
    fs,
    dir,
    trees: [TREE({ ref: oid })],
    map: async (filepath, entries) => {
      const [entry] = entries;
      if (entry === null || entry === undefined || filepath === '.') return true;
      const type = await entry.type();
      if (type === 'tree')
        return filepath.split('/').some((p) => p.startsWith('.') || p === 'node_modules')
          ? null
          : true;
      if (type !== 'blob') return null;
      const safe = safeRelativePath(filepath);
      if (safe === undefined) return null;
      const content = await entry.content();
      if (content === undefined) return null;
      total += content.length;
      if (
        content.length > EXTENSION_LIMITS.maxFileBytes ||
        total > EXTENSION_LIMITS.maxTotalBytes ||
        files.size >= EXTENSION_LIMITS.maxFiles
      ) {
        throw extensionError('The repository is too large to install as an extension.');
      }
      files.set(safe, content);
      return null;
    },
  });
  return files;
}

/**
 * Fetch one tag shallowly and read the extension from its commit (it must contain a built
 * `dist/`). `commit` is the tag's commit as the server listed it (peeled).
 */
export async function cloneTagPackage(
  url: string,
  tag: string,
  commit: string,
  tempRoot: string,
): Promise<{ pkg: ExtensionPackage; sha: string }> {
  const dir = await mkdtemp(path.join(tempRoot, 'ext-'));
  try {
    await init({ fs, dir });
    await addRemote({ fs, dir, remote: 'origin', url });
    await gitFetch({ fs, http, dir, url, ref: tag, singleBranch: true, depth: 1, tags: false });
    const pkg = toPackage(await readTreeFiles(dir, commit));
    return { pkg, sha: commit };
  } catch (error) {
    throw toAppError(error, url);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ResolvedGitExtension {
  pkg: ExtensionPackage;
  url: string;
  tag: string;
  sha?: string | undefined;
}

/** The newest compatible version of an extension in a git repository. */
export async function resolveGitExtension(options: {
  url: string;
  fetch: HttpFetch;
  tempRoot: string;
  /** Only versions newer than this (update checks). */
  newerThan?: string | undefined;
}): Promise<ResolvedGitExtension | undefined> {
  const url = checkGitUrl(options.url);
  const tags = await listVersionTags(url);
  if (tags.length === 0) throw extensionError(`${url} has no release tags (like v1.0.0).`);
  let lastError: unknown;
  for (const candidate of tags.slice(0, 10)) {
    const current = options.newerThan === undefined ? undefined : parseVersion(options.newerThan);
    const version = parseVersion(candidate.version);
    if (current !== undefined && version !== undefined && compareVersions(version, current) <= 0)
      return undefined;
    try {
      const asset = await fetchReleaseAsset(url, candidate.tag, options.fetch);
      if (asset !== undefined) {
        const pkg = readExtensionZip(asset);
        return { pkg, url, tag: candidate.tag, sha: candidate.oid };
      }
      const { pkg, sha } = await cloneTagPackage(
        url,
        candidate.tag,
        candidate.oid,
        options.tempRoot,
      );
      return { pkg, url, tag: candidate.tag, sha };
    } catch (error) {
      // An incompatible or broken release: try the one before it.
      lastError = error;
    }
  }
  if (lastError instanceof AppError) throw lastError;
  throw extensionError(
    `No release of ${url} works with this version of Raml KQL (API ${HOST_API_VERSION}).`,
  );
}
