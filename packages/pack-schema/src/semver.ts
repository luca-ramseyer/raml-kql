/**
 * Just enough semver for `engines["raml-kql"]` and picking the newest extension release:
 * versions `x.y.z(-pre)`, ranges `*`, `x.y.z`, `^x.y.z`, `~x.y.z`, `>=`, `>`, `<=`, `<`, and
 * space-separated combinations (all must hold).
 */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    text.trim(),
  );
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

export function compareVersions(a: Version, b: Version): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  // A prerelease sorts before its release.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

function test(version: Version, comparator: string): boolean {
  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(comparator);
  if (match === null) return false;
  const [, op = '=', rest = ''] = match;
  if (rest === '*' || rest === 'x') return true;
  const target = parseVersion(rest);
  if (target === undefined) return false;
  const cmp = compareVersions(version, target);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '~':
      return cmp >= 0 && version.major === target.major && version.minor === target.minor;
    case '^':
      if (cmp < 0) return false;
      if (target.major > 0) return version.major === target.major;
      if (target.minor > 0) return version.major === 0 && version.minor === target.minor;
      return version.major === 0 && version.minor === 0 && version.patch === target.patch;
    default:
      return cmp === 0;
  }
}

/** Whether `version` satisfies `range` (unparseable input never does). */
export function satisfies(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return true;
  return trimmed.split('||').some((alternative) =>
    alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .every((comparator) => test(parsed, comparator)),
  );
}

export function isValidRange(range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*') return true;
  return trimmed.split('||').every((alternative) =>
    alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .split(/\s+/)
      .every((c) => /^(\^|~|>=|<=|>|<|=)?(\*|x|v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/.test(c)),
  );
}
