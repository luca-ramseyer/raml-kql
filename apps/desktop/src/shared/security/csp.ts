/**
 * Content Security Policy for the workbench renderer (spec 01, "Electron hardening").
 *
 * The production policy never allows `unsafe-eval` and never allows inline scripts.
 * `style-src 'unsafe-inline'` is needed because Monaco and AG Grid inject <style> elements at
 * runtime (VS Code's own workbench makes the same trade-off); styles can't execute code.
 *
 * The development policy additionally allows the Vite dev server: an inline React Fast Refresh
 * preamble and the HMR websocket. It is only ever used by `electron-vite dev`.
 */
export interface CspOptions {
  mode: 'production' | 'development';
}

export function buildWorkbenchCsp({ mode }: CspOptions): string {
  const dev = mode === 'development';
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws://localhost:*'] : ["'self'"],
    'worker-src': ["'self'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/**
 * The hidden extension host page (spec 07): scripts from the app bundle and blob: (the
 * extensions' code) only, and no network at all. Its session also blocks every request.
 */
export function buildExtensionHostCsp({ mode }: CspOptions): string {
  const dev = mode === 'development';
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': dev ? ['ws://localhost:*'] : ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
