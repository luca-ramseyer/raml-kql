# Things only Luca can do

Claude Code appends items here when blocked, and keeps working. Tick them off when done.

## Known upfront

- [ ] **Entra multi-tenant app registration.** Follow `docs/guides/entra-app-registration.md`, then put the client ID in a local `.env` (`RAML_KQL_CLIENT_ID=...`) and later in the GitHub Actions secret `RAML_KQL_CLIENT_ID`.
  - Status (Phase 0): a local `.env` with `RAML_KQL_CLIENT_ID` already exists and is git-ignored. The GitHub secret is still to do once the repo exists.
- [ ] **Branding:** a 1024×1024 app icon (`apps/desktop/build/icon.png`) and the Raml colour values for the optional Raml theme.
- [ ] **Apple signing:** create a "Developer ID Application" certificate, export it as .p12, and create an App Store Connect API key. Add the secrets `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (base64 .p8), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
- [ ] **Windows signing:** after going public, apply to SignPath Foundation (OSS program), or evaluate Microsoft's cloud signing service eligibility.
- [ ] **Live test:** sign in with two accounts, verify Lighthouse workspaces are listed, run a query across them, and verify the guest-tenant re-auth prompt.
- [ ] **Work approval:** before using Raml KQL on customer tenants at work, get it approved internally (it uses your delegated access, but it's still a new tool touching customer data).
- [ ] **Going public (Phase 12):** flip repo visibility, enable private vulnerability reporting, CodeQL and branch protection.

## Added during Phase 0

- [x] **Create the GitHub repository and push.** Nothing has been pushed anywhere yet; the repo only exists locally. Suggested (private until Phase 12):
  ```bash
  gh repo create raml-kql --private --source . --remote origin
  git push -u origin main phase/0-scaffold
  gh pr create --base main --head phase/0-scaffold --fill
  ```
  Then check that the **CI** and **PR title** workflows go green on that PR (Phase 0 acceptance: "CI passes on a PR"). Claude Code can do this for you if you say so.
- [x] **Create the `full-ci` label** (done by Claude Code) in the GitHub repo (Issues → Labels). Adding it to a PR runs the three-OS installer build, which otherwise only runs on `main`.
- [ ] **Branch protection on `main`** (if your plan allows it on private repos; otherwise at Phase 12): require the `Lint, typecheck, unit tests`, `End-to-end tests (demo mode)` and `conventional-title` checks, and allow squash merges only.

## Added during Phase 1

- [ ] **Visual check against VS Code.** Put Raml KQL (`pnpm dev:demo`) next to VS Code in Dark Modern, Light Modern and High Contrast and note anything that looks off (spacing, colours, fonts, the macOS traffic-light position). Screenshots in an issue are ideal.
- [ ] **Windows and Linux title bar.** I can only run macOS locally. On Windows and Linux, check that the menu bar works, that the native window controls (minimise/maximise/close) match the theme after switching themes, and that the window can be dragged by the title bar. CI runs the e2e tests on Linux under xvfb, but that doesn't show how it looks.

## Added during Phase 2

- [ ] **Live sign-in test** (expands the "Live test" item above). With the client ID in `.env`, run `pnpm dev` (not demo) and:
  1. Accounts (bottom of the activity bar) → Add Account → Microsoft sign-in. Your browser opens; sign in and consent. The account appears with its home tenant and any guest tenants.
  2. Add a second account the same way (or with "device code").
  3. For a guest tenant with MFA or Conditional Access, check it shows "Sign in" and that clicking it opens the browser for that tenant.
  4. Quit and restart: both accounts should still be signed in (encrypted cache). On Linux, check the keyring message if no keyring is running.
  5. Optional: Azure CLI (`az login`, then Add Account → Azure CLI).
     Lighthouse workspaces show up with discovery in Phase 3.
- [ ] **GitHub secret `RAML_KQL_CLIENT_ID`** so CI and release builds include the built-in sign-in (Settings → Secrets and variables → Actions). Without it, CI builds work but offer only custom client ID and Azure CLI sign-in.

## Added during Phase 3

- [ ] **Live discovery test.** After signing in (Phase 2 steps), open Targets: your Log Analytics workspaces should appear, including Lighthouse-delegated ones, with Sentinel shields on Sentinel workspaces. Check that:
  1. names are aliased on startup ("Customer 01 …") and ⌘⌥P / Ctrl+Alt+P reveals them after confirmation;
  2. Workspaces settings (gear icon in Targets) lets you disable a workspace and it disappears from Targets;
  3. a workspace reachable through two accounts shows one row with an access-path dropdown;
  4. `~/.raml-kql/workspaces.jsonc` contains only resource IDs, enabled flags, aliases and tags (nothing secret).

## Added during Phase 4

- [ ] **Live schema test.** Signed in with discovery done (Phase 3 steps), press ⌘N / Ctrl+N and:
  1. type the start of a table you know exists in only some selected workspaces: the completion shows `n/m`, and hovering the table name shows "Available in n/m selected workspaces";
  2. a custom `_CL` table and a workspace function show up in completions;
  3. `~/.raml-kql/state/schema-cache/` contains hashed `.json` files with only table, column and function names (no data, no workspace names in file names);
  4. Command Palette → "Query: Refresh Schema" works, and a workspace you can't read produces the "could not be loaded for 1 of n workspaces" warning.
     The metadata API has no maintained Learn reference (D-029). If any workspace's schema is missing although you can query it, please note which kind of workspace it is.

## Added during Phase 5

- [ ] **Live query test.** Signed in with discovery done, open a query tab (⌘N / Ctrl+N), keep the sample query and press Shift+Enter:
  1. Results fill in as workspaces finish; the pill reads like "12 ✓ · 1 failed · 00:07". Click it for the Run tab: every workspace has a state, rows, duration and attempts, and failures show the server's message (e.g. `SemanticError: … Failed to resolve table …` for workspaces without `SigninLogs`).
  2. Press Escape during a longer query: it stops, and finished workspaces keep their rows.
  3. "Audit: Verify Log Integrity" from the Command Palette reports the log as intact; `~/.raml-kql/audit/audit-YYYY-MM.jsonl` has one line per workspace attempt and no result values.
  4. Quit the app: the `session-cache` folder in the app's data folder (macOS: `~/Library/Application Support/Raml KQL/`) is empty.
- [ ] **Proxy test (if you work behind a proxy).** With the OS proxy configured, sign in, discover and run a query. All three should work without extra settings, because sign-in, ARM and Log Analytics now all use Chromium's network stack (D-023, D-032).
