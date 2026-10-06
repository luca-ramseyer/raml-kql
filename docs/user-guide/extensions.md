---
title: Using extensions
description: Install extensions, understand the permissions they ask for, and keep control of what they can do.
---

# Using extensions

Extensions add features to Raml KQL: commands, result **enrichers** (look up an IP or file hash on a threat intelligence service), result **renderers** (for example a world map), sidebar views and colour themes. Open the **Extensions** view with <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>.

## Installing

- **Extensions: Install from File…** installs a `.rkqlx` package.
- **Extensions: Install from Git URL…** installs from a repository's release (or a tagged build).
- **Extensions: Check for Extension Updates** shows available updates. They are never installed automatically (`extensions.autoUpdate` is off by default), and an update that asks for more permissions shows you the difference first.

Extensions from outside the project are marked **Not verified by Raml KQL**. Only install extensions from authors you trust. You can enable, disable and uninstall each one in the Extensions view.

Two example extensions live in the [source repository](https://github.com/luca-ramseyer/raml-kql/tree/main/examples/extensions): a VirusTotal enricher and a Country Map renderer. Build them with `pnpm build:examples` and install the resulting `.rkqlx` files.

## What an extension can do

Extensions run in a **sandbox**: their code lives in a hidden worker with no network, no file access and no access to the workbench. The only way out is the host API, and every call is checked in the main process. An extension declares the permissions it needs, with a reason, in its manifest. The Extensions view lists them, and **you decide**:

- Reading results (the values you selected, or whole results) and network access to named hosts are **asked each time**: when you use the extension, a prompt shows the extension, the permission, the reason and the hosts. Choose **Allow for this run** (the default), **Allow for this session**, **Always allow**, or **Deny**. `extensions.permissions.defaultScope` sets the default button.
- Extensions never see real customer names while presentation mode is on, unless you grant the real-names permission.
- Grants can be reviewed and revoked at any time in the Extensions view.

Grants, installs and revocations are written to the [audit log](privacy-and-security.md#the-audit-log). To write your own extension, see [Writing extensions](../guides/writing-extensions.md).
