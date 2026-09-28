import fs from 'node:fs';

import {
  clone,
  fetch as gitFetch,
  log as gitLog,
  resolveRef,
  TREE,
  walk,
  type AuthCallback,
} from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

import { AppError } from '../../shared/errors';
import type { CommitInfo } from '../../shared/packs/models';

import { isPackFile, PackFileBudget, safeRelativePath, sourceError } from './pack-files';

/**
 * Git pack sources with isomorphic-git (spec 08): no system git. Clones are shallow and have no
 * working tree; pack files are read straight from the pinned commit's tree, so what the app
 * loads is exactly the commit recorded in `sources.jsonc`.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Only `https://` URLs (and `http://` to this machine, for local git servers and tests).
 * Credentials in the URL are refused: tokens go to secure storage instead.
 */
export function checkGitUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw sourceError('Enter a git repository URL, like https://github.com/contoso/kql-packs.');
  }
  if (url.username !== '' || url.password !== '') {
    throw sourceError(
      'Remove the user name or token from the URL. For a private repository, enter a token when asked.',
    );
  }
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw sourceError('Only https:// git URLs are supported.');
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function authFor(token: string | undefined): AuthCallback | undefined {
  // Any user name works with a token for GitHub, GitLab and Azure DevOps.
  return token === undefined ? undefined : () => ({ username: 'raml-kql', password: token });
}

function describe(error: unknown, url: string): AppError {
  if (error instanceof AppError) return error;
  const e = error as { code?: string; data?: { statusCode?: number }; message?: string };
  const status = e.data?.statusCode;
  if (e.code === 'HttpError' && (status === 401 || status === 403)) {
    return new AppError({
      code: 'SOURCE_AUTH_REQUIRED',
      message: `${url} needs a token (private repository), or the token was refused.`,
      retryable: false,
      source: 'main',
    });
  }
  if (e.code === 'HttpError' && status === 404) {
    return sourceError(`No git repository found at ${url}.`);
  }
  if (e.code === 'NotFoundError') {
    return sourceError(`The branch or tag was not found in ${url}.`, e.message);
  }
  const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET/.test(e.message ?? '');
  return new AppError({
    code: offline ? 'NET_OFFLINE' : 'SOURCE_ERROR',
    message: offline ? `Could not reach ${url}.` : `Could not read the git repository ${url}.`,
    ...(e.message === undefined ? {} : { detail: e.message }),
    retryable: offline,
    source: 'main',
  });
}

export interface CloneOptions {
  dir: string;
  url: string;
  ref?: string | undefined;
  token?: string | undefined;
}

/** Shallow clone without checkout; returns the commit SHA of the ref. */
export async function cloneSource(options: CloneOptions): Promise<string> {
  try {
    await clone({
      fs,
      http,
      dir: options.dir,
      url: options.url,
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      singleBranch: true,
      depth: 1,
      noCheckout: true,
      noTags: true,
      onAuth: authFor(options.token),
    });
    return await resolveRef({ fs, dir: options.dir, ref: 'HEAD' });
  } catch (error) {
    throw describe(error, options.url);
  }
}

/** Fetch the latest commit of the source's ref (update check); returns its SHA. */
export async function fetchLatest(options: CloneOptions): Promise<string> {
  try {
    const result = await gitFetch({
      fs,
      http,
      dir: options.dir,
      url: options.url,
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      singleBranch: true,
      depth: 100,
      tags: false,
      onAuth: authFor(options.token),
    });
    if (result.fetchHead === null) throw sourceError(`${options.url} returned no commits.`);
    return result.fetchHead;
  } catch (error) {
    throw describe(error, options.url);
  }
}

/** The pack files of a commit (from the object store, not a working tree). */
export async function readCommitFiles(dir: string, oid: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const budget = new PackFileBudget();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  await walk({
    fs,
    dir,
    trees: [TREE({ ref: oid })],
    map: async (filepath, entries) => {
      const [entry] = entries;
      if (entry === null || entry === undefined || filepath === '.') return true;
      const type = await entry.type();
      if (type === 'tree') {
        return filepath.split('/').some((part) => part.startsWith('.')) ? null : true;
      }
      if (type !== 'blob' || !isPackFile(filepath)) return null;
      const safe = safeRelativePath(filepath);
      if (safe === undefined) return null;
      const content = await entry.content();
      if (content === undefined) return null;
      budget.add(safe, content.length);
      files.set(safe, decoder.decode(content));
      return null;
    },
  });
  return files;
}

/** Commits after `from` up to `to`, newest first (at most `limit`). */
export async function commitsBetween(
  dir: string,
  from: string,
  to: string,
  limit = 50,
): Promise<{ commits: CommitInfo[]; more: boolean }> {
  const log = await gitLog({ fs, dir, ref: to, depth: limit + 1 }).catch(() => []);
  const commits: CommitInfo[] = [];
  let reached = false;
  for (const entry of log) {
    if (entry.oid === from) {
      reached = true;
      break;
    }
    if (commits.length === limit) break;
    commits.push({
      oid: entry.oid,
      message: entry.commit.message.split('\n')[0]?.slice(0, 2000) ?? '',
      author: entry.commit.author.name.slice(0, 300),
      date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
    });
  }
  return { commits, more: !reached && log.length > commits.length };
}
