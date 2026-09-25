import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { discoverPacks } from '@raml-kql/pack-schema';

import type { CliIo } from './index';

/**
 * `raml-kql-ext pack validate [dir]` (spec 08, "Schemas"): the same validation the app runs
 * before adding a source, for pack authors and their CI.
 */
function readPackFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (relative: string, depth: number): void => {
    if (depth > 12) return;
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child, depth + 1);
      else if (entry.isFile() && /\.(kql|ya?ml)$/i.test(entry.name)) {
        files.set(child, readFileSync(path.join(root, child), 'utf8'));
      }
    }
  };
  walk('', 0);
  return files;
}

export function validatePacks(dir: string, io: CliIo): number {
  let files: Map<string, string>;
  try {
    if (!statSync(dir).isDirectory()) throw new Error('not a directory');
    files = readPackFiles(dir);
  } catch {
    io.err(`Cannot read the folder ${dir}.`);
    return 2;
  }
  const { packs, problems } = discoverPacks(files);
  const all = [...problems, ...packs.flatMap((p) => p.problems)];
  for (const pack of packs) {
    io.out(
      `${pack.manifest.id} ${pack.manifest.version}: ${String(pack.queries.length)} queries (${pack.path === '' ? '.' : pack.path})`,
    );
  }
  for (const problem of all)
    io.err(`${problem.file === '' ? dir : problem.file}: ${problem.message}`);
  if (all.length > 0 || packs.length === 0) {
    io.err(`${String(all.length)} ${all.length === 1 ? 'problem' : 'problems'} found.`);
    return 1;
  }
  io.out('No problems found.');
  return 0;
}
