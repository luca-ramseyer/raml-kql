import path from 'node:path';

/**
 * `rkql-ext://<extension id>/<path>` (spec 07): serves an installed extension's own files to
 * its sandboxed iframes (views, result renderers). No network (`connect-src 'none'`), only
 * the extension's own scripts, and only embeddable by the workbench.
 */
export const EXTENSION_UI_SCHEME = 'rkql-ext';

/** A file inside the extension folder, or undefined (traversal, package.json). */
export function resolveExtensionFile(folder: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const root = path.resolve(folder);
  const file = path.resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (!file.startsWith(root + path.sep)) return undefined;
  if (path.relative(root, file) === 'package.json') return undefined;
  return file;
}

export function extensionUiCsp(extensionId: string, ancestors: readonly string[]): string {
  const self = `${EXTENSION_UI_SCHEME}://${extensionId}`;
  return [
    "default-src 'none'",
    `script-src ${self}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data:`,
    `font-src ${self} data:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${ancestors.join(' ')}`,
  ].join('; ');
}
