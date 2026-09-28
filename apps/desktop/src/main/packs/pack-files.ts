import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { AppError } from '../../shared/errors';

/**
 * Reading pack files from folders, `.rkqlpack` zips and git trees into one map of POSIX paths
 * to text (the input of `discoverPacks`). Packs are data only, so only `.kql` and `.yaml`
 * files are read, with limits against huge or hostile archives.
 */
export const PACK_LIMITS = {
  maxFiles: 5000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxDepth: 12,
};

export function isPackFile(file: string): boolean {
  return /\.(kql|ya?ml)$/i.test(file);
}

export function sourceError(message: string, detail?: string): AppError {
  return new AppError({
    code: 'SOURCE_ERROR',
    message,
    ...(detail === undefined ? {} : { detail }),
    retryable: false,
    source: 'main',
  });
}

/** A safe relative POSIX path (no `..`, no absolute paths, no drive letters, no NUL). */
export function safeRelativePath(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.includes('\0')) {
    return undefined;
  }
  const parts = normalized.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) return undefined;
  if (parts.length > PACK_LIMITS.maxDepth) return undefined;
  return parts.join('/');
}

class Budget {
  private files = 0;
  private bytes = 0;

  add(file: string, size: number): void {
    if (size > PACK_LIMITS.maxFileBytes) {
      throw sourceError(`${file} is larger than 1 MB; pack files must be small text files.`);
    }
    this.files += 1;
    this.bytes += size;
    if (this.files > PACK_LIMITS.maxFiles) {
      throw sourceError(`The source has more than ${String(PACK_LIMITS.maxFiles)} pack files.`);
    }
    if (this.bytes > PACK_LIMITS.maxTotalBytes)
      throw sourceError('The source is larger than 50 MB.');
  }
}

/** A stable hash of a pack file map (import dedupe and `sources.jsonc`). */
export function hashFiles(files: ReadonlyMap<string, string>): string {
  const hash = createHash('sha256');
  for (const file of [...files.keys()].sort()) {
    hash
      .update(file)
      .update('\0')
      .update(files.get(file) ?? '')
      .update('\0');
  }
  return hash.digest('hex');
}

/** Read the pack files of a folder (symlinks are not followed). */
export async function readFolderFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const budget = new Budget();
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > PACK_LIMITS.maxDepth) return;
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.isFile() && isPackFile(entry.name)) {
        const info = await stat(path.join(root, child));
        budget.add(child, info.size);
        files.set(child, await readFile(path.join(root, child), 'utf8'));
      }
    }
  };
  await walk('', 0);
  return files;
}

/**
 * Read the pack files of a `.rkqlpack` zip. Sizes are checked before inflating, entries with
 * unsafe paths are refused, and a single top-level folder (`my-pack/…`) is stripped.
 */
export function readZipFiles(data: Uint8Array): Map<string, string> {
  const budget = new Budget();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith('/') || !isPackFile(file.name)) return false;
        if (safeRelativePath(file.name) === undefined) {
          throw sourceError(`The archive contains an unsafe path: ${file.name}`);
        }
        budget.add(file.name, file.originalSize);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw sourceError('This file is not a valid .rkqlpack (zip) archive.');
  }
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const raw = new Map<string, string>();
  // Declared sizes can lie: check what was actually inflated too.
  const actual = new Budget();
  for (const [name, bytes] of Object.entries(entries)) {
    actual.add(name, bytes.length);
    const safe = safeRelativePath(name);
    if (safe !== undefined) raw.set(safe, decoder.decode(bytes));
  }
  const roots = new Set([...raw.keys()].map((file) => file.split('/')[0]));
  const [onlyRoot] = roots;
  const hasRootManifest = raw.has('rkqlpack.yaml') || raw.has('rkql-index.yaml');
  if (roots.size === 1 && onlyRoot !== undefined && !hasRootManifest) {
    return new Map([...raw].map(([file, text]) => [file.slice(onlyRoot.length + 1), text]));
  }
  return raw;
}

/** Write a file map into a folder (imported file sources). */
export async function writeFiles(root: string, files: ReadonlyMap<string, string>): Promise<void> {
  for (const [file, text] of files) {
    const safe = safeRelativePath(file);
    if (safe === undefined) continue;
    const target = path.join(root, ...safe.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text, 'utf8');
  }
}

export { Budget as PackFileBudget };
