---
title: Workspaces and targets
description: How Raml KQL finds your workspaces, how to choose what a query runs on, tenant groups, and how names are aliased for screen sharing.
---

# Workspaces and targets

## How workspaces are found

After you sign in, Raml KQL uses **Azure Resource Graph** to discover every Log Analytics workspace your accounts can see, including Lighthouse-delegated ones, together with their subscriptions and tenants. Workspaces that have Microsoft Sentinel enabled get a shield badge; all workspaces are listed either way.

Discovery runs on start, when you add an account, and when you run **Workspaces: Refresh Workspaces**. The last result is cached (names and IDs only), so the app is usable immediately while a refresh runs in the background. A workspace that is no longer found is greyed out as "missing" and never deleted automatically. When new workspaces appear, a notification says so ("5 new workspaces discovered").

## Choosing which workspaces appear

Open **Preferences: Open Workspaces Settings** (the gear icon in the Targets view). It shows a tree of account, tenant, subscription and workspace:

- Tick or untick a workspace to **enable** or **disable** it. Disabled workspaces never show up in Targets, so your list stays short.
- **Enable all** and **Disable all** buttons act on a whole tenant, a filter shows only Sentinel workspaces, and a search box narrows the tree.
- Give a workspace or tenant an **alias**, tags, and (when several routes exist) a preferred access path.
- **Copy resource ID** copies the workspace's Azure resource ID.

New workspaces are enabled by default; set `workspaces.newWorkspaceDefault` to `"disabled"` to review them first. Your choices are saved in `workspaces.jsonc`, keyed by resource ID, so they follow you if you share the file.

## Targets: what a query runs on

The **Targets** view (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>) lists the enabled workspaces under their tenants. The checkboxes select the targets of the **active query tab**, so every tab remembers its own selection. The status bar shows the count ("12 workspaces · 5 tenants"); click it to jump to Targets.

- The drop-down at the top picks a **group** or "All enabled"; the box below it filters by name.
- **Targets: Select All Shown** and **Targets: Clear Selection** act on what is currently shown.
- A tenant or workspace that needs a new sign-in shows a warning with a **Sign in** action.

### Tenant groups

A group is a named selection you can reuse. Choose **Targets: Save Selection as Group…** to save what is ticked, and **Targets: Select Group…** to apply one. Groups can also be created and edited in the Workspaces settings, and are stored in `groups.jsonc`, which you can edit by hand too:

- **Static groups** list specific workspaces.
- **Dynamic groups** match by rule: Sentinel workspaces, tenant or workspace tags, a name pattern, location, or account. They update themselves when workspaces change.

Groups only ever contain **enabled** workspaces.

## Aliased names (presentation mode)

Customer names are sensitive on a shared screen. By default Raml KQL starts **aliased**: tenants, subscriptions, workspaces and accounts appear as "Customer 01", "Customer 02", and so on, everywhere: the Targets tree, result columns, tab titles, notifications, chart legends. The numbers are stable, and you can set your own alias for any tenant or workspace.

- **Privacy: Toggle Presentation Mode** (<kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd>), or the status bar item, switches between aliases and real names. Switching to real names asks for confirmation, so a stray keypress during a call is harmless.
- Aliasing only changes what is displayed; the data is untouched, so toggling is instant and needs no new query. Searching and filtering match what is displayed, so typing a customer's real name while aliased finds nothing.
- Exports follow `privacy.aliasing.applyToExports` (ask, always or never use aliases).
- **Masking rules** (`privacy.maskingRules`) replace text inside result cells while presentation mode is on, for example a customer's domain. **Privacy: Generate Masking Rules from Tenant Domains** creates a starting set.
- Extensions only see aliased names unless you grant them the real-names permission.

Automatic detection of screen sharing isn't reliable across platforms, so Raml KQL doesn't try. The safety comes from starting aliased and the one-key toggle. All options are in the [settings reference](../reference/settings.md) under **Privacy**.
