# 07 — Extensions

## Goals

- Extensions are written in TypeScript/JavaScript only.
- Extensions can add:
  - commands (plus menus and keybindings)
  - sidebar views / panels
  - result renderers / visualisations
  - entity enrichers
  - new data sources
  - themes
  - settings
- **Sandboxed by default.** An extension can do nothing outside its sandbox without a permission grant. Grants are asked **per query run by default**, and can be upgraded to session or **always**.
- The extension API should feel familiar to VS Code extension authors (`package.json` with `contributes`, `activate(context)`, disposables) without claiming compatibility.

## Package format

An extension is a folder or a `.rkqlx` file (zip) with:

```
package.json            manifest (see below)
dist/extension.js       worker entry (ESM, bundled, no imports at runtime)
dist/ui/<view>.html     optional UI entries for panels/renderers (+ bundled js/css)
themes/*.json           optional VS Code-format colour themes
README.md, CHANGELOG.md, LICENSE, icon.png (128×128)
```

`package.json`:

```jsonc
{
  "name": "virustotal-enricher",
  "publisher": "raml",                      // id = publisher.name
  "displayName": "VirusTotal Enricher",
  "version": "1.2.0",
  "description": "Look up IPs, domains and hashes on VirusTotal",
  "license": "MIT",
  "repository": "https://github.com/raml/raml-kql-virustotal",
  "engines": { "raml-kql": "^1.0.0" },     // host API semver range
  "main": "dist/extension.js",
  "activationEvents": ["onCommand:virustotal.lookup", "onEnricher:virustotal"],
  "permissions": [
    { "id": "network", "hosts": ["www.virustotal.com"], "reason": "Query the VirusTotal API" },
    { "id": "results.readSelection", "reason": "Read the values you choose to enrich" },
    { "id": "secrets", "reason": "Store your VirusTotal API key" }
  ],
  "contributes": {
    "commands": [{ "command": "virustotal.lookup", "title": "Look up on VirusTotal", "category": "VirusTotal" }],
    "menus": { "results/cell/context": [{ "command": "virustotal.lookup", "when": "cellEntityType =~ /ip|domain|hash/" }] },
    "keybindings": [],
    "enrichers": [{ "id": "virustotal", "entityTypes": ["ip", "domain", "url", "sha256", "sha1", "md5"], "title": "VirusTotal" }],
    "views": { "sidebar": [{ "id": "virustotal.recent", "name": "VirusTotal", "icon": "$(shield)", "ui": "dist/ui/recent.html" }] },
    "resultRenderers": [],
    "dataSources": [],
    "themes": [],
    "configuration": { "properties": { "virustotal.maxLookupsPerRun": { "type": "number", "default": 25 } } }
  }
}
```

The manifest is validated with the zod schema from `packages/pack-schema` (shared with packs). Invalid manifests don't install and show readable errors.

## Runtime architecture

- **Worker code** (`main`) runs in a dedicated Web Worker inside the hidden extension-host renderer (spec 01):
  - CSP `default-src 'none'; script-src 'self' blob:`, so there is no network, no DOM, no Node and no `eval`.
  - Communication is only via a `MessagePort` to the main process `ExtensionManager`.
  - The `@raml-kql/extension-api` runtime shim wraps this into the `ramlKql` API object.
- **UI code** (views, result renderers) runs in `<iframe sandbox="allow-scripts">` inside the workbench:
  - loaded from a custom protocol `rkql-ext://<extId>/...` registered in main, serving only that extension's files
  - CSP with no network
  - host theme CSS variables are injected so extension UI matches the theme
  - communicates with its own worker only via host-relayed `postMessage` (the `ramlKql.webview` channel)
- **Themes** are data only (JSON) and need no sandbox or permissions.
- **Activation** is lazy, on `activationEvents`. Deactivate on disable/uninstall (dispose everything).
- **Resource limits** per extension: an activation timeout of 10 s, and a message rate limit. A worker that is unresponsive for more than 5 s gets a "restart extension" prompt.
- Crashes of an extension never crash the app. Errors appear in an "Extension Host" output channel.

## Host API (v1), `@raml-kql/extension-api`

```ts
export function activate(context: ExtensionContext): void | Promise<void>;

namespace ramlKql {
  commands.registerCommand(id, handler): Disposable;
  commands.executeCommand(id, ...args);           // only own commands + a public allowlist of host commands
  window.showInformationMessage / showWarningMessage / showErrorMessage(msg, ...actions);
  window.showQuickPick(items, opts); window.showInputBox(opts);
  window.withProgress(opts, task);
  views.registerWebviewView(viewId, provider);    // sidebar/panel UI
  results.registerRenderer(id, provider);         // custom visualisation of a result table
  results.getActive(): ResultHandle | undefined;  // permission-gated reads (see below)
  enrichment.registerProvider(id, provider);      // provider.enrich(entities[], token) → EnrichmentResult[]
  dataSources.register(id, dataSource);           // implements DataSource (spec 01), auth via ramlKql.auth
  auth.getToken(resource: string): Promise<string>; // permission "auth:<resource>"; tokens for the principal of the current target only
  net.fetch(url, init): Promise<Response>;        // permission "network" with host allowlist
  secrets.get/set/delete(key);                    // OS-encrypted (safeStorage), per extension
  storage.get/set (global + workspace-agnostic KV, per extension, JSON, 5 MB cap; never result data by policy, documented)
  editor.getActiveQuery(): string; editor.insertText(text); editor.openQueryTab({ query, targets?, timespan? });
  query.run({ query, targets?, timespan? }): Promise<RunHandle>; // permission "query.run" — high risk
  targets.list(): TargetInfo[];                   // aliased names unless "tenants.realNames"
  configuration.get(key); onDidChangeConfiguration;
  clipboard.writeText(text);                      // permission "clipboard.write"
  env.appVersion; env.theme; env.presentationMode;
}
```

