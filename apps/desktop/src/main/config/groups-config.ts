import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem } from '../../shared/config/config-snapshots';
import { GroupSchema, type Group, type GroupsSnapshot } from '../../shared/workspaces/groups';

import { loadExtendedLayers } from './extends';
import { lineOf, parseJsonc, readTextFile, writeTextFileAtomic } from './jsonc';
import { setTopLevelProperty } from './jsonc-edit';

export interface GroupsStore {
  /** Effective groups (extends layers first; the user's file wins by id). */
  read(): Promise<GroupsSnapshot & { userGroups: Group[] }>;
  /** Write the user's own groups. */
  write(groups: Group[]): Promise<void>;
}

const NEW_FILE = `{
  // Tenant and workspace groups. See the "Tenant groups" section of the docs.
  "groups": []
}
`;

export class JsoncGroupsStore implements GroupsStore {
  constructor(private readonly file: string) {}

  async read(): Promise<GroupsSnapshot & { userGroups: Group[] }> {
    const text = await readTextFile(this.file);
    if (text === undefined) return { groups: [], userGroups: [], problems: [] };
    const { tree, problems } = parseJsonc(text, 'groups.jsonc');
    if (problems.length > 0 || tree?.type !== 'object') {
      return { groups: [], userGroups: [], problems };
    }
    const root = getNodeValue(tree) as { groups?: unknown };
    const allProblems: ConfigProblem[] = [];
    const parseGroups = (
      raw: unknown,
      file: string,
      node?: import('jsonc-parser').Node,
    ): Group[] => {
      if (!Array.isArray(raw)) return [];
      return raw.flatMap((entry, index) => {
        const parsed = GroupSchema.safeParse(entry);
        if (parsed.success) return [parsed.data];
        const child = node?.children?.find(
          (c) => c.type === 'property' && c.children?.[0]?.value === 'groups',
        )?.children?.[1]?.children?.[index];
        allProblems.push({
          file,
          line: child === undefined ? 0 : lineOf(text, child.offset),
          message: `Invalid group: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
        });
        return [];
      });
    };
    const userGroups = parseGroups(root.groups, 'groups.jsonc', tree);
    const { layers, problems: layerProblems } = await loadExtendedLayers(this.file, root);
    allProblems.push(...layerProblems);
    const byId = new Map<string, Group>();
    for (const layer of layers)
      for (const group of parseGroups(layer.value['groups'], layer.file)) byId.set(group.id, group);
    for (const group of userGroups) byId.set(group.id, group);
    return { groups: [...byId.values()], userGroups, problems: allProblems };
  }

  async write(groups: Group[]): Promise<void> {
    const text = (await readTextFile(this.file)) ?? NEW_FILE;
    const { problems } = parseJsonc(text, 'groups.jsonc');
    if (problems.length > 0)
      throw new Error('groups.jsonc has errors; fix them before editing groups in the app.');
    await writeTextFileAtomic(this.file, setTopLevelProperty(text, 'groups', groups));
  }
}

export class MemoryGroupsStore implements GroupsStore {
  constructor(private groups: Group[] = []) {}

  read(): Promise<GroupsSnapshot & { userGroups: Group[] }> {
    return Promise.resolve({
      groups: [...this.groups],
      userGroups: [...this.groups],
      problems: [],
    });
  }

  write(groups: Group[]): Promise<void> {
    this.groups = [...groups];
    return Promise.resolve();
  }
}
