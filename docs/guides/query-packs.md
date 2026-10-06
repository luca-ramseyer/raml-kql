# Writing query packs

A query pack is a folder of `.kql` files plus a small manifest, usually kept in a git
repository. People add it in Raml KQL with **Library: Add Pack Source…** (a git URL) or
**Import Pack or Queries from File…** (a `.rkqlpack` zip). Packs are data only: they never
contain code, and a query never runs until the user presses Run.

The full format is in [`docs/spec/08-query-packs.md`](../spec/08-query-packs.md). This guide
is the short version. [`examples/packs/raml.starter`](../../examples/packs/raml.starter) is a
complete example.

## Layout

```
my-pack/
  rkqlpack.yaml       the manifest
  queries/
    failed-signins.kql
    ...
  README.md
  CHANGELOG.md
  LICENSE
```

A repository with several packs lists them in a root `rkql-index.yaml`:

```yaml
packs:
  - path: packs/identity
  - path: packs/endpoint
```

## The manifest

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/<owner>/raml-kql/main/packages/pack-schema/schemas/rkqlpack.schema.json
schemaVersion: 1
id: contoso.identity-hunting # publisher.name, lowercase
name: Identity Hunting
version: 1.3.0 # semantic version; bump it when you publish changes
description: Sign-in and identity hunting queries.
license: MIT
defaults:
  timespan: P7D # used when a query sets none
```

## A query

The metadata is YAML inside a `// ---` comment block, so the file still pastes into the
Azure Portal unchanged:

```kusto
// ---
// id: failed-signins
// name: Failed sign-ins by user
// description: Users with the most failed interactive sign-ins.
// category: hunting
// tables: [SigninLogs]
// mitre: [T1110.003]
// tags: [identity]
// timespan: P1D
// parameters:
//   - name: MinFailures
//     type: long
//     default: 10
// ---
let MinFailures = 10;
SigninLogs
| where TimeGenerated > ago(1d)
| where ResultType != "0"
| summarize Failures = count() by UserPrincipalName
| where Failures >= MinFailures
```

- `id`, `name`, `description` and `tables` are required. `tables` powers the "compatible
  with my targets" filter.
- Use `TimeGenerated`, never `Timestamp`: Raml KQL queries Log Analytics.
- **Parameters** are ordinary `let` statements with a default. Raml KQL shows a parameter bar
  and replaces that `let` with the typed value the user entered, so the query also works
  as-is in the portal. The types are `string`, `long`, `int`, `real`, `bool`, `datetime`,
  `timespan`, `dynamic`, `enum` (with `values`) and `stringList`.
- Instead of front-matter you can put the same YAML in a sidecar file next to the query
  (`failed-signins.yaml`). Use one or the other, not both.

## Validate before you publish

```bash
raml-kql-ext pack validate path/to/my-pack
```

This runs the same checks the app runs before it adds a source. It exits with code 1 when
something is wrong and prints the file and the problem for each one. Your editor can also
validate `rkqlpack.yaml` with the JSON Schema in
[`packages/pack-schema/schemas/`](../../packages/pack-schema/schemas/).

### In GitHub Actions

A pack repository can validate every pull request with `@raml-kql/extension-cli` from npm:

```yaml
# .github/workflows/validate-packs.yml
name: Validate query packs
on: [pull_request, push]
permissions:
  contents: read
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npx --yes @raml-kql/extension-cli pack validate .
```

## Publishing updates

People who added your repository stay pinned to the commit they added. When you push a new
commit, the app finds it (at most once a day, or on **Check for Pack Updates**) and shows the
commits and the changed queries side by side. Nothing changes until the user applies the
update. Keep a `CHANGELOG.md` and bump `version`, so the review is easy to follow.

## Private repositories

Users can add a private repository with a **read-only** token (for example a GitHub
fine-grained token with "Contents: read" on that repository only). The app asks for the token
when the host refuses access and keeps it in the OS keychain. It is never written to the
config folder.
