---
title: Privacy and crash reporting
description: The privacy stance and how crash reports work without telemetry.
---

# Privacy stance and crash reporting

## Privacy stance (put this verbatim-ish in README and SECURITY.md)

- **No telemetry.** Raml KQL does not collect usage data, analytics, feature counters or identifiers.
- Your queries go from your machine straight to Microsoft, using your own identity. No Raml KQL server is involved.
- Results stay in memory, or in an encrypted session cache that is destroyed when the app closes.
- The only network traffic the app itself initiates:
  - Microsoft identity/Azure endpoints you query
  - git hosts for sources you added
  - the GitHub Releases update check (disable with `update.checkAutomatically: false`)
- Extensions can only reach the network after you grant it.

Add a **"Network Activity"** developer view (command "Developer: Show Network Activity") listing the hosts contacted this session with counts. It makes the claims verifiable, which matters to a security audience.

## Crash reporting: local first, user-sent

The goal is to get actionable crash reports without a telemetry backend and without leaking customer data.

1. **Capture:**
   - Uncaught exceptions / unhandled rejections in main and renderer, extension-host crashes (attributed to the extension), and `render-process-gone` / `child-process-gone`.
   - Electron `crashReporter` with `uploadToServer: false` for native minidumps, stored locally in `state/crashes/`.
2. **Sanitize** before anything is shown or sent. Keep stack traces with app-relative paths. Strip or replace:
   - Query text
   - Tenant, subscription and workspace IDs and names (GUID regex → `<guid>`)
   - UPNs/emails
   - IPs
   - JWT-like strings
   - Home directory paths (→ `~`)
   - Anything from result data
3. **Next start after a crash:** a notification "Raml KQL closed unexpectedly. Report the problem?" with actions:
   - **Preview & Report on GitHub**: shows the sanitized report in an editor tab so the user can read and edit it, then opens a prefilled GitHub new-issue URL (title, app version, OS, Electron version, sanitized stack). The user submits it themselves in the browser. Minidumps are **not** attached automatically; instructions explain how to attach one if a maintainer asks.
   - **Copy report**
   - **Don't ask again**
4. **Setting `crashReporting.mode`:**
   - `"ask"` (default): the flow above.
   - `"off"`: capture locally only, never prompt.
   - `"auto"`: send sanitized reports to a configured endpoint.
     - Implement the plumbing behind an interface, with a Sentry adapter (`@sentry/electron`, `sendDefaultPii: false`, `beforeSend` running the same sanitizer, no breadcrumbs of user data) enabled only when a DSN is configured at build time.
     - Public builds ship **without** a DSN. Enabling it is a maintainer decision and would be documented in the privacy stance first.

Tests: the sanitizer gets a corpus-based unit test (fixtures containing GUIDs, UPNs, IPs, JWTs, paths, KQL). Every sensitive token must be removed.
