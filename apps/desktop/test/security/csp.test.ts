import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildWorkbenchCsp } from '../../src/shared/security/csp';

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('workbench CSP (spec 01)', () => {
  const production = directives(buildWorkbenchCsp({ mode: 'production' }));

  it('never allows eval', () => {
    for (const mode of ['production', 'development'] as const) {
      expect(buildWorkbenchCsp({ mode })).not.toContain('unsafe-eval');
    }
  });

  it('only allows scripts from the app itself in production', () => {
    expect(production.get('script-src')).toEqual(["'self'"]);
  });

  it('denies everything by default and blocks plugins and base/form hijacking', () => {
    expect(production.get('default-src')).toEqual(["'none'"]);
    expect(production.get('object-src')).toEqual(["'none'"]);
    expect(production.get('base-uri')).toEqual(["'none'"]);
    expect(production.get('form-action')).toEqual(["'none'"]);
  });

  it('does not allow network connections outside the app in production', () => {
    expect(production.get('connect-src')).toEqual(["'self'"]);
  });

  it('index.html carries the CSP placeholder that the build fills in', () => {
    const html = readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="%CSP%" \/>/);
  });
});
