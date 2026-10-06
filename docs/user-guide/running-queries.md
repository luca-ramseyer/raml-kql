---
title: Writing and running queries
description: The KQL editor, IntelliSense across workspaces, the time range, running on many workspaces, and what happens when some of them fail.
---

# Writing and running queries

## The editor

Raml KQL's editor is the Monaco editor (the one in VS Code) with the Kusto language service, so you get syntax colouring, formatting, bracket matching, find and replace, multiple cursors and snippets. Open a query tab with **Query: New Query** (<kbd>Ctrl/Cmd</kbd>+<kbd>N</kbd>). Tabs, their text, targets and time range are restored when you restart the app; query **results are not**. Tabs can be split into side-by-side groups (<kbd>Ctrl/Cmd</kbd>+<kbd>\\</kbd>), pinned, and reordered by dragging.

This app targets **Log Analytics**, so the time column is `TimeGenerated` (not `Timestamp`).

### IntelliSense that knows your workspaces

Completions, hover documentation and error squiggles use the **schema of the workspaces you selected**: the union of their tables, columns and functions, including custom `_CL` tables. A table or column that exists in only some of the selected workspaces is marked with a count such as `3/5`, and hovering explains "Available in 3/5 selected workspaces". The schema is fetched per workspace, cached on disk (table, column and function names only, never data) and refreshed when stale; run **Query: Refresh Schema** to force it. If a workspace's schema can't be read, you get one warning and the others still work.

## Running a query

Press <kbd>Shift</kbd>+<kbd>Enter</kbd> or <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> (or the **Run** button):

- With a selection, the selection runs. Otherwise the **block under the cursor** runs (statements are separated by blank lines, as in the Azure portal). Set `editor.runScope` to `"all"` to always run the whole tab.
- A syntax error stops the run right in the editor. A query is never sent to forty workspaces just to get forty identical errors.
- Press <kbd>Esc</kbd> or the Stop button to cancel. Workspaces that already finished keep their rows.

The query goes to every workspace you selected for that tab, in parallel, using the account that can reach each one. Raml KQL respects the Log Analytics service limits: it keeps a few requests in flight per account (`query.maxConcurrentPerAccount`, default 4, leaving room for the portal you probably have open) and slows itself down when Azure answers "too many requests".

### Time range

The time range picker next to **Run** offers presets (30 minutes to 30 days) and a custom start and end. Times are shown in UTC by default (`time.displayZone`). If your query already filters `TimeGenerated` at the top level (for example `where TimeGenerated > ago(1d)`), the picker shows **Set in query** and sends no separate time span, like the portal does.

## When some workspaces fail

In a fleet of workspaces something is always slow, throttled or missing a table. Raml KQL shows each workspace's state separately and never lets one failure hide the others.

- A pill above the results summarizes the run, for example `38 ✓ · 2 partial · 1 failed · 00:14`. Click it, or open the **Run** panel tab, for a table with the state, row count, duration and attempts per workspace, and the server's own error message (for example `SemanticError: … Failed to resolve table …` for a workspace without that table).
- Temporary errors (throttling, 5xx, network) are **retried automatically** with backoff, up to three attempts. Query errors are not retried. A query that timed out is not retried either, because it usually would time out again.
- **Query: Re-run Failed Workspaces** runs only the failed ones again. **Query: Re-run Failed and Timed Out with a Longer Timeout** gives them more time (the normal limit is `query.timeoutSeconds`, 180 s by default).
- If the **first** workspace to answer reports a real query error (not a missing table), Raml KQL stops the workspaces that haven't started and asks whether to run on the rest anyway (`query.failFastOnSemanticError`).
- Auth problems (a tenant needs MFA) don't open a browser mid-run. See [Accounts and tenants](accounts.md#tenants-that-need-you-to-sign-in-again).

## Where the results go

Results stream into the grid as each workspace finishes, and are merged into one table with attribution columns for the tenant and workspace. Continue with [Working with results](results.md). Every run is also recorded in the **History** view (query text and counts, never results), see [Saved queries, history and packs](query-library.md).
