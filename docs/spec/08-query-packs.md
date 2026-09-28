# 08 — Query packs, My Queries, sources

## Principles

- A query pack is **data only**: KQL plus metadata. It never contains executable code (that's what extensions are for), so packs need no sandbox.
- Packs never auto-run. Opening a pack query opens a tab; the user presses Run.
- Every query must run unchanged in the Azure Portal too (portable KQL). Parameters are therefore plain KQL identifiers bound via `let` (below), not template placeholders.
- Human-friendly files (`.kql` + YAML) diff well in git, so packs are easy to review in PRs.

## Pack layout

```
my-pack/
  rkqlpack.yaml                 pack manifest
  queries/
    signin-failed-by-user.kql
    signin-failed-by-user.yaml  optional sidecar (alternatively: front-matter inside the .kql)
    ...
  README.md
  CHANGELOG.md
  LICENSE
```

A repository can hold one pack at its root, or many packs, listed in a root `rkql-index.yaml`:

```yaml
packs:
  - path: packs/identity
  - path: packs/endpoint
```

## `rkqlpack.yaml`

```yaml
schemaVersion: 1
id: raml.identity-hunting            # publisher.name, lowercase, [a-z0-9.-]
name: Identity Hunting
version: 1.3.0                        # semver
description: Sign-in and identity hunting queries for Entra ID logs.
authors: ["Luca Ramseyer <luca@raml.ch>"]
license: MIT
homepage: https://github.com/raml/raml-kql-packs
minAppVersion: 1.0.0
tags: [identity, entra, hunting]
defaults:
  timespan: P7D                       # used when a query doesn't set its own
  targetGroup: all-sentinel           # optional suggestion; resolved only if the user has that group id
```

## Query metadata (front-matter or sidecar)

Front-matter in `.kql` files uses a KQL comment block, so the file still pastes into the portal:

```kusto
// ---
// id: signin-failed-by-user
// name: Failed sign-ins by user
// description: Users with the most failed interactive sign-ins, with top failure reasons.
// category: hunting            # hunting | investigation | triage | reporting | health
// severity: informational      # informational | low | medium | high (a hint for hunting queries)
// tables: [SigninLogs]
// mitre: [T1110, T1110.003]
// tags: [bruteforce, password-spray]
// timespan: P1D
// render: barchart
// parameters:
//   - name: MinFailures
//     type: long
//     default: 10
//     description: Only show users with at least this many failures
//   - name: UserFilter
//     type: string
//     default: ""
//     description: Optional substring of the UPN
// references:
//   - https://attack.mitre.org/techniques/T1110/
// ---
SigninLogs
| where TimeGenerated > ago(1d)
| where ResultType != "0"
| where isempty(UserFilter) or UserPrincipalName has UserFilter
| summarize Failures = count(), Reasons = make_set(ResultDescription, 5) by UserPrincipalName
| where Failures >= MinFailures
| top 25 by Failures
```

Field rules:

- Required: `id` (unique within the pack), `name`, `description`, `tables`.
- Recommended: `category`, `mitre`, `tags`, `timespan`.
- Everything else is optional.
- `tables` drives the Library's "compatible with your targets" filter (checked against the merged schema).
- `mitre` IDs are validated by format (`T\d{4}(\.\d{3})?`). Names are shown from a bundled ATT&CK technique list (ID → name only).

## Parameters

- Types: `string`, `long`, `int`, `real`, `bool`, `datetime`, `timespan`, `dynamic` (becomes `parse_json("…")` of an escaped string, D-041), `enum` (with `values: [...]`, rendered as a dropdown), `stringList` (becomes `dynamic([...])`).
- When a query with parameters opens, a **parameter form** appears above the editor (a slim bar, like the portal's parameter pills). Values persist per tab.
- **Injection:** at run time the engine prepends typed `let` statements, generated with proper KQL literal escaping:

  ```kusto
  let MinFailures = 10;
  let UserFilter = "o\"brien";   // escaped via a KQL string literal encoder, never raw concatenation
  ```

  The body is never string-substituted. The literal encoder has thorough unit tests covering quotes, backslashes, newlines, unicode, empty values, and datetime/timespan formatting.
- If the query already defines a `let` with the same name (so it's portable), the injected value **replaces** that statement. Use the Kusto syntax tree to find it.

## My Queries

- Stored as `.kql` files with the same front-matter in `<config>/queries/`, with subfolders allowed. Git-friendly, so they are part of the dotfile config.
- The Library view has two sections:
  - **My Queries** (tree of folders)
  - **Packs** (installed packs → categories → queries)
- Actions:
  - new query, rename, move, delete (to OS trash)
  - "Duplicate to My Queries" for pack queries, since pack files are read-only
  - "Reveal in file manager"
  - "Export as pack…", which bundles selected My Queries into a new pack folder or `.rkqlpack` zip (makes sharing easy)
- Filters: text search, tags, MITRE technique, tables, "compatible with current targets".

## Sources (git + file)

- **Add source by git URL**, e.g. `https://github.com/someone/kql-packs`, via "Library: Add Pack Source…" or in Settings → Sources.
  - Clone with isomorphic-git into `<config>/sources/<hash-of-url>/` (shallow, default branch or a chosen ref).
  - Discover packs via `rkql-index.yaml` or a root `rkqlpack.yaml`. Validate everything and show a preview: packs, query counts and any validation errors. Then **Add**.
  - Pin to the resolved commit SHA in `sources.jsonc`.
  - Private repos: support an optional token stored in OS secure storage (`safeStorage`). The token itself is never in config; `sources.jsonc` only holds a reference.
- **Updates:**
  - Check on startup (throttled to once per 24 h per source) and via the "Check for Pack Updates" command.
  - The update screen shows the commit log since the pinned SHA and the changed queries, with a diff view (Monaco diff editor).
  - The user applies the update; it is never applied silently (setting `sources.autoUpdate` default `false`).
- **Import from file:** `.rkqlpack` (zip of a pack folder), a pack folder, or loose `.kql` files (these become My Queries). Imported packs are tracked in `sources.jsonc` with `type: "file"` and a content hash.
- Removing a source removes its packs from the Library. Open tabs keep their text.
- Conflicting IDs: if two sources provide the same pack id, show both with the source as disambiguator. Never silently override.

## Schemas

- `packages/pack-schema` exports the zod schemas plus generated JSON Schema files (`rkqlpack.schema.json`, `rkql-query.schema.json`). Pack authors get editor validation via `# yaml-language-server: $schema=...` once the repo is public.
- `raml-kql-ext` gets a `pack validate` subcommand, plus a reusable GitHub Action snippet in the author guide so pack repos can validate on PR.

## Example pack

`examples/packs/raml.starter/` contains ~10 genuinely useful Log Analytics/Sentinel queries across identity, endpoint (Defender tables in Sentinel), email, Azure activity, and ingestion health, e.g. "Tables with ingestion drop in last 24h", "New admin role assignments", "Rare process executions", "Inbound email with URL clicks". All use `TimeGenerated`, have parameters where sensible, and include MITRE tags. Write them originally; don't copy from other repos.
