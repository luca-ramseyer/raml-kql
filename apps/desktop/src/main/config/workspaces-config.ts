import { getNodeValue } from 'jsonc-parser';
import { z } from 'zod';

import type { ConfigProblem } from '../../shared/config/config-snapshots';

import { loadExtendedLayers } from './extends';
import { parseJsonc, readTextFile, writeTextFileAtomic } from './jsonc';
import { setJsoncPath } from './jsonc-edit-path';

/**
 * workspaces.jsonc (spec 09): per-workspace enabled state, alias, tags and preferred access
 * path, and per-tenant alias, tags and the stable number for automatic aliases. Keys are the
 * lowercase workspace resource ID and the tenant ID, so the file is portable.
 */
export const WorkspaceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  alias: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  preferredPath: z.string().max(400).optional(),
});
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;

export const TenantSettingsSchema = z.object({
  alias: z.string().max(200).optional(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  aliasNumber: z.number().int().positive().optional(),
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

export interface WorkspacesConfig {
  workspaces: Record<string, WorkspaceSettings>;
  tenants: Record<string, TenantSettings>;
}

export interface WorkspacesConfigPatch {
  workspaces?: Record<string, WorkspaceSettings | undefined>;
  tenants?: Record<string, TenantSettings | undefined>;
}

export interface WorkspacesConfigStore {
  /** Effective config (extends layers merged underneath the user's file). */
  read(): Promise<{ config: WorkspacesConfig; problems: ConfigProblem[] }>;
  /** Replace the given entries in the user's file (`undefined` removes an entry). */
  patch(patch: WorkspacesConfigPatch): Promise<void>;
}

function parseSection<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  problems: ConfigProblem[],
  file: string,
): Record<string, T> {
  const result: Record<string, T> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    const parsed = schema.safeParse(value);
    if (parsed.success) result[key.toLowerCase()] = parsed.data;
    else problems.push({ file, line: 0, message: `Invalid entry "${key}" ignored.` });
  }
  return result;
}

function mergeSections<T extends object>(
  base: Record<string, T>,
  over: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = { ...base[key], ...value };
  return merged;
}

const NEW_FILE = `{
  // Workspace and tenant preferences, keyed by resource ID / tenant ID (portable across machines).
  "workspaces": {},
  "tenants": {}
}
`;

export class JsoncWorkspacesConfig implements WorkspacesConfigStore {
  constructor(private readonly file: string) {}

  async read(): Promise<{ config: WorkspacesConfig; problems: ConfigProblem[] }> {
    const problems: ConfigProblem[] = [];
    const text = await readTextFile(this.file);
    if (text === undefined) return { config: { workspaces: {}, tenants: {} }, problems };
    const { tree, problems: syntax } = parseJsonc(text, 'workspaces.jsonc');
    if (syntax.length > 0 || tree?.type !== 'object') {
      return {
        config: { workspaces: {}, tenants: {} },
        problems:
          syntax.length > 0
            ? syntax
            : [{ file: 'workspaces.jsonc', line: 1, message: 'Must be a JSON object.' }],
      };
    }
    const root = getNodeValue(tree) as { workspaces?: unknown; tenants?: unknown };
    const { layers, problems: layerProblems } = await loadExtendedLayers(this.file, root);
    problems.push(...layerProblems);
    let config: WorkspacesConfig = { workspaces: {}, tenants: {} };
    for (const layer of [...layers, { file: this.file, value: root as Record<string, unknown> }]) {
      config = {
        workspaces: mergeSections(
          config.workspaces,
          parseSection(
            layer.value['workspaces'],
            WorkspaceSettingsSchema,
            problems,
            'workspaces.jsonc',
          ),
        ),
        tenants: mergeSections(
          config.tenants,
          parseSection(layer.value['tenants'], TenantSettingsSchema, problems, 'workspaces.jsonc'),
        ),
      };
    }
    return { config, problems };
  }

  async patch(patch: WorkspacesConfigPatch): Promise<void> {
    let text = (await readTextFile(this.file)) ?? NEW_FILE;
    const { tree, problems } = parseJsonc(text, 'workspaces.jsonc');
    if (problems.length > 0 || tree?.type !== 'object') {
      throw new Error(
        'workspaces.jsonc has errors; fix them before changing workspaces in the app.',
      );
    }
    const root = getNodeValue(tree) as { workspaces?: unknown; tenants?: unknown };
    if (typeof root.workspaces !== 'object') text = setJsoncPath(text, ['workspaces'], {});
    if (typeof root.tenants !== 'object') text = setJsoncPath(text, ['tenants'], {});
    for (const [section, entries] of Object.entries(patch) as [
      'workspaces' | 'tenants',
      Record<string, unknown>,
    ][]) {
      for (const [key, value] of Object.entries(entries)) {
        text = setJsoncPath(text, [section, key], value);
      }
    }
    await writeTextFileAtomic(this.file, text);
  }
}

/** Demo mode: kept in memory so demo data never reaches the user's real config. */
export class MemoryWorkspacesConfig implements WorkspacesConfigStore {
  private config: WorkspacesConfig = { workspaces: {}, tenants: {} };

  read(): Promise<{ config: WorkspacesConfig; problems: ConfigProblem[] }> {
    return Promise.resolve({ config: structuredClone(this.config), problems: [] });
  }

  patch(patch: WorkspacesConfigPatch): Promise<void> {
    const apply = <T>(
      current: Record<string, T>,
      entries: Record<string, T | undefined> = {},
    ): Record<string, T> => {
      const next: Record<string, T> = {};
      for (const [key, value] of Object.entries(current)) {
        if (!(key in entries)) next[key] = value;
      }
      for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined) next[key] = value;
      }
      return next;
    };
    this.config = {
      workspaces: apply(this.config.workspaces, patch.workspaces),
      tenants: apply(this.config.tenants, patch.tenants),
    };
    return Promise.resolve();
  }
}
