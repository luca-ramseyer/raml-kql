# Raml KQL

Raml KQL is an open-source, cross-platform desktop app (macOS, Windows, Linux) for running one KQL query against many Azure Log Analytics workspaces at once, across many Entra tenants and many signed-in accounts. It returns one merged result with tenant and workspace attribution on every row.

It exists for analysts who work across multiple customer tenants but have no Microsoft Defender multi-tenant organization (MTO) / multi-tenant advanced hunting. It is a tool in the analyst's toolbelt. It must look and feel like VS Code so it feels familiar from the first second.

The project owner is Luca (security analyst, not a full-time software engineer). The project is long-lived and will be maintained and eventually opened to outside contributors. Optimise for **correctness, security, maintainability and clarity** over cleverness.

---

## How to work on this repo (read first)

You are building this project **autonomously, end to end**. Follow these rules:

1. **Build order:** follow `docs/spec/00-roadmap.md` phase by phase. Do not start a phase before the previous phase's acceptance criteria pass. When a phase is done, tick its checkboxes in the roadmap file and commit.
2. **Read the relevant spec before you build a feature.** The specs in `docs/spec/` are the source of truth. This file only holds the rules that apply everywhere.
3. **Record decisions.** Whenever you pick between real alternatives (library, data format, API shape), or deviate from a spec because reality differs, append an entry to `docs/DECISIONS.md` (ADR-lite: context, decision, consequences). Update the spec if the deviation is permanent.
4. **Blocked by something only Luca can provide?** Examples: an Entra client ID, Apple/Windows signing credentials, GitHub secrets. Do not stop. Stub it behind an env var or config value, add an item to `docs/HUMAN-TODO.md` explaining exactly what he must do and where, and continue.
5. **Verify external APIs against current docs.** Azure REST APIs, MSAL, Electron and npm packages change. If a package name, API version or limit in these specs looks outdated, check the official docs or npm, use the current correct one, and log it in `DECISIONS.md`.
6. **Quality gates must be green before every commit that finishes a task:** `pnpm lint && pnpm typecheck && pnpm test`. Run `pnpm test:e2e` at the end of every phase.
7. **Commits:** small and logical, using Conventional Commits (`feat(query): …`, `fix(auth): …`, `chore(ci): …`, `docs: …`, `test: …`). This drives automated changelogs and versioning later.
8. **Never commit secrets, tokens, tenant IDs, real customer names or real query results.** Test fixtures use obviously fake data (Contoso, Fabrikam, Woodgrove, GUIDs starting with `00000000-`). The repo will become public; its history must be clean.
9. **Demo mode is a first-class feature.** Every feature must work in demo mode (fake accounts, tenants, workspaces and query results; no network). e2e tests, screenshots and development without Azure access all depend on it. See `docs/spec/04-query-execution.md#demo-mode`.

---

## Tech stack (summary; details in `docs/spec/01-architecture.md`)

- **Electron** (latest stable) + **electron-vite** + **React 18+** + **TypeScript (strict)**. Nextron is *not* used.
- **pnpm** workspaces monorepo.
- **Monaco Editor** + **@kusto/monaco-kusto** for KQL language service and schema-aware IntelliSense.
- **@azure/msal-node** + **@azure/msal-node-extensions** for multi-account auth with an OS-encrypted token cache.
- Azure REST: Azure Resource Graph (discovery), ARM, Log Analytics Query API (`api.loganalytics.io`). Use the official Azure SDK packages where they fit; thin typed `fetch` clients where they don't.
- **AG Grid Community** for results, **Apache ECharts** for charts, **exceljs** for XLSX export.
- **Zustand** for renderer state, **zod** for every schema at every boundary (IPC, config files, manifests, API responses).
- **isomorphic-git** for git-based query pack and extension sources (no system git dependency).
- **@vscode/codicons** for icons.
- Tests: **Vitest**, **@testing-library/react**, **Playwright** (Electron mode).
- Packaging: **electron-builder** + **electron-updater** (GitHub Releases).

---

## Non-negotiable principles

- **Security first.** The app handles tokens and customer security data.
  - Renderer runs with `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`, under a strict CSP.
  - All Azure calls, tokens and file IO live in the main process.
  - Every IPC message is validated with zod on both sides.
  - Follow `docs/spec/01-architecture.md#electron-hardening` exactly.
