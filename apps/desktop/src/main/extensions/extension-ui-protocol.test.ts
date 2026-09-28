import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { extensionUiCsp, resolveExtensionFile } from './extension-ui-protocol';

const root = path.resolve('/opt/ext/contoso.map-1.0.0');

describe('extension UI protocol', () => {
  it('serves files inside the extension only', () => {
    expect(resolveExtensionFile(root, '/dist/ui/map.html')).toBe(
      path.join(root, 'dist', 'ui', 'map.html'),
    );
    expect(resolveExtensionFile(root, '/../other/secret.txt')).toBeUndefined();
    expect(resolveExtensionFile(root, '/%2e%2e/secret.txt')).toBeUndefined();
    expect(resolveExtensionFile(root, '/package.json')).toBeUndefined();
    expect(resolveExtensionFile(root, '/%E0%A4%A')).toBeUndefined();
  });

  it('allows no network and only the workbench as parent', () => {
    const csp = extensionUiCsp('contoso.map', ['raml-kql://app']);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('script-src rkql-ext://contoso.map');
    expect(csp).toContain('frame-ancestors raml-kql://app');
    expect(csp).not.toContain('unsafe-eval');
  });
});
