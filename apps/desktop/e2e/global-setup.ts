import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Build the example extensions (examples/extensions/dist/*.rkqlx) once for the e2e tests. */
export default function globalSetup(): void {
  const root = path.resolve(__dirname, '../../..');
  execFileSync('node', [path.join(root, 'scripts', 'build-examples.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
}