- **Results are never persisted.** Query results live only in memory, or in an encrypted session cache whose key exists only in memory. The cache is destroyed on quit and wiped on next start if the app crashed. Query *text* (tabs, history, saved queries) is persisted; result *data* is not. See `docs/spec/04-query-execution.md`.
- **No telemetry.** No analytics, usage pings or phone-home of any kind. The only outbound traffic is:
  - Microsoft identity and Azure endpoints the user queries.
  - Git hosts for sources the user added.
  - The GitHub Releases update check, which can be disabled.
  - Network calls by extensions the user explicitly granted.
- **Least privilege for extensions.** Extensions run sandboxed, with no Node or DOM access to the workbench. Everything goes through a permission-checked host API. See `docs/spec/07-extensions.md`.
- **Privacy on screen.** Tenant, subscription and workspace names are aliased by default. See `docs/spec/03-workspaces-discovery.md#aliasing--presentation-privacy`.
- **The VS Code look is a feature.** Match VS Code's "Dark Modern" / "Light Modern" themes, layout, spacing, fonts, icons, keyboard shortcuts and interaction patterns as closely as possible. When unsure how something should behave, do what VS Code does. See `docs/spec/05-workbench-ui.md`.
- **Do not use Microsoft or VS Code trademarks or logos** in the app name, icon or branding. Codicons are fine (CC BY 4.0, attribute in `THIRD_PARTY_NOTICES.md`). VS Code theme colour values are fine (MIT).

---

## KQL conventions (applies to all sample queries, fixtures, docs and query packs)

- This app targets **Log Analytics**. The time column is **`TimeGenerated`**. Never write `Timestamp` in samples, tests or packs, even for Defender tables ingested into Sentinel.
- Sample queries must be valid KQL, parse cleanly with the Kusto language service, and be read-only (KQL is read-only by nature; never generate management `.` commands).

---

## Repo layout

```
apps/desktop/                 Electron app (main, preload, renderer)
  src/main/                   main process: auth, azure, query engine, cache, audit, registry, extension host mgmt, updater
  src/preload/                typed contextBridge API
  src/renderer/               React workbench (VS Code look)
  src/shared/                 IPC contracts (zod), shared types
packages/extension-api/       public TS types + runtime shim for extension authors (@raml-kql/extension-api)
packages/pack-schema/         zod + generated JSON Schema for query packs and manifests
packages/extension-cli/       `raml-kql-ext` CLI: scaffold, validate, package (.rkqlx)
examples/extensions/          example extensions (enrichment, result renderer, theme)
examples/packs/               example query pack
docs/spec/                    specs (source of truth)
docs/guides/                  human guides (app registration, testing/CI explained, config dotfiles)
docs/DECISIONS.md             decision log
docs/HUMAN-TODO.md            things only Luca can do
```

## Commands (create these in phase 0 and keep them working)

```
pnpm dev            # run app in dev mode
pnpm dev:demo       # run app in demo mode (no Azure)
pnpm lint           # eslint + prettier check
pnpm format         # prettier write
pnpm typecheck      # tsc --noEmit across workspaces
pnpm test           # vitest (unit + integration)
pnpm test:e2e       # playwright against built app in demo mode
pnpm build          # production build
pnpm dist           # package installers for current OS
```

## Spec index

| File | Covers |
|---|---|
| `docs/spec/00-roadmap.md` | Phases, acceptance criteria, progress |
| `docs/spec/01-architecture.md` | Processes, IPC, security hardening, stack, data flow |
| `docs/spec/02-accounts-auth.md` | Multi-account, multi-tenant auth with MSAL |
| `docs/spec/03-workspaces-discovery.md` | Discovery, workspace settings, enable/disable, tenant groups, aliasing |
| `docs/spec/04-query-execution.md` | Fan-out engine, limits, retries, partial failures, merge, encrypted cache, audit log, demo mode |
| `docs/spec/05-workbench-ui.md` | VS Code look, layout, editor, IntelliSense, tabs, history, palette, keybindings |
| `docs/spec/06-results.md` | Grid, multi-table results, group-by, charts, export, deep links |
| `docs/spec/07-extensions.md` | Extension model, sandbox, API, permissions, distribution |
| `docs/spec/08-query-packs.md` | Pack format, parameters, git sources, file import |
| `docs/spec/09-config-dotfiles.md` | Config directory, settings.jsonc, all files and keys |
| `docs/spec/10-privacy-crash-reporting.md` | Privacy stance, crash reporting |
| `docs/spec/11-quality-ci-release.md` | Testing strategy, CI, signing, auto-update, release |
