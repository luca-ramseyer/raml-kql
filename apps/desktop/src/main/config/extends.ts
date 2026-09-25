import path from 'node:path';

import { getNodeValue } from 'jsonc-parser';

import type { ConfigProblem } from '../../shared/config/config-snapshots';

import { parseJsonc, readTextFile } from './jsonc';

const MAX_DEPTH = 5;

export interface ConfigLayer {
  file: string;
  value: Record<string, unknown>;
}

/**
 * Config `extends` (spec 09, "Merge semantics for team-shared configs"): a config file may
 * list other local files to layer underneath it, e.g. a team config kept in a shared repo:
 *
 *   { "extends": ["./team/settings.jsonc"], ... }
 *
 * Paths are relative to the including file (or absolute). Remote URLs are refused. Returns the
 * extended files' contents in application order (earliest first), without the user file itself.
 */
export async function loadExtendedLayers(
  userFile: string,
  userValue: unknown,
): Promise<{ layers: ConfigLayer[]; problems: ConfigProblem[] }> {
  const layers: ConfigLayer[] = [];
  const problems: ConfigProblem[] = [];
  const label = path.basename(userFile);

  async function visit(
    file: string,
    value: unknown,
    depth: number,
    chain: string[],
  ): Promise<void> {
    const extendsValue = (value as { extends?: unknown } | undefined)?.extends;
    if (extendsValue === undefined) return;
    const entries = typeof extendsValue === 'string' ? [extendsValue] : extendsValue;
    if (!Array.isArray(entries) || !entries.every((e): e is string => typeof e === 'string')) {
      problems.push({ file: label, line: 0, message: '"extends" must be a list of file paths.' });
      return;
    }
    for (const entry of entries) {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry)) {
        problems.push({
          file: label,
          line: 0,
          message: `Remote "extends" is not allowed: ${entry}`,
        });
        continue;
      }
      const target = path.resolve(path.dirname(file), entry);
      if (chain.includes(target) || depth >= MAX_DEPTH) {
        problems.push({
          file: label,
          line: 0,
          message: `"extends" loop or chain too deep at ${entry}`,
        });
        continue;
      }
      let text: string | undefined;
      try {
        text = await readTextFile(target);
      } catch (error) {
        problems.push({
          file: label,
          line: 0,
          message: `Cannot read ${entry}: ${(error as Error).message}`,
        });
        continue;
      }
      if (text === undefined) {
        problems.push({ file: label, line: 0, message: `"extends" file not found: ${entry}` });
        continue;
      }
      const { tree, problems: syntax } = parseJsonc(text, entry);
      if (syntax.length > 0 || tree?.type !== 'object') {
        problems.push({ file: label, line: 0, message: `${entry} is not a valid JSONC object.` });
        continue;
      }
      const parsed = getNodeValue(tree) as Record<string, unknown>;
      await visit(target, parsed, depth + 1, [...chain, target]);
      const { extends: _ignored, ...rest } = parsed;
      layers.push({ file: target, value: rest });
    }
  }

  await visit(userFile, userValue, 0, [path.resolve(userFile)]);
  return { layers, problems };
}
