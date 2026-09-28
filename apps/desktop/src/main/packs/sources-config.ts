import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem } from '../../shared/config/config-snapshots';
import { SourceSchema, type Source } from '../../shared/packs/models';
import { lineOf, parseJsonc, readTextFile, writeTextFileAtomic } from '../config/jsonc';
import { setTopLevelProperty } from '../config/jsonc-edit';

/** `sources.jsonc` (spec 09): pack sources with their pinned commits. No secrets. */
export interface SourcesStore {
  read(): Promise<{ sources: Source[]; problems: ConfigProblem[] }>;
  write(sources: Source[]): Promise<void>;
}

const NEW_FILE = `{
  // Query pack sources. Git sources are pinned to a commit; updates are applied from the
  // Library ("Check for Pack Updates"). Tokens for private repositories are kept in the OS
  // keychain, never here.
  "sources": []
}
`;

export class JsoncSourcesStore implements SourcesStore {
  constructor(private readonly file: string) {}

  async read(): Promise<{ sources: Source[]; problems: ConfigProblem[] }> {
    const text = await readTextFile(this.file);
    if (text === undefined) return { sources: [], problems: [] };
    const { tree, problems } = parseJsonc(text, 'sources.jsonc');
    if (problems.length > 0 || tree?.type !== 'object') return { sources: [], problems };
    const root = getNodeValue(tree) as { sources?: unknown };
    if (!Array.isArray(root.sources)) return { sources: [], problems: [] };
    const list = tree.children?.find(
      (c) => c.type === 'property' && c.children?.[0]?.value === 'sources',
    )?.children?.[1]?.children;
    const all: ConfigProblem[] = [];
    const seen = new Set<string>();
    const sources = root.sources.flatMap((entry, index): Source[] => {
      const parsed = SourceSchema.safeParse(entry);
      const node = list?.[index];
      if (!parsed.success || seen.has(parsed.data.id)) {
        all.push({
          file: 'sources.jsonc',
          line: node === undefined ? 0 : lineOf(text, node.offset),
          message: parsed.success
            ? `Duplicate source id ${parsed.data.id}`
            : `Invalid source: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        });
        return [];
      }
      seen.add(parsed.data.id);
      return [parsed.data];
    });
    return { sources, problems: all };
  }

  async write(sources: Source[]): Promise<void> {
    const text = (await readTextFile(this.file)) ?? NEW_FILE;
    const { problems } = parseJsonc(text, 'sources.jsonc');
    if (problems.length > 0) {
      throw new Error('sources.jsonc has errors; fix them before changing sources in the app.');
    }
    await writeTextFileAtomic(this.file, setTopLevelProperty(text, 'sources', sources));
  }
}

export class MemorySourcesStore implements SourcesStore {
  constructor(private sources: Source[] = []) {}

  read(): Promise<{ sources: Source[]; problems: ConfigProblem[] }> {
    return Promise.resolve({ sources: [...this.sources], problems: [] });
  }

  write(sources: Source[]): Promise<void> {
    this.sources = [...sources];
    return Promise.resolve();
  }
}
