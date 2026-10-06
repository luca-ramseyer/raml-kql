---
title: Configuration folder and files
description: Where Raml KQL keeps your settings and saved data, what each file is for, and how to share or version them.
---

# Configuration folder and files

All your configuration lives in **one folder of readable files**, so you can keep it in a dotfiles repository, share parts of it with your team, or back it up. Open it with **Preferences: Open Config Folder**.

## Location

In order of precedence:

1. The `--config-dir <path>` command-line option
2. The `RAML_KQL_CONFIG_DIR` environment variable
3. The default: `~/.raml-kql/` on macOS and Linux (`$XDG_CONFIG_HOME/raml-kql/` on Linux when that variable is set) and `%USERPROFILE%\.raml-kql\` on Windows

Sign-in tokens and the encrypted result cache are **not** in this folder. They live in the operating system's application data folder and are never meant to be shared. (`RAML_KQL_USER_DATA_DIR` moves that folder, like VS Code's `--user-data-dir`.)

## Files

```
~/.raml-kql/
  settings.jsonc      settings (VS Code-style keys), see the settings reference
  keybindings.jsonc   your keyboard shortcut changes, in VS Code's format
  workspaces.jsonc    enabled and disabled workspaces, aliases, tags, preferred access paths
  groups.jsonc        tenant and workspace groups
  accounts.jsonc      account labels and order (no tokens)
  sources.jsonc       query pack sources (URL, ref, pinned commit)
  extensions.jsonc    installed extensions and whether they are enabled
  permissions.jsonc   "always" permission grants for extensions
  queries/            My Queries (.kql files)
  themes/             your own colour themes (VS Code JSON format)
  state/              tabs, history, workspace inventory, schema cache, window layout
  sources/            cloned query pack repositories
  extensions/         installed extension files
  audit/              the audit log
```

Everything down to `themes/` is what you would want to share or keep in git. `state/`, `sources/`, `extensions/` and `audit/` are machine-local: Raml KQL writes a `.gitignore` in the folder that excludes them, plus a short `README.md`.

## File format

- The `*.jsonc` files are **JSON with comments** (and trailing commas are fine). Raml KQL preserves your comments and formatting when it changes a file.
- Every file is validated when it is loaded. A file with errors never crashes the app: you get a notification with the line number, and the last valid version stays in use until you fix it.
- Files are **watched**: edit them in any editor, or run `git pull` in a dotfiles repository, and the changes apply immediately.
- **No secrets.** Files only refer to secrets by an ID. Tokens, API keys and git credentials are stored encrypted by the operating system.
- Identifiers are tenant and resource IDs, not file paths, so a configuration works on another machine.

## Sharing a team configuration

`settings.jsonc`, `groups.jsonc` and `workspaces.jsonc` can include shared files with an `extends` key:

```jsonc
{
  "extends": ["./team/settings.jsonc"],
  // Your own values win over the shared ones:
  "time.displayZone": "local",
}
```

Only local file paths are allowed (relative or absolute), never URLs, and the files are applied in order with your own file last. Keep the team folder in a git repository and clone it where the path points.

## Settings

Every setting, its type and default value are in the [settings reference](settings.md). Change them in the Settings editor (<kbd>Ctrl/Cmd</kbd>+<kbd>,</kbd>), or with **Preferences: Open User Settings (JSON)**, which opens `settings.jsonc` in your default editor.
