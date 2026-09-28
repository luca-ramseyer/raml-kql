# 00 — Roadmap and progress

Work top to bottom. Each phase ends with its acceptance criteria passing, `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` green, the checkboxes below ticked, and a commit.

Version targets:

- `0.x`: private development.
- `1.0.0`: first good working public release (Phase 12).

---

## Phase 0 — Scaffold and quality gates

- [x] pnpm workspace monorepo with the layout from `CLAUDE.md`
- [x] `apps/desktop` scaffolded with electron-vite (main / preload / renderer), React, strict TS
- [x] ESLint (typescript-eslint, react-hooks, import order) and Prettier set up, with `pnpm lint` and `pnpm format`
- [x] Vitest configured for main, renderer and packages; Playwright configured for Electron
- [x] Typed IPC skeleton (`src/shared/ipc/`) with zod-validated contracts, and one example round trip covered by a test
- [x] `--demo` flag / `RAML_KQL_DEMO=1` plumbing (empty for now)
- [x] GitHub Actions `ci.yml` (see `11-quality-ci-release.md`)
- [x] `docs/DECISIONS.md`, `docs/HUMAN-TODO.md`, `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md` exist

**Acceptance:** `pnpm dev` opens an empty window. All scripts run. CI passes on a PR. An e2e smoke test launches the app and asserts the window title.

> Status: all acceptance criteria verified locally (lint, typecheck, unit tests, e2e, `pnpm dev`, `pnpm dist` on macOS). "CI passes on a PR" is pending until the GitHub repo exists (see `docs/HUMAN-TODO.md`).

## Phase 1 — Workbench shell (VS Code look)

- [x] Layout: title bar, activity bar, primary sidebar, editor area with tab strip, bottom panel, status bar (spec 05)
- [x] Theme system using VS Code theme JSON format; ships Dark Modern, Light Modern, High Contrast; follows OS by default
- [x] Command registry, command palette (`F1`, `Ctrl/Cmd+Shift+P`), quick open (`Ctrl/Cmd+P`)
- [x] Keybinding service with defaults and a `keybindings.jsonc` override
- [x] Settings service backed by `settings.jsonc`, a Settings UI (search, categories, "Edit in settings.jsonc"), and live reload on file change (spec 09)
- [x] Resizable, collapsible sidebar and panel whose sizes persist; `Ctrl/Cmd+B` and `Ctrl/Cmd+J` toggle them
- [x] Notifications (toast bottom-right like VS Code) and a status bar item API

**Acceptance:** side by side with VS Code, the shell is visually near-identical in both themes. e2e: open the palette, run the "Toggle Sidebar" command, change the theme via settings.

> Status: e2e acceptance tests pass (`apps/desktop/e2e/workbench.spec.ts`), plus live reload of settings.jsonc and keybindings.jsonc and layout persistence across restarts. Visual comparison done from screenshots on macOS; a side-by-side check by a human on all three OSes is in `docs/HUMAN-TODO.md`. The in-app JSON editor for settings.jsonc and the visual Keyboard Shortcuts editor come with Monaco in Phase 4 (D-018).

## Phase 2 — Accounts and authentication

- [x] MSAL Node public client with persistent encrypted cache (spec 02)
- [x] Add / remove / re-authenticate accounts (multiple accounts)
- [x] Per-tenant token acquisition (home tenant + guest tenants), with interactive fallback on `interaction_required`
- [x] Accounts view in the activity bar ("Accounts" icon at the bottom like VS Code) showing accounts, tenants and status
- [x] Auth provider modes: built-in client ID, custom client ID, Azure CLI
- [x] Demo auth provider

**Acceptance:** In demo mode, 2 fake accounts with 3 tenants are shown. Unit tests cover token routing logic. The manual live test is listed in HUMAN-TODO.

> Status: e2e (`apps/desktop/e2e/accounts.spec.ts`) shows 2 demo accounts with 3 tenants, the re-auth badge and notification, and signing in to the tenant that needs it. Token routing, coalescing, `needsReauth` tracking and the providers are unit-tested; `/tenants` is integration-tested against the fake Azure server (`apps/desktop/test/fake-azure/`). The MSAL cache is encrypted with Electron `safeStorage` instead of msal-node-extensions (D-020). The live test with real accounts is in `docs/HUMAN-TODO.md`.

