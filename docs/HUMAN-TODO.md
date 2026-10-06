# Things only Luca can do

Claude Code appends items here when blocked, and keeps working. Tick them off when done.

## Known upfront

- [x] **Entra multi-tenant app registration.** Follow `docs/guides/entra-app-registration.md`, then put the client ID in a local `.env` (`RAML_KQL_CLIENT_ID=...`) and later in the GitHub Actions secret `RAML_KQL_CLIENT_ID`.
  - Done: the local `.env` and the GitHub secret exist. The CI installer build passes the secret to the build (Phase 10 follow-up).
- [x] **Branding:** a 1024×1024 app icon (`apps/desktop/build/icon.png`). Done (1080×1080, committed).
- [x] **Raml colour values** for the optional Raml theme. Done: the built-in Raml Dark and Raml Light themes use the brand style guide (D-054).
- [x] **Apple signing:** create a "Developer ID Application" certificate, export it as .p12, and create an App Store Connect API key. Add the secrets `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (base64 .p8), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
  - Done 2026-10-06: certificate and notarization key are `release` environment secrets. v1.0.0 is signed and notarized for arm64 and x64.
- [ ] **Windows signing:** after going public, apply to SignPath Foundation (OSS program), or evaluate Microsoft's cloud signing service eligibility.
- [x] **Live test:** sign in with two accounts, verify Lighthouse workspaces are listed, run a query across them, and verify the guest-tenant re-auth prompt.
- [x] **Work approval:** before using Raml KQL on customer tenants at work, get it approved internally (it uses your delegated access, but it's still a new tool touching customer data).
- [ ] **Going public (Phase 12).** Do in this order, on the day:
  1. Decide about the git history (see below), then run `gitleaks detect` one last time.
  2. Settings → General → Danger zone → **Change visibility → Public**. Add a description and topics (`kql`, `azure`, `log-analytics`, `sentinel`, `electron`, `security`).
  3. Settings → Security: enable **private vulnerability reporting**, **CodeQL** (default setup) and **secret scanning with push protection**.
  4. Settings → Branches/Rulesets: protect `main` (require the `Lint, typecheck, unit tests`, `End-to-end tests (demo mode)` and `conventional-title` checks; squash merge only).
  5. Settings → Actions → General: allow Actions to create pull requests (release-please).
  6. Merge the first release PR and check the draft release.
  7. Publish `@raml-kql/extension-api` and `@raml-kql/extension-cli` to npm.

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

- [x] **Visual check against VS Code.** Put Raml KQL (`pnpm dev:demo`) next to VS Code in Dark Modern, Light Modern and High Contrast and note anything that looks off (spacing, colours, fonts, the macOS traffic-light position). Screenshots in an issue are ideal.
- [x] **Windows and Linux title bar.** I can only run macOS locally. On Windows and Linux, check that the menu bar works, that the native window controls (minimise/maximise/close) match the theme after switching themes, and that the window can be dragged by the title bar. CI runs the e2e tests on Linux under xvfb, but that doesn't show how it looks.

## Added during Phase 2

- [x] **Live sign-in test** (expands the "Live test" item above). With the client ID in `.env`, run `pnpm dev` (not demo) and:
  1. Accounts (bottom of the activity bar) → Add Account → Microsoft sign-in. Your browser opens; sign in and consent. The account appears with its home tenant and any guest tenants.
  2. Add a second account the same way (or with "device code").
  3. For a guest tenant with MFA or Conditional Access, check it shows "Sign in" and that clicking it opens the browser for that tenant.
  4. Quit and restart: both accounts should still be signed in (encrypted cache). On Linux, check the keyring message if no keyring is running.
  5. Optional: Azure CLI (`az login`, then Add Account → Azure CLI).
     Lighthouse workspaces show up with discovery in Phase 3.
- [x] **GitHub secret `RAML_KQL_CLIENT_ID`** so CI and release builds include the built-in sign-in (Settings → Secrets and variables → Actions). Without it, CI builds work but offer only custom client ID and Azure CLI sign-in.

## Added during Phase 3

- [x] **Live discovery test.** After signing in (Phase 2 steps), open Targets: your Log Analytics workspaces should appear, including Lighthouse-delegated ones, with Sentinel shields on Sentinel workspaces. Check that:
  1. names are aliased on startup ("Customer 01 …") and ⌘⌥P / Ctrl+Alt+P reveals them after confirmation;
  2. Workspaces settings (gear icon in Targets) lets you disable a workspace and it disappears from Targets;
  3. a workspace reachable through two accounts shows one row with an access-path dropdown;
  4. `~/.raml-kql/workspaces.jsonc` contains only resource IDs, enabled flags, aliases and tags (nothing secret).

## Added during Phase 4

- [x] **Live schema test.** Signed in with discovery done (Phase 3 steps), press ⌘N / Ctrl+N and:
  1. type the start of a table you know exists in only some selected workspaces: the completion shows `n/m`, and hovering the table name shows "Available in n/m selected workspaces";
  2. a custom `_CL` table and a workspace function show up in completions;
  3. `~/.raml-kql/state/schema-cache/` contains hashed `.json` files with only table, column and function names (no data, no workspace names in file names);
  4. Command Palette → "Query: Refresh Schema" works, and a workspace you can't read produces the "could not be loaded for 1 of n workspaces" warning.
     The metadata API has no maintained Learn reference (D-029). If any workspace's schema is missing although you can query it, please note which kind of workspace it is.

## Added during Phase 5

- [x] **Live query test.** Signed in with discovery done, open a query tab (⌘N / Ctrl+N), keep the sample query and press Shift+Enter:
  1. Results fill in as workspaces finish; the pill reads like "12 ✓ · 1 failed · 00:07". Click it for the Run tab: every workspace has a state, rows, duration and attempts, and failures show the server's message (e.g. `SemanticError: … Failed to resolve table …` for workspaces without `SigninLogs`).
  2. Press Escape during a longer query: it stops, and finished workspaces keep their rows.
  3. "Audit: Verify Log Integrity" from the Command Palette reports the log as intact; `~/.raml-kql/audit/audit-YYYY-MM.jsonl` has one line per workspace attempt and no result values.
  4. Quit the app: the `session-cache` folder in the app's data folder (macOS: `~/Library/Application Support/Raml KQL/`) is empty.
- [x] **Proxy test (if you work behind a proxy).** With the OS proxy configured, sign in, discover and run a query. All three should work without extra settings, because sign-in, ARM and Log Analytics now all use Chromium's network stack (D-023, D-032).

## Added during Phase 6

- [x] **Live results test.** Run a query that returns a few thousand rows across tenants, then check:
  1. sorting, column filters, quick search and "Filter to This Value" (right-click a cell) behave as you'd expect;
  2. double-clicking a row shows all its columns, and a `dynamic` cell shows its JSON;
  3. Group (toolbar) → "Group by Tenant";
  4. a `| render timechart` query draws one line per tenant.
- [x] **Verify the portal link.** Right-click a result cell → "Open Query in Azure Portal Logs" (or the link icon in the Run tab). The portal should open Logs on that workspace with the query filled in. For a Lighthouse customer it should open in your own tenant. If the portal changed its URL format, tell me what URL the portal's own "Copy link to query" produces.
- [x] **Verify the Defender device link** on a `DeviceProcessEvents` row (right-click → "Open Device in Microsoft Defender"), and an incident link from `SecurityIncident` (`IncidentUrl`).
- [x] **Exports in Excel:** open an exported XLSX and a CSV (with your locale's delimiter; set `export.csv.delimiter` to `;` if Excel shows everything in one column).

## Added during Phase 7

- [x] **Tabs across a restart.** Open three or four query tabs, split one to the right (`Cmd+\`), pick different targets in two of them, quit and start again. The tabs, groups, text, time range and targets should come back, each with the "results were cleared" note.
- [x] **My Queries in your dotfiles.** Save a query (`Cmd+S`), then look at `~/.raml-kql/queries/`. If you keep the config folder in git, check that the `.kql` file diff reads well and that `state/` stays out of git.
- [x] **History on real runs.** After a few real runs, search History by a table name and by a (real, with presentation mode off) tenant name, and use "Run Again".

## Added during Phase 8

- [x] **Starter pack against real data.** The example queries in `examples/packs/raml.starter` parse cleanly, but only a real workspace shows whether columns and values (e.g. `ResultType == "500121"`, the `AuditLogs` role fields) behave as intended. Import the folder ("Library: Import Pack from Folder…"), run each query on a Sentinel workspace, and tell me which ones return nothing useful or fail.
- [x] **A real git source.** Put a test pack in a public GitHub repository and add it with "Library: Add Pack Source…". Push a change and run "Check for Pack Updates", then review and apply it.
- [x] **A private repository.** Try the same with a private repository and a fine-grained token (read-only "Contents" on that one repository). Check that `~/.raml-kql/sources.jsonc` contains no token.
- [x] **Decide where packs are published.** For example a `raml-kql-packs` repository. I'll then point the Welcome page and the docs at it. The GitHub Actions snippet in `docs/guides/query-packs.md` works once `@raml-kql/extension-cli` is published to npm (Phase 12).

## Added during Phase 9

- [x] **Try the examples.** Run `pnpm build:examples`, then "Extensions: Install from File…" with `examples/extensions/dist/*.rkqlx`:
  - with the **VirusTotal Enricher** and your VirusTotal key ("VirusTotal: Set API Key…"), right-click an IP in real results → "Enrich Value with VirusTotal";
  - with the **Country Map**, run `SigninLogs | summarize count() by Country = tostring(LocationDetails.countryOrRegion)` and open the Country Map panel tab.

  Check the prompts read well to you.

- [x] **Brand colours for Raml Dark.** Done: the brand themes are built in (D-054); the teal example is now "Teal Dark".
- [ ] **Publish `@raml-kql/extension-api` and `@raml-kql/extension-cli` to npm** when the repo goes public (Phase 12). The scaffold's `package.json` and the author guide already point at those names.

## Added during Phase 10

- [x] **Turn on private vulnerability reporting** in the GitHub repository: Settings → Code security → Private vulnerability reporting → Enable. `SECURITY.md` tells people to use it.
- [x] **Decide on automatic crash reports.** Decided 2026-10-06: never send anything automatically, always ask (`crashReporting.mode: "ask"`, the default). Public builds have no Sentry endpoint anyway.
      Original note: By default, users review and file crash reports themselves (`crashReporting.mode: "ask"`). If you ever want reports sent automatically for your own builds, create a Sentry project and set the `RAML_KQL_SENTRY_DSN` secret for the build. Public builds should stay without it; tell me first and I'll document it in the privacy stance.
- [x] **Look at a crash report once.** Run "Developer: Show Crash Report" after a real error (or kill the app while it runs) and check the preview hides everything you'd consider sensitive. Tell me about anything that slips through; the sanitizer's test corpus grows with each case.

## Added during Phase 11

- [x] **GitHub Actions secrets for signing** (all optional: without them the release workflow builds unsigned installers). Create an **environment** named `release` (Settings → Environments → New environment), limit it to the `main` branch (Deployment branches and tags → Selected branches), and add the signing secrets there as _environment secrets_, not repository secrets. Only `RAML_KQL_CLIENT_ID` stays a repository secret (CI uses it too):
  - Done 2026-10-06 for macOS (environment `release`). The Windows secrets are not needed: Windows signing goes through SignPath.
  - macOS: `CSC_LINK` (the Developer ID Application certificate as a base64 `.p12`: `base64 -i cert.p12 | pbcopy`), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the App Store Connect `.p8` as base64), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. The notarization step runs only when all of them exist.
  - Windows, either a certificate (`WIN_CSC_LINK` as base64 `.pfx`, `WIN_CSC_KEY_PASSWORD`), or Microsoft's cloud signing service: secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and _variables_ (not secrets) `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`, `AZURE_SIGNING_PUBLISHER`. Check the service's current name and whether it accepts individuals in Switzerland.
- [x] **Allow GitHub Actions to create pull requests**: Settings → Actions → General → Workflow permissions → tick "Allow GitHub Actions to create and approve pull requests". release-please needs it to open the Release PR.
  - Done: release-please opened its Release PR.
- [x] **Try the release flow once, privately.** After merging this phase, look for the "chore(main): release 0.1.0" PR. Merge it, and check that the draft release gets installers for all three systems and then turns public. The first release is expected to be unsigned. To pick the version, put `Release-As: 1.0.0` in a commit body.
  - Done 2026-10-06: v1.0.0 was published with installers for all three systems. It took four workflow fixes (checkout of a draft's tag, the macOS keychain, an empty `CSC_LINK`, and a manual rebuild trigger).
- [ ] **Try an update end to end** (needs the repository public, or a local server): install release N, publish N+1, start N: after about 30 s a "Restart to Update" notification should appear. For a private-phase test, serve a folder of installers plus `latest*.yml` with electron-builder's `generic` provider (`publish: {provider: generic, url: http://localhost:8080}`) in a throwaway config.
- [ ] **Look at the unsigned installs on real machines:** macOS (right-click → Open the first time), Windows (SmartScreen "More info → Run anyway"), Linux AppImage (`chmod +x`) and the `.deb`. The README (Phase 12) must say what users will see.
- [ ] **Windows signing via SignPath Foundation** (decided 2026-10-06; Windows releases stay unsigned until then). Microsoft's cloud signing is not an option for an individual in Switzerland, and a paid OV certificate was passed over. Steps, in order:
  1. Make the repository public and publish a first (unsigned) release. SignPath requires the project to be released already in the form it will sign, actively maintained, OSI-licensed (MIT: fine) and described on its download page (the README).
  2. Apply at <https://signpath.org/> for the free OSS programme. Expect questions about the build process: it must be fully automated from the repository (it is: `release.yml`).
  3. Once accepted, send Claude Code the organization slug, project slug, signing policy slug and artifact configuration slug. It then adds a step to `release.yml` that uploads the Windows installer to SignPath with their GitHub Action, waits for the signed file and replaces it in the release (and regenerates `latest.yml`, since the file hash changes).
  4. Add the `SIGNPATH_API_TOKEN` secret. SignPath also requires a public code signing policy page in the README; Claude Code will draft it.
     The `AZURE_*` and `WIN_CSC_*` hooks in `electron-builder.config.mjs` stay available but unused.
- [ ] **Optional GPG key** to sign `SHA256SUMS` for Linux users.

---

## Summary: what is really still open (updated 2026-10-06, after going public)

The repository is public, v1.0.0 is released (macOS signed and notarized), the old repository is deleted. Everything ticked above is done. What is genuinely left:

### Done since going public

- [x] Repository public, old repository deleted, Advanced Security checked, signed macOS installer tried.
- [x] Private vulnerability reporting, CodeQL (default setup), secret scanning with push protection: enabled.
- [x] Branch protection: the ruleset "Protect main" requires a pull request (squash only), the three checks (`Lint, typecheck, unit tests`, `End-to-end tests (demo mode)`, `conventional-title`), and blocks force pushes and deletion. Nobody can bypass it, so to change it, edit or pause the ruleset in Settings → Rules.
- [x] README says macOS is signed and notarized (pull request "docs: README now says macOS is signed…").
- [x] Dependabot alerts: dompurify, uuid and source-map-js are overridden to patched versions (pull request "fix(deps): override vulnerable transitive dependencies"). The two alerts with no patch that only come in through electron-builder at build time (sprintf-js, http-cache-semantics) are dismissed as not used. One low alert, a DOMPurify `IN_PLACE` issue with no patch yet, stays open on purpose: Monaco is not known to use that mode, and it will clear when DOMPurify ships a fix.

### Still open (you)

- [ ] **Apply to SignPath Foundation** for free Windows signing (steps in the Phase 11 section above). The repository is public and a release exists, so you can apply now. Until then Windows shows SmartScreen warnings. Send Claude Code the slugs once accepted.
- [ ] **Publish `@raml-kql/extension-api` and `@raml-kql/extension-cli` to npm.** The scaffold and the author guide already use those names. Needs an npm account (and a login on your machine), so Claude Code can prepare but not publish.
- [ ] **Try an update end to end:** install v1.0.0, release the next version (the release pull request "release 1.1.0" can be it), start the old one and wait about 30 seconds for "Restart to Update". Now possible, because the repository is public.
- [ ] **Look at the installs on Windows and Linux:** SmartScreen "More info → Run anyway", AppImage (`chmod +x`), and the deb and rpm.

### Your decisions (not urgent)

- [ ] **Code of Conduct contact.** Reports currently go through GitHub's private reporting. If you want a mailbox instead, tell Claude Code and it replaces the text.
- [ ] **Your GitHub commit email** (Settings → Emails): set raml.ch as primary, "Keep my email addresses private" and "Block command line pushes that expose my email". Two squash-merge commits use your work address; you decided that is acceptable.
- [ ] **Whether to build "Verified by Raml KQL"** for the two example extensions (signed `.rkqlx` packages, a public key in the app). Not started; fine to leave for 1.1.
- [ ] **Optional GPG key** to sign `SHA256SUMS` (Linux users). Not started.
- [ ] **Release pull request "release 1.1.0":** leave it open until there is something worth shipping, then merge it.
