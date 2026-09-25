# Country Map

An example Raml KQL **result renderer**: it draws the active result as a world map, colouring
countries by the number of rows (or by a count column when the query already aggregated).

- The map is bundled (Natural Earth 110m via [world-atlas](https://github.com/topojson/world-atlas),
  public domain). The renderer has **no network** and asks only for `results.read`, once per
  query run by default.
- Country values can be ISO alpha-2 (`US`), alpha-3 (`USA`) or English names.

```kusto
SigninLogs
| where TimeGenerated > ago(1d)
| summarize SignIns = count() by Country = tostring(LocationDetails.countryOrRegion)
```

Open the **Country Map** tab in the panel after running a query.
