# Contributing to Raml KQL

Thank you for helping. This is a small project with a security focus (it handles tokens and
customer data), so a few rules keep it dependable. By taking part you agree to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs and ideas:** open an [issue](../../issues/new/choose). For anything bigger than a small
  fix, please discuss it in an issue first, so you don't build something we can't merge.
- **Security problems:** never in a public issue. See [`SECURITY.md`](SECURITY.md).
- **Never post real data.** No tenant or subscription IDs, customer names, e-mail addresses,
  tokens, or query results, in issues, pull requests, screenshots or test fixtures. Use
  obviously fake values (Contoso, Fabrikam, Woodgrove; GUIDs starting with `00000000-`). The
  crash report in the app is sanitized, but read it before you paste it.

## Set up

You need Node.js 24 (see `.nvmrc`) and pnpm 11 (`corepack enable`).

```bash
pnpm install
pnpm dev:demo      # the app with fake accounts, tenants, workspaces and data. No Azure needed.
```

Demo mode is a first-class feature: every feature must work in it, because the end-to-end
tests, the screenshots and most development rely on it.

## Before you open a pull request

All of these must pass (CI runs them too):

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e      # builds the app and drives it in demo mode
```

- **Add tests** for new behaviour and bug fixes. See
  [`docs/guides/testing-and-ci-explained.md`](docs/guides/testing-and-ci-explained.md) for what
  kind of test goes where.
- **Read the spec** for the area you touch in [`docs/spec/`](docs/spec). The specs are the
  source of truth. If you have to deviate, add an entry to
  [`docs/DECISIONS.md`](docs/DECISIONS.md) and update the spec.
- **Match the code around yours.** Strict TypeScript, zod at every boundary (IPC, config
  files, API responses), no `any`.
- **KQL in samples, tests and packs** targets Log Analytics: the time column is
  `TimeGenerated`, never `Timestamp`. Samples must parse and be read-only.

### Pull request titles

Pull requests are squash-merged, and the **title becomes the commit message**. It must be a
[Conventional Commit](https://www.conventionalcommits.org/): `feat(query): …`,
`fix(auth): …`, `docs: …`, `test: …`, `chore: …`. A check enforces this, and
[release-please](https://github.com/googleapis/release-please) builds the changelog and version
numbers from it. Use `feat!:` or a `BREAKING CHANGE:` note for breaking changes.

## Principles that decide close calls

1. **Security first.** The renderer is sandboxed, all Azure calls and file access live in the
   main process, and every IPC message is validated on both sides.
2. **Query results are never persisted.** Only query text (tabs, history, saved queries) is.
3. **No telemetry,** and no new outbound network traffic beyond what the README lists.
4. **Extensions get least privilege.** Anything an extension can do goes through a
   permission-checked host API.
5. **Look and behave like VS Code.** When unsure, do what VS Code does.
6. **Don't use Microsoft or VS Code trademarks or logos** in names, icons or branding.

## Extensions and query packs

You don't need to change the app to extend it. See
[Writing extensions](docs/guides/writing-extensions.md) and
[Writing query packs](docs/guides/query-packs.md).

## Releases

Maintainers merge the release pull request that release-please keeps open; the release workflow
does the rest. You don't need to bump versions or edit `CHANGELOG.md`.
