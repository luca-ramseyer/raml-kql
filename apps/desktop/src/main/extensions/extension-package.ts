import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ExtensionManifestSchema,
  type ExtensionManifest,
} from '@raml-kql/pack-schema/extension-manifest';
import { satisfies } from '@raml-kql/pack-schema/semver';
import { unzipSync } from 'fflate';

import { AppError } from '../../shared/errors';
import { safeRelativePath } from '../packs/pack-files';

/**
 * Reading an extension package: a `.rkqlx` zip or a folder (spec 07, "Package format"). Every
 * file is kept (scripts, UI, themes, images), within limits, and the manifest is validated
 * before anything is written.
 */
export const EXTENSION_LIMITS = {
  maxFiles: 2000,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
};

/** The host API version extensions are checked against (`engines["raml-kql"]`). */
export const HOST_API_VERSION = '1.0.0';

export function extensionError(message: string, detail?: string): AppError {
  return new AppError({
    code: 'EXTENSION_ERROR',
    message,
    ...(detail === undefined ? {} : { detail }),
    retryable: false,
    source: 'main',
  });
}

export interface ExtensionPackage {
  manifest: ExtensionManifest;
  files: Map<string, Uint8Array>;
  /** SHA-256 over the package files (pinning, spec 07). */
  sha256: string;
}

class Budget {
  private files = 0;
  private bytes = 0;

  add(name: string, size: number): void {
    if (size > EXTENSION_LIMITS.maxFileBytes) throw extensionError(`${name} is larger than 10 MB.`);
    this.files += 1;
    this.bytes += size;
    if (this.files > EXTENSION_LIMITS.maxFiles) {
      throw extensionError(
        `The extension has more than ${String(EXTENSION_LIMITS.maxFiles)} files.`,
      );
    }
    if (this.bytes > EXTENSION_LIMITS.maxTotalBytes)
      throw extensionError('The extension is larger than 50 MB.');
  }
}

export function hashPackage(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    hash
      .update(name)
      .update('\0')
      .update(files.get(name) ?? new Uint8Array())
      .update('\0');
  }
  return hash.digest('hex');
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 6)
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('\n');
}

/** Validate the manifest and the files it points to. */
export function toPackage(files: Map<string, Uint8Array>): ExtensionPackage {
  const manifestBytes = files.get('package.json');
  if (manifestBytes === undefined) throw extensionError('The extension has no package.json.');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw extensionError('package.json is not valid JSON.');
  }
  const parsed = ExtensionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw extensionError(
      'The extension manifest (package.json) is invalid.',
      describeIssues(parsed.error),
    );
  }
  const manifest = parsed.data;
  if (!satisfies(HOST_API_VERSION, manifest.engines['raml-kql'])) {
    throw extensionError(
      `This extension needs Raml KQL API ${manifest.engines['raml-kql']}; this version provides ${HOST_API_VERSION}.`,
    );
  }
  const referenced = [
    manifest.main,
    ...(manifest.contributes?.views?.sidebar ?? []).map((v) => v.ui),
    ...(manifest.contributes?.resultRenderers ?? []).map((r) => r.ui),
    ...(manifest.contributes?.themes ?? []).map((t) => t.path),
  ].filter((file): file is string => file !== undefined);
  for (const file of referenced) {
    if (!files.has(file)) throw extensionError(`The manifest refers to ${file}, which is missing.`);
  }
  return { manifest, files, sha256: hashPackage(files) };
}

/** Read a `.rkqlx` (zip). A single top-level folder is stripped. */
export function readExtensionZip(data: Uint8Array): ExtensionPackage {
  const budget = new Budget();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        if (safeRelativePath(file.name) === undefined) {
          throw extensionError(`The package contains an unsafe path: ${file.name}`);
        }
        budget.add(file.name, file.originalSize);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw extensionError('This file is not a valid .rkqlx (zip) package.');
  }
  const actual = new Budget();
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    actual.add(name, bytes.length);
    const safe = safeRelativePath(name);
    if (safe !== undefined) files.set(safe, bytes);
  }
  const roots = new Set([...files.keys()].map((f) => f.split('/')[0]));
  const [root] = roots;
  if (roots.size === 1 && root !== undefined && !files.has('package.json')) {
    return toPackage(
      new Map([...files].map(([name, bytes]) => [name.slice(root.length + 1), bytes])),
    );
  }
  return toPackage(files);
}

/** Read an extension folder (development, or an unpacked install). */
export async function readExtensionFolder(root: string): Promise<ExtensionPackage> {
  const budget = new Budget();
  const files = new Map<string, Uint8Array>();
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, depth + 1);
      else if (entry.isFile()) {
        budget.add(child, (await stat(path.join(root, child))).size);
        files.set(child, new Uint8Array(await readFile(path.join(root, child))));
      }
    }
  };
  await walk('', 0);
  return toPackage(files);
}

export async function writePackage(dir: string, pkg: ExtensionPackage): Promise<void> {
  for (const [name, bytes] of pkg.files) {
    const safe = safeRelativePath(name);
    if (safe === undefined) continue;
    const target = path.join(dir, ...safe.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
