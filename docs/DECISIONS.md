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

## D-015 — VS Code colours: imported themes plus the colour-registry defaults (2026-09-24)

**Context:** VS Code themes only list the colours they change. Everything else falls back to defaults registered in VS Code's source code, often as transforms (`transparent(foreground, 0.7)`). High-contrast themes define almost nothing themselves. Copying a few hundred defaults by hand would be error-prone and would drift from VS Code.

**Decision:** two maintainer scripts, pinned to VS Code 1.139.0: `scripts/import-vscode-themes.mjs` flattens the `include` chains of Dark Modern, Light Modern, High Contrast and High Contrast Light into self-contained JSON; `scripts/import-vscode-color-defaults.mjs` _parses_ (never executes) VS Code's colour-registry sources with the TypeScript compiler API and writes every default as a JSON expression. The renderer evaluates those expressions with a port of VS Code's `Color` maths (`platform/theme/color.ts`) and writes the result as `--vscode-*` CSS variables. Both scripts' outputs are committed and reviewed like code; the code is MIT-licensed and attributed in `THIRD_PARTY_NOTICES.md`.

**Consequences:** any VS Code colour theme renders the same as in VS Code, including themes users drop into `<config>/themes/`. Theme colour keys and values are validated (`a.b.c` keys, hex values only) before they become CSS, because themes come from files (and later extensions). Updating to a newer VS Code release means re-running both scripts and reviewing the diff.

## D-016 — Window chrome and menus (2026-09-24)

**Decision:**

