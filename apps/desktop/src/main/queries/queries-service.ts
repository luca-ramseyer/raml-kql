import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { ParameterSchema } from '@raml-kql/pack-schema/schemas';
import { z } from 'zod';

import { AppError } from '../../shared/errors';
import { formatQueryFile, parseQueryFile } from '../../shared/queries/front-matter';
import type { QueryFile, QueryNode, SaveQueryRequest } from '../../shared/queries/models';
import { writeTextFileAtomic } from '../config/jsonc';

/**
 * My Queries (spec 08): `.kql` files with front-matter in `<config>/queries/`, subfolders
 * allowed, so they're part of the dotfile config. Every path is resolved inside the folder.
 */
export interface QueriesServiceOptions {
  root: string;
  /** Moves a file or folder to the OS trash (spec 08: delete to trash). */
  trash: (absolutePath: string) => Promise<void>;
  reveal: (absolutePath: string) => void;
}

const MAX_DEPTH = 8;

/** A message the user should see (the IPC router hides plain errors). */
function fileError(message: string): AppError {
  return new AppError({ code: 'FILE_OPERATION_FAILED', message, retryable: false, source: 'main' });
}

const ParametersSchema = z.array(ParameterSchema).max(50);
const MAX_NODES = 5000;

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug === '' ? 'query' : slug;
}

function parentOf(relative: string): string {
  const parent = path.posix.dirname(relative);
  return parent === '.' ? '' : parent;
}

export class QueriesService {
  constructor(private readonly options: QueriesServiceOptions) {}

  /** Absolute path for a relative one, refusing anything outside the folder. */
  resolve(relative: string): string {
    const root = path.resolve(this.options.root);
    const absolute = path.resolve(root, ...relative.split('/').filter((p) => p !== ''));
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw fileError('That path is outside My Queries.');
    }
    return absolute;
  }

  async list(): Promise<QueryNode[]> {
    const nodes: QueryNode[] = [];
    const walk = async (relative: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || nodes.length >= MAX_NODES) return;
      let entries;
      try {
        entries = await readdir(this.resolve(relative), { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || nodes.length >= MAX_NODES) continue;
        const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          nodes.push({ path: child, kind: 'folder', name: entry.name });
          await walk(child, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.kql')) {
          let meta: {
            name?: string | undefined;
            description?: string | undefined;
            tags?: string[] | undefined;
          } = {};
          try {
            meta = parseQueryFile(await readFile(this.resolve(child), 'utf8')).meta;
          } catch {
            meta = {};
          }
          nodes.push({
            path: child,
            kind: 'file',
            name: meta.name ?? entry.name.replace(/\.kql$/i, ''),
            ...(meta.description === undefined ? {} : { description: meta.description }),
            ...(meta.tags === undefined ? {} : { tags: meta.tags }),
          });
        }
      }
    };
    await walk('', 0);
    return nodes;
  }

  async read(relative: string): Promise<QueryFile> {
    let text: string;
    try {
      text = await readFile(this.resolve(relative), 'utf8');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw fileError(`${relative} could not be read. It may have been moved or deleted.`);
    }
    const { meta, body } = parseQueryFile(text);
    const parameters = ParametersSchema.safeParse(meta['parameters']);
    return {
      path: relative,
      name: meta.name ?? path.posix.basename(relative).replace(/\.kql$/i, ''),
      body,
      ...(parameters.success && parameters.data.length > 0 ? { parameters: parameters.data } : {}),
      ...(typeof meta.timespan === 'string' ? { timespan: meta.timespan } : {}),
    };
  }

  /** Save a tab: overwrite its file (keeping the front-matter), or create a new file. */
  async save(request: SaveQueryRequest): Promise<QueryFile> {
    let relative = request.path;
    let meta: Record<string, unknown> = {};
    if (relative !== undefined) {
      try {
        meta = parseQueryFile(await readFile(this.resolve(relative), 'utf8')).meta;
      } catch {
        meta = {};
      }
    } else {
      const name = request.name ?? 'New Query';
      relative = await this.freePath(request.folder ?? '', slugify(name));
      meta = { ...request.meta, id: slugify(name) };
    }
    if (request.name !== undefined) meta = { ...meta, name: request.name };
    const absolute = this.resolve(relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeTextFileAtomic(absolute, formatQueryFile(meta, request.body));
    return this.read(relative);
  }

  /** Rename: the display name in front-matter and the file name. */
  async rename(relative: string, name: string): Promise<QueryFile> {
    const file = await this.read(relative);
    const saved = await this.save({ path: relative, name, body: file.body });
    const target = await this.freePath(parentOf(relative), slugify(name), relative);
    if (target !== relative) await rename(this.resolve(relative), this.resolve(target));
    return { ...saved, path: target };
  }

  async move(relative: string, toFolder: string): Promise<string> {
    const base = path.posix.basename(relative);
    const target = toFolder === '' ? base : `${toFolder}/${base}`;
    if (target === relative) return relative;
    if (target.startsWith(`${relative}/`)) throw fileError('A folder cannot move into itself.');
    if (await this.exists(target))
      throw fileError('Something with that name already exists there.');
    await mkdir(path.dirname(this.resolve(target)), { recursive: true });
    await rename(this.resolve(relative), this.resolve(target));
    return target;
  }

  async createFolder(relative: string): Promise<void> {
    await mkdir(this.resolve(relative), { recursive: true });
  }

  async delete(relative: string): Promise<void> {
    if (relative === '') throw fileError('The My Queries folder itself cannot be deleted.');
    await this.options.trash(this.resolve(relative));
  }

  reveal(relative: string | undefined): void {
    this.options.reveal(this.resolve(relative ?? ''));
  }

  private async exists(relative: string): Promise<boolean> {
    try {
      await stat(this.resolve(relative));
      return true;
    } catch {
      return false;
    }
  }

  /** `folder/slug.kql`, or `slug-2.kql`… when taken (except by `current`). */
  private async freePath(folder: string, slug: string, current?: string): Promise<string> {
    for (let n = 1; n < 1000; n++) {
      const file = `${slug}${n === 1 ? '' : `-${String(n)}`}.kql`;
      const candidate = folder === '' ? file : `${folder}/${file}`;
      if (candidate === current || !(await this.exists(candidate))) return candidate;
    }
    throw fileError('Too many queries with that name.');
  }
}
