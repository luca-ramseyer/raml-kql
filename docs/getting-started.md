---
title: Getting started
description: Install Raml KQL, sign in, choose workspaces and run your first query, or try it in demo mode.
---

# Getting started

## Install

Download the installer for your system from the [latest release](https://github.com/luca-ramseyer/raml-kql/releases/latest).

| System  | File                                                                         | First start                                                                                                                    |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| macOS   | `Raml-KQL-<version>-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) | Open the dmg and drag the app to Applications. It is signed and notarized, so macOS opens it without a warning.                |
| Windows | `Raml-KQL-<version>-win-x64.exe` (or `-arm64`)                               | Run the installer. If SmartScreen appears, choose **More info → Run anyway**. It installs per user and needs no administrator. |
| Linux   | `.AppImage`, `.deb` or `.rpm`                                                | AppImage: make it executable (`chmod +x`) and run it; it updates itself. deb and rpm: install with your package manager.       |

The Windows installer is not code-signed yet, so SmartScreen doesn't know the publisher. Each release has a `SHA256SUMS` file to check your download against (`shasum -a 256 -c SHA256SUMS --ignore-missing` on macOS and Linux, `Get-FileHash` on Windows).

### Updates

The app checks GitHub Releases for new versions shortly after it starts and every few hours, downloads in the background, and offers **Restart to Update**. **Help → Check for Updates…** checks right away. To stop all update traffic, set `update.checkAutomatically` to `false`; to receive pre-releases too, set `update.channel` to `beta`. Installs from a `.deb` or `.rpm` package update through your package manager instead.

## Try it without Azure (demo mode)

Demo mode runs the whole app with fake accounts, tenants, workspaces and data. Nothing leaves your machine. Open the Command Palette (<kbd>F1</kbd>) and run **Restart in Demo Mode**; run **Exit Demo Mode (Restart)** to come back. Demo results are labelled "Demo data".

## What you need for real data

- A Microsoft account that can read the Log Analytics workspaces you want to query: at least the **Log Analytics Reader** role (or the `Microsoft.OperationalInsights/workspaces/query/read` permission) on each workspace.
- For customer workspaces: [Azure Lighthouse](user-guide/accounts.md#lighthouse-and-guest-access) delegation or guest access to those tenants.
- Your organization may need to approve the Raml KQL app once. See [Troubleshooting](user-guide/troubleshooting.md#sign-in-says-approval-or-consent-is-required), or [register your own app](guides/register-your-own-entra-app.md).

## Your first query

1. **Add an account.** Open the account menu at the bottom of the activity bar and choose **Add Account**. Your browser opens for the Microsoft sign-in. Add more accounts the same way.
2. **Let discovery finish.** Raml KQL lists your workspaces (including Lighthouse and guest tenants) in the **Targets** view. New workspaces are enabled by default; see [Workspaces and targets](user-guide/workspaces-and-targets.md) to hide the ones you never query.
3. **Pick targets.** Tick the workspaces, or choose a group, in the Targets view. Each query tab has its own selection.
4. **Write and run.** Press <kbd>Ctrl/Cmd</kbd>+<kbd>N</kbd> for a new query tab, choose a time range, and press <kbd>Shift</kbd>+<kbd>Enter</kbd>. Results appear as each workspace finishes.

```kusto
SigninLogs
| where TimeGenerated > ago(1d)
| summarize SignIns = count(), FailedSignIns = countif(ResultType != "0") by UserPrincipalName
| top 20 by FailedSignIns
```

Every row carries the tenant and workspace it came from. Continue with [writing and running queries](user-guide/running-queries.md) and [working with results](user-guide/results.md).

## Where your data lives

Settings, saved queries, workspace choices and groups are plain files in a folder in your home directory, `~/.raml-kql/` (see [configuration files](reference/config-files.md)). Sign-in tokens are kept encrypted by your operating system's keychain. Query results are never written to disk in the clear. The [privacy page](user-guide/privacy-and-security.md) has the details.
