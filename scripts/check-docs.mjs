// Checks the public documentation, which is also the source of the project website:
//  - every page under docs/ has front matter with a title and a description
//  - docs/nav.json lists every page exactly once and points only to pages that exist
//  - every relative link and image in docs/, README.md and the other root pages resolves
//  - docs/ does not mention maintainer-only files
//
//   node scripts/check-docs.mjs      (also run by `pnpm check:docs` and CI)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
const problems = [];
const rel = (file) => path.relative(root, file).split(path.sep).join('/');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const pages = walk(docs).filter((file) => file.endsWith('.md'));

// --- front matter ---------------------------------------------------------------------------
function frontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return undefined;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const pair = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

for (const page of pages) {
  const fields = frontMatter(readFileSync(page, 'utf8'));
  if (!fields) problems.push(`${rel(page)}: missing front matter (--- title, description ---)`);
  else {
    if (!fields.title) problems.push(`${rel(page)}: front matter needs a title`);
    if (!fields.description) problems.push(`${rel(page)}: front matter needs a description`);
  }
}

// --- navigation -----------------------------------------------------------------------------
const navFile = path.join(docs, 'nav.json');
const listed = new Map();
if (!existsSync(navFile)) problems.push('docs/nav.json is missing');
else {
  const nav = JSON.parse(readFileSync(navFile, 'utf8'));
  for (const section of nav.sections ?? []) {
    for (const entry of section.pages ?? []) {
      const target = path.join(docs, entry.path);
      if (!existsSync(target)) problems.push(`docs/nav.json: ${entry.path} does not exist`);
      listed.set(entry.path, (listed.get(entry.path) ?? 0) + 1);
    }
  }
  for (const [entry, count] of listed) {
    if (count > 1) problems.push(`docs/nav.json: ${entry} is listed ${count} times`);
  }
  for (const page of pages) {
    const key = path.relative(docs, page).split(path.sep).join('/');
    if (!listed.has(key)) problems.push(`docs/nav.json: ${key} is not listed`);
  }
}

// --- links ----------------------------------------------------------------------------------
function withoutCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    const counts = new Map();
    const anchors = new Set();
    for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const base = slug(match[1]);
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    anchorCache.set(file, anchors);
  }
  return anchorCache.get(file);
}

const linkChecked = [
  ...pages,
  ...['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'].map((f) =>
    path.join(root, f),
  ),
].filter((file) => existsSync(file));

for (const file of linkChecked) {
  const text = withoutCode(readFileSync(file, 'utf8'));
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = match[1];
    if (/^(https?:|mailto:)/.test(raw)) continue;
    const [pathPart, fragment] = raw.split('#');
    const target = decodeURIComponent(pathPart.split('?')[0]);
    const resolved =
      target === ''
        ? file
        : target.startsWith('/')
          ? path.join(root, target)
          : path.resolve(path.dirname(file), target);
    if (!existsSync(resolved)) {
      problems.push(`${rel(file)}: broken link to ${raw}`);
    } else if (fragment && resolved.endsWith('.md') && !anchorsOf(resolved).has(fragment)) {
      problems.push(`${rel(file)}: link ${raw} points to a heading that does not exist`);
    }
  }
}

// --- nothing maintainer-only in the public docs ---------------------------------------------
const FORBIDDEN = [/HUMAN-TODO/, /CLAUDE\.md/, /project\/roadmap/];
for (const page of pages) {
  const text = readFileSync(page, 'utf8');
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text))
      problems.push(`${rel(page)}: mentions a maintainer-only file (${pattern})`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((p) => `  ${p}`).join('\n'));
  console.error(`\n${problems.length} documentation problem(s).`);
  process.exit(1);
}
console.log(`Documentation OK: ${pages.length} pages, ${listed.size} in the navigation.`);
