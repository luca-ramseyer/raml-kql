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

**Update (Phase 7):** each query tab now has its own selection and group (D-037). The Targets view shows the active tab's selection. A new tab starts from the current one; tabs opened from History get the targets of that run.

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

## D-035 — Azure CLI "Sign in" runs `az login` (2026-09-25)

**Context:** for Azure CLI accounts, "Sign in" on a tenant that needs it (MFA, Conditional Access, an expired session) always failed. The provider only told the user to run `az login` in a terminal, and that message was hidden behind a generic "Sign-in failed."

**Decision:**

- The Azure CLI provider's interactive sign-in runs `az login --tenant <tenant> --output none` (no shell; the tenant is a validated GUID). The CLI opens the system browser, like the built-in sign-in, and the app waits up to 5 minutes before getting a token for the tenant as usual.
- `AZURE_CORE_LOGIN_EXPERIENCE_V2=off` is set for that call. Azure CLI 2.61+ otherwise asks in the terminal which subscription to use, and nobody can answer that from the app.
- Azure CLI is looked up with the common install folders appended to `PATH` (`/opt/homebrew/bin`, `/usr/local/bin` on macOS; `/usr/local/bin`, `/snap/bin` on Linux). Apps started from Finder or the Dock get a minimal `PATH` without them.
- Providers throw `SignInError` for failures written for the user. The auth service shows that message itself instead of "Sign-in failed." with the reason hidden in the details.

## D-036 — Dev-mode robustness: StrictMode and the Kusto worker (2026-09-25)

**Context:** under `pnpm dev`, a query tab showed no IntelliSense and Targets started with nothing selected. AG Grid also reported a deprecated option. Production builds were fine, so e2e (which runs the built app) didn't catch any of this.

**Decision:**

- **Kusto worker:** the language service (Bridge.NET output) refers to Node's `global`. Rollup rewrites it in production builds; Vite's dev server doesn't. The worker entry now imports a tiny shim (`worker-globals.ts`) first. Previously Monaco silently fell back to a worker without the language service.
- **React StrictMode starts the workbench twice** in dev and stops the first start. Two registries shared state across the starts:
  - Zustand keeps listeners in a `Set`, so subscribing the same module function twice leaves one entry. The first start's unsubscribe then removed the second start's subscription: the Targets selection never followed the inventory, and the theme stopped following settings. Subscriptions now use a fresh closure per start.
  - Status bar items are keyed by id. Dispose and update now only touch an item while it's still the registration's own, as commands already did.
- **AG Grid 36.2** deprecates `tooltipValueGetter`; the grid uses `tooltip` with a callback. AG Grid only reports deprecations through its validation module, which the app loads in dev.
- **Regression tests:**
  - a Targets test renders the workbench under `<StrictMode>`;
  - a status bar test covers duplicate ids;
  - a column-defs test checks the tooltip option;
  - a manual dev-mode console sweep found no remaining warnings or errors.

## D-037 — Editor groups, tab persistence and per-tab targets (2026-09-25)

**Context:** spec 05 asks for VS Code-style tabs with split groups, and tabs that survive restarts with their text, targets, time range and name. Result data must never be persisted (spec 04).

**Decision:**

