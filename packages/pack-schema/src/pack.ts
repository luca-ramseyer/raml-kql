import { parse } from 'yaml';
import type { z } from 'zod';

import { readFrontMatter } from './front-matter';
import {
  PackIndexSchema,
  PackManifestSchema,
  PackQueryMetaSchema,
  type PackManifest,
  type PackQueryMeta,
} from './schemas';

/**
 * Loading packs from a set of files (spec 08, "Pack layout"). Pure: the caller reads the files
 * (from disk, a zip or a git tree) into a map of repository-relative POSIX paths to text, so the
 * app, the update diff and `raml-kql-ext pack validate` all validate the same way.
 */
export type PackFiles = ReadonlyMap<string, string>;

export const MANIFEST_FILE = 'rkqlpack.yaml';
export const INDEX_FILE = 'rkql-index.yaml';

export interface PackProblem {
  /** Repository-relative path. */
  file: string;
  message: string;
}

export interface PackQuery extends PackQueryMeta {
  /** Repository-relative path of the `.kql` file. */
  file: string;
  /** The query without front-matter. */
  body: string;
}

export interface LoadedPack {
  /** Folder of the pack inside the repository ('' for the root). */
  path: string;
  manifest: PackManifest;
  queries: PackQuery[];
  /** Problems with individual queries (those queries are skipped). */
  problems: PackProblem[];
}

export interface DiscoveredPacks {
  packs: LoadedPack[];
  /** Problems that prevented a whole pack (or the index) from loading. */
  problems: PackProblem[];
}

function join(folder: string, file: string): string {
  return folder === '' ? file : `${folder}/${file}`;
}

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

function parseYaml(text: string): { data?: unknown; error?: string } {
  try {
    return { data: parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0] : 'Invalid YAML' };
  }
}

/** Load one pack from `path` ('' for the repository root). */
export function loadPack(
  files: PackFiles,
  path: string,
): { pack?: LoadedPack; problems: PackProblem[] } {
  const manifestFile = join(path, MANIFEST_FILE);
  const manifestText = files.get(manifestFile);
  if (manifestText === undefined) {
    return { problems: [{ file: manifestFile, message: `${MANIFEST_FILE} is missing.` }] };
  }
  const yaml = parseYaml(manifestText);
  if (yaml.error !== undefined) {
    return { problems: [{ file: manifestFile, message: yaml.error }] };
  }
  const manifest = PackManifestSchema.safeParse(yaml.data);
  if (!manifest.success) {
    return { problems: [{ file: manifestFile, message: issues(manifest.error) }] };
  }

  const problems: PackProblem[] = [];
  const queries: PackQuery[] = [];
  const queriesFolder = join(path, 'queries');
  const kqlFiles = [...files.keys()]
    .filter((file) => file.startsWith(`${queriesFolder}/`) && file.toLowerCase().endsWith('.kql'))
    .sort();
  const ids = new Set<string>();
  for (const file of kqlFiles) {
    const text = files.get(file) ?? '';
    const front = readFrontMatter(text);
    if (front.error !== undefined) {
      problems.push({ file, message: `Front-matter: ${front.error}` });
      continue;
    }
    let meta: unknown = front.data;
    const sidecarFile = file.replace(/\.kql$/i, '.yaml');
    const sidecarText = files.get(sidecarFile);
    if (sidecarText !== undefined) {
      if (front.hasFrontMatter) {
        problems.push({ file, message: 'Use either front-matter or a sidecar .yaml, not both.' });
        continue;
      }
      const sidecar = parseYaml(sidecarText);
      if (sidecar.error !== undefined) {
        problems.push({ file: sidecarFile, message: sidecar.error });
        continue;
      }
      meta = sidecar.data;
    }
    if (meta === undefined) {
      problems.push({ file, message: 'No metadata: add front-matter or a sidecar .yaml.' });
      continue;
    }
    const parsed = PackQueryMetaSchema.safeParse(meta);
    if (!parsed.success) {
      problems.push({
        file: sidecarText === undefined ? file : sidecarFile,
        message: issues(parsed.error),
      });
      continue;
    }
    if (ids.has(parsed.data.id)) {
      problems.push({ file, message: `Duplicate query id "${parsed.data.id}".` });
      continue;
    }
    if (front.body.trim() === '') {
      problems.push({ file, message: 'The query is empty.' });
      continue;
    }
    ids.add(parsed.data.id);
    queries.push({ ...parsed.data, file, body: front.body });
  }
  return { pack: { path, manifest: manifest.data, queries, problems }, problems: [] };
}

/** Find the packs in a repository: `rkql-index.yaml`, or a single pack at the root. */
export function discoverPacks(files: PackFiles): DiscoveredPacks {
  const indexText = files.get(INDEX_FILE);
  if (indexText === undefined) {
    if (!files.has(MANIFEST_FILE)) {
      return {
        packs: [],
        problems: [
          {
            file: '',
            message: `No ${INDEX_FILE} or ${MANIFEST_FILE} at the root: this is not a query pack.`,
          },
        ],
      };
    }
    const { pack, problems } = loadPack(files, '');
    return { packs: pack === undefined ? [] : [pack], problems };
  }
  const yaml = parseYaml(indexText);
  if (yaml.error !== undefined)
    return { packs: [], problems: [{ file: INDEX_FILE, message: yaml.error }] };
  const index = PackIndexSchema.safeParse(yaml.data);
  if (!index.success) {
    return { packs: [], problems: [{ file: INDEX_FILE, message: issues(index.error) }] };
  }
  const packs: LoadedPack[] = [];
  const problems: PackProblem[] = [];
  const seen = new Set<string>();
  for (const entry of index.data.packs) {
    const path = entry.path.replace(/^\.\//, '').replace(/\/+$/, '');
    const result = loadPack(files, path);
    problems.push(...result.problems);
    if (result.pack === undefined) continue;
    if (seen.has(result.pack.manifest.id)) {
      problems.push({
        file: join(path, MANIFEST_FILE),
        message: `Pack id "${result.pack.manifest.id}" appears twice in this repository.`,
      });
      continue;
    }
    seen.add(result.pack.manifest.id);
    packs.push(result.pack);
  }
  return { packs, problems };
}
