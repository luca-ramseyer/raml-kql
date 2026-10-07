import {
  readExtensionZip,
  extensionError,
  EXTENSION_LIMITS,
  type ExtensionPackage,
} from './extension-package';

/**
 * Downloading a `.rkqlx` from an https link (the catalog's `package` URL). The link can be a
 * "latest release" URL that redirects; the result is validated exactly like a file the user
 * picked, and the user sees its permissions before anything is installed.
 */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 60_000;

export async function fetchPackageFromUrl(
  url: string,
  fetch: HttpFetch,
): Promise<ExtensionPackage> {
  if (!url.startsWith('https://')) throw extensionError('Only https:// links can be installed.');
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw extensionError('The extension could not be downloaded. Check your connection.');
  }
  if (response.status === 404) {
    throw extensionError(
      'The package was not found. It may not be published yet, or the catalog entry is out of date.',
    );
  }
  if (!response.ok) {
    throw extensionError(`The download failed (HTTP ${String(response.status)}).`);
  }
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > EXTENSION_LIMITS.maxTotalBytes)
    throw extensionError('The package is larger than 50 MB.');
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > EXTENSION_LIMITS.maxTotalBytes)
    throw extensionError('The package is larger than 50 MB.');
  return readExtensionZip(data);
}
