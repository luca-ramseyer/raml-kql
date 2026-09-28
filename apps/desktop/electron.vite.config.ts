import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin, UserConfig } from 'vite';

import { buildWorkbenchCsp } from './src/shared/security/csp';

/**
 * Replaces the `%CSP%` placeholder in index.html with the policy from
 * src/shared/security/csp.ts: strict in builds, relaxed for the Vite dev server.
 */
function workbenchCsp(): Plugin {
  let mode: 'production' | 'development' = 'production';
  return {
    name: 'raml-kql:workbench-csp',
    configResolved(config) {
      mode = config.command === 'serve' ? 'development' : 'production';
    },
    transformIndexHtml(html) {
      const placeholder = 'content="%CSP%"';
      if (!html.includes(placeholder)) {
        throw new Error(`index.html must contain a CSP meta tag with ${placeholder}`);
      }
      return html.replaceAll(placeholder, `content="${buildWorkbenchCsp({ mode })}"`);
    },
  };
}

/**
 * zod ships `@__PURE__` comments in positions Rollup can't use. Harmless; hide the noise so
 * real warnings stand out.
 */
const onwarn: NonNullable<NonNullable<UserConfig['build']>['rollupOptions']>['onwarn'] = (
  warning,
  defaultHandler,
) => {
  if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/') === true) return;
  defaultHandler(warning);
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can't `require` from node_modules: bundle every dependency (zod).
      externalizeDeps: false,
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') }, onwarn },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), workbenchCsp()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') }, onwarn },
    },
  },
});
