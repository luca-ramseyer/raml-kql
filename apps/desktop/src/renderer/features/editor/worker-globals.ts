/**
 * The Kusto language service (Bridge.NET output) refers to Node's `global`. Production builds
 * rewrite that reference; Vite's dev server serves the dependency as is, so in `pnpm dev` the
 * worker failed with "global is not defined" and Monaco silently fell back to a worker without
 * the language service. Imported first by `kusto.worker.ts`, before the language service runs.
 */
const scope = globalThis as typeof globalThis & { global?: typeof globalThis };
scope.global ??= globalThis;

export {};
