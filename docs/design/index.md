---
title: Design documents
description: The detailed design specifications of Raml KQL and the log of design decisions.
---

# Design documents

These documents describe how Raml KQL is designed and why. They are written for contributors and curious readers. For using the app, start with the [user guide](../index.md) instead.

The specifications describe the intended design. Where reality turned out differently, the [decision log](decisions.md) records the change and the reason, and the specification is updated when the change is permanent.

| Document | Covers |
| --- | --- |
| [Architecture](01-architecture.md) | Processes, IPC, security hardening, the stack, data flow |
| [Accounts and authentication](02-accounts-auth.md) | Multi-account, multi-tenant sign-in with MSAL |
| [Discovery, workspaces and aliasing](03-workspaces-discovery.md) | Discovery, access paths, tenant groups, presentation privacy |
| [Query execution](04-query-execution.md) | Fan-out engine, limits, retries, merging, the encrypted cache, the audit log, demo mode |
| [Workbench, editor and IntelliSense](05-workbench-ui.md) | The VS Code look, layout, editor, schema-aware IntelliSense, tabs, history |
| [Results](06-results.md) | Grid, group-by, charts, export, deep links |
| [Extensions](07-extensions.md) | The extension model, sandbox, permissions, API, distribution |
| [Query packs](08-query-packs.md) | Pack format, parameters, git sources, import |
| [Configuration directory](09-config-dotfiles.md) | Config folder, files, merge rules, the settings registry |
| [Privacy and crash reporting](10-privacy-crash-reporting.md) | The privacy stance and crash reports |
| [Quality, CI, signing and release](11-quality-ci-release.md) | Testing strategy, CI, signing, auto-update |
| [Decision log](decisions.md) | Decisions with context and consequences |

Proposing a change to the design? Open an issue first. See the [contributing guide](https://github.com/luca-ramseyer/raml-kql/blob/main/CONTRIBUTING.md).