## Phase 3 — Discovery and workspace management

- [x] Discovery via Azure Resource Graph per account (workspaces, subscriptions, tenants, Sentinel flag)
- [x] Access-path dedupe when multiple accounts reach the same workspace
- [x] Settings → Workspaces page: tree Account/Tenant/Subscription/Workspace, enable/disable, preferred access path, rename alias, refresh
- [x] Tenant groups (static and dynamic), editable in the UI and config
- [x] Config `extends` for settings.jsonc, groups.jsonc and workspaces.jsonc (spec 09, moved here from Phase 1; see D-018)
- [x] Aliasing and presentation privacy (master switch + quick toggle)
- [x] "Targets" sidebar view in the KQL view showing only enabled workspaces, with checkboxes, search and groups

**Acceptance:** In demo mode, disabled workspaces disappear from Targets. Toggling aliasing updates every visible name instantly. Groups select correctly.

> Status: e2e (`apps/desktop/e2e/workspaces.spec.ts`) covers all three, plus rediscovery after signing in to a tenant. Discovery, dedupe, groups, aliasing and `extends` are unit-tested; Resource Graph and `/tenants` are integration-tested against the fake Azure server. The Targets selection is session-wide until query tabs exist (D-027). The live discovery test is in `docs/HUMAN-TODO.md`.

## Phase 4 — Editor and IntelliSense

- [x] Monaco with KQL via monaco-kusto, workers wired for electron-vite
- [x] Schema fetch per workspace, cached (metadata only), merged for the selected targets, with availability hints
- [x] Time range picker with "Set in query" detection
- [x] Format document, comment toggle, find/replace, multi-cursor (Monaco defaults), and KQL snippets

**Acceptance:** In demo mode, completions list tables and columns from the fake schema. Tables missing in some targets show "available in 3/5 workspaces".

> Status: e2e (`apps/desktop/e2e/editor.spec.ts`) runs the built app under the production CSP. Completions list demo tables and columns, `DeviceProcessEvents` shows `3/10` in completions and "Available in 3/10 selected workspaces" on hover, the sample query shows "Set in query", and the time range picker works. The schema service, merge, cache, metadata parsing, "Set in query" detection, snippets and time range helpers are unit-tested. Details are in D-028 to D-030. The live schema test is in `docs/HUMAN-TODO.md`.

## Phase 5 — Query engine

