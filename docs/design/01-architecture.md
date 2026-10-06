---
title: Architecture
description: Processes, IPC, security hardening, the technology stack and the data flow.
---

# Architecture

## Process model

```
┌──────────────────────────── MAIN PROCESS (Node) ─────────────────────────────┐
│ AuthService (MSAL, multi-account)      ConfigService (config dir, watchers)  │
│ AzureClients (ARG, ARM, LA Query)      AuditLog (hash-chained JSONL)         │
│ DiscoveryService                       SourceService (isomorphic-git)        │
│ SchemaService (metadata cache)         ExtensionManager + PermissionBroker   │
│ QueryEngine (fan-out, limits, retry)   Updater (electron-updater)            │
│ ResultStore (encrypted session cache)  CrashHandler                          │
└──────────────┬───────────────────────────────────┬───────────────────────────┘
               │ typed IPC (zod) via preload        │ MessagePorts (brokered)
┌──────────────▼───────────────┐      ┌─────────────▼────────────────────────────┐
│ WORKBENCH RENDERER (sandbox) │      │ EXTENSION HOST RENDERER (sandbox, hidden)│
│ React + Zustand              │      │ one Web Worker per extension             │
│ Monaco + monaco-kusto        │      │ CSP: default-src 'none'; no network      │
│ AG Grid, ECharts             │      │ talks only to host API via MessagePort   │
│ extension UI in sandboxed    │      └──────────────────────────────────────────┘
│ <iframe>s (webview-like)     │
└──────────────────────────────┘
```

- **Main process** owns every secret, every network call to Azure, every file write, and every permission decision.
- **The workbench renderer** is pure UI. It never sees access tokens.
- **The extension host** is a separate hidden `BrowserWindow` with `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, and a CSP that blocks all network (`connect-src 'none'`). Each extension runs in its own Web Worker there. Extension UI (panels, result renderers) renders in sandboxed iframes inside the workbench (`sandbox="allow-scripts"`, no `allow-same-origin`), fed via `postMessage`. This mirrors VS Code's webview model.

## IPC

- Contracts live in `apps/desktop/src/shared/ipc/`. Each channel has a zod request schema, a zod response schema, and a name.
- Preload exposes a single typed object `window.ramlKql` generated from the contracts. The renderer never calls `ipcRenderer` directly.
- Main validates every inbound payload and checks `event.senderFrame` origin. Unknown senders are rejected.
- Streaming (query progress, per-workspace results) uses a `MessagePort` pair per query run instead of many IPC events.
- Large results are transferred in **columnar chunks** (`{ columns: Column[], chunks: ArrayBuffer | typed arrays }`), marked as transferable. Do not serialize 500k rows as JSON objects over IPC.

## Electron hardening

Apply all of these and add a test asserting the `webPreferences` of every window:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `allowRunningInsecureContent: false`.
- Strict CSP on every HTML entry, with no `unsafe-eval`. Monaco and monaco-kusto workers must be configured to work without eval. If a library forces eval, log it in DECISIONS and isolate it.
- `app.on('web-contents-created')`: deny `will-navigate` and `setWindowOpenHandler` for anything except explicitly allowed deep links, which open in the OS browser via `shell.openExternal` after URL allowlist validation (`https://portal.azure.com`, `https://security.microsoft.com`, `https://github.com`).
- `session.setPermissionRequestHandler` denies everything (camera, mic, geolocation, notifications via web API, etc.).
- Electron fuses: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `EnableCookieEncryption=true`.
- Single-instance lock (`app.requestSingleInstanceLock`).
- Never load remote content into the workbench.
- Linux: keep the Chromium sandbox working (correct `chrome-sandbox` permissions in deb/rpm; AppImage caveats documented). Never ship with `--no-sandbox`.

## Main-process modules

Each module is a class with an explicit interface, constructor-injected dependencies, and no hidden global state, so it is testable with fakes.

| Module | Responsibility |
|---|---|
| `ConfigService` | Resolve the config dir, load/validate/watch all config files, and emit changes (spec 09) |
| `AuthService` | Accounts, MSAL cache, `getToken(accountId, tenantId, resource)` (spec 02) |
| `AzureHttp` | Shared fetch wrapper: auth header, retry/backoff, throttling headers, request IDs, cancellation (`AbortSignal`), redacting logger |
| `DiscoveryService` | Tenants, subscriptions and workspaces per account; access paths (spec 03) |
| `SchemaService` | Workspace metadata fetch + cache + merge (spec 05) |
| `QueryEngine` | Fan-out execution (spec 04) |
| `ResultStore` | Encrypted in-memory/spill cache (spec 04) |
| `AuditLog` | Append-only hash-chained log (spec 04) |
| `SourceService` | Git and file sources for packs and extensions (specs 07, 08) |
| `ExtensionManager` / `PermissionBroker` | Spec 07 |
| `Updater` | Spec 11 |
| `CrashHandler` | Spec 10 |
| `DataSourceRegistry` | Built-in Log Analytics source plus extension-contributed sources, behind one interface |

### Data source abstraction

The query engine never talks to Log Analytics directly. It talks to a `DataSource`:

```ts
interface DataSource {
  id: string;                          // "builtin.loganalytics"
  displayName: string;
  discoverTargets(ctx): Promise<Target[]>;           // workspaces, clusters, ...
  getSchema(target, ctx): Promise<Schema>;
  execute(target, request: QueryRequest, ctx): Promise<QueryResultStream>;
  deepLink?(target, request): string | undefined;
  limits: { maxConcurrentPerPrincipal: number; requestsPer30s?: number; maxRows?: number; maxBytes?: number };
}
```

The built-in Log Analytics source implements this, registered in a `DataSourceRegistry` like any other (D-049). Extension data sources implement the same interface through the extension API (spec 07). Targets carry the `dataSourceId`.

## Renderer architecture

- React function components; Zustand stores per domain (`layout`, `tabs`, `targets`, `results`, `settings`, `accounts`, `extensions`).
- A **service layer** in the renderer wraps `window.ramlKql` so components never call IPC directly.
- Commands follow VS Code's model: a central registry of `{ id, title, category, handler, when }` plus a `when`-clause context key service (simplified VS Code semantics: `editorFocus`, `resultsFocus`, `queryRunning`, `presentationMode`, ...). Menus, keybindings, the palette and extensions all reference command IDs.

## Folder conventions

- `src/main/<module>/index.ts` exports the module; tests sit next to the code as `*.test.ts`.
- `src/renderer/workbench/<part>/` for layout parts (activitybar, sidebar, editor, panel, statusbar, titlebar).
- `src/renderer/features/<feature>/` for feature UIs (targets, results, history, library, accounts, settings, extensions).
- No barrel files that create import cycles; add an eslint rule for cycles (`import/no-cycle`).

## Error model

- All errors crossing boundaries are `AppError { code, message, detail?, retryable, source }`. Codes are stable strings (`AUTH_INTERACTION_REQUIRED`, `LA_THROTTLED`, `LA_SEMANTIC_ERROR`, `LA_PARTIAL`, `NET_OFFLINE`, ...).
- Users see short messages. Details are expandable, and a "Copy details" action copies a redacted version.

## Logging

- Structured app log in the OS log dir (rotated, 7 days), for debugging only.
- **Redaction is mandatory:**
  - Never log tokens or result values.
  - Log query text only at debug level.
  - Hash tenant and workspace IDs in logs unless `log.level` is `debug`.
- "Open Logs Folder" command.
