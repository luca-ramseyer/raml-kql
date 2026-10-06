---
title: Architecture overview
description: A short map of the code for contributors: processes, where things live, and the rules that shape the design.
---

# Architecture overview

This is the short version, enough to find your way around. The detailed design is in the [design documents](../design/index.md), starting with [Architecture](../design/01-architecture.md).

## Three kinds of process

- **The main process** (Node.js) owns everything sensitive: access tokens, every network call to Azure, every file write, the query engine, the encrypted result cache and every permission decision.
- **The workbench** is the window you see: a React app (Monaco editor, AG Grid, ECharts) in a sandboxed renderer with no Node.js access. It never sees a token. It talks to the main process only through a typed, validated IPC API.
- **The extension host** is a separate hidden window that runs each extension in its own Web Worker, with no network and no DOM access to the workbench. Extensions can only call a permission-checked host API.

## Repository layout

```
apps/desktop/
  src/main/        main process: auth, azure clients, discovery, query engine, result store, audit log,
                   sources, extensions, updater, crash handling
  src/preload/     the typed contextBridge API generated from the IPC contracts
  src/renderer/    the workbench (React, Zustand): features/ per area, workbench/ for the VS Code-like shell
  src/shared/      IPC contracts (zod), shared types and schemas used on both sides
  e2e/             Playwright tests that drive the built app in demo mode
packages/
  extension-api/   @raml-kql/extension-api: types and runtime shim for extension authors
  extension-cli/   @raml-kql/extension-cli: the raml-kql-ext command
  pack-schema/     zod schemas and generated JSON Schema for query packs and extension manifests
examples/          example extensions and an example query pack
docs/              this documentation
```

## Rules that shape the code

1. **Security first.** The renderer is sandboxed with a strict content security policy; main validates every IPC message with zod, and the renderer validates every response. Electron fuses are set at packaging time.
2. **Results are never persisted.** Query results live in memory or in an encrypted session cache whose key exists only in memory. Query _text_ is persisted; result _data_ is not.
3. **No telemetry.** The only outbound traffic is listed in [Privacy and security](../user-guide/privacy-and-security.md).
4. **Everything is validated at boundaries** with zod: IPC, config files, manifests and API responses.
5. **Demo mode is a first-class feature.** Every feature works against fake accounts, tenants, workspaces and data, with no network. The end-to-end tests, screenshots and most development use it (`pnpm dev:demo`).
6. **Looks and behaves like VS Code.** When unsure how something should behave, do what VS Code does.

## Where to read next

- [Testing and CI](testing-and-ci.md) for how changes are checked.
- [Releasing](releasing.md) for how a release is built and published.
- The [decision log](../design/decisions.md) for why things are the way they are.
- [CONTRIBUTING.md](https://github.com/luca-ramseyer/raml-kql/blob/main/CONTRIBUTING.md) for the contribution workflow.
