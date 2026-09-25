import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ENTRY_URL, EXTHOST_HOST, resolveAppFile } from './app-protocol';

const root = path.resolve('/opt/raml-kql/renderer');

describe('resolveAppFile', () => {
  it('maps the entry URL to index.html', () => {
    expect(resolveAppFile(APP_ENTRY_URL, root)).toBe(path.join(root, 'index.html'));
  });

  it('maps the bare origin to index.html', () => {
    expect(resolveAppFile('raml-kql://app/', root)).toBe(path.join(root, 'index.html'));
  });

  it('maps nested assets', () => {
    expect(resolveAppFile('raml-kql://app/assets/index-abc.js', root)).toBe(
      path.join(root, 'assets', 'index-abc.js'),
    );
  });

  it.each([
    'raml-kql://app/../secret.txt',
    'raml-kql://app/%2e%2e/secret.txt',
    'raml-kql://app/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    'raml-kql://app/..%5c..%5csecret.txt',
    'raml-kql://app/%00index.html',
    'raml-kql://app/%E0%A4%A',
  ])('refuses path traversal and malformed paths: %s', (url) => {
    const resolved = resolveAppFile(url, root);
    if (resolved !== undefined) {
      // Some inputs are normalised by the URL parser to stay inside the root; that's fine too.
      expect(resolved.startsWith(root + path.sep)).toBe(true);
    }
  });

  it.each(['raml-kql://other/index.html', 'file:///opt/raml-kql/renderer/index.html', 'nonsense'])(
    'refuses other hosts and schemes: %s',
    (url) => {
      expect(resolveAppFile(url, root)).toBeUndefined();
    },
  );
});

describe('extension host origin', () => {
  it('serves only the host page and bundle assets', () => {
    expect(resolveAppFile('raml-kql://exthost/exthost/index.html', root, EXTHOST_HOST)).toBe(
      path.join(root, 'exthost', 'index.html'),
    );
    expect(resolveAppFile('raml-kql://exthost/assets/a.js', root, EXTHOST_HOST)).toBe(
      path.join(root, 'assets', 'a.js'),
    );
    expect(resolveAppFile('raml-kql://exthost/index.html', root, EXTHOST_HOST)).toBeUndefined();
    expect(resolveAppFile('raml-kql://app/assets/a.js', root, EXTHOST_HOST)).toBeUndefined();
  });
});
