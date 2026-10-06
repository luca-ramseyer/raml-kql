---
title: Results
description: The results grid, group-by, charts, export and deep links.
---

# Results: grid, group-by, charts, export, deep links

## Panel tabs per query tab

- **Results**: grid, with a sub-tab strip when the query returns multiple tables (`Table 1`, `Table 2`, …).
- **Chart**: visible when a render spec exists or the user opens the chart builder.
- **Run**: per-workspace status (spec 04).
- **Audit**: a global view, not per tab; lives in the panel's overflow.

## Grid (AG Grid Community)

- Virtual rows and columns. Must stay smooth at 1M rows × 30 columns: use columnar data + a row-model adapter, and never materialize 1M row objects.
- Features:
  - sort (multi with Shift)
  - column filters (text/number/date/set-like quick filter)
  - global quick-search box
  - resize, reorder and pin columns
  - hide/show columns via a column picker
  - auto-size on double-click of the header edge
- Column headers show a type icon (`string`, `long`, `real`, `datetime`, `bool`, `dynamic`, `guid`, `timespan`, `decimal`).
- **Datetime** display follows `time.displayZone`, format ISO-like `2026-09-24 09:12:03.123`. The tooltip shows both UTC and local time.
- **Dynamic/JSON cells** render compact and expandable. Clicking opens the **Cell Details** side sheet: pretty JSON with a tree view, copy value, and copy JSON path.
- **Row details:** `Space` or double-click opens a side sheet with all columns vertically, like the portal's expanded row, with search.
- **Selection and copy:** click-drag range-like selection is Enterprise-only, so implement:
  - row selection (click, Shift, Ctrl/Cmd)
  - cell focus
  - `Ctrl/Cmd+C` copies the focused cell, or selected rows as TSV with headers (setting `results.copyWithHeaders`)
- **Context menu** on a cell:
  - Copy value
  - Copy row as JSON
  - "Filter to this value" / "Exclude this value": appends `| where Col == "val"` / `!=` to the query as a new line (portal behaviour) or as a grid-only filter (setting `results.cellFilterMode`: `"query"` | `"grid"`, default `"grid"`)
  - "Enrich with…" for entity-like values (extensions, spec 07)
  - "Open in …" deep links (below)
- Attribution columns are pinned left by default, with visually distinct header colours.
- A grid state row shows: rows, filtered rows, truncated flag, and "Demo data" if applicable.

## Group-by (client-side aggregation over merged results)

A lightweight answer to MTO's missing cross-tenant rollup.

- A "Group" toolbar button opens a bar where the user drags or chooses group columns and aggregations: `count`, `dcount`, `sum`, `avg`, `min`, `max` per column.
- The group-by is computed in a Web Worker in the renderer over the columnar data and shown as a new derived grid ("Grouped view"), with a toggle back to the raw rows.
- A common one-click preset: **"Group by tenant"**, which counts rows per `_TenantName`.
- Grouped views can be exported and charted like normal results.
- Keep the implementation isolated (`features/results/aggregate/`) so a future second-stage engine can replace it.

## Charts (Apache ECharts)

- **From `render`:** map the Log Analytics render kinds to ECharts:
  - `timechart` and `linechart` → line
  - `areachart` → area (stacked if the `kind` says so)
  - `columnchart` → vertical bar
  - `barchart` → horizontal bar
  - `piechart` → pie
  - `scatterchart` → scatter
  - `anomalychart` → line with anomaly markers where the column exists
  - `card` → big number
  - `table` → no chart
  - Honour `title`, `xcolumn`, `ycolumns`, `series`, `kind`, `ytitle`, `xtitle`, `legend`, `ymin`/`ymax` where provided.
- **Cross-tenant twist:** a "Split by tenant" toggle adds `_TenantName` as a series dimension, so one timechart can show all tenants as separate lines. Default: on if the result has more than one tenant and the render has no explicit `series`.
- **Chart builder** (when there is no render or the user wants a different chart): chart type, X column, Y columns, series column, aggregation. Changes are reflected live.
- Charts follow the current theme (derive the ECharts theme from workbench colours) and aliasing (legends aliased).
- Export a chart as PNG or SVG, or copy it to the clipboard as an image.
- Max points guard: above 50k points, downsample with LTTB for line charts and show a notice.

## Export

- Scope: all rows / filtered rows / selected rows; visible columns vs all columns.
- Formats:
  - **CSV** (UTF-8 with BOM option for Excel, delimiter setting)
  - **JSON** (array of objects) and **JSON Lines**
  - **XLSX** (exceljs; one sheet per result table, header styling, frozen header row, datetime cells typed)
  - **Markdown table** (for incident write-ups; truncates cells over 200 chars with a notice)
  - **KQL `datatable`** (copy as a pasteable `datatable(...)[...]` expression; capped at 10k rows)
- Copy to clipboard in each format, and save to file via the native save dialog (last folder remembered).
- The aliasing prompt follows `privacy.aliasing.applyToExports` (spec 03).
- Exports are user-initiated files. They are the one place result data may leave the session, by explicit user action.

## Deep links

Setting `links.enabled` default `true`. All links open in the OS browser (allowlisted origins, spec 01).

- **"Open query in Azure Portal Logs"** for a workspace, from the Run panel row, the Targets context menu, or the cell context menu (uses the row's `_WorkspaceId`).
  - The portal accepts a Logs blade URL with the workspace resource ID, a compressed query and a timespan. The known format is `https://portal.azure.com/#@{tenantId}/blade/Microsoft_OperationsManagementSuite_Workspace/Logs.ReactView/resourceId/{urlencoded resourceId}/source/LogsBlade.AnalyticsShareLinkToQuery/q/{urlencoded base64(gzip(query))}/timespan/{ISO duration}`.
  - **Verify it works** and adjust. Put the builder in `src/main/links/portal.ts` with tests.
  - Use the access-path tenant (managing tenant for Lighthouse) in `#@{tenant}`.
- **Row-level links** when well-known columns exist:
  - `IncidentUrl` (SecurityIncident) → open as is
  - `DeviceId` → Defender device page `https://security.microsoft.com/machines/{DeviceId}?tid={tenantId}`
  - `AlertLink` / `AlertUrl` → as is
  - Verify each pattern; keep them in a small registry `links/rowLinks.ts` that extensions can extend.
- "Copy link" is available alongside "Open".
