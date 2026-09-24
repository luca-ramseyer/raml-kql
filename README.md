# Raml KQL

Run one KQL query against many Azure Log Analytics workspaces at once, across many Entra
tenants and many signed-in accounts, and get one merged result with tenant and workspace
attribution on every row. A desktop app for macOS, Windows and Linux that looks and feels
like VS Code.

> **Status:** early development (`0.x`). Not ready for use yet. See
> [`docs/spec/00-roadmap.md`](docs/spec/00-roadmap.md) for progress.

## Development

Requirements: Node.js 24 (see `.nvmrc`) and pnpm 11 (`corepack enable` picks the right version).

```bash
pnpm install
pnpm dev:demo      # run the app with fake data, no Azure access needed
```

| Command                      | What it does                                             |
| ---------------------------- | -------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:demo` | Run the app (live / demo mode) with hot reload           |
| `pnpm lint` / `pnpm format`  | ESLint + Prettier check / fix formatting                 |
| `pnpm typecheck`             | TypeScript across all workspaces                         |
| `pnpm test`                  | Unit and integration tests (Vitest)                      |
| `pnpm test:e2e`              | Build, then drive the real app in demo mode (Playwright) |
| `pnpm build` / `pnpm dist`   | Production build / installers for the current OS         |

New to the testing and CI setup? Read
[`docs/guides/testing-and-ci-explained.md`](docs/guides/testing-and-ci-explained.md).

## Licence

[MIT](LICENSE). Third-party components: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
Raml KQL is not affiliated with Microsoft.
