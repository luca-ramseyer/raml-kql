// Builds the example extensions in examples/extensions/ and packages each into
// examples/extensions/dist/<publisher>.<name>-<version>.rkqlx with raml-kql-ext.
// Usage: pnpm build:examples
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(root, 'examples', 'extensions');
const out = path.join(examples, 'dist');
const cli = path.join(root, 'packages', 'extension-cli', 'dist', 'cli.cjs');

// The API package is bundled into each extension (it only reads the host's `ramlKql`).
const alias = {
  '@raml-kql/extension-api': path.join(root, 'packages', 'extension-api', 'src', 'index.ts'),
};

await build({
  entryPoints: [path.join(root, 'packages', 'extension-cli', 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: cli,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of readdirSync(examples)) {
  const dir = path.join(examples, name);
  if (name === 'dist' || !existsSync(path.join(dir, 'package.json'))) continue;
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const common = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    alias,
    logLevel: 'warning',
  };
  if (existsSync(path.join(dir, 'src', 'extension.ts'))) {
    await build({
      ...common,
      entryPoints: [path.join(dir, 'src', 'extension.ts')],
      outfile: path.join(dir, 'dist', 'extension.js'),
    });
  }
  const ui = path.join(dir, 'src', 'ui');
  if (existsSync(ui)) {
    const scripts = readdirSync(ui).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const entries = scripts.filter((f) => existsSync(path.join(ui, f.replace(/\.ts$/, '.html'))));
    // UI scripts are classic scripts: a sandboxed frame has an opaque origin, and module
    // scripts would need CORS to load from rkql-ext:.
    await build({
      ...common,
      format: 'iife',
      entryPoints: entries.map((f) => path.join(ui, f)),
      outdir: path.join(dir, 'dist', 'ui'),
      loader: { '.json': 'json' },
      minify: true,
    });
    for (const file of readdirSync(ui).filter((f) => /\.(html|css)$/.test(f))) {
      copyFileSync(path.join(ui, file), path.join(dir, 'dist', 'ui', file));
    }
  }
  execFileSync('node', [cli, 'package', dir, '-o', path.join(out, `${name}.rkqlx`)], {
    stdio: 'inherit',
  });
}
