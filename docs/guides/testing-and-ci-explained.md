# Testing and CI, explained (for Luca)

This guide explains *what* the project's testing and CI setup does and *why*, so you can maintain it yourself. Claude Code keeps it updated when the setup changes.

## The one-sentence version

Tests are small programs that check your program. CI is a robot (GitHub Actions) that runs all those checks on every change, so nothing broken gets merged or released.

## Why bother, for a tool like this

You'll maintain this for years, other people will send pull requests, and some of the code is subtle (retries, rate limits, encryption, permission checks). Without tests, every change risks breaking something you won't notice until an analyst's query silently misses three tenants. Tests make that visible in seconds, before release.

Think of it like detection engineering: a test is an analytic rule for your own code. It fires when behaviour changes.

## The kinds of tests here

**1. Unit tests (Vitest).** They check one small piece of logic in isolation, and there are lots of them. Each runs in milliseconds. Example: "given a 429 with `Retry-After: 5`, the retry policy waits 5 seconds and pauses that account's queue".

```ts
it('merges columns and widens long+real to real', () => {
  const merged = mergeTables([tableA_long, tableB_real]);
  expect(merged.columns.find(c => c.name === 'Count')?.type).toBe('real');
});
```

`it(...)` names the behaviour; `expect(...)` states what must be true. If it isn't, the test fails and tells you exactly what differed.

**2. Component tests (Testing Library).** They render one piece of UI (e.g. the permission prompt) and click it like a user: "clicking *Always allow* stores the grant".

**3. Integration tests.** They check several real pieces together against a **fake Azure server** that the project contains. The real query engine talks HTTP to a pretend Log Analytics endpoint that can be told to return errors, throttle or hang. That's how the partial-failure logic gets tested without touching a real tenant.

**4. End-to-end (E2E) tests (Playwright).** They start the actual app in **demo mode** and drive it like a person: click, type a query, press Shift+Enter, check the grid shows merged rows. They're slow-ish, so there are only a few, covering the most important journeys.

This is the **testing pyramid**: many fast unit tests at the bottom, fewer integration tests, very few E2E tests at the top.

## Coverage

"Coverage" is the percentage of code lines that ran during tests. It's a smoke alarm, not a goal. The project requires 80% on the critical parts (query engine, auth, result store, audit) and 60% overall. High coverage on trivial code is worthless.

## Lint, format, typecheck

These are not tests but automatic reviewers:

- **Prettier** formats code the same way every time, so there are no style debates.
- **ESLint** flags suspicious patterns (unused variables, bad React hook usage, forbidden imports like Node APIs in the UI).
- **TypeScript typecheck** catches wrong types before the code runs.

## Commands you'll use

```
pnpm test            # all unit/integration tests once
pnpm test --watch    # re-run tests as you edit (great while working)
pnpm test:e2e        # E2E tests (builds and launches the app in demo mode)
pnpm lint            # lint + formatting check
pnpm format          # fix formatting automatically
pnpm typecheck
```

If a test fails, read the output top-down: test name → expected vs received → stack trace pointing at the line.

## CI: what happens on GitHub

1. You push a branch and open a **pull request** (PR).
2. GitHub Actions runs `ci.yml`: install, lint, typecheck, unit + integration tests, then E2E. On `main` it also builds installers for macOS, Windows and Linux.
3. A green check means safe to merge. A red X means click it, read the log, fix, and push again.
4. Branch protection (once enabled) makes green CI mandatory for merging to `main`.

Why PRs even when you're alone? The PR is where CI runs and where the change history is readable. With Claude Code: let it work on a branch, open a PR, look at the diff and CI, then merge.

## Conventional Commits and releases (release-please)

Commit messages follow a pattern:

- `feat(results): add markdown export` → new feature → **minor** version bump (1.2.0 → 1.3.0)
- `fix(auth): refresh token before expiry` → bug fix → **patch** bump (1.3.0 → 1.3.1)
- `feat!: …` or `BREAKING CHANGE:` in the body → **major** bump
- `docs:`, `test:`, `chore:`, `refactor:`, `ci:` → no release on their own

**release-please** reads these messages and keeps a "Release PR" open with the next version number and a generated CHANGELOG. When you want to ship, merge that PR. It tags the release, and `release.yml` builds, signs and uploads the installers to GitHub Releases. Installed apps then see the update through auto-update.

So releasing becomes: *merge the release PR*. That's it.

## Other robots in the repo

- **Dependabot** opens PRs when dependencies have updates. If CI is green, merging is usually safe.
- **CodeQL** is GitHub's security code scanner (free for public repos).
- **gitleaks** fails CI if a secret or token was committed. Important before going public.

## Private repo tip

GitHub gives private repos a limited number of free CI minutes per month, and macOS runners cost 10× the minutes. That's why the full three-OS build only runs on `main` while the repo is private. Once public, CI minutes are free and it can run on every PR.
