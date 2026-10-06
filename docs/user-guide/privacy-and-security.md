---
title: Privacy and security
description: What Raml KQL stores, what it sends, how results are protected, the audit log, and how crash reports work without telemetry.
---

# Privacy and security

Raml KQL handles access tokens and customer security data, so it is built to keep both on your machine.

## What leaves your machine

- **No telemetry.** Raml KQL does not collect usage data, analytics, feature counters or identifiers.
- Your queries go from your machine straight to Microsoft, with your own identity. No Raml KQL server exists.
- The only network traffic the app starts itself goes to the Microsoft identity and Azure endpoints you query, to git hosts of query pack and extension sources you added, and to GitHub for the update check (which you can turn off with `update.checkAutomatically`).
- Extensions can reach the network only after you allow it, per host.
- **You can check this yourself:** the command **Developer: Show Network Activity** lists every host contacted in the current session, with counts.

## What is stored, and where

| Data                                               | Where                                                                    | Protection                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Sign-in tokens                                     | The app's data folder (macOS: `~/Library/Application Support/Raml KQL/`) | Encrypted with your operating system's keychain; removed when you sign out                                         |
| Query results                                      | Memory; larger sets spill to an encrypted cache                          | The key exists only in memory. The cache is destroyed when the app quits and wiped on the next start after a crash |
| Settings, saved queries, workspace choices, groups | `~/.raml-kql/` ([details](../reference/config-files.md))                 | Plain readable files. They hold no tokens, keys or results                                                         |
| Query text, tabs, history                          | `~/.raml-kql/state/` and `queries/`                                      | Plain files. Query **text** is saved, result **data** never is                                                     |
| Audit log                                          | `~/.raml-kql/audit/`                                                     | Hash-chained, see below                                                                                            |

The only way result data leaves the session is an export or copy you ask for.

## The audit log

Raml KQL keeps a local, append-only log of what ran where: for every workspace attempt, the time, the account and tenant, the workspace, the query (or just its hash, with `audit.includeQueryText` off), the state, row count and duration. It also records sign-ins and sign-outs, extension installs and permission grants, and added sources. It **never** contains tokens or result values.

Each line contains the hash of the previous line, so tampering is evident: run **Audit: Verify Log Integrity** to check the chain. The log is a set of JSON Lines files in `~/.raml-kql/audit/` (`audit-YYYY-MM.jsonl`, one per month), which any tool can read, for example to answer "which customers did I query, and when?". A viewer inside the app (the **Audit** tab in the panel) is not built yet. Files are kept for `audit.retentionMonths` (12 by default).

## Protection on screen

Tenant, subscription and workspace names are aliased by default. See [Aliased names](workspaces-and-targets.md#aliased-names-presentation-mode).

## Crash reports

If Raml KQL crashes, it records the crash **locally**, sanitized: tenant, subscription and workspace IDs and names, e-mail addresses, IP addresses, tokens, file paths and query text are replaced. On the next start it offers to show you the sanitized report and open a prefilled GitHub issue; you read it, edit it if you like, and submit it yourself in the browser. Nothing is ever sent automatically. **Developer: Show Crash Report** shows the latest one any time. `crashReporting.mode` is `"ask"` by default; `"off"` stops the offer.

## The application itself

- The window runs sandboxed with a strict content security policy. Azure access, tokens and file access live in a separate main process, and every message between them is validated.
- Release builds use hardened Electron settings (for example, Node.js can't be started from the app binary), and the macOS app is signed and notarized.
- Extensions and query packs are data or sandboxed code, and updates to them need your approval.

## Reporting a vulnerability

Please **don't open a public issue**. Use **Report a vulnerability** on the Security tab of the [GitHub repository](https://github.com/luca-ramseyer/raml-kql/security) (private reporting) and include the version, your operating system and steps to reproduce. Never include real tenant IDs, customer names, tokens or query results; use fake values. See [SECURITY.md](https://github.com/luca-ramseyer/raml-kql/blob/main/SECURITY.md).
