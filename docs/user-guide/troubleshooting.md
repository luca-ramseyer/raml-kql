---
title: Troubleshooting
description: Fixes for sign-in and consent problems, missing workspaces, failed runs and platform-specific issues.
---

# Troubleshooting

## Sign-in says approval or consent is required

Errors such as `AADSTS65001` (consent required) or `AADSTS90094` (admin approval required) mean your organization (or a customer tenant) doesn't allow users to consent to this app. A tenant administrator (for example a Cloud Application Administrator or Global Administrator) can approve it once for everyone: they sign in to Raml KQL with their own account, and on the Microsoft consent screen choose **Consent on behalf of your organization**. After that, nobody else in that tenant is asked again.

Alternatives that need no approval of the shared app: [register your own Entra app](../guides/register-your-own-entra-app.md) and add the account with its client ID, or sign in with the Azure CLI (**Accounts: Add Azure CLI Account** after `az login`).

## A tenant shows "Sign in" or a run says authentication is required

Multi-factor authentication or Conditional Access wants an interactive sign-in for that tenant. Run **Accounts: Sign In to Tenants That Need It**, then **Query: Re-run Failed Workspaces**. See [Accounts and tenants](accounts.md#tenants-that-need-you-to-sign-in-again).

## A workspace is missing from Targets

1. It may be **disabled**: open **Preferences: Open Workspaces Settings** and check its checkbox.
2. Run **Workspaces: Refresh Workspaces**. Discovery only lists what your accounts can see through Azure Resource Graph.
3. For a customer workspace, check that the Lighthouse delegation or guest access exists for the account you signed in with, and that the tenant isn't waiting for a sign-in (Accounts view).
4. Make sure you have at least reader access on a subscription that contains the workspace.

## A query fails on some workspaces

Open the **Run** tab: it shows each workspace's state and the server's message.

- `SemanticError … Failed to resolve table` means that workspace doesn't have the table (for example `SigninLogs` without Entra diagnostic settings). The other workspaces are unaffected.
- A permission error means your account lacks access to that workspace's data. Ask for the **Log Analytics Reader** role.
- `timeout` can be retried with **Query: Re-run Failed and Timed Out with a Longer Timeout**, or narrow the time range.
- Throttling ("too many requests") is retried automatically. If you often hit it, lower `query.maxConcurrentPerAccount`.

## IntelliSense shows no columns for a table

The schema is fetched and cached per workspace. Run **Query: Refresh Schema**. If one workspace's schema can't be read, a warning says "could not be loaded for 1 of n workspaces" and the rest still work.

## Excel shows everything in one column

Your region uses `;` as the list separator. Set `export.csv.delimiter` to `";"` (see the [settings reference](../reference/settings.md)).

## Linux

- **No keyring:** if no secret service (GNOME Keyring, KWallet) is running, Raml KQL can't store sign-ins encrypted and tells you so. Start a keyring, or set `auth.sessionOnly` to `true` to keep sign-ins in memory only.
- **AppImage and the sandbox:** on distributions that restrict unprivileged user namespaces (for example Ubuntu 24.04), the Chromium sandbox may refuse to start. Allow user namespaces for the app (an AppArmor profile or `sysctl kernel.apparmor_restrict_unprivileged_userns=0`) rather than disabling the sandbox. Raml KQL never ships with `--no-sandbox`.

## Behind a proxy

Sign-in, discovery and queries use the operating system's proxy settings automatically. If a proxy inspects TLS, make sure its root certificate is trusted by the operating system.

## Starting over

Close the app and move or delete `~/.raml-kql/` to reset settings, saved queries and workspace choices (back it up first: saved queries are only stored there). Signing out of an account removes its tokens. **Developer: Toggle Developer Tools** and **Developer: Show Network Activity** help when diagnosing problems.

## Still stuck?

[Open an issue](https://github.com/luca-ramseyer/raml-kql/issues/new/choose) with your version (**Help → About**), your operating system, what you expected and what happened. If the problem also happens in **demo mode**, say so. **Developer: Show Crash Report** gives a sanitized report you can paste. Never post real tenant IDs, customer names, tokens or query results.
