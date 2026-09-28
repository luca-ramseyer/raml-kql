import { defineConfig } from 'vitest/config';

/**
 * One Vitest run covers the whole monorepo, split into "projects" by environment:
 * - desktop-node:     main process, preload, shared code, security tests (Node)
 * - desktop-renderer: React components and renderer services (jsdom, a simulated browser)
 * - packages:         the publishable packages under packages/
 *
 * Run everything with `pnpm test`, or one project with `pnpm test --project desktop-node`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'desktop-node',
          root: './apps/desktop',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/preload/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'test/**/*.test.ts',
          ],
          setupFiles: ['./test/setup/no-network.ts'],
        },
      },
      {
        test: {
          name: 'desktop-renderer',
          root: './apps/desktop',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['./test/setup/no-network.ts', './test/setup/dom.ts'],
        },
      },
      {
        test: {
          name: 'examples',
          root: './examples/extensions',
          environment: 'node',
          include: ['*/src/**/*.test.ts'],
          setupFiles: ['../../apps/desktop/test/setup/no-network.ts'],
        },
        resolve: {
          alias: {
            '@raml-kql/extension-api': new URL(
              './packages/extension-api/src/index.ts',
              import.meta.url,
            ).pathname,
          },
        },
      },
      {
        test: {
          name: 'packages',
          root: './packages',
          environment: 'node',
          include: ['*/src/**/*.test.ts'],
          setupFiles: ['../apps/desktop/test/setup/no-network.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['apps/desktop/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Thin Electron/DOM bootstrap files: exercised by the e2e tests instead.
        'apps/desktop/src/main/index.ts',
        'apps/desktop/src/preload/index.ts',
        'apps/desktop/src/renderer/main.tsx',
      ],
      // Spec 11: 60% overall, 80% on the critical modules. Don't chase 100%.
      thresholds: {
        lines: 60,
        'apps/desktop/src/main/query/**': { lines: 80 },
        'apps/desktop/src/main/auth/**': { lines: 80 },
        'apps/desktop/src/main/results/**': { lines: 80 },
        'apps/desktop/src/main/audit/**': { lines: 80 },
        'packages/*/src/**': { lines: 80 },
      },
    },
  },
});
