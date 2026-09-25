import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem, SettingsSnapshot } from '../../shared/config/config-snapshots';
import { AppError } from '../../shared/errors';
import { describeIssues } from '../../shared/ipc/channel';
import type { SettingsUpdateRequest } from '../../shared/ipc/contracts';
import { getSettingDefinition } from '../../shared/settings/registry';
import { loadExtendedLayers } from '../config/extends';
import { parseJsonc, propertyLine, readTextFile, writeTextFileAtomic } from '../config/jsonc';
import { setTopLevelProperty } from '../config/jsonc-edit';

type JsonValue = SettingsSnapshot['values'][string];

/**
 * Validate the text of settings.jsonc against the settings registry (spec 09, "Rules"):
 * - syntax errors: keep every previously valid value (the app never breaks on a typo);
 * - an invalid value: report it and keep that key's previous valid value, if any;
 * - unknown keys: ignored (they may belong to extensions or newer versions).
 */
export function evaluateSettingsText(
  text: string | undefined,
  previousValid: Readonly<Record<string, JsonValue>>,
  file = 'settings.jsonc',
): SettingsSnapshot {
  if (text === undefined || text.trim() === '') {
    return { values: {}, problems: [] };
  }

  const { tree, problems } = parseJsonc(text, file);
  if (problems.length > 0) {
    return { values: { ...previousValid }, problems };
  }
  if (tree?.type !== 'object') {
    return {
      values: { ...previousValid },
      problems: [{ file, line: 1, message: `${file} must contain a JSON object.` }],
    };
  }

  const values: Record<string, JsonValue> = {};
  const valueProblems: ConfigProblem[] = [];
  const raw = getNodeValue(tree) as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    const definition = getSettingDefinition(key);
    if (definition === undefined) continue;
    const parsed = definition.schema.safeParse(value);
    if (parsed.success) {
      values[key] = parsed.data as JsonValue;
    } else {
      valueProblems.push({
        file,
        line: propertyLine(text, tree, key),
        message: `Invalid value for "${key}": ${describeIssues(parsed.error)}`,
      });
      const previous = previousValid[key];
      if (previous !== undefined) values[key] = previous;
    }
  }
  return { values, problems: valueProblems };
}

function rawSettings(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  const { tree, problems } = parseJsonc(text, 'settings.jsonc');
  if (problems.length > 0 || tree?.type !== 'object') return {};
  return getNodeValue(tree) as Record<string, unknown>;
}

export const NEW_SETTINGS_FILE = `{
  // Raml KQL settings. Open the Settings editor (Ctrl/Cmd+,) to browse every option.
}
`;

/** Owns settings.jsonc: loads, validates, edits (preserving comments) and notifies. */
export class SettingsService {
  private snapshot: SettingsSnapshot = { values: {}, problems: [] };
  /** Valid values from the user's own file (without `extends` layers). */
  private userValues: SettingsSnapshot['values'] = {};
  private readonly listeners = new Set<(snapshot: SettingsSnapshot) => void>();
  /** Every key of the user's file as written (extension settings aren't in the registry). */
  private raw: Record<string, unknown> = {};
  /** Serialises writes so two quick edits can't overwrite each other. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  get current(): SettingsSnapshot {
    return this.snapshot;
  }

  /** A key's value as written in settings.jsonc, unvalidated (extension settings). */
  rawValue(key: string): unknown {
    return this.raw[key];
  }

  onDidChange(listener: (snapshot: SettingsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-read the file (and any `extends` files). Notifies listeners only when something changed. */
  async reload(): Promise<SettingsSnapshot> {
    let next: SettingsSnapshot;
    try {
      const text = await readTextFile(this.filePath);
      this.raw = rawSettings(text);
      const user = evaluateSettingsText(text, this.userValues);
      this.userValues = user.values;
      const base = await this.extendedValues(text);
      next = {
        values: { ...base.values, ...user.values },
        problems: [...user.problems, ...base.problems],
      };
    } catch (error) {
      next = {
        values: this.snapshot.values,
        problems: [
          {
            file: 'settings.jsonc',
            line: 0,
            message: `Could not read: ${(error as Error).message}`,
          },
        ],
      };
    }
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) {
      this.snapshot = next;
      for (const listener of this.listeners) listener(next);
    }
    return this.snapshot;
  }

  /** Settings from files listed in `"extends"`, earliest first (the user's file wins). */
  private async extendedValues(text: string | undefined): Promise<SettingsSnapshot> {
    if (text === undefined) return { values: {}, problems: [] };
    const { tree, problems } = parseJsonc(text, 'settings.jsonc');
    if (problems.length > 0 || tree?.type !== 'object') return { values: {}, problems: [] };
    const layers = await loadExtendedLayers(this.filePath, getNodeValue(tree));
    let values: SettingsSnapshot['values'] = {};
    const layerProblems = [...layers.problems];
    for (const layer of layers.layers) {
      const evaluated = evaluateSettingsText(JSON.stringify(layer.value), {}, layer.file);
      values = { ...values, ...evaluated.values };
      layerProblems.push(...evaluated.problems.map((p) => ({ ...p, line: 0 })));
    }
    return { values, problems: layerProblems };
  }

  update(request: SettingsUpdateRequest): Promise<SettingsSnapshot> {
    const run = this.writeQueue.then(() => this.applyUpdate(request));
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  private async applyUpdate(request: SettingsUpdateRequest): Promise<SettingsSnapshot> {
    const definition = getSettingDefinition(request.key);
    if (definition === undefined) {
      throw new AppError({
        code: 'SETTING_UNKNOWN',
        message: `Unknown setting "${request.key}".`,
        retryable: false,
        source: 'main',
      });
    }

    let value: unknown;
    if (request.action === 'set') {
      const parsed = definition.schema.safeParse(request.value);
      if (!parsed.success) {
        throw new AppError({
          code: 'SETTING_INVALID_VALUE',
          message: `Invalid value for "${request.key}".`,
          detail: describeIssues(parsed.error),
          retryable: false,
          source: 'main',
        });
      }
      value = parsed.data;
    }

    const text = (await readTextFile(this.filePath)) ?? '';
    const base = text.trim() === '' ? NEW_SETTINGS_FILE : text;
    const { tree, problems } = parseJsonc(base, 'settings.jsonc');
    if (problems.length > 0 || tree?.type !== 'object') {
      throw new AppError({
        code: 'CONFIG_INVALID',
        message:
          'Unable to write into settings.jsonc. Open the file to correct errors in it and try again.',
        retryable: false,
        source: 'main',
      });
    }

    await writeTextFileAtomic(this.filePath, setTopLevelProperty(base, request.key, value));
    return this.reload();
  }
}
