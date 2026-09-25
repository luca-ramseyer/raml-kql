# Writing extensions

Raml KQL extensions add commands, result enrichers, result renderers, sidebar views, colour
themes and settings. They are written in TypeScript or JavaScript. The model will feel
familiar if you know VS Code extensions (`package.json` with `contributes`,
`activate(context)`, disposables), but the APIs are not compatible.

Three complete examples live in [`examples/extensions/`](../../examples/extensions):

| Example                | Shows                                                          |
| ---------------------- | -------------------------------------------------------------- |
| `virustotal-enricher`  | An enricher, `net.fetch`, `secrets`, settings, commands        |
| `country-map-renderer` | A result renderer (sandboxed UI, bundled data, `results.read`) |
| `raml-dark-theme`      | A theme-only extension (no code, no permissions)               |

Build them with `pnpm build:examples`. The `.rkqlx` files land in `examples/extensions/dist/`.

## The sandbox

Extensions run with less power than a web page:

- **Code** (`main`) runs in its own Web Worker inside a hidden window that has **no network**.
  Its session blocks every request and its CSP sets `connect-src 'none'`. There is no DOM and
  no Node.js. `fetch`, `XMLHttpRequest` and `WebSocket` are removed. The only way out is the
  `ramlKql` API, and the app checks every call in its main process.
- **UI** (views, result renderers) runs in an `<iframe sandbox="allow-scripts">`, loaded from
  `rkql-ext://<publisher.name>/…`. It also has no network (`connect-src 'none'`) and can only
  load the extension's own files. It talks to the workbench with `postMessage`. **Build UI
  scripts as classic scripts** (e.g. esbuild `--format=iife`) and load them with
  `<script defer src="…">`. The frame has an opaque origin, so module scripts would need
  CORS.
- **Themes** are data only.

## Permissions

Declare what you need in `package.json`. Declaring doesn't grant medium- or high-risk
permissions: the user is asked the first time they're used, **once per query run by
default**, with "for this session" and "always" as options. Anything undeclared is refused
without asking.

| Permission              | Allows                                                                                   | Risk   |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `network` + `hosts`     | `ramlKql.net.fetch` to those hosts only (`api.example.com`, `*.example.com`), https only | high   |
| `results.readSelection` | the values the user chose (enrichment, a right-clicked cell)                             | medium |
| `results.read`          | the full active result (result renderers)                                                | high   |
| `clipboard.write`       | `ramlKql.clipboard.writeText`                                                            | low    |
| `secrets`               | per-extension secret storage in the OS keychain                                          | low    |
| `notifications`         | messages (always granted)                                                                | low    |

```jsonc
"permissions": [
  { "id": "network", "hosts": ["www.virustotal.com"], "reason": "Query the VirusTotal API" },
  { "id": "results.readSelection", "reason": "Read the values you choose to enrich" }
]
```

The `reason` is shown in the prompt. Keep it short and specific.

## Getting started

```bash
npx raml-kql-ext init my-extension --publisher contoso
cd my-extension
npm install
npm run build                 # esbuild bundles src/extension.ts into dist/extension.js
npx raml-kql-ext validate     # the same checks the app runs when installing
npx raml-kql-ext package      # builds contoso.my-extension-0.1.0.rkqlx
```

Install the `.rkqlx` with **Extensions: Install from File…**. To publish, tag a release
`v1.2.0` in a git repository and attach the `.rkqlx` as a release asset (GitHub or GitLab).
Users can then use **Extensions: Install from Git URL…**, and updates show up in the
Extensions view. A tag with a committed, built `dist/` also works.

`main` must be **one bundled ES module** without runtime imports. The worker loads it from a
blob, so it can't import anything.

## The API

```ts
import { ramlKql, type ExtensionContext } from '@raml-kql/extension-api';

export function activate(context: ExtensionContext) {
  context.subscriptions.push(
    ramlKql.commands.registerCommand('hello.world', async () => {
      const name = await ramlKql.window.showInputBox({ prompt: 'Your name' });
      await ramlKql.window.showInformationMessage(`Hello ${name ?? 'there'}!`);
    }),
  );
}
```

