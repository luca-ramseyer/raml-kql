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

- [ ] Layout: title bar, activity bar, primary sidebar, editor area with tab strip, bottom panel, status bar (spec 05)
- [ ] Theme system using VS Code theme JSON format; ships Dark Modern, Light Modern, High Contrast; follows OS by default
- [ ] Command registry, command palette (`F1`, `Ctrl/Cmd+Shift+P`), quick open (`Ctrl/Cmd+P`)
- [ ] Keybinding service with defaults and a `keybindings.jsonc` override
- [ ] Settings service backed by `settings.jsonc`, a Settings UI (search, categories, "Edit in settings.jsonc"), and live reload on file change (spec 09)
- [ ] Resizable, collapsible sidebar and panel whose sizes persist; `Ctrl/Cmd+B` and `Ctrl/Cmd+J` toggle them
- [ ] Notifications (toast bottom-right like VS Code) and a status bar item API

**Acceptance:** side by side with VS Code, the shell is visually near-identical in both themes. e2e: open the palette, run the "Toggle Sidebar" command, change the theme via settings.

## Phase 2 — Accounts and authentication

- [ ] MSAL Node public client with persistent encrypted cache (spec 02)
- [ ] Add / remove / re-authenticate accounts (multiple accounts)
- [ ] Per-tenant token acquisition (home tenant + guest tenants), with interactive fallback on `interaction_required`
- [ ] Accounts view in the activity bar ("Accounts" icon at the bottom like VS Code) showing accounts, tenants and status
- [ ] Auth provider modes: built-in client ID, custom client ID, Azure CLI
- [ ] Demo auth provider

**Acceptance:** In demo mode, 2 fake accounts with 3 tenants are shown. Unit tests cover token routing logic. The manual live test is listed in HUMAN-TODO.

## Phase 3 — Discovery and workspace management

- [ ] Discovery via Azure Resource Graph per account (workspaces, subscriptions, tenants, Sentinel flag)
- [ ] Access-path dedupe when multiple accounts reach the same workspace
- [ ] Settings → Workspaces page: tree Account/Tenant/Subscription/Workspace, enable/disable, preferred access path, rename alias, refresh
- [ ] Tenant groups (static and dynamic), editable in the UI and config
- [ ] Aliasing and presentation privacy (master switch + quick toggle)
- [ ] "Targets" sidebar view in the KQL view showing only enabled workspaces, with checkboxes, search and groups

**Acceptance:** In demo mode, disabled workspaces disappear from Targets. Toggling aliasing updates every visible name instantly. Groups select correctly.

## Phase 4 — Editor and IntelliSense

- [ ] Monaco with KQL via monaco-kusto, workers wired for electron-vite
- [ ] Schema fetch per workspace, cached (metadata only), merged for the selected targets, with availability hints
- [ ] Time range picker with "Set in query" detection
- [ ] Format document, comment toggle, find/replace, multi-cursor (Monaco defaults), and KQL snippets

**Acceptance:** In demo mode, completions list tables and columns from the fake schema. Tables missing in some targets show "available in 3/5 workspaces".

## Phase 5 — Query engine

- [ ] Fan-out orchestrator with per-account concurrency, rate limiting, timeouts, retries and cancellation (spec 04)
- [ ] Pre-flight parse check (don't fan out syntactically broken queries)
- [ ] Merge with attribution columns; multiple result tables
- [ ] Per-workspace status panel and "Re-run failed"
- [ ] Encrypted session result cache with memory budget and spill-to-disk
- [ ] Audit log (hash-chained JSONL)

**Acceptance:** Engine integration tests against a fake Log Analytics server cover success, 429 with Retry-After, 5xx retry, timeout, partial error, cancellation and row-cap truncation. The cache is gone after quit (test). The audit log verifies (test).

## Phase 6 — Results

- [ ] AG Grid results with virtual scrolling, sort, filter, resize, reorder, pin, and copy (cell / row / selection as TSV)
- [ ] JSON/dynamic cell viewer, cell details side panel
- [ ] Group-by panel (client-side aggregation over merged results)
- [ ] Charts from the `render` operator and from a manual chart builder (ECharts)
- [ ] Export: CSV, JSON, XLSX, Markdown table, KQL `datatable`, copy as each
- [ ] Deep links: open query in Azure Portal Logs for a workspace; row-level links where columns allow

**Acceptance:** A 500k-row demo result scrolls smoothly. Each render type draws. Exports round-trip in tests.

## Phase 7 — Tabs, history, saved queries

- [ ] Query tabs persist across restarts (text, targets, time range, name) with results cleared
- [ ] Split editor groups (side-by-side tabs) like VS Code
- [ ] History view (searchable, re-open into a tab, no result data)
- [ ] "My Queries" saved as `.kql` files with front-matter in the config dir, plus an Explorer-like view

**Acceptance:** Restart restores tabs without results. History search works. Saved queries appear as files.

## Phase 8 — Query packs and git sources

- [ ] Pack format + zod schema + JSON Schema (spec 08)
- [ ] Add a source by git URL (clone with isomorphic-git, pinned to commit), update check, and update with diff
- [ ] Import from file (`.rkqlpack` zip, folder, single `.kql`)
- [ ] Query Library view: browse, search, filter by tag/MITRE/table, open query in new tab, parameter form
- [ ] Parameters injected as typed `let` statements (never string-concatenated into the body)

**Acceptance:** The example pack installs from a local bare git repo in tests, updates, and runs with parameters.

## Phase 9 — Extensions

- [ ] Extension host (sandboxed) + host API + permission broker (spec 07)
- [ ] Contribution points: commands, menus, keybindings, views/panels, result renderers, enrichers, data sources, themes, configuration
- [ ] Permission prompts (once / session / always), permissions management UI, revocation
- [ ] Install from git URL (release asset) or file (`.rkqlx`); enable/disable/uninstall; update with permission diff
- [ ] `packages/extension-api` and `packages/extension-cli` (scaffold, validate, package)
- [ ] Example extensions: VirusTotal IP/hash enricher, "Map" result renderer (no external tiles; country aggregation), a theme
- [ ] The built-in Log Analytics data source is implemented through the same data-source interface

**Acceptance:** An example extension can't reach the network without a grant (test). A permission prompt appears per query run by default. "Always allow" persists.

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
