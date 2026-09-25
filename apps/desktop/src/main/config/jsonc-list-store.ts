import { getNodeValue } from 'jsonc-parser';
import type { z } from 'zod';

import type { ConfigProblem } from '../../shared/config/config-snapshots';

import { lineOf, parseJsonc, readTextFile, writeTextFileAtomic } from './jsonc';
import { setTopLevelProperty } from './jsonc-edit';

/**
 * A JSONC config file holding one list under one key (`extensions.jsonc`, `permissions.jsonc`).
 * Invalid entries are reported and skipped; edits keep the user's comments (spec 09).
 */
export interface ListStore<T> {
  read(): Promise<{ items: T[]; problems: ConfigProblem[] }>;
  write(items: T[]): Promise<void>;
}

export class JsoncListStore<T> implements ListStore<T> {
  constructor(
    private readonly file: string,
    private readonly key: string,
    private readonly schema: z.ZodType<T>,
    private readonly newFile: string,
  ) {}

  private get name(): string {
    return this.file.split(/[\\/]/).at(-1) ?? this.file;
  }

  async read(): Promise<{ items: T[]; problems: ConfigProblem[] }> {
    const text = await readTextFile(this.file);
    if (text === undefined) return { items: [], problems: [] };
    const { tree, problems } = parseJsonc(text, this.name);
    if (problems.length > 0 || tree?.type !== 'object') return { items: [], problems };
    const root = getNodeValue(tree) as Record<string, unknown>;
    const list = root[this.key];
    if (!Array.isArray(list)) return { items: [], problems: [] };
    const nodes = tree.children?.find(
      (c) => c.type === 'property' && c.children?.[0]?.value === this.key,
    )?.children?.[1]?.children;
    const all: ConfigProblem[] = [];
    const items = list.flatMap((entry, index): T[] => {
      const parsed = this.schema.safeParse(entry);
      if (parsed.success) return [parsed.data];
      const node = nodes?.[index];
      all.push({
        file: this.name,
        line: node === undefined ? 0 : lineOf(text, node.offset),
        message: `Invalid entry: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      });
      return [];
    });
    return { items, problems: all };
  }

  async write(items: T[]): Promise<void> {
    const text = (await readTextFile(this.file)) ?? this.newFile;
    const { problems } = parseJsonc(text, this.name);
    if (problems.length > 0) {
      throw new Error(`${this.name} has errors; fix them before changing it in the app.`);
    }
    await writeTextFileAtomic(this.file, setTopLevelProperty(text, this.key, items));
  }
}

export class MemoryListStore<T> implements ListStore<T> {
  constructor(private items: T[] = []) {}

  read(): Promise<{ items: T[]; problems: ConfigProblem[] }> {
    return Promise.resolve({ items: [...this.items], problems: [] });
  }

  write(items: T[]): Promise<void> {
    this.items = [...items];
    return Promise.resolve();
  }
}
