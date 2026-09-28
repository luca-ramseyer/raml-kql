import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { secureWebPreferences } from '../../src/main/security/web-preferences';

const mainDir = path.resolve(__dirname, '../../src/main');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('window webPreferences (spec 01, Electron hardening)', () => {
  it('uses the hardened settings', () => {
    expect(secureWebPreferences('/app/preload.js')).toMatchObject({
      preload: '/app/preload.js',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
    });
  });

  it('every BrowserWindow in the main process uses secureWebPreferences()', () => {
    const offenders: string[] = [];
    let windows = 0;
    for (const file of sourceFiles(mainDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/new BrowserWindow\(/g)) {
        windows += 1;
        // The options object for this window must route webPreferences through the factory.
        const snippet = source.slice(match.index, match.index + 1500);
        if (!/webPreferences:\s*secureWebPreferences\(/.test(snippet)) {
          offenders.push(path.relative(mainDir, file));
        }
      }
    }
    expect(windows).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
