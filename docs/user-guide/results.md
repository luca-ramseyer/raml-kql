---
title: Working with results
description: The results grid, grouping by tenant, charts, exporting, and opening rows in the Azure portal and Microsoft Defender.
---

# Working with results

Results appear in the panel under the editor, one set per query tab, with these tabs: **Results**, **Chart** and **Run** (per-workspace status, see [Writing and running queries](running-queries.md#when-some-workspaces-fail)).

## Attribution columns

Every merged row starts with columns that say where it came from, such as `_TenantName` and `_WorkspaceName`. Choose which are visible with `results.attributionColumns`. When the same column has different types in different workspaces (for example `long` in one and `real` in another), the types are widened and an info icon on the column header explains it. A column missing in some workspace is simply empty for those rows.

If a result is very large, Raml KQL stops at `results.maxMergedRows` (1,000,000 by default) and shows a banner asking you to narrow the query or reduce the targets.

## The grid

The grid scrolls smoothly even with hundreds of thousands of rows, because only the visible rows are drawn.

- **Sort** by clicking a header (hold <kbd>Shift</kbd> to sort by several columns), **filter** per column, **search** with the box above the grid, and resize, reorder or pin columns.
- **Copy** the focused cell or the selected rows (<kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd>) as tab-separated text, with headers if `results.copyWithHeaders` is on.
- **Right-click a cell** for: copy value, copy row as JSON, **Filter to This Value** and **Exclude This Value** (these filter the grid by default; set `results.cellFilterMode` to `"query"` to append a `where` line to your query instead), entity enrichment from extensions, and the links below.
- **Double-click a row** to see all its columns at once. A `dynamic` cell opens as formatted JSON.
- Datetimes follow `time.displayZone` and show both UTC and local time in the tooltip.

## Group by tenant

The **Group** button in the results toolbar summarizes the merged result on your machine, without running another query: pick columns to group by and aggregations (`count`, `dcount`, `sum`, `avg`, `min`, `max`). **Results: Group by Tenant** is a one-step preset that counts rows per tenant. A grouped view can be exported and charted like any other result; switch back to the rows any time.

## Charts

If your query ends with `render` (`timechart`, `columnchart`, `barchart`, `piechart`, `areachart`, `scatterchart`, `card` and so on), the **Chart** tab opens with it. Otherwise open the tab and use the chart builder: choose a type, the X column, the Y columns, a series column and an aggregation, with live preview.

A **Split by tenant** option adds the tenant as a series, so a single timechart shows one line per customer. Charts follow your theme and the aliased names, and can be saved as PNG or SVG or copied as an image.

## Export and copy

**Results: Export Results…** writes the results (all rows or the filtered rows) to **CSV**, **JSON**, **JSON Lines**, **XLSX**, a **Markdown table**, or a KQL **`datatable`** you can paste into a query. **Results: Copy Results As…** puts the same formats on the clipboard.

Exports are the one place result data leaves the app, and only because you asked. If presentation mode is on, `privacy.aliasing.applyToExports` decides whether real or aliased names go into the file. For CSV in Excel with a European locale, set `export.csv.delimiter` to `;`.

## Links to the Azure portal and Microsoft Defender

Right-click a result cell to jump straight to the source:

- **Open Query in Azure Portal Logs** opens the Logs blade for that row's workspace with your query and time range filled in. For a Lighthouse customer it opens in your own tenant.
- Rows with the right columns get direct links: **Open Device in Microsoft Defender** for `DeviceId`, and the incident or alert URL for `SecurityIncident` and alert rows.

Links open in your normal browser and only for known Microsoft addresses. Turn them off with `links.enabled`.

## Clearing results

**Results: Clear All Results** frees the memory used by every tab's results. Results are cleared automatically when you quit, and they are not restored when you restart: the tab shows "Results from the previous session were cleared" and you press <kbd>Shift</kbd>+<kbd>Enter</kbd> to run again.
