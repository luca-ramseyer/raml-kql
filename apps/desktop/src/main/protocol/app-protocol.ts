import path from 'node:path';

/**
 * Production builds serve the workbench from a custom `raml-kql://app/` origin instead of
 * `file://`. This gives the renderer a real, unique origin (so `'self'` in the CSP means only
 * our bundle, and IPC sender checks can compare origins), mirroring VS Code's `vscode-file:`.
 */
export const APP_SCHEME = 'raml-kql';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** The hidden extension host page: its own origin, so it gets its own (network-less) CSP. */
export const EXTHOST_HOST = 'exthost';
export const EXTHOST_ENTRY_URL = `${APP_SCHEME}://${EXTHOST_HOST}/exthost/index.html`;

/**
 * Map a `raml-kql://app/...` URL to a file inside `rootDir`.
 * Returns `undefined` for anything outside the root (path traversal) or the wrong host.
 */
export function resolveAppFile(
  rawUrl: string,
  rootDir: string,
  host: string = APP_HOST,
): string | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== host) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes('\0')) {
    return undefined;
  }

  const root = path.resolve(rootDir);
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.slice(1);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return undefined;
  }
  // The extension host origin serves only its page and the shared bundle assets.
  if (host === EXTHOST_HOST && !/^(exthost|assets)\//.test(relative)) return undefined;
  return resolved;
}