Activation is lazy, on `activationEvents` (`onCommand:`, `onEnricher:`, `onView:`,
`onStartupFinished`, `*`). Everything in `context.subscriptions` is disposed when the
extension is disabled, updated or uninstalled. Every call is async and has limits: an
activation timeout of 10 seconds, and a rate limit on API calls.

| Namespace       | What                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `commands`      | `registerCommand` (only commands in `contributes.commands`), `executeCommand` (your own, plus a small allowlist of app commands)           |
| `window`        | `showInformationMessage` / `Warning` / `Error` (with actions), `showQuickPick`, `showInputBox` (`password: true` for keys), `withProgress` |
| `enrichment`    | `registerProvider(id, { enrich(entities, token) })` returning fields per entity; shown as extra result columns                             |
| `views`         | `registerWebviewView(viewId, provider)`: message your sidebar view's UI                                                                    |
| `net`           | `fetch(url, init)` (permission `network`; redirects are returned, not followed)                                                            |
| `secrets`       | `get` / `set` / `delete` (OS keychain)                                                                                                     |
| `storage`       | `get` / `set` JSON, 5 MB per extension. Never store result data.                                                                           |
| `configuration` | `get(key)` for your `contributes.configuration` settings (from settings.jsonc); `onDidChangeConfiguration`                                 |
| `editor`        | `getActiveQuery`, `insertText`, `openQueryTab`                                                                                             |
| `clipboard`     | `writeText` (permission `clipboard.write`)                                                                                                 |
| `env`           | `appVersion`, `apiVersion`, `theme`, `presentationMode`                                                                                    |

### Enrichers

Declare the entity types you handle:

```jsonc
"enrichers": [{ "id": "virustotal", "title": "VirusTotal", "entityTypes": ["ip", "sha256"] }]
```

The app detects entities in result cells by column name and value: `ip`, `domain`, `url`,
`md5`, `sha1`, `sha256`, `upn`, `email`, `hostname`, `deviceId`, `aadObjectId`, `tenantId`.
The user right-clicks a cell and chooses **Enrich Value** or **Enrich Column** (up to 100
distinct values). One prompt covers both reading the values and sending them to your hosts.
Return at most 20 short fields per entity. They appear as `Title: field` columns and are
never written back to the result.

### Result renderers and views

```jsonc
"resultRenderers": [{ "id": "countryMap.map", "title": "Country Map", "ui": "dist/ui/map.html" }],
"views": { "sidebar": [{ "id": "myExt.recent", "name": "Recent", "icon": "$(history)", "ui": "dist/ui/recent.html" }] }
```

A renderer gets a panel tab. After the user allows `results.read`, the frame receives
`{ type: 'theme', variables }` (the theme's `--vscode-*` colours) and then
`{ type: 'render', table: { name, columns, rows, truncated } }`, with up to 10,000 rows, using
the names on screen (aliased in presentation mode). A sidebar view gets the same `theme`
message, plus `{ type: 'message', message }` for what your worker posts. It sends messages
to the worker with `parent.postMessage(message, '*')`.

### Menus, keybindings and settings

```jsonc
"menus": {
  "results/cell/context": [{ "command": "myExt.lookup", "when": "cellEntityType =~ /ip|domain/" }],
  "commandPalette": [{ "command": "myExt.internal", "when": "false" }]
},
"keybindings": [{ "command": "myExt.lookup", "key": "ctrl+alt+l", "mac": "cmd+alt+l" }],
"configuration": { "properties": { "my-extension.limit": { "type": "integer", "default": 25 } } }
```

A command run from the result cell menu receives `{ value, column, entityType }` and needs
`results.readSelection`. Setting names must start with your extension's `name`.

## Themes

Point `contributes.themes` at VS Code colour theme files (`colors`, `tokenColors`). They
appear in **Preferences: Color Theme**.
