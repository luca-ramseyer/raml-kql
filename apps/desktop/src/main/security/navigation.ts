/**
 * Navigation and external-link policy (spec 01, "Electron hardening").
 *
 * - The workbench never navigates away from its own origin.
 * - `window.open` / target=_blank never creates a new Electron window.
 * - Links to an allowlisted set of HTTPS hosts open in the OS browser instead.
 */

/** Hosts whose links may be opened in the OS browser. Exact host match, HTTPS only. */
export const EXTERNAL_URL_ALLOWLIST: readonly string[] = [
  'portal.azure.com',
  'security.microsoft.com',
  'github.com',
];

export function isAllowedExternalUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    EXTERNAL_URL_ALLOWLIST.includes(url.hostname)
  );
}

/**
 * `new URL(x).origin` is "null" for non-special schemes such as our `raml-kql:` app protocol,
 * so compare protocol + host explicitly.
 */
export function originKey(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** True when `rawUrl` belongs to one of the trusted workbench origins (as origin keys). */
export function isTrustedOrigin(rawUrl: string, trustedOrigins: readonly string[]): boolean {
  const key = originKey(rawUrl);
  return key !== undefined && trustedOrigins.includes(key);
}

/** The subset of Electron's `WebContents` the guards need. */
export interface WebContentsLike {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): void;
  on(
    event: 'will-attach-webview',
    listener: (event: { preventDefault(): void }, ...args: unknown[]) => void,
  ): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
}

export interface NavigationGuardOptions {
  trustedOrigins: readonly string[];
  openExternal: (url: string) => void;
}

/** Install on every `WebContents` from `app.on('web-contents-created')`. */
export function installNavigationGuards(
  contents: WebContentsLike,
  { trustedOrigins, openExternal }: NavigationGuardOptions,
): void {
  contents.on('will-navigate', (event, url) => {
    // Same-origin navigations only happen on reload; everything else is blocked.
    if (isTrustedOrigin(url, trustedOrigins)) {
      return;
    }
    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      openExternal(url);
    }
  });

  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      openExternal(url);
    }
    return { action: 'deny' };
  });
}
