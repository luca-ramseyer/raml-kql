---
title: Saved queries, history and packs
description: Save queries as files, find earlier runs in the history, and use shared query packs from git or files.
---

# Saved queries, history and packs

The **Library** view (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>) holds your own queries and installed query packs. The **History** view (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>) lists what you ran. Press <kbd>Ctrl/Cmd</kbd>+<kbd>P</kbd> to jump to any saved query, pack query or recent run by name.

## My Queries

Press <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd> in a query tab to save it. A saved query is a plain **`.kql` file** with a small header (name, description, tags) in `~/.raml-kql/queries/`, so you can read it, diff it and keep it in git. Organize them in folders with **Library: New Folder in My Queries…**. **Library: Reveal My Queries in File Manager** opens the folder.

A tab you never saved is still kept as a draft across restarts.

## History

Every run adds an entry: when you ran it, the query text, the targets and time range, the number of workspaces that succeeded or failed, and the duration. **Result data is never stored.** Search the history by text, table name or tenant, then **Open in New Tab**, **Run Again** or copy the query. The history keeps the last 5,000 runs (`history.maxEntries`); **History: Clear History** erases it.

## Query packs

A query pack is a shared set of queries, for example "identity hunting" or "endpoint triage", that a team keeps in a git repository. Packs are **data only**: they hold KQL, descriptions and parameters, never code, and nothing runs until you press Run.

In the Library view you can browse and search packs, filter by tag, MITRE technique or table, open a query in a new tab, and fill in a **parameter form** when the query has parameters. Parameters are inserted as typed `let` statements, never by pasting text into your query, so a parameter value can't change what a query does.

### Adding packs

- **Library: Add Pack Source…** takes a git URL (GitHub, GitLab or any HTTPS git host). Raml KQL clones it, pins the exact commit, and checks for updates (`sources.checkForUpdates`, at most once a day). Updates are never applied automatically: **Library: Check for Pack Updates** shows what changed and you accept or decline it. For a private repository, use a read-only fine-grained access token; it is stored encrypted, never in a config file.
- **Library: Import Pack from Folder…** and **Library: Import Pack or Queries from File…** import a folder, a `.rkqlpack` archive, or a single `.kql` file.
- **Library: Remove Pack Source…** removes a source.

An example pack ships with the project: [`examples/packs/raml.starter`](https://github.com/luca-ramseyer/raml-kql/tree/main/examples/packs/raml.starter). To write your own, see [Writing query packs](../guides/writing-query-packs.md).