- macOS: `titleBarStyle: 'hiddenInset'` with our own title bar and command center (spec 05), plus a **native** application menu. The renderer owns commands and keybindings, so it builds the menu model (including the user's current keybindings) and sends it to the main process over IPC. Command accelerators are display-only (`registerAccelerator: false`), so keybindings.jsonc overrides can't be shadowed by the menu. The Edit menu uses Electron roles, which macOS needs for Cmd+C/V/X/Z/A in text fields.
- Windows/Linux: frameless (`titleBarStyle: 'hidden'`) with the menu bar (File, Edit, Selection, View, Help) drawn in the title bar, and **native window controls via `titleBarOverlay`**, recoloured on theme change. This deviates slightly from spec 05's "custom window controls": the native overlay keeps OS behaviour such as Windows 11 snap layouts for free, and is what VS Code's "native" controls do on Windows.
- Menu items whose command doesn't exist yet are hidden, and empty menus (currently "Query") disappear. Menus fill in as later phases register commands.

## D-017 — Keyboard handling (2026-09-24)

**Decision:** keybindings.jsonc uses VS Code's syntax and resolution rules: user entries after defaults, the last matching entry whose `when` holds wins, `-command` removes defaults, and chords (`cmd+k cmd+s`) put the status bar into "waiting for second key". Letters, digits and unshifted punctuation are matched by the character the keyboard layout produced (`event.key`), so shortcuts follow the printed key labels on QWERTZ and AZERTY layouts; everything else falls back to the physical key (`event.code`). The primary keybinding shown in menus and the palette is the last one defined for a command, as in VS Code.

**Consequences:** Alt+letter on macOS layouts that remap letters may match the physical key rather than the label (a rare corner case). A layout-aware keymap like VS Code's native-keymap module can replace this later if needed.

## D-018 — Settings behaviour (2026-09-24)

**Decision:**

- `window.autoDetectColorScheme` defaults to **true** (VS Code's default is false), because the roadmap asks for the app to follow the OS by default. Choosing a theme in the theme picker while auto-detection is on updates the preferred dark/light theme for the current OS appearance.
- Programmatic edits of settings.jsonc must keep the user's comments (spec 09). `jsonc-parser`'s `modify` removes comments that sit between a removed property and its neighbour, including comments that belong to other settings, so resets use our own comment-preserving removal (`main/config/jsonc-edit.ts`, with tests).
- Settings changes are optimistic in the UI and roll back when the main process rejects them (e.g. a syntax error in settings.jsonc makes it read-only for the app).
- **Temporary deviation:** "Open Settings (JSON)" and "Keyboard Shortcuts" open settings.jsonc / keybindings.jsonc in the OS default editor (or reveal the file). Spec 05 wants an in-app Monaco JSON editor with schema validation and a visual keyboard-shortcuts editor; both arrive with Monaco in Phase 4. The JSON Schema is already generated (`settingsJsonSchema()`).
- Config `extends` and profiles (spec 09) are not implemented yet; `extends` is added to Phase 3, where groups.jsonc and workspaces.jsonc need the same merge semantics.

## D-019 — Renderer structure and state (2026-09-24)

**Decision:** `src/renderer/platform/` holds framework-level services, mirroring VS Code's "platform" layer: commands, context keys and when-clauses, keybindings, theme, settings, layout, notifications, status bar and quick input. `workbench/` holds the layout parts, and `features/` the feature UIs (spec 01). State lives in small Zustand stores exposed through plain functions (`toggleSidebar()`, `notify()`, `registerCommand()`), so commands, menus, tests and later extensions call the same API. Renderer tests boot the real preload API and main-process IPC router in jsdom, with only the main-process services faked (`test/helpers/workbench-harness.ts`).

## D-020 — Token cache encryption with Electron safeStorage, not msal-node-extensions (2026-09-24)

**Context:** spec 02 names `@azure/msal-node-extensions` for the encrypted MSAL cache. Its current version (5.x) depends on `keytar`, which its maintainers archived, and on the native `@azure/msal-node-runtime` broker. Both are native modules that must be rebuilt for every Electron version and platform.

**Decision:** a small MSAL `ICachePlugin` (`main/auth/encrypted-cache-plugin.ts`) encrypts the serialized cache with Electron's built-in `safeStorage`, which uses the same OS stores (macOS Keychain, Windows DPAPI, libsecret/KWallet on Linux). The file lives in the app's userData folder (machine-local), never in the shareable config dir, and is written with mode 0600. On Linux, `safeStorage.getSelectedStorageBackend()` tells us when there's no keyring (`basic_text`): then persistence is `unavailable`, MSAL sign-in is refused with install instructions, and the user can explicitly opt into `auth.sessionOnly` (memory only). There is never a plaintext fallback.

**Consequences:** no native modules to build; the cache is not shared with other MSAL apps (which msal-node-extensions could do via its file lock), which we don't need.

## D-021 — Built-in client ID injected at build time (2026-09-24)

**Decision:** `electron.vite.config.ts` reads `RAML_KQL_CLIENT_ID` from the environment (CI secret) or the repo-root `.env` (local) and injects it as a constant. The client ID is a public identifier, not a secret (the Entra guide says so). Builds without it still work: the built-in sign-in is shown as unavailable and custom client ID and Azure CLI sign-in remain.

## D-022 — Accounts, providers and tenants (2026-09-24)

**Decision:**

- `AuthService` owns all tokens; `getToken({ accountId, tenantId, resource })` is main-process only and never exposed over IPC. The renderer sees account and tenant metadata only.
- Providers share one interface: MSAL (one instance per client ID: built-in, and each custom client ID recorded in accounts.jsonc so it is recreated after a restart), Azure CLI (`az`, run with `execFile`; accounts appear only once the user adds them, because `az login` manages them) and demo.
- `/tenants` `tenantCategory` maps to relations: the home tenant, `ProjectedBy`/`ManagedBy` → `lighthouse`, anything else → `guest`. Every tenant is probed with a silent ARM token → `ok` / `needsReauth` / `noAccess`. If `/tenants` fails, the home tenant is still shown.
- Demo mode keeps accounts in memory and never writes accounts.jsonc.
- `nextLink` is only followed on the ARM origin, so a malicious response can't redirect a bearer token to another host.
- Sign-in pages open only in the system browser, and only when the URL's origin is the Entra authority host.
- accounts.jsonc is read at startup; unlike settings.jsonc it isn't live-reloaded yet (it only holds labels and order).

## D-023 — Network stack for Azure calls (2026-09-24)

**Context:** SOC analysts often sit behind corporate proxies. Node's `fetch` ignores OS proxy settings; Electron's `net.fetch` uses Chromium's network stack, which honours them.

**Decision:** ARM calls (and future Azure calls) go through `net.fetch`. MSAL still uses its own Node HTTP client for token requests, so sign-in doesn't follow the OS proxy yet. Phase 5 (AzureHttp) adds a custom MSAL network module on top of `net.fetch`; tracked in the roadmap.

## D-024 — Resource Graph and Sentinel API versions (2026-09-25)

**Context:** spec 03 named Resource Graph `2022-10-01` and asked to verify it.

**Decision:** the current REST reference lists **`2024-04-01`** for Resource Graph `resources` (same request shape; paging via `options.$skipToken`, `$top` ≤ 1000) and **`2025-09-01`** for Sentinel `onboardingStates`. Both are used, and spec 03 is updated. The fake Azure server rejects other versions, so a regression shows up in tests.

## D-025 — Discovery behaviour details (2026-09-25)

**Decision:**

- Discovery queries each (account, tenant) that is signed in (`ok`) with relation home or guest. Lighthouse customers come through the home tenant's token. Access paths are `home` (workspace in the token's tenant), `lighthouse` (home token, other tenant), `guest` or `azureCli`. Duplicates are merged by the lowercase resource ID, keeping every path in discovery order.
- A workspace is marked `missing` only after a discovery with no errors, so one failing tenant can't make its workspaces look deleted.
- New workspaces get their enabled state from `workspaces.newWorkspaceDefault` once, and it is written to workspaces.jsonc. Changing the default later doesn't flip workspaces the user has already seen.
- Every tenant an account knows gets a stable alias number as soon as the accounts service reports it (`syncTenants`), before discovery finishes. Main-process listeners run before the renderer is notified, so no name is ever shown without an alias.
- The Sentinel fallback (`onboardingStates`) runs only for workspaces the solution query didn't flag, 8 at a time.
- Discovery re-runs (debounced) whenever the set of signed-in (account, tenant) pairs changes.
- Demo mode keeps workspaces.jsonc, groups.jsonc and the inventory in memory.
- Config `extends` is implemented for settings.jsonc, workspaces.jsonc and groups.jsonc (local paths only; remote URLs are refused). Extended files outside the config folder aren't watched; edits to them apply on the next change to the user's file or on restart.

## D-026 — Aliasing (presentation privacy) details (2026-09-25)

**Decision:**

- Aliasing is a render-layer `DisplayNamer` built from the inventory, accounts and settings. Tenants use the user's alias or `privacy.aliasing.autoAliasFormat` with their stable number. Workspaces and subscriptions without a user alias become `<tenant alias> · Workspace NN` / `Subscription NN`, numbered by resource ID within the tenant. Accounts become `Account N`, because labels and usernames often contain customer names.
- A tenant the inventory doesn't know yet is shown as "Unlisted tenant", never its real name.
- Search in Targets and the Workspaces page matches only what is displayed, so typing a customer's real name while aliased reveals nothing.
- Revealing real names asks for confirmation (a quick pick, keyboard-first) when `privacy.aliasing.confirmReveal` is on. The status bar item turns into a warning-coloured "Real names" while names are revealed.
- `privacy.aliasing.scope` is edited in settings.jsonc (it is a list).

## D-027 — Targets selection until query tabs exist (2026-09-25)

**Decision:** until query tabs arrive (Phase 4/7), the Targets selection is one session-wide selection. The first inventory selects every enabled workspace; disabled or missing workspaces drop out of the selection automatically. Choosing a group filters the tree to that group and selects exactly its (enabled) workspaces. "Save Selection as Group…" creates a static group. The selection becomes per-tab state in Phase 7.

## D-028 — Monaco and monaco-kusto integration (2026-09-25)

**Context:** spec 05 asks for Monaco with `@kusto/monaco-kusto`, bundled, with workers wired for electron-vite, under the strict CSP (no `unsafe-eval`).

**Decision:**

- `monaco-editor` 0.55.1 and `@kusto/monaco-kusto` 15.0.1 (current on npm, both MIT). Monaco is loaded as `edcore.main` (every editor feature, none of Monaco's other languages), lazily with the first query tab: `QueryEditor` is a `React.lazy` chunk, so startup cost doesn't change.
- Workers are Vite `?worker` module workers served from `raml-kql://app` (`worker-src 'self'`). The Kusto worker entry also includes Monaco's editor worker. The Kusto language service (Bridge.NET) uses `eval` in `newtonsoft.json.min.js`. This runs only inside the worker, which has no DOM, no preload bridge and no IPC, and gets no CSP of its own from our protocol. The page CSP still forbids `eval`, and e2e runs the built app to check that no CSP violation occurs.
- Control commands are off (`includeControlCommands: false`): Log Analytics is read-only.
- F1 in the editor opens the workbench command palette, not Monaco's own.
- The renderer bundle is not minified (electron-vite default). Minification is a release-polish item. It needs care because of Bridge.NET's reflection over names.

**Consequences:** each monaco-kusto cached database is only rebuilt when its `majorVersion` increases, so every schema sent gets a new version. Its per-word completion cache has no invalidation. D-033 wraps its completion provider to reset that cache after each schema update, so the editor never waits for the schema.

## D-029 — Schema service (2026-09-25)

**Context:** spec 05 "Schema-aware IntelliSense".

**Decision:**

- Per workspace, `GET {logAnalyticsEndpoint}/v1/workspaces/{customerId}/metadata` with a Log Analytics token, trying the preferred access path first and then the others. Learn has no maintained reference page for this response. It is parsed leniently: only `tables[].name/description/columns[].name/type/description` and `functions[].name/parameters/body/description` are read, unknown fields are ignored, and `null`s are tolerated. No fallback to `getschema` or the ARM tables API yet. It will be added if the metadata API turns out to be unavailable for some workspaces.
- Cache: `state/schema-cache/<sha256(resourceId)>.json`, metadata only, TTL `schema.cacheHours` (0 = always fetch). File names are hashes, so no names end up in paths. If a fetch fails, an expired cached schema is used rather than none.
- Merge: tables, columns and functions are united by name, with availability counts. The denominator is the number of workspaces whose schema loaded (a failed workspace isn't counted as "missing" the table). Conflicting column types widen (`int`→`long`→`real`, otherwise `string`), as the results merge does (spec 04).
- The merged schema is sent to the language service as one synthetic database, "Targets". Availability appears in docstrings (hover and the completion details pane: "Available in 3/10 selected workspaces"). The completion item detail shows `3/10`: monaco-kusto passes only `label` and `detail` through, and Monaco shows `detail` next to the focused item.
- Built-in table descriptions: `shared/schema/table-descriptions.ts`, written for this project. With `schema.hideTablesMissingEverywhere: false`, those tables are offered even if no target has them ("Not in any selected workspace").
- Functions with tabular parameters are left out of IntelliSense (their parameter syntax isn't parsed yet).
- Nothing is fetched until the first query tab opens. After that the schema follows the Targets selection, debounced by 300 ms.
- Demo mode serves fixed demo schemas that differ per workspace (Defender tables in 3 workspaces, a Contoso `_CL` table and function). The forbidden demo workspace fails, like the fake query engine will.

## D-030 — Time range and "Set in query" (2026-09-25)

**Decision:**

- "Set in query" uses the Kusto language service's classifications (tokens from the real parser) rather than a regex. It reports true when a `where`/`filter` predicate compares `TimeGenerated` with `> >= < <= == between !between in !in`. Comments and string literals never count. This is token-level rather than a full syntax-tree walk, and it counts `where` clauses inside subqueries (`join`, `let`) too. It's a close approximation of "top level", deliberately erring towards "Set in query". A syntax-tree walk can replace it if false positives show up.
- Custom ranges are entered as `YYYY-MM-DD HH:mm` in two input boxes (quick-input style, keyboard-first) in `time.displayZone` (default UTC), and stored as ISO instants. The API `timespan` is `PTnM`/`PTnH`/`PnD` for presets and `start/end` for custom ranges, and it is omitted when "Set in query".
- Until tab persistence (Phase 7), the first New Query of a session starts with the sample query, and later ones are empty.

## D-031 — Query engine (2026-09-25)

**Context:** spec 04 "Fan-out engine", "Log Analytics Query API" and "Service limits".

**Decision:**

- **Thin typed client, not the SDK.** `@azure/monitor-query-logs` (the current successor of `@azure/monitor-query`) runs its requests through the Azure core pipeline on Node's HTTP stack. That bypasses the OS proxy (D-023), and its results don't expose the raw `render`/`statistics` payloads the way the engine needs. `main/azure/log-analytics-query.ts` is a thin client on `AzureHttp` instead. It classifies failures (`throttled`, `transient`, `network`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `timeout`, `cancelled`) for the retry policy, and keeps the innermost server error as `Code: message`.
- **Endpoint:** Learn now shows `api.loganalytics.azure.com`. The app keeps `api.loganalytics.io`: it is still served, and it is the token audience used everywhere (`https://api.loganalytics.io/Data.Read`). Both hosts come from `CloudProfile`.
- **Limits** (verified 2026-09, `main/query/limits.ts`, linked from the code):
  - 5 concurrent queries and 200 requests per 30 s per user;
  - 500,000 rows and ~100 MiB (64 MB compressed) per result;
  - a 10-minute maximum `Prefer: wait`; a server timeout returns 504, which is mapped to `timeout`.
- **Scheduling:** one scheduler with a queue per principal (the account ID). Each principal gets a concurrency limit (`query.maxConcurrentPerAccount`, default 4), a token bucket (150 per 30 s) and a cooldown after a 429 that pauses all of that principal's requests. On top sits a global cap (`query.maxConcurrentTotal`). Targets are interleaved round-robin by tenant. "Warm tokens first" isn't done: tokens are coalesced per (account, tenant) anyway, so the first request of a tenant pays once.
- **Retries** follow spec 04: at most 3 attempts with full-jitter backoff, only for 429/5xx/network.
  - 401: one silent forced refresh (`forceRefresh` through `AuthService` to MSAL), then `AUTH_INTERACTION_REQUIRED`.
  - 403/404: the next access path, when `query.fallbackAccessPaths` is on.
  - Timeouts: never retried.
  - Auth failures of an (account, tenant) pair mark the tenant's other workspaces in the run `skipped` without calling the API.
- **Fail-fast** applies only to the first workspace that finishes with a query error. Errors that are legitimately per-workspace (a table or column that can't be resolved) never trigger it. Queued workspaces become `skipped`, and the renderer asks "Run Anyway", which re-runs the skipped ones with fail-fast off for that run.
- **Pre-flight syntax check** runs in the renderer: the Monaco Kusto worker already has the parser and the merged schema, so a second copy of the language service in the main process isn't needed. Only diagnostics with codes `KS0xx` (syntax: "Missing …", "Malformed …") within the lines being run block the run. Semantic diagnostics (`KS1xx`+) don't block.
- **Run scope:** Shift+Enter and Ctrl/Cmd+Enter run the selection, the blank-line-separated block under the cursor, or everything (`editor.runScope`). Inside Monaco they are Monaco commands, as is Escape while running, so Monaco's own bindings (Ctrl+Enter inserting a line) don't win. "Set in query" is taken from the whole document's detection (D-030).
- **One run per tab:** a new run of a tab cancels and frees the previous one. Closing a tab frees its results.
- **Events:** `query.runChanged` snapshots carry only states, counts and table shapes, coalesced to at most one per 100 ms. Rows are paged with `results.page`.
- **Demo mode** uses `DemoDataSource`:
  - deterministic seeded data per (query, workspace, table);
  - `take`/`limit`/`top` and `count`, and the sample query;
  - a semantic error for tables a demo workspace doesn't have;
  - 403 for the forbidden workspace, 2.5 s for the slow one and one 429 for the "throttle once" one.
    Results are labelled "Demo data".

## D-032 — Result store and audit log (2026-09-25)

**Decision:**

- **Result store.**
  - Results are stored per workspace batch, with the attribution values held once per batch rather than per row. Merged columns are resolved when a page is read: attribution first, then first-seen order, with types widened as in D-029.
  - The memory cost is estimated from the JSON size. Above `results.memoryBudgetMB`, the oldest batches (of any tab) spill to `<userData>/session-cache/<sessionId>/<n>.bin`.
  - Spill files are encrypted with AES-256-GCM: the key is 32 random bytes that exist only in memory, each chunk gets a random 12-byte IV, and the run ID is the associated data.
  - `will-quit` deletes the folder and zeroes the key. Start-up wipes the whole `session-cache` folder.
  - The row cap (`results.maxMergedRows`) counts per run across all tables. The workspace that crosses it is marked `partial` (`TRUNCATED`) and the run `truncated`.
- **Attribution** columns hold real names in the main process. Aliasing is applied when rendering (the same rule as everywhere, D-026). Names the inventory doesn't know show as "Unlisted …" in presentation mode.
- **Audit log.**
  - One `audit/audit-YYYY-MM.jsonl` file per month (UTC).
  - One line per attempt, plus sign-in and sign-out; accounts restored at startup are not logged as sign-ins.
  - `prev` is the SHA-256 of the previous line across files, starting from `sha256:000…` for the first line. Appends are serialized so the chain can't fork.
  - Retention pruning deletes whole months, so verification treats the oldest kept line as the anchor: it proves nothing was edited or removed within the kept history, not that older months existed.
  - `audit.includeQueryText: false` stores only `queryHash`.
- **MSAL through AzureHttp:** MSAL's `system.networkClient` is `AzureHttp.msalNetworkModule()`, so sign-in and token refresh now follow the OS proxy too. This completes D-023.
- **`RAML_KQL_USER_DATA_DIR`** (absolute path) moves the machine-local data (MSAL cache, session result cache), like VS Code's `--user-data-dir`. e2e uses it, so test runs never touch the real profile.

## D-033 — Faster first query tab (2026-09-25)

**Context:** opening a query tab took ~830 ms to a usable editor in the built app. A CPU profile showed the main thread idle for ~650 ms of that. The biggest part (~300 ms) was React 19 throttling the reveal of a resolved `Suspense` boundary (`React.lazy`). The rest was loading Monaco (~105 ms) and starting the Kusto worker with the schema (~150 ms).

**Decision:**

- The query editor chunk is loaded without `Suspense`: a small host component renders it as soon as the module has loaded.
- While the app is idle after start-up (`requestIdleCallback`, 5 s cap), the editor chunk and Monaco are preloaded, and the Kusto worker is started with a throwaway `kusto` model. The worker parses its ~10 MB off the main thread.
- Only code is warmed up. The schema sync still starts with the first query tab, so start-up makes no metadata requests (D-029 unchanged).

**Consequences:**

- Measured in the built app, key press to ready editor went from ~830 ms to ~130 ms, and to the first completion from ~885 ms to ~345 ms.
- Memory for Monaco and the worker is used from start-up rather than from the first tab. For a KQL tool that is the expected state.
- The renderer bundle is still unminified. Minifying would mostly shorten the idle-time preload, so it stays a release-polish item (D-028).

**Follow-up (same day):** with real workspaces the tab still took well over a second, because the editor waited (up to 5 s) for the merged schema before taking input. In demo mode the schema is instant; for real workspaces it means one metadata request per workspace. That wait is gone:

- The editor takes input as soon as Monaco is ready. The schema reaches the language service whenever it arrives.
- The stale-completion problem it worked around is solved at the source. monaco-kusto's completion provider is wrapped (`monaco.languages.registerCompletionItemProvider` is intercepted before monaco-kusto registers). After every schema update, the wrapper first asks for completions at an empty word in a blank model, which resets monaco-kusto's per-word cache.
- An e2e test changes the targets while the same word stays under the cursor. It fails without the reset.
- `.query-monaco[data-schema]` tells tests when the schema is in the language service.
- The idle preload now starts within 1.5 s of start-up (was 5 s).
- Under `pnpm dev`, only the very first run after installing dependencies is slow (~1.3 s), while Vite pre-bundles Monaco. Later dev runs open the editor in ~60 ms.

## D-034 — Results architecture (2026-09-25)

**Context:** spec 06 asks for a grid smooth at 1M rows, group-by in a renderer Web Worker over columnar data, charts, exports and deep links. Results are never persisted (spec 04) and live in the main-process result store.

**Decision:**

- **Rows stay in the main process.** The grid uses AG Grid Community's infinite row model. Sorting, filters (AG Grid's text, number and date models, validated with zod) and quick search are computed in the main process, in one pass next to the data. The resulting row order is cached by table version, and the grid fetches 200-row blocks.
  - This deviates from spec 06's renderer-side columnar data. Shipping 1M rows to the renderer would duplicate them outside the encrypted store and cost hundreds of MB of IPC.
  - Measured in e2e: 500,000 demo rows scroll to the last row in well under a second.
- **Aliasing applies to filtering, search, sort and export too.** The renderer sends the display names on screen with every view request, and the main process maps the attribution columns before evaluating. Searching for a customer's real name therefore finds nothing while names are aliased. Clipboard copies always match the screen. Files follow `privacy.aliasing.applyToExports` (`ask` offers what's on screen first).
- **Group-by runs in the main process too** (streaming aggregator in `shared/results/aggregate.ts`, isolated as the spec asks), over the current view. It is capped at 100,000 groups and sorted largest first. The grouped view is a small client-side grid; it can be charted and exported inline.
- **"Filter to / Exclude this value"** are grid-only `valueFilters` on top of column filters (default `results.cellFilterMode: "grid"`). In `"query"` mode they append a `| where` line built from typed KQL literals.
- **Charts:** ECharts core with only the charts and components used (line, bar, pie, scatter; tooltip, legend, title, data zoom, mark point). Render kinds map per spec. Kusto defaults apply when `render` names no columns: x is the first datetime column (time charts) or the first column; y is the numeric columns; series is the first string column. "Split by tenant" defaults on when there is more than one tenant and no explicit series. Several rows at the same x are summed unless an aggregation is chosen. Line series over 50,000 points are downsampled with LTTB. A query with `render` switches the panel to Chart when its results arrive. Exports: PNG via the canvas, SVG via a server-side-rendered SVG instance, and copy as image through `clipboard.write` (Electron 44 replaced `writeImage` with the async `ClipboardItem` API).
- **Exports** are written in the main process:
  - CSV follows RFC 4180, with BOM and delimiter settings.
  - JSON parses `dynamic` columns into objects.
  - Markdown truncates cells at 200 characters.
  - The KQL `datatable` uses typed literals and is capped at 10,000 rows.
  - XLSX (exceljs) writes one sheet per result table for "all rows", with typed cells and a frozen header.
  - Scope can be all, filtered or selected rows, with visible or all columns. Files go through the native save dialog; the last folder is remembered for the session.
- **Deep links:** the portal Logs URL format was verified against a share link published on Microsoft Learn. The query is gzip, then base64, then URL-encoded twice; `#@tenant` is the access path's tenant. Row links are a small registry (`IncidentUrl`, `AlertLink`/`AlertUrl`, `DeviceId` → Defender device page with `?tid=`), and only allowlisted hosts pass.
- **Not done yet:** the Targets view's context menu entry for portal links (the Run panel and cell menu have it). The last export folder isn't persisted across restarts.
