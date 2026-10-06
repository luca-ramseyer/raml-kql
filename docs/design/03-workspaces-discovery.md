---
title: Discovery, workspaces and aliasing
description: Workspace discovery, access paths, tenant groups, aliasing and presentation privacy.
---

# Discovery, workspace management, tenant groups and aliasing

## Discovery

Run discovery per account (and per tenant token where required) using **Azure Resource Graph**. Resource Graph automatically includes Lighthouse-delegated subscriptions.

Endpoint: `POST https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2024-04-01` (verified 2026-09; see D-024). Page with `options.$skipToken`, `$top` ≤ 1000.

Queries (run per account's home tenant token, then per additional tenant token for guest tenants):

```kusto
// Workspaces
resources
| where type =~ 'microsoft.operationalinsights/workspaces'
| project id, name, location, tenantId, subscriptionId, resourceGroup,
          customerId = tostring(properties.customerId),
          retentionInDays = toint(properties.retentionInDays),
          sku = tostring(properties.sku.name)
```

```kusto
// Subscriptions
resourcecontainers
| where type =~ 'microsoft.resources/subscriptions'
| project subscriptionId, subscriptionName = name, tenantId
```

```kusto
// Sentinel flag (legacy solution resource; fast)
resources
| where type =~ 'microsoft.operationsmanagement/solutions' and name startswith 'SecurityInsights('
| project workspaceResourceId = tolower(tostring(properties.workspaceResourceId))
```

- If the solution check yields nothing for a workspace, check `GET {workspaceId}/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=2025-09-01` (200 means Sentinel is enabled; verified 2026-09).
- **The Sentinel flag is a badge only. All Log Analytics workspaces are listed.**
- Tenant display names: use `/tenants` (spec 02) when available. Otherwise show the tenant ID until the user sets a name. Names are always overridable (see Aliasing).

## Workspace identity and access paths

- **Workspace key:** the lowercase ARM resource ID. `customerId` is the GUID used by the Log Analytics Query API.
- An **access path** is `{ accountId, authorityTenantId, via: 'home' | 'lighthouse' | 'guest' | 'azureCli' }`. One workspace can have several access paths, for example reachable through two accounts.
- Dedupe by workspace key. Keep all paths. The **preferred path** is:
  1. the user's saved choice,
  2. otherwise the first path whose last query succeeded,
  3. otherwise the discovery order.
- If the preferred path fails with auth/permission errors, the engine may try the next path when `query.fallbackAccessPaths` is `true` (default `true`). Every attempt is logged in the audit log.

## Discovery lifecycle

- Discovery runs on startup (after auth), on "Refresh Workspaces", and when an account is added.
- The cached inventory (IDs, names, flags: metadata only) is kept in the config dir's `state/inventory.json`. Startup is therefore instant; a background refresh follows.
- New workspaces get enabled state from `workspaces.newWorkspaceDefault` (`"enabled"` | `"disabled"`, default `"enabled"`). A notification says "5 new workspaces discovered — Review".
- Workspaces no longer discovered are marked "missing" (greyed), not auto-deleted. The user can remove them.

## Settings → Workspaces page

This is a VS Code settings-editor-like page with a tree:

```
▾ analyst@contoso.com  (builtin)                                  [Refresh]
  ▾ Contoso Managing (tenant)                    home
    ▾ Sub: SOC-Prod
      ☑ la-soc-weu          West Europe  ● Sentinel   alias: —
  ▾ Customer 01 · Fabrikam (tenant)              lighthouse
    ▾ Sub: Fabrikam-Security
      ☑ la-fabrikam-sentinel  North Europe ● Sentinel alias: Customer 01
      ☐ la-fabrikam-apps      North Europe
▾ analyst@woodgrove.onmicrosoft.com (guest account)
  ...
```

- Checkbox = enabled. Disabled workspaces are hidden from the KQL view's Targets.
- Bulk actions: enable/disable all in a tenant or subscription, "Only Sentinel workspaces", and search/filter.
- Per workspace:
  - alias,
  - preferred access path (dropdown when more than one),
  - tags (free text, used by dynamic groups),
  - "Copy resource ID" and "Open in portal".
- Per tenant: alias, tags.
- State is stored in `workspaces.jsonc` (spec 09), keyed by workspace resource ID and tenant ID.

## Targets view (KQL view sidebar)

- Shows **enabled** workspaces as tenant → workspace (subscription shown as secondary text; setting `targets.groupBySubscription` to show it as a level).
- Checkboxes select targets for the **active query tab**. Each tab has its own target selection.
- A group dropdown at the top ("All enabled", plus user groups) and a search box.
- The status bar shows `$(server) 12 workspaces · 5 tenants` for the active tab. Clicking it focuses Targets.
- Tenants or workspaces needing re-auth show a warning icon with a "Sign in" inline action.

## Tenant groups

Named selections stored in `groups.jsonc`:

```jsonc
{
  "groups": [
    { "id": "all-sentinel", "name": "All Sentinel", "type": "dynamic",
      "match": { "sentinel": true } },
    { "id": "ch-banks", "name": "Swiss banks", "type": "dynamic",
      "match": { "tenantTags": ["bank", "ch"], "mode": "all" } },
    { "id": "oncall", "name": "On-call set", "type": "static",
      "workspaces": ["/subscriptions/.../workspaces/la-a", "..."] }
  ]
}
```

- Dynamic match fields: `sentinel`, `tenantIds`, `tenantTags`, `workspaceTags`, `nameRegex`, `location`, `accountIds`; `mode: "all" | "any"`.
- Groups only ever resolve to **enabled** workspaces.
- UI: create/edit from Targets ("Save selection as group…") and from Settings.
- Groups can be used by queries: a saved query or pack query may declare a default group.

## Aliasing & presentation privacy

Aliasing protects customer identities during screen sharing and screenshots.

Settings:

- `privacy.aliasing.enabled` (default `true`): the master switch. When `false`, the feature is fully off: no aliasing, no status bar item, and the quick toggle is hidden.
- `privacy.aliasing.activeOnStartup` (default `true`): the app always starts aliased, so opening it on a call is safe by default.
- `privacy.aliasing.autoAliasFormat` (default `"Customer {nn}"`): used for tenants without a user-set alias. Numbers are stable (assigned once, stored in `workspaces.jsonc`).
- `privacy.aliasing.scope`: which names are aliased. Default all: `tenant`, `subscription`, `workspace`, `account`.
- Custom masking rules for **result cell values**, in `privacy.maskingRules`: `[ { "match": "fabrikam", "isRegex": false, "replace": "customer01", "caseSensitive": false } ]`, applied at render time.
  - A helper offers to generate rules from tenant default domains (`fabrikam.com → customer01.example`).

Behaviour:

- **Quick toggle:**
  - Command `Privacy: Toggle Presentation Mode`, default keybinding `Ctrl/Cmd+Alt+P`, and a status bar item (`$(eye-closed) Aliased` / `$(eye) Real names`).
  - Switching to real names asks for confirmation when `privacy.aliasing.confirmReveal` is `true` (default `true`).
- Aliasing is a **render-layer transform**. The underlying data is untouched, so toggling is instant and needs no re-query.
  - This includes the `_TenantName`, `_SubscriptionName` and `_WorkspaceName` attribution columns, tab titles, notifications, the Targets tree, deep-link tooltips and chart legends.
- **Exports:**
  - Setting `privacy.aliasing.applyToExports`: `"ask"` (default) | `"always"` | `"never"`.
  - Copy-to-clipboard follows what is displayed.
- **Extensions** see aliased names unless they hold the `tenants:realNames` permission (spec 07).
- **Audit log** always records real IDs (it is local and not shown on screen by default).
- The window title never contains customer names.

Note: automatic detection of screen sharing is not reliable cross-platform and is **not** implemented. Safety comes from "aliased on startup" plus the quick toggle.
