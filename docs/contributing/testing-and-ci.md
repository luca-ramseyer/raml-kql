---
title: Testing and CI
description: What the tests and continuous integration do, how to run them, and how pull requests are checked.
---

# Testing and CI

This guide explains _what_ the project's tests and continuous integration (CI) do and _why_, for contributors and maintainers. It assumes you can code, not that you have set up CI before.

## The one-sentence version

Tests are small programs that check your program. CI is a robot (GitHub Actions) that runs all those checks on every change, so nothing broken gets merged or released.

## Why bother, for a tool like this

The project is maintained for years, many people send pull requests, and some of the code is subtle (retries, rate limits, encryption, permission checks). Without tests, every change risks breaking something nobody notices until an analyst's query silently misses three tenants. Tests make that visible in seconds, before release.

Think of it like detection engineering: a test is an analytic rule for code. It fires when behaviour changes.

## The kinds of tests here

**1. Unit tests (Vitest).** They check one small piece of logic in isolation, and there are lots of them. Each runs in milliseconds. Example: "given a 429 with `Retry-After: 5`, the retry policy waits 5 seconds and pauses that account's queue".

```ts
it('merges columns and widens long+real to real', () => {
  const merged = mergeTables([tableA_long, tableB_real]);
  expect(merged.columns.find((c) => c.name === 'Count')?.type).toBe('real');
});
```

`it(...)` names the behaviour; `expect(...)` states what must be true. If it isn't, the test fails and tells you exactly what differed.

**2. Component tests (Testing Library).** They render one piece of UI (e.g. the permission prompt) and click it like a user: "clicking _Always allow_ stores the grant".

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
pnpm test                          # all unit/integration tests once
pnpm test --watch                  # re-run tests as you edit (great while working)
pnpm test --project desktop-node   # only one test project (see below)
pnpm test --coverage               # also write a coverage report to coverage/index.html
pnpm test:e2e                      # E2E tests (builds and launches the app in demo mode)
pnpm lint                          # lint + formatting check
pnpm format                        # fix formatting automatically
pnpm typecheck
pnpm check:licenses                # fail if any dependency has a copyleft licence
pnpm check:docs                    # docs: front matter, navigation, links, generated reference pages
pnpm docs:generate                 # regenerate the settings and keyboard shortcut reference
```

If a test fails, read the output top-down: test name → expected vs received → stack trace pointing at the line.

## How it's wired in this repo

- **One Vitest config** at the repo root (`vitest.config.ts`) with three _projects_:
  - `desktop-node`: main process, preload and shared code, plus `apps/desktop/test/` (security and integration tests). Runs in plain Node.
  - `desktop-renderer`: React components, in **jsdom** (a simulated browser).
  - `packages`: everything under `packages/`.
- **Where tests live:** unit tests sit next to the code as `something.test.ts`. Cross-module tests go in `apps/desktop/test/integration/`, security regression tests in `apps/desktop/test/security/`, and E2E tests in `apps/desktop/e2e/`.
- **No real network in tests.** `apps/desktop/test/setup/no-network.ts` runs before every test file and makes any request to a non-local host throw `Blocked real network access in a test`. Local servers (the fake Azure server, later) are allowed. If you see that error, the code under test tried to reach the internet, which is a bug in the test or the code.
- **Testing Electron code without Electron.** Modules that talk to Electron accept a small interface (for example `IpcMainLike` instead of Electron's `ipcMain`). Tests pass in a fake (`apps/desktop/test/helpers/fake-ipc.ts`), so they run in milliseconds.
- **Workbench tests without Electron.** `apps/desktop/test/helpers/workbench-harness.ts` starts the real renderer in jsdom and connects it to the _real_ preload API and main-process IPC router; only the main-process services (settings file, layout file, window) are replaced by fakes. That's how `App.test.tsx` can press Cmd+B, open the command palette or simulate someone editing settings.jsonc, all in milliseconds.
- **Fake Azure server.** `apps/desktop/test/fake-azure/server.ts` is a real HTTP server on 127.0.0.1 that pretends to be Azure (so far: ARM `/tenants`, with paging and injectable failures such as HTTP 503). Integration tests point the real clients at it, so they test real HTTP without touching a real tenant.
- **E2E tests** build the app, launch it with `--demo` and a throwaway config folder, and drive the real window through Playwright. The app only allows one running instance, so if E2E tests fail with "Target page, context or browser has been closed", check that no other copy of the dev app is running.

## CI: what happens on GitHub

1. You push a branch and open a **pull request** (PR).
2. GitHub Actions runs `.github/workflows/ci.yml`:
   - **Lint, typecheck, unit tests** (`check`): scans the history for committed secrets (gitleaks), installs, lints, typechecks, runs the tests with coverage, and runs the licence check. The coverage report is attached to the run as an artifact.
   - **End-to-end tests** (`e2e`): builds the app and runs the Playwright tests on Linux inside a virtual display (`xvfb-run`). If they fail, the Playwright report (with screenshots and traces) is attached to the run.
   - **Package** (`build-matrix`): builds installers on macOS, Windows and Linux. Only on `main`, or on a PR with the `full-ci` label (it's expensive on a private repo).
3. `.github/workflows/pr-title.yml` checks that the PR title is a Conventional Commit (see below), because the PR title becomes the commit message when you squash-merge.
4. A green check means safe to merge. A red X means click it, read the log, fix, and push again.
5. Branch protection (once enabled) makes green CI mandatory for merging to `main`.

Why PRs even for a maintainer's own changes? The PR is where CI runs and where the change history is readable.

## Conventional Commits and releases (release-please)

Commit messages follow a pattern:

- `feat(results): add markdown export` → new feature → **minor** version bump (1.2.0 → 1.3.0)
- `fix(auth): refresh token before expiry` → bug fix → **patch** bump (1.3.0 → 1.3.1)
- `feat!: …` or `BREAKING CHANGE:` in the body → **major** bump
- `docs:`, `test:`, `chore:`, `refactor:`, `ci:` → no release on their own

**release-please** reads these messages and keeps a "Release PR" open with the next version number and a generated CHANGELOG. Merging that PR ships a release; how that works is described in [Releasing](releasing.md).

## Other robots in the repo

- **Dependabot** opens PRs when dependencies have updates. If CI is green, merging is usually safe.
- **CodeQL** is GitHub's security code scanner.
- **gitleaks** fails CI if a secret or token was committed. Important before going public.

- **Branch protection** on `main` requires a pull request and the three checks (`Lint, typecheck, unit tests`, `End-to-end tests (demo mode)` and the PR title check), and blocks force pushes.
