# Decision log

Format: `## D-NNN — Title (YYYY-MM-DD)`, then **Context**, **Decision**, **Consequences**. Append only. Supersede by adding a new entry that references the old one.

## D-001 — Rewrite from zero; electron-vite instead of Nextron (2026-09-24)

**Context:** v1 (Nextron) was lost. Nextron couples Next.js routing/SSR concepts to a desktop app that needs neither, and its maintenance lags Electron releases.

**Decision:** Electron + electron-vite + React SPA.

**Consequences:** simpler build, fast HMR, first-class worker support for Monaco. No Next.js.

## D-002 — VS Code look-alike, not a Code-OSS fork or VS Code extension (2026-09-24)

**Context:** we want VS Code familiarity, our own sandboxed extension model, and full control over security.

**Decision:** build our own workbench replicating VS Code's themes, layout and interaction patterns. Use the VS Code colour theme JSON format so themes are interchangeable.

**Consequences:** more UI work, but a small attack surface and our own permission model. We do not load VS Code extensions.

## D-003 — Log Analytics only as built-in data source (2026-09-24)

**Context:** Lighthouse gives Azure RBAC access to customer workspaces; Defender XDR advanced hunting needs per-tenant app consent and isn't reachable via Lighthouse.

**Decision:** the built-in source is the Log Analytics Query API. Other sources are possible via extensions implementing `DataSource`.

## D-004 — Delegated user auth with MSAL, optional custom client ID and Azure CLI modes (2026-09-24)

**Decision:** see spec 02. There are no app secrets anywhere.

## D-005 — No telemetry; crash reports are local-first and user-submitted (2026-09-24)

**Decision:** see spec 10. The security audience values this over usage insight; adoption is gauged by GitHub stars, release download counts and issues.

## D-006 — Results never persisted; crypto-shredded session cache (2026-09-24)

**Decision:** see spec 04.

## D-007 — Query pack parameters bound via typed `let` statements (2026-09-24)

**Context:** templating placeholders break portability and invite injection bugs.

**Decision:** parameters are KQL identifiers; the app prepends or replaces `let` statements using a tested literal encoder.

## D-008 — Toolchain versions pinned by peer compatibility, not "latest" (2026-09-24)

**Context:** the newest majors on npm (TypeScript 7, ESLint 10, Vite 8) are not yet supported by other parts of the stack: typescript-eslint 8.70 requires `typescript <6.1`, eslint-plugin-react 7.37 supports ESLint up to 9, and electron-vite 5 supports Vite up to 7.

**Decision:** Electron 44, electron-vite 5 + Vite 7.3, React 19.3 (spec says 18+), TypeScript 6.0, ESLint 9.39 with typescript-eslint `strict-type-checked`, eslint-plugin-import-x, zod 4, Vitest 5, Playwright 1.63, Node 24 (matches Electron 44's Node), pnpm 11. Vitest 5 brings its own Vite 8 internally; tests don't need the React plugin because Vite 8 transforms JSX natively.

**Consequences:** Dependabot will propose the blocked majors; merge them only once the peer ranges allow it. pnpm 11 blocks dependency install scripts by default, so `pnpm-workspace.yaml` has an explicit `allowBuilds` list (Electron and esbuild download binaries; everything else is denied).

## D-009 — Workbench served from a custom `raml-kql://app` protocol (2026-09-24)

**Context:** loading `index.html` via `file://` gives the renderer an opaque origin, makes `'self'` in the CSP match any local file, and makes IPC sender checks weak.

**Decision:** production builds register a privileged, secure, standard scheme `raml-kql:` and serve `out/renderer` through `protocol.handle`, with path-traversal protection and the CSP also sent as a response header. In development, the Vite dev server origin is trusted only when `app.isPackaged` is false. This mirrors VS Code's `vscode-file:` protocol.

**Consequences:** IPC sender checks compare against a real origin (`raml-kql://app`). Note that `new URL(...).origin` is `"null"` for custom schemes, so origin comparisons use protocol + host (`originKey()`).

## D-010 — IPC contract table and result envelope (2026-09-24)

**Context:** spec 01 requires zod validation on both sides and a single typed `window.ramlKql`.

**Decision:** contracts live in `src/shared/ipc/contracts.ts` as a `namespace → method → channel` table. The preload generates `window.ramlKql.<namespace>.<method>()` from it; the main process must implement an `IpcHandlers` object with the same shape (a missing handler is a type error and a startup error). Both sides validate request and response. Results cross the boundary as `{ ok: true, value } | { ok: false, error: AppErrorData }` because `Error` objects lose their fields when cloned through IPC and `contextBridge`; the renderer service layer (`unwrap`) turns error envelopes back into `AppError`. Validation messages describe the path and rule only, never the input value. Unexpected handler exceptions become a generic `INTERNAL` error.

**Consequences:** adding an IPC call is one contract entry plus one handler. Streaming (query progress, result chunks) will use `MessagePort`s as the spec says, added in Phase 5.

## D-011 — CSP details (2026-09-24)

**Decision:** one source of truth, `src/shared/security/csp.ts`. A small Vite plugin writes it into `index.html` at build time, and the app protocol also sends it as a header. Production: `default-src 'none'`, `script-src 'self'` (no `unsafe-eval`, no inline scripts). `style-src` allows `'unsafe-inline'` because Monaco and AG Grid inject `<style>` elements (VS Code makes the same trade-off; styles can't execute code). The dev policy additionally allows the React Fast Refresh inline preamble and the HMR websocket; it is only used by `electron-vite dev`.

**Consequences:** Phase 4 (Monaco workers) and Phase 9 (extension iframes) will extend `worker-src` / `frame-src` here, with tests.

## D-012 — Runtime dependencies vs bundled dependencies (2026-09-24)

**Context:** electron-vite bundles the renderer and preload, while the main process loads its `dependencies` from `node_modules` inside the asar.

**Decision:** in `apps/desktop/package.json`, `dependencies` holds only packages the **main process** needs at runtime. Libraries bundled into the renderer or the sandboxed preload (React, and later Monaco, AG Grid, ECharts) are `devDependencies`. Because bundled code still ships, the licence gate (`pnpm check:licenses`) checks the whole dependency tree, not only production dependencies.

**Consequences:** smaller installers; a library imported by the main process but declared as a devDependency would fail at runtime in the packaged app, which the Phase 11 packaged-app e2e test will catch.

## D-013 — Test setup (2026-09-24)

**Decision:** one root `vitest.config.ts` with three projects (`desktop-node`, `desktop-renderer` in jsdom, `packages`) and a single coverage config with the thresholds from spec 11. Thin bootstrap files (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`) are excluded from unit coverage because the e2e tests exercise them. A setup file blocks any non-loopback `fetch`, `http(s).request` or socket connection during tests. Electron-facing modules take small `...Like` interfaces (e.g. `IpcMainLike`, `SessionLike`) so they are unit-testable without Electron.

## D-014 — CI specifics (2026-09-24)

**Decision:** gitleaks and the licence check run in the `check` job from day one. On Ubuntu 24.04 runners, the e2e job re-allows unprivileged user namespaces (`kernel.apparmor_restrict_unprivileged_userns=0`) so Electron runs **with** its Chromium sandbox instead of `--no-sandbox`. CodeQL is deferred until the repo is public (it needs GitHub Advanced Security on private repos). A PR-title check enforces Conventional Commits because PRs are squash-merged.
