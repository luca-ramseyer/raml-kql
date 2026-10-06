import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ExtensionManifestSchema,
  extensionId,
  type ExtensionManifest,
} from '@raml-kql/pack-schema';
import { zipSync } from 'fflate';

import type { CliIo } from './index';

/**
 * `raml-kql-ext init | validate | package` (spec 07, "Developer experience"). Checks mirror what
 * the app does when installing: a valid manifest, every referenced file present, a single
 * bundled worker script without runtime imports, and the size limits.
 */
const LIMITS = { maxFiles: 2000, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };

/** Folders and files that are never packaged (sources, tooling, dot-files). */
const SKIP_DIRS = new Set(['node_modules', 'src', 'test', 'tests', 'coverage']);
const SKIP_FILE =
  /\.(ts|tsx|map|rkqlx)$|^tsconfig.*\.json$|^(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (relative: string, depth: number): void => {
    if (depth > 12) return;
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!(relative === '' && SKIP_DIRS.has(entry.name))) walk(child, depth + 1);
      } else if (entry.isFile() && !SKIP_FILE.test(entry.name)) {
        out.push(child);
      }
    }
  };
  walk('', 0);
  return out.sort();
}

export interface CheckResult {
  manifest?: ExtensionManifest;
  files: string[];
  problems: string[];
}

/** Validate an extension folder the way the app will when it's installed. */
export function checkExtension(dir: string): CheckResult {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return { files: [], problems: ['package.json is missing or not valid JSON.'] };
  }
  const parsed = ExtensionManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      files: [],
      problems: parsed.error.issues.map(
        (i) => `package.json ${i.path.map(String).join('.')}: ${i.message}`,
      ),
    };
  }
  const manifest = parsed.data;
  const files = listFiles(dir);
  const referenced = [
    manifest.main,
    manifest.icon,
    ...(manifest.contributes?.views?.sidebar ?? []).map((v) => v.ui),
    ...(manifest.contributes?.resultRenderers ?? []).map((r) => r.ui),
    ...(manifest.contributes?.themes ?? []).map((t) => t.path),
  ].filter((file): file is string => file !== undefined);
  for (const file of referenced) {
    if (!files.includes(file))
      problems.push(`${file} is referenced in package.json but missing (did you build?).`);
  }
  if (manifest.main !== undefined && existsSync(path.join(dir, manifest.main))) {
    const code = readFileSync(path.join(dir, manifest.main), 'utf8');
    // The worker loads one module from a blob URL: it can't import anything at runtime.
    if (
      /(^|[;\n])\s*import\s[^(]*?from\s*['"][^'"]+['"]/m.test(code) ||
      /\bimport\s*\(\s*['"]/.test(code)
    ) {
      problems.push(
        `${manifest.main} imports other modules; bundle it into one file (e.g. esbuild --bundle).`,
      );
    }
    if (/\brequire\s*\(/.test(code))
      problems.push(`${manifest.main} uses require(); build it as an ES module.`);
  }
  let total = 0;
  for (const file of files) {
    const size = statSync(path.join(dir, file)).size;
    total += size;
    if (size > LIMITS.maxFileBytes) problems.push(`${file} is larger than 10 MB.`);
  }
  if (files.length > LIMITS.maxFiles) problems.push(`More than ${String(LIMITS.maxFiles)} files.`);
  if (total > LIMITS.maxTotalBytes) problems.push('The extension is larger than 50 MB.');
  return { manifest, files, problems };
}

export function validateExtension(dir: string, io: CliIo): number {
  const { manifest, problems } = checkExtension(dir);
  for (const problem of problems) io.err(problem);
  if (manifest === undefined || problems.length > 0) {
    io.err(`${String(problems.length)} ${problems.length === 1 ? 'problem' : 'problems'} found.`);
    return 1;
  }
  io.out(`${extensionId(manifest)} ${manifest.version}: no problems found.`);
  return 0;
}

/** Build the `.rkqlx` (a zip of the package files). */
export function packageExtension(dir: string, out: string | undefined, io: CliIo): number {
  const { manifest, files, problems } = checkExtension(dir);
  if (manifest === undefined || problems.length > 0) {
    for (const problem of problems) io.err(problem);
    io.err('Fix the problems above before packaging.');
    return 1;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file] = new Uint8Array(readFileSync(path.join(dir, file)));
  const target = out ?? path.join(dir, `${extensionId(manifest)}-${manifest.version}.rkqlx`);
  writeFileSync(target, zipSync(entries, { level: 9 }));
  io.out(`Packaged ${String(files.length)} files into ${target}`);
  return 0;
}

const TEMPLATE = {
  extension: `import { ramlKql, type ExtensionContext } from '@raml-kql/extension-api';

/** Called once, the first time one of the activation events happens. */
export function activate(context: ExtensionContext): void {
  context.subscriptions.push(
    ramlKql.commands.registerCommand('NAME.hello', async () => {
      const query = await ramlKql.editor.getActiveQuery();
      await ramlKql.window.showInformationMessage(
        \`Hello from DISPLAY! The active query has \${String(query?.length ?? 0)} characters.\`,
      );
    }),
  );
}
`,
  readme: `# DISPLAY

A Raml KQL extension.

\`\`\`bash
npm install
npm run build       # bundles src/extension.ts into dist/extension.js
npx raml-kql-ext validate
npx raml-kql-ext package
\`\`\`

Install the \`.rkqlx\` with "Extensions: Install from File…". See the author guide:
docs/guides/writing-extensions.md in the Raml KQL repository.
`,
};

/** Scaffold a TypeScript extension bundled with esbuild. */
export function initExtension(
  dir: string,
  options: { name: string; publisher: string },
  io: CliIo,
): number {
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.name) ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options.publisher)
  ) {
    io.err('The name and publisher must be lowercase letters, digits and dashes.');
    return 2;
  }
  if (existsSync(path.join(dir, 'package.json'))) {
    io.err(`${dir} already contains a package.json.`);
    return 1;
  }
  const display = options.name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  const manifest = {
    name: options.name,
    publisher: options.publisher,
    displayName: display,
    version: '0.1.0',
    description: `${display} for Raml KQL.`,
    license: 'MIT',
    engines: { 'raml-kql': '^1.0.0' },
    main: 'dist/extension.js',
    activationEvents: [`onCommand:${options.name}.hello`],
    permissions: [],
    contributes: {
      commands: [{ command: `${options.name}.hello`, title: 'Say Hello', category: display }],
    },
    scripts: {
      build:
        'esbuild src/extension.ts --bundle --format=esm --platform=browser --target=es2022 --outfile=dist/extension.js',
      package: 'npm run build && raml-kql-ext package',
    },
    devDependencies: {
      '@raml-kql/extension-api': '^1.0.0',
      '@raml-kql/extension-cli': '^1.0.0',
      esbuild: '^0.28.0',
      typescript: '^6.0.0',
    },
  };
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    path.join(dir, 'src', 'extension.ts'),
    TEMPLATE.extension.replaceAll('NAME', options.name).replaceAll('DISPLAY', display),
  );
  writeFileSync(path.join(dir, 'README.md'), TEMPLATE.readme.replaceAll('DISPLAY', display));
  writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndist/\n*.rkqlx\n');
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          lib: ['ES2022', 'WebWorker'],
          noEmit: true,
        },
        include: ['src'],
      },
      null,
      2,
    )}\n`,
  );
  io.out(
    `Created ${options.publisher}.${options.name} in ${dir}. Next: npm install && npm run build.`,
  );
  return 0;
}