- Every call is async over the port. The host validates arguments with zod and checks permissions **in main**, never in the worker.
- Entity types are shared enums: `ip`, `domain`, `url`, `md5`, `sha1`, `sha256`, `upn`, `email`, `hostname`, `deviceId`, `aadObjectId`, `tenantId`.
  - Detection is by known column names (`IPAddress`, `RemoteIP`, `SHA256`, `UserPrincipalName`, `DeviceName`, `Url`, …) plus value validation (regex/`net.isIP`).
  - Detection lives in the host and is exposed via context keys (`cellEntityType`).

## Permissions

| Permission | Grants | Risk |
|---|---|---|
| `network` (hosts list) | `net.fetch` to listed hosts only (exact host or `*.example.com`) | high |
| `results.readSelection` | read the cells/rows the user explicitly selected or right-clicked | medium |
| `results.read` | read the full active result tables | high |
| `query.run` | run KQL against targets | high |
| `auth:<resource>` | get tokens for a resource (data source extensions) | high |
| `tenants.realNames` | see real tenant/workspace names | medium |
| `clipboard.write` | write clipboard | low |
| `secrets` | per-extension secret storage | low |
| `notifications` | show notifications (granted by default) | low |

**Grant model:**

- Declared permissions are shown at install time. Installing does **not** grant high or medium permissions; they are requested at use time.
- **Scope of a grant:**
  - `run`: valid for the current query run only; this is the default.
  - `session`: until the app quits.
  - `always`: persisted in `permissions.jsonc`.
- **A "query run"** is the lifecycle of one executed query's results. When the user enriches values from run R, a `network` + `results.readSelection` prompt appears once for run R. A new run means a new prompt, unless the grant is `session` or `always`.
- **Prompt:** a modal like VS Code's trust dialog. It states specifically what will happen, for example "**VirusTotal Enricher** wants to send **14 values** (IP addresses) from this result to **www.virustotal.com**", and shows the extension's `reason`.
  - Buttons: `Allow for this run` (default focus) · `Allow for this session` · `Always allow` · `Deny`.
  - The high-risk icon is shown for high-risk permissions.
  - When aliasing is active, the prompt adds: "Presentation mode is on — values are real, not aliased, when sent."
- **Settings → Extensions → Permissions:** a list per extension with scope and date, and revoke buttons. Revocations and grants go to the audit log.
- **On update:** if the new version adds permissions, persisted grants for new permissions are not carried over, and the user sees a diff before the update applies.
- Setting `extensions.permissions.defaultScope` (`"run"` default) lets the user change the default button.

## Distribution: sources, install, update

- **Install from git URL:**
  - The user pastes a repo URL (GitHub, GitLab, any HTTPS git).
  - The host lists tags (`vX.Y.Z`) via isomorphic-git `getRemoteInfo`/`listServerRefs`.
  - It installs the newest compatible version: first choice is a GitHub/GitLab **release asset** `*.rkqlx` for that tag (via the provider REST API, unauthenticated, rate-limit aware); fallback is a shallow clone of the tag expecting a prebuilt `dist/` directory.
  - It validates the manifest and `engines`, shows a details page (README, permissions, repository, version) → Install.
- **Install from file:** `.rkqlx` via the "Extensions: Install from File…" command or drag and drop.
- **Pinning and integrity:**
  - Record the source URL, tag, commit SHA and the SHA-256 of the installed package in `extensions.jsonc`.
  - The update check (daily, and on command) shows available updates with changelog and permission diff. Updates are never automatic unless `extensions.autoUpdate` is `true` (default `false`).
- **Unverified warning:** all third-party extensions show "Not verified by Raml KQL — only install extensions you trust" on first install. There is no verified-publisher program yet; keep a `verified` field in the model for later.
- **Storage:** installed extensions live in `<config>/extensions/<publisher.name>-<version>/`. Only the installed set is recorded in `extensions.jsonc`, so a shared dotfile config reinstalls the same set on another machine (after confirmation).

## Developer experience

`packages/extension-cli` (`raml-kql-ext`):

- `init` scaffolds a TS extension with esbuild and example code for each contribution type.
- `validate` checks the manifest and bundle constraints.
- `package` builds the `.rkqlx` zip.
- `dev` watches, and hot reloads into a running app started with `--extensionDevelopmentPath=<dir>`, which enables an "Extension Development" badge and relaxed install checks for that path only.

Also:

- Publish the `@raml-kql/extension-api` types to npm when the repo goes public. Until then, build them locally and document how.
- Write an author guide: `docs/guides/writing-extensions.md`.

## Example extensions (ship in `examples/extensions/`)

1. **virustotal-enricher**: IP, domain and hash lookups. Needs the VirusTotal API key via `secrets`. Adds result columns "VT malicious/total" as an enrichment overlay (a derived view, not modifying the source data).
2. **country-map-renderer**: a result renderer that aggregates an IP-geo or country column into a choropleth using a bundled low-res world GeoJSON (no remote tiles, so it needs no network permission).
3. **raml-dark-theme**: a theme-only extension (Raml brand colours), to prove the theme contribution.