- [x] Fan-out orchestrator with per-account concurrency, rate limiting, timeouts, retries and cancellation (spec 04)
- [x] `AzureHttp` on Electron `net.fetch`, and MSAL routed through it so sign-in honours the OS proxy (D-023)
- [x] Pre-flight parse check (don't fan out syntactically broken queries)
- [x] Merge with attribution columns; multiple result tables
- [x] Per-workspace status panel and "Re-run failed"
- [x] Encrypted session result cache with memory budget and spill-to-disk
- [x] Audit log (hash-chained JSONL)

**Acceptance:** Engine integration tests against a fake Log Analytics server cover success, 429 with Retry-After, 5xx retry, timeout, partial error, cancellation and row-cap truncation. The cache is gone after quit (test). The audit log verifies (test).

> Status:
> - `src/main/query/query-engine.test.ts` runs the real client against the fake Log Analytics server (`test/fake-azure/`). It covers success with the request headers, 429 with Retry-After, 5xx retries, server and client timeouts, partial errors, cancellation of running and queued workspaces, row-cap truncation, access-path fallback, the 401 refresh, fail-fast, auth aggregation, re-runs and auditing.
> - The cache: `result-store.test.ts` covers encryption, spill, dispose and the crash wipe, and `e2e/query.spec.ts` shows the session cache is gone after quitting the real app.
> - The audit log: `audit-log.test.ts` covers verification, tampering, rotation and retention.
> - In demo mode, e2e covers the run, merged results with attribution and aliasing, the syntax pre-flight, Escape to cancel and Re-run Failed.
> - The results view is a 200-row preview until the grid arrives in Phase 6.
> - Details are in D-031 and D-032. Live query and proxy tests are in `docs/HUMAN-TODO.md`.

## Phase 6 — Results

- [x] AG Grid results with virtual scrolling, sort, filter, resize, reorder, pin, and copy (cell / row / selection as TSV)
- [x] JSON/dynamic cell viewer, cell details side panel
- [x] Group-by panel (client-side aggregation over merged results)
- [x] Charts from the `render` operator and from a manual chart builder (ECharts)
- [x] Export: CSV, JSON, XLSX, Markdown table, KQL `datatable`, copy as each
- [x] Deep links: open query in Azure Portal Logs for a workspace; row-level links where columns allow

**Acceptance:** A 500k-row demo result scrolls smoothly. Each render type draws. Exports round-trip in tests.

> Status:
> - `e2e/results.spec.ts` scrolls a 500,000-row demo result to the end and the middle within seconds, sorts, searches, filters to a value, opens row details, groups by tenant, draws a `render timechart` and switches through every chart type, and exports CSV to a file and Markdown to the clipboard.
> - Unit tests cover every render kind, CSV/JSON/JSON Lines/Markdown/datatable/XLSX round-trips, the views (filters, sorting, search on aliases, spilled batches), group-by, LTTB, portal links (decoded like Learn's sample) and row links.
> - Rows stay in the main process, and sorting, filtering and grouping run there (D-034).
> - The live test is in `docs/HUMAN-TODO.md`.

## Phase 7 — Tabs, history, saved queries

- [x] Query tabs persist across restarts (text, targets, time range, name) with results cleared
- [x] Split editor groups (side-by-side tabs) like VS Code
- [x] History view (searchable, re-open into a tab, no result data)
- [x] "My Queries" saved as `.kql` files with front-matter in the config dir, plus an Explorer-like view

**Acceptance:** Restart restores tabs without results. History search works. Saved queries appear as files.

> Status:
> - `e2e/tabs.spec.ts` covers three things:
>   - it runs a query, restarts the app on the same config dir, and checks that the tab comes back with its text and the "results were cleared" note, and that `state/tabs.json` holds no result data;
>   - it searches History and reopens an entry;
>   - it saves a tab with Ctrl/Cmd+S into `<config>/queries/`, checks the file and the Library tree, and saves it again in place.
> - Unit tests cover:
>   - editor groups (split, move, preview, MRU);
>   - tab persistence round-trips and per-tab targets;
>   - the tabs store, history service (dedupe, cap, damaged lines) and My Queries service (path safety, free names, rename, move, trash);
>   - front-matter.
> - Decisions: D-037 to D-039. The live check is in `docs/HUMAN-TODO.md`.

## Phase 8 — Query packs and git sources

- [x] Pack format + zod schema + JSON Schema (spec 08)
- [x] Add a source by git URL (clone with isomorphic-git, pinned to commit), update check, and update with diff
- [x] Import from file (`.rkqlpack` zip, folder, single `.kql`)
- [x] Query Library view: browse, search, filter by tag/MITRE/table, open query in new tab, parameter form
- [x] Parameters injected as typed `let` statements (never string-concatenated into the body)

**Acceptance:** The example pack installs from a local bare git repo in tests, updates, and runs with parameters.

> Status:
> - `e2e/packs.spec.ts` runs two tests.
>   - The first serves `examples/packs/raml.starter` from a bare repository over local smart HTTP. It adds the source from the preview, runs a query with changed parameters (History shows the typed `let` statements that replaced the portable defaults), then pushes 1.1.0, checks for updates, reviews the commit and changed queries, and applies the update.
>   - The second imports a `.rkqlpack` through a stubbed file dialog.
> - Unit tests cover:
>   - the pack schemas and loader;
>   - the literal encoder, round-tripped through the real Kusto parser, hostile strings included;
>   - injection that replaces top-level `let`s only;
>   - git sources against a local server: pinning, updates and diffs, private repositories with tokens, the 24-hour throttle and removal;
>   - zip safety and the URL policy;
>   - every example query parsing with and without injected defaults;
>   - the Library UI and parameter bar;
>   - `raml-kql-ext pack validate`.
> - Decisions: D-040 to D-044. The live checks are in `docs/HUMAN-TODO.md`.

## Phase 9 — Extensions

- [x] Extension host (sandboxed) + host API + permission broker (spec 07)
- [x] Contribution points: commands, menus, keybindings, views/panels, result renderers, enrichers, data sources, themes, configuration
- [x] Permission prompts (once / session / always), permissions management UI, revocation
- [x] Install from git URL (release asset) or file (`.rkqlx`); enable/disable/uninstall; update with permission diff
- [x] `packages/extension-api` and `packages/extension-cli` (scaffold, validate, package)
- [x] Example extensions: VirusTotal IP/hash enricher, "Map" result renderer (no external tiles; country aggregation), a theme
- [x] The built-in Log Analytics data source is implemented through the same data-source interface

**Acceptance:** An example extension can't reach the network without a grant (test). A permission prompt appears per query run by default. "Always allow" persists.

> Status:
> - `e2e/extensions.spec.ts` checks the acceptance in the running app with a test extension:
>   - a direct `fetch` (in three different ways) never reaches the local test server;
>   - `ramlKql.net.fetch` is refused until granted;
>   - the prompt appears again for each new query run;
>   - "Always allow" is written to `permissions.jsonc` and holds after a restart, and revoking it in the Extensions view brings the prompt back.
> - `e2e/example-extensions.spec.ts` covers the three examples in the app:
>   - the Country Map draws in its sandboxed frame after `results.read` is allowed;
>   - the theme can be chosen;
>   - VirusTotal enrichment asks "send 1 value (IP addresses) from this result to www.virustotal.com" before anything leaves.
> - Unit tests cover:
>   - the broker (scopes, denial memory, concurrency, combined prompts, updates);
>   - the manager with the real runtime over a MessageChannel;
>   - git installs against a local server;
>   - the manifest schema, semver, entity detection, the `=~` when-clauses and the CLI.
> - Deferred (D-050): `query.run`, `targets.list`, `auth.getToken` and targets for extension data sources; the `dev` command with `--extensionDevelopmentPath`; drag-and-drop install.
> - Decisions: D-045 to D-050. The live checks are in `docs/HUMAN-TODO.md`.

## Phase 10 — Privacy polish and crash reporting

- [ ] Presentation-mode indicator in the status bar, keybinding, and custom masking rules for result cells (spec 03)
- [ ] Crash capture + sanitized "Report on GitHub" flow (spec 10)

## Phase 11 — Packaging, signing, auto-update

- [ ] electron-builder configs: mac (dmg + zip, universal or arm64+x64), win (nsis), linux (AppImage, deb, rpm)
- [ ] macOS hardened runtime + notarization via env secrets
- [ ] Windows signing hook (SignPath or Trusted Signing) via env secrets, no-op when absent
- [ ] electron-updater against GitHub Releases, with stable/beta channel setting and a "check for updates" command
- [ ] Electron fuses set (spec 01)
- [ ] `release.yml` workflow with release-please

**Acceptance:** Unsigned local builds install on all three OSes (CI artifacts). Signing steps are documented in HUMAN-TODO.

## Phase 12 — Public readiness (1.0.0)

- [ ] README with screenshots from demo mode, install instructions, and "how it compares to MTO"
- [ ] CONTRIBUTING.md, SECURITY.md (private vulnerability reporting), CODE_OF_CONDUCT.md, issue/PR templates
- [ ] `docs/guides/` complete; extension author guide; query pack author guide
- [ ] gitleaks scan of the full history is clean
- [ ] Dependency license check is clean (no GPL in the bundled app)

---

## Post-1.0 backlog (not now)

- Scheduled / recurring queries (run only while the app is open; results obey the same no-persistence rule)
- Result diffing between two runs in the same session
- Second-stage aggregation (e.g. local KQL-like or SQL pipeline over merged results) if group-by proves insufficient
- Query pack marketplace index (a curated GitHub repo listing sources)
