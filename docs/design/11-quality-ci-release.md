---
title: Quality, CI, signing and release
description: Testing strategy, CI, signing, auto-update and release automation.
---

# Testing, CI, signing, auto-update, release

The maintainer is learning testing and CI with this project. Keep configs conventional and well commented, and keep `docs/contributing/testing-and-ci.md` in sync when you change anything here.

## Testing strategy

| Layer | Tool | What | Where |
|---|---|---|---|
| Unit | Vitest | Pure logic: token routing, scheduler/rate limiter, retry policy, merge + type widening, KQL literal encoder, parameter injection, "set in query" detection, aliasing transforms, masking rules, sanitizer, config parsing/merging, audit hash chain, deep-link builders, manifest/pack schemas | next to source, `*.test.ts` |
| Component | Vitest + Testing Library (jsdom) | Settings UI, Targets tree, parameter form, permission prompt, quick pick | `src/renderer/**/*.test.tsx` |
| Integration | Vitest (node) + fake Azure server | Real HTTP clients + QueryEngine + ResultStore against `test/fake-azure` with fault injection; SourceService against local bare git repos created in temp dirs; ExtensionManager with example extensions | `apps/desktop/test/integration/` |
| E2E | Playwright `_electron` | Launch the built app with `--demo`: sign-in flow (demo), enable/disable workspace, run query across targets, see merged rows + Run panel, cancel, export CSV, toggle presentation mode, install example pack from local git, extension permission prompt, restart clears results but keeps tabs | `apps/desktop/e2e/` |
| Security regression | Vitest | `webPreferences` of every window; CSP present; navigation blocked; IPC rejects invalid payloads/unknown senders; extension worker cannot `fetch` | `test/security/` |

- Coverage: V8 coverage via Vitest. Enforce **≥80% lines on `src/main/query`, `src/main/auth`, `src/main/results`, `src/main/audit` and `packages/*`**. Global threshold 60%. Don't chase 100%.
- Tests must be deterministic: fake timers for backoff and rate limits, seeded PRNG for demo data, no real network. Add a guard that fails a test if a real outbound request happens.
- **Live smoke tests** (optional, manual): `pnpm test:live` runs a tiny read-only query against a workspace configured via env vars, used by maintainers against their own tenant. It is never run in CI by default.

## Lint and format

ESLint flat config (typescript-eslint strict + stylistic off, react, react-hooks, import/no-cycle, no-restricted-imports forbidding `electron` in the renderer and `node:*` in the renderer/extension-api), Prettier, and `tsc --noEmit` per workspace. Optionally use lint-staged + a simple-git-hooks pre-commit hook for format and lint on staged files.

## CI (GitHub Actions)

### `.github/workflows/ci.yml`: on pull_request and push to `main`

- **Job `check`** (ubuntu-latest): pnpm setup with cache → `pnpm install --frozen-lockfile` → `pnpm lint` → `pnpm typecheck` → `pnpm test --coverage` → upload the coverage artifact.
- **Job `e2e`** (ubuntu-latest, needs `check`): build → `xvfb-run pnpm test:e2e` → upload the Playwright report on failure.
- **Job `build-matrix`** (only on push to `main`, or on PRs labelled `full-ci`): `macos-latest`, `windows-latest`, `ubuntu-latest` → `pnpm dist` without signing → upload installers as artifacts (retention 7 days).
  - Reason: GitHub Actions minutes are limited for private repos and macOS runners consume them 10× faster. Once the repo is public, run the matrix on every PR.
- Concurrency group per branch with `cancel-in-progress: true`.

### Other workflows

- `.github/workflows/codeql.yml`: CodeQL for JS/TS, weekly + on PR. Enable it when public; it's free for public repos.
- `.github/dependabot.yml`: weekly npm and github-actions updates, grouped (minor/patch together).
- Secret scanning: a `gitleaks` step in `check` (fails on detected secrets).
- License check: `license-checker` or similar, failing on GPL/AGPL in production deps.

## Versioning and releases

- **Conventional Commits → release-please** (`googleapis/release-please-action`, node release type, monorepo manifest config).
  - release-please keeps a "Release PR" open that bumps versions and writes `CHANGELOG.md` from commit messages.
  - Merging that PR creates the tag `vX.Y.Z` and a GitHub Release draft.
- **`.github/workflows/release.yml`**, on push to `main` (release-please and the build live in one workflow, because releases made with `GITHUB_TOKEN` don't trigger other workflows; D-056): matrix mac/win/linux → build → sign/notarize (when secrets exist) → `electron-builder --publish always` uploads installers + `latest*.yml` update metadata to that GitHub Release.
- Pre-releases for the beta channel use a `-beta.N` suffix and are marked as prerelease; electron-updater's `allowPrerelease` follows `update.channel`.

## Packaging (electron-builder)

- `appId: ch.raml.kql`, `productName: Raml KQL`, artifact names `Raml-KQL-${version}-${os}-${arch}.${ext}`.
- mac: `dmg` + `zip` (zip is required for auto-update), arm64 + x64 as separate artifacts (D-055), `hardenedRuntime: true`, entitlements minimal (JIT for V8 if required by Electron; no camera/mic).
- win: `nsis` (per-user install by default, optional per-machine), x64 + arm64.
- linux: `AppImage` (auto-update capable), `deb`, `rpm`. Correct `chrome-sandbox` permissions.
- Icons generated from a single 1024 px source in `build/icon.png` (the project's own icon).

## Code signing (all via CI secrets; skip gracefully when absent)

- **macOS:** Developer ID Application certificate + notarization with an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) using electron-builder's built-in notarize. The maintainer's Apple Developer membership provides the Developer ID certificate; export it as `.p12` and add `CSC_LINK`, `CSC_KEY_PASSWORD` plus the API key as environment secrets.
- **Windows:** implement a pluggable `win.sign` hook supporting:
  - (a) **SignPath Foundation**: free code signing for OSS projects. Requires a public repo with an OSI license; apply after going public.
  - (b) **Microsoft's cloud signing service** (Trusted Signing, possibly renamed since; check the current name and whether individuals in Switzerland are eligible).
  - (c) a classic certificate via `CSC_LINK`.
  - Before signing is available, Windows builds are unsigned and SmartScreen warns; document this in the README.
- **Linux:** no OS signing. Publish SHA-256 checksums (`SHA256SUMS`) with every release and optionally sign them with a GPG key.

## Auto-update

- electron-updater with the GitHub provider.
  - It checks on startup (delayed 30 s) and every 6 h when `update.checkAutomatically` is set.
  - Downloads happen in the background, then a VS Code-like notification offers "Restart to Update". There is also a manual "Check for Updates…" command.
- **Private repo caveat:** electron-updater can't read private GitHub Releases without a token, so auto-update effectively starts when the repo goes public. During the private phase, test updates with a local update server (electron-builder's `generic` provider pointing to a local folder).
- macOS auto-update requires signed builds. Windows works unsigned but with warnings. AppImage works unsigned.

## Repository hygiene for going public later

- Develop in a private repo from day one **as if public**: no secrets, no real customer data, MIT `LICENSE` present, and `THIRD_PARTY_NOTICES.md` maintained.
- Before flipping to public, run the Phase 12 checklist: a gitleaks full-history scan, a license audit, and a docs review.
- Enable GitHub "Private vulnerability reporting" and describe it in SECURITY.md.
- Branch protection on `main` (when possible on the plan): require the CI checks and PRs, and allow squash merges only (the PR title must be a Conventional Commit; add a small `amannn/action-semantic-pull-request` check).
