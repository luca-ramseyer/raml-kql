/**
 * Smoke test for a packaged (unpacked) build: start the real app in demo mode and check that it
 * is still running a few seconds later. Electron fuses and signing can leave an app that builds
 * fine but dies at start (this actually happened: an invalid ad-hoc signature on Apple Silicon),
 * and the unit and e2e tests run the unpackaged app, so they can't see it.
 *
 *   node scripts/smoke-packaged.mjs            # looks in apps/desktop/release
 *
 * Playwright can't drive a packaged app (the fuses switch off the debugging flag it needs),
 * so this only checks the app starts and stays up, not what is on screen.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN_MS = 15_000;
const release = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'desktop',
  'release',
);

function findExecutable() {
  if (process.platform === 'darwin') {
    // electron-builder names the folder `mac` for x64 and `mac-arm64` for arm64.
    const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
    return path.join(release, folder, 'Raml KQL.app', 'Contents', 'MacOS', 'Raml KQL');
  }
  if (process.platform === 'win32') return path.join(release, 'win-unpacked', 'Raml KQL.exe');
  return path.join(release, 'linux-unpacked', 'raml-kql');
}

const executable = findExecutable();
if (!existsSync(executable)) {
  const found = existsSync(release) ? readdirSync(release).join(', ') : '(no release folder)';
  console.error(`Packaged app not found: ${executable}\nrelease/ contains: ${found}`);
  process.exit(1);
}

const profile = mkdtempSync(path.join(tmpdir(), 'raml-kql-smoke-'));
let output = '';
const child = spawn(executable, ['--demo', `--user-data-dir=${profile}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

let exited = false;
child.on('exit', (code, signal) => {
  exited = true;
  console.error(`The app exited early (code ${code}, signal ${signal}).\n${output.slice(-2000)}`);
  cleanup(1);
});

function cleanup(code) {
  try {
    // Windows keeps files locked for a moment after the process ends: retry, and never let a
    // leftover temp folder fail a smoke test whose result is already known.
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    console.warn(`Could not remove ${profile}; leaving it for the OS to clean up.`);
  }
  process.exit(code);
}

setTimeout(() => {
  if (exited) return;
  child.removeAllListeners('exit');
  console.log(`OK: ${path.basename(executable)} was still running after ${RUN_MS / 1000} s.`);
  child.once('exit', () => {
    cleanup(0);
  });
  child.kill();
  // If it ignores the signal, don't hang the build.
  setTimeout(() => {
    cleanup(0);
  }, 10_000).unref();
}, RUN_MS);
