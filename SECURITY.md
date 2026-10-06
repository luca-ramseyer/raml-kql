# Security and privacy

This page describes the security design and how to report vulnerabilities. The formal statement of what data is handled is the [privacy policy](docs/privacy-policy.md).

Raml KQL handles access tokens and customer security data, so it is built to keep both on your
machine.

## Privacy stance

- **No telemetry.** Raml KQL does not collect usage data, analytics, feature counters or
  identifiers.
- Your queries go from your machine straight to Microsoft, with your own identity. No Raml KQL
  server is involved.
- Results stay in memory, or in an encrypted session cache (AES-256-GCM, key only in memory)
  that is destroyed when the app closes and wiped on the next start after a crash.
- The only network traffic the app itself starts:
  - Microsoft identity and Azure endpoints you query;
  - git hosts of query pack and extension sources you added;
  - the GitHub Releases update check (can be turned off).
- Extensions run sandboxed and can reach the network only after you allow it, per query run by
  default.
- **Developer: Show Network Activity** lists every host contacted in the current session, so
  you can verify the points above.

## Crash reports

Crashes are recorded locally in the config folder (`state/crashes/`), **sanitized before they
are written**: tenant, subscription and workspace IDs and names, e-mail addresses and UPNs,
IP addresses, tokens, file paths and query text are replaced. After a crash, Raml KQL shows the
sanitized report and you choose whether to open a prefilled GitHub issue, which you submit
yourself in the browser. Native crash dumps stay on your machine; attach one only if a
maintainer asks. The setting `crashReporting.mode` (`ask`, `off`, `auto`) controls this.
`auto` only works in builds configured with a reporting endpoint, and public builds have none.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
vulnerability reporting instead: the **Security** tab of this repository → **Report a
vulnerability**. Include the version, your OS, and steps to reproduce. You'll get an answer
within a few days, and a fix is coordinated with you before anything is published.

Never include real tenant IDs, customer names, tokens or query results in a report. Use
placeholders.