- **Groups model:** the editor store holds groups. Each group has its editors, active editor, MRU order and size. `editors` and `activeId` are derived for existing callers.
  - Split Right (`Ctrl/Cmd+\`) duplicates the active query tab into a new group, with a copy of its text, time range and targets.
  - Tabs move between groups by drag and drop.
  - `Ctrl/Cmd+1..4` focuses a group, and `Ctrl+Tab` switches to the previous tab in MRU order.
  - Preview tabs (italic, replaced by the next preview) come from single clicks in History and Library. Editing or double-clicking a tab keeps it.
  - Pinned tabs are supported.
- **Dirty dot:** only for tabs linked to a My Queries file whose text differs from the saved text. Unsaved drafts are normal in this app (spec 05: "they persist as drafts"), so marking every new tab dirty would be noise.
- **Persistence:** the renderer builds the state; main validates it with zod and writes `state/tabs.json` (0600, atomic, serialized).
  - Saved: groups, tabs (id, kind, title, pinned), query text, time range, cursor, targets and group, and the linked file with its saved text.
  - Saves are debounced by 500 ms, with one more when the window closes.
  - Restored tabs show "Results from the previous session were cleared" until they run again.
  - Welcome opens only when nothing was restored.
- **Per-tab targets:** the Targets store stays the single source for the view and for runs. A tracker swaps its selection in and out when the active query tab changes, so the existing Targets UI and the schema loader didn't change.
- **Module layout:** `open-query.ts` (opening tabs) and `run-query.ts` (Shift+Enter) are split out of `query-commands.ts`. History, Library and persistence use them without an import cycle.

**Consequences:**

- `state/` is machine-local (the config `.gitignore` excludes it). Unsaved query text sits there in plain text, like VS Code's hot exit. Query text is not result data, and spec 04 keeps it out of the encrypted cache on purpose.
- Deferred to later phases:
  - the Ctrl/Cmd+P `@` (targets) and `#` (tables) prefixes;
  - pack queries in quick open (Phase 8);
  - the Targets view's "Open in Azure Portal" context menu.

## D-038 — Query history (2026-09-25)

**Decision:**

- Main records history, not the renderer. The query service wraps `engine.run`: `started(runId, request)` remembers the request (group, time range, tab title), and the first finished snapshot for that run appends one line to `state/history.jsonl` (0600).
- Each entry holds the query text, target resource IDs, tenant IDs, counts per outcome, row count and duration. It never holds result data.
- "Re-run Failed" updates the same run and adds no entry.
- The cap is `history.maxEntries` (default 5000). The file is appended and rewritten only when it grows past 110 % of the cap. Damaged lines (a crash mid-write) are skipped.
- Search runs in the renderer over query text, table names in the text, and tenant names. Tenant names go through the aliasing namer, so presentation mode doesn't leak real names through search.
- The view groups runs by day (Today, Yesterday, date). An entry opens as a preview on single click and as a normal tab on double click or Enter. Other actions: Open in New Tab, Run Again, Copy Query, and Clear History (with confirmation).

## D-039 — My Queries files (2026-09-25)

**Decision:**

- `.kql` files in `<config>/queries/`, subfolders allowed (spec 08). Front-matter is YAML in `// ` comment lines between `// ---` markers, so the file is still valid KQL. It's parsed with [`yaml`](https://github.com/eemeli/yaml) 2.9 (ISC, no dependencies, the maintained YAML 1.2 parser). Unknown keys are kept on save.
- Main owns all file IO:
  - Every path is resolved inside the folder, and anything else is refused.
  - New files get a slug of the name (`failed-sign-ins.kql`, then `-2`, …).
  - Rename changes both the front-matter name and the file name.
  - Delete moves the file to the OS trash (`shell.trashItem`), never a hard delete.
  - A recursive `fs.watch` emits `queries.changed`, so edits made outside the app (git pull, an editor) show up live.
- Ctrl/Cmd+S saves a linked tab in place, and otherwise asks for a name (Save As). Ctrl/Cmd+Shift+S always asks.
- The Library view shows a My Queries tree (the Explorer look):
  - search, folders and drag and drop moves;
  - F2 renames, Delete deletes, and there is a context menu.
  - Installed packs join the view in Phase 8.

## D-040 — Query pack format and `@raml-kql/pack-schema` (2026-09-25)

**Decision:**

- `packages/pack-schema` holds the zod schemas (manifest, index, query metadata, parameters), the front-matter parser (moved from the app) and a **pure loader**: `discoverPacks(files)` takes a map of repository paths to text. The app (folders, zips, git trees) and `raml-kql-ext pack validate` all validate with the same code.
- Schemas are **strict**: a typo such as `categroy:` is reported instead of silently ignored. A query with a problem is skipped with a message; the rest of the pack loads. A broken manifest or index rejects the whole pack.
- Front-matter and a sidecar `.yaml` are exclusive per query. Using both is reported, so it's never ambiguous which one wins.
- Duplicate query ids in a pack keep the first file (in sorted order) and report the others.
- JSON Schema files (`packages/pack-schema/schemas/*.json`) come from `z.toJSONSchema`. They are generated by a test run with `RKQL_UPDATE_SCHEMAS=1` (`pnpm --filter @raml-kql/pack-schema generate`), and the same test fails when they are stale. There is no `tsx` in the repo, and Node's type stripping can't resolve extensionless imports. Cross-field rules (enum `values`, default types) exist only in zod.
- MITRE IDs are validated by format. The bundled ID → name list (spec 08) is deferred: the Library shows IDs.

## D-041 — Parameter injection with the Kusto parser in main (2026-09-25)

**Context:** spec 08 wants typed `let` statements, an existing `let` of the same name replaced "using the Kusto syntax tree", and never string substitution.

**Decision:**

- **Injection runs in the main process**, at the IPC boundary: `QueryRunRequest.parameters` carries zod-validated `{name, type, values?, value}`, and `withParameters` rewrites the query before the engine sees it.
  - A value that doesn't fit its type is refused with `PARAMETER_INVALID`, and nothing is sent.
  - History records the query that actually ran.
- The syntax tree comes from `@kusto/language-service-next` 12.4.1 (MIT). It is the same Bridge.NET parser the editor's worker uses, and a direct dependency now.
  - It needs no DOM or `window`, so it loads lazily in main (about 100 ms) on the first query with parameters.
  - Only **top-level** `LetStatement`s are replaced, in place, keeping comments. A `let` inside a function body, string or comment is never touched.
- Literals per type:
  - `string` and `enum`: a double-quoted string that escapes `\\`, `"`, `\n`, `\r`, `\t`, and control and line-separator characters as `\uXXXX`, so it is always one line;
  - `int(…)`, `long(…)` (digits only, 64-bit range checked with BigInt), `real(…)` (`nan` and `±inf` allowed), `true`/`false`;
  - `datetime(…)`, checked against a strict ISO 8601 pattern;
  - `timespan(…)`, checked against the KQL timespan literal grammar;
  - `stringList`: `dynamic([...])` of encoded strings;
  - **`dynamic`: `parse_json("<escaped JSON>")` instead of `dynamic(<json>)`**, so no JSON value can break out of the literal. This is a deviation from a literal reading of spec 08 (updated).
- Tests round-trip every literal through the real parser, hostile strings included, and parse every example query with and without injected defaults.
- In the renderer, a tab stores the parameter definitions plus **the text typed** into each input, saved in `tabs.json`. Values are parsed and checked when the query runs, with the invalid input highlighted. This keeps half-typed values ("1.") editable and makes persistence trivial.

## D-042 — Git pack sources (2026-09-25)

**Decision:**

- **isomorphic-git 1.42.2** (MIT; no system git, per spec).
  - Sources are shallow-cloned (`depth: 1`, single branch, **no checkout**) into `<config>/sources/git-<hash of url#ref>/`.
  - Pack files are read from the **pinned commit's tree in the object store**, so the app always loads exactly the SHA in `sources.jsonc`, whatever is in the folder.
  - An update fetches `depth: 100`. The review lists up to 50 commits since the pinned one, plus added, removed and changed queries. Metadata is compared too, rendered as front-matter, in a read-only Monaco diff editor.
  - Applying changes only the pinned SHA.
- **URL policy:** `https://` only, plus `http://` to localhost/127.0.0.1 for local git servers and the tests. User names or tokens in the URL are refused.
- **Private repositories:** a `401`/`403` response becomes `SOURCE_AUTH_REQUIRED`. The renderer then asks for a token (the quick input got a `password` mode) and retries.
  - The token is encrypted with Electron `safeStorage` into `<userData>/credentials.json`, which is machine-local, not the config dir.
  - `sources.jsonc` holds only `credentialRef`, and removing a source deletes its token.
  - A token is sent as HTTP basic auth password, which GitHub, GitLab and Azure DevOps all accept.
- **Preview before add:** the clone goes into `sources/.preview-*` and is moved into place only on "Add Source". Previews expire after 30 minutes, and leftovers are removed at start.
- **Update checks:**
  - At start (15 s after launch), at most once per 24 h per source, recorded in `state/pack-sources.json`.
  - A new setting, `sources.checkForUpdates` (default on), turns the startup check off. `sources.autoUpdate` (default off) applies updates without review.
  - The "Check for Pack Updates" command ignores the throttle.
  - Found updates show a notification with a **Review** action and an "Update" badge on the pack.
- Two sources providing the same pack id are both kept. The source label tells them apart in the tree, and the preview warns about the conflict.
- Tests use a small **smart-HTTP git server** (`test/helpers/git-server.ts`) that wraps `git http-backend` over repositories made with the system git. This is a test dependency only: CI runners have git, the app doesn't need it.

## D-043 — Importing packs from files (2026-09-25)

**Decision:**

- **fflate 0.8.3** (MIT, no dependencies) reads `.rkqlpack` zips.
  - Only `.kql` and `.yaml` entries are read, with limits of 1 MB per file, 5,000 files and 50 MB in total.
  - Declared sizes are checked before inflating, and actual sizes after, because headers can lie.
  - Entries with `..`, absolute or drive paths are refused.
  - A single top-level folder (`raml.starter/…`) is stripped.
- An imported pack is copied into `<config>/sources/file-<content hash>/` and recorded in `sources.jsonc` as `type: "file"` with its hash. Only the file name is recorded, never the machine-specific path. Importing identical content again says "already added".
- Loose `.kql` files become My Queries, keeping any front-matter.
- There are two commands, "Import Pack or Queries from File…" and "Import Pack from Folder…", because Windows and Linux dialogs can't pick files and folders at once.
- The e2e test replaces `dialog.showOpenDialog` through Playwright's `electronApp.evaluate`.

## D-044 — Library view with packs (2026-09-25)

**Decision:**

- The Library view has two sections, **My Queries** and **Packs** (pack → category → query; one category shows flat), with one search box. Search is VS Code-style text plus `tag:`, `mitre:` (sub-techniques match their parent), `table:` and `category:`.
- A filter toggle shows only queries whose tables all exist in the current targets' merged schema.
- A pack query opens like a My Query: single click opens a preview tab, double click opens a normal tab.
  - The tab gets the pack's timespan (mapped to the smallest covering preset) and its parameter bar.
  - It never runs by itself.
- "Duplicate to My Queries" keeps the metadata, including parameters. A My Query with `parameters` in its front-matter gets the parameter bar too.
- The add-source preview is a quick pick listing packs, query counts, conflicts and problems, then Add or Cancel. Cancelling deletes the clone.
- The update review is an editor tab (`packUpdate`, one per source). It isn't saved in `tabs.json`, since it would be stale after a restart.
- Quick open (`Ctrl/Cmd+P`) lists pack queries. The Welcome page links "Add Query Pack Source…".
- User-facing errors from My Queries now reach the renderer: the IPC router shows plain `Error`s as "An unexpected error occurred", so the service now throws `FILE_OPERATION_FAILED` AppErrors. This was a Phase 7 bug.
- Deferred:
  - "Export as pack…" (bundle selected My Queries);
  - a Settings → Sources page (the commands and the pack context menu cover add, check, review and remove);
  - the MITRE technique names (D-040).

## D-045 — Extension host and sandbox (2026-09-25)

**Decision:**

- As spec 01 describes, extensions run in a hidden `BrowserWindow` (the extension host), with one **module Web Worker per extension**. The worker gets the bundled code from main and loads it from a blob URL. It talks to main over its own `MessagePort`. The host page has no IPC: its preload only hands ports over.
- **No network, three layers:**
  1. The host window uses its own in-memory session, whose `webRequest` cancels everything except its own page (`raml-kql://exthost/…`, a separate origin with its own CSP).
  2. The page CSP is `default-src 'none'; script-src 'self' blob:; connect-src 'none'`.
  3. The worker deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport` and `importScripts`.

  The e2e test tries three ways to reach a local server directly and all fail. The only way out is `ramlKql.net.fetch`, which main performs after the permission check. It runs in a separate cookie-less session, over https (or http to localhost), with redirects returned rather than followed (a redirect could lead to a host that wasn't granted), a 10 MB limit and a 30 s timeout.

- **Extension UI** (views, result renderers) runs in `<iframe sandbox="allow-scripts">` from a new privileged scheme, `rkql-ext://<extension id>/…`. It serves only that extension's files (never `package.json`), with a CSP that has no network and `frame-ancestors` limited to the workbench. The workbench CSP gained `frame-src rkql-ext:`. Because the frame's origin is opaque, UI scripts must be classic scripts (module scripts would need CORS). The author guide says so.
- **Limits:** a 10 s activation timeout, invocation timeouts, and 200 calls per second per extension. Every call's arguments are validated with zod in main. A crash only marks the extension "Failed".

## D-046 — Permission broker and grant model (2026-09-25)

**Decision:**

- Checks happen **in main** (`PermissionBroker`), never in the worker.
  - Undeclared permissions, and hosts outside the declared `network` list, are refused without a prompt.
  - Declared low-risk permissions (`secrets`, `clipboard.write`, `notifications`) are granted at install.
  - Medium and high risk are asked at use time.
- **Scopes:** `run` (the default), `session`, `always` (persisted in `permissions.jsonc` as `{ extension, permission, hosts?, grantedAt }`).
  - A run grant belongs to the query run of the active tab: the workbench passes its `runId` with every command or enrichment, and calls made during that invocation inherit it.
  - Calls outside a run (e.g. from the command palette with no results) get "Allow Once", scoped to that invocation.
  - A denial is remembered for the run, so a loop can't flood the user with prompts.
  - Concurrent identical checks share one prompt.
- **One prompt per action:** enrichment asks for `results.readSelection` and `network` together ("wants to send 14 values (IP addresses) from this result to www.virustotal.com").
- The prompt is a modal dialog, and the dialog component is new. It has the four buttons from spec 07; the focused one follows `extensions.permissions.defaultScope`. With aliasing on, it notes that sent values are real, not aliased.
- Grants, denials, revocations, installs, updates and uninstalls go to the audit log (a new `extension` event kind).
- **On update:** always-grants survive only when the new version asks for the same or narrower (network hosts included); the rest are dropped. The install preview shows the new permissions.

## D-047 — Contribution points (2026-09-25)

**Decision:**

- **Commands:** registered in the palette as soon as the extension is enabled, before activation (activation stays lazy). Their titles come from the manifest.
  - `menus.commandPalette` with `when: "false"` hides a command.
  - `menus.results/cell/context` adds items to the grid's cell menu. Those items receive the cell value and need `results.readSelection`.
  - When clauses gained VS Code's `=~ /regex/` for `cellEntityType`.
- **Keybindings:** a layer between the defaults and the user's `keybindings.jsonc` (the user's own keybindings win).
- **Enrichers:** entity detection lives in the host (`shared/results/entities.ts`, by column name confirmed by the value's shape). Results become extra grid columns (an in-memory overlay per run: not sortable, never persisted, never written into the result).
- **Result renderers:** one panel tab each, fed up to 10,000 rows with the names on screen (aliased in presentation mode) once `results.read` is granted. Rows go from the workbench to the frame by `postMessage`; the gate is in main.
- **Sidebar views:** join the activity bar. Messages go frame ↔ workbench ↔ main ↔ worker (`views.registerWebviewView`, `webview.postMessage`).
- **Themes:** data only. They join the theme picker like user themes (no `include`).
- **Configuration:** extension settings live in `settings.jsonc` under keys that must start with the extension's name. `configuration.get` checks the declared type and falls back to the default. The settings service now keeps the raw values and reports raw key changes, for `onDidChangeConfiguration`. The Settings editor doesn't list extension settings yet.
- **Data sources:** see D-049.

## D-048 — Installing and updating extensions (2026-09-25)

**Decision:**

- **From file:** a `.rkqlx` zip, read with fflate (every file, with a 10 MB/file, 2,000 files and 50 MB limit, path traversal refused).
- **From git:** `listServerRefs` lists the `vX.Y.Z` tags (prereleases skipped). The newest release whose manifest fits `engines` wins, trying up to 10.
  - First choice is a GitHub or GitLab **release asset** (`*.rkqlx`, through their REST APIs, unauthenticated; a GitHub rate limit is reported).
  - Otherwise the tag itself, which must contain a built `dist/`. isomorphic-git can't `clone` a tag with `singleBranch`, so the host inits a repo, fetches the tag shallowly and reads the peeled commit's tree.
  - `extensions.jsonc` records the URL, tag, commit and the package SHA-256.
- **Every install shows a preview first:**
  - "Not verified by Raml KQL — only install extensions you trust";
  - the permissions with their risk;
  - the README;
  - for updates, the permissions the new version adds.

  `verified` is always false for now.

- **Updates:**
  - checked at startup (`extensions.checkForUpdates`, a new setting, default on) and with "Check for Extension Updates";
  - shown in the Extensions view with an Update button;
  - `extensions.autoUpdate` (default off) applies only updates that add no permissions.
- **Uninstall** removes the files, grants, secrets (OS keychain, in user data) and storage (`state/extension-storage/`).

## D-049 — Data sources behind one interface (2026-09-25)

**Decision:** `DataSourceRegistry` holds the query engine's data sources. The built-in Log Analytics source (or the demo source in demo mode) is registered like any other. Each workspace is routed by its new optional `dataSourceId`, defaulting to Log Analytics. Manifests can declare `contributes.dataSources`. How an extension provides _targets_ (its own inventory) and tokens (`auth:<resource>`) is deferred (D-050), so extension data sources cannot run queries yet.

## D-050 — Extension API: implemented and deferred (2026-09-25)

**Implemented:**

- `commands`, `window` (messages with actions, quick pick, input box with password, progress);
- `enrichment`, `views` (webviews), `net.fetch`, `secrets`, `storage`, `configuration` (+ change events), `editor` (`getActiveQuery`, `insertText`, `openQueryTab`), `clipboard`, `env`.

**Deferred:**

- `query.run`, `targets.list`, `auth.getToken`, `results.getActive` (renderers get rows from the host instead), and `dataSources.register`. These are the high-risk ones, and each needs its own prompt design.
- The CLI's `dev` command with `--extensionDevelopmentPath` hot reload.
- Drag-and-drop install.
- Offering to reinstall the set from a shared `extensions.jsonc` on another machine.
- A "restart extension" prompt for a worker that stops answering (invocations time out instead).
- Listing extension settings in the Settings editor.

The examples are built with esbuild (now a root dev dependency) by `pnpm build:examples`. The country map bundles Natural Earth 110m (public domain, via world-atlas, ISC) with topojson-client (ISC) and i18n-iso-countries codes (MIT).
