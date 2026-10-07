import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fetchPackageFromUrl } from './url-install';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function validPackage(): Uint8Array {
  const manifest = {
    name: 'demo',
    publisher: 'contoso',
    version: '1.0.0',
    engines: { 'raml-kql': '^1.0.0' },
    main: 'dist/extension.js',
  };
  return zipSync({
    'package.json': bytes(JSON.stringify(manifest)),
    'dist/extension.js': bytes('export function activate() {}'),
  });
}

const respond = (body: Uint8Array | string, init: ResponseInit = { status: 200 }) =>
  Promise.resolve(new Response(typeof body === 'string' ? body : new Blob([body]), init));

describe('fetchPackageFromUrl', () => {
  it('downloads and validates a package', async () => {
    const pkg = await fetchPackageFromUrl('https://example.com/demo.rkqlx', () =>
      respond(validPackage()),
    );
    expect(pkg.manifest.name).toBe('demo');
    expect(pkg.files.has('dist/extension.js')).toBe(true);
  });

  it('refuses links that are not https', async () => {
    await expect(
      fetchPackageFromUrl('http://example.com/demo.rkqlx', () => respond(validPackage())),
    ).rejects.toThrow(/https/);
  });

  it('explains a 404, other HTTP errors, and a network failure', async () => {
    await expect(
      fetchPackageFromUrl('https://example.com/x.rkqlx', () => respond('', { status: 404 })),
    ).rejects.toThrow(/not found/);
    await expect(
      fetchPackageFromUrl('https://example.com/x.rkqlx', () => respond('', { status: 500 })),
    ).rejects.toThrow(/HTTP 500/);
    await expect(
      fetchPackageFromUrl('https://example.com/x.rkqlx', () => Promise.reject(new Error('dns'))),
    ).rejects.toThrow(/Check your connection/);
  });

  it('refuses downloads that are not packages', async () => {
    await expect(
      fetchPackageFromUrl('https://example.com/x.rkqlx', () => respond('<html>not a zip</html>')),
    ).rejects.toThrow(/not a valid/);
  });
});
