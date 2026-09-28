#!/usr/bin/env node
/**
 * License gate (spec 11): fail when any dependency uses a copyleft licence that is
 * incompatible with shipping Raml KQL under MIT.
 *
 * All dependencies are checked, not only `dependencies`: the renderer bundles libraries
 * that are declared as devDependencies (React, Monaco, ...), so they end up in the app too.
 *
 * Usage: node scripts/check-licenses.mjs
 */
import { execFileSync } from 'node:child_process';

/** Licence identifiers that must not appear (matched as SPDX tokens). */
const FORBIDDEN = /\b(AGPL|GPL|LGPL|SSPL|EUPL|CC-BY-NC|CC-BY-SA)\b/i;

/**
 * Packages allowed despite matching FORBIDDEN, with the reason. Keep this empty unless a
 * package is verifiably not shipped in the app (e.g. build-only tooling).
 * @type {Record<string, string>}
 */
const ALLOWLIST = {};

const raw = execFileSync('pnpm', ['licenses', 'list', '--json', '--recursive'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});
/** @type {Record<string, { name: string; versions: string[] }[]>} */
const byLicense = JSON.parse(raw);

const violations = [];
for (const [license, packages] of Object.entries(byLicense)) {
  // "(MIT OR GPL-3.0)" is fine: we can pick the permissive option.
  const options = license.replace(/[()]/g, '').split(/\s+OR\s+/i);
  if (!options.every((option) => FORBIDDEN.test(option))) continue;
  for (const pkg of packages) {
    if (!(pkg.name in ALLOWLIST)) {
      violations.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Dependencies with forbidden licences:\n  ' + violations.join('\n  '));
  process.exit(1);
}
const total = Object.values(byLicense).reduce((sum, list) => sum + list.length, 0);
console.log(`License check passed (${total} packages).`);
