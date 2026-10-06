// Builds the published files into dist/: one ES module per entry point (esbuild) and the
// type declarations (tsc). Run by `pnpm build`, and automatically before `pnpm pack/publish`.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
rmSync(path.join(here, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: ['index', 'runtime', 'protocol'].map((name) => path.join(here, 'src', `${name}.ts`)),
  outdir: path.join(here, 'dist'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  logLevel: 'warning',
});

execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: here, stdio: 'inherit' });
