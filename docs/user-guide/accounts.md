---
title: Accounts and tenants
description: Sign in with several Microsoft accounts and reach workspaces in many tenants through Lighthouse, guest access or the Azure CLI.
---

# Accounts and tenants

Raml KQL uses **your own identity**. Every request to Azure is made with a token for the account you signed in with, so the app can only read what that account may read, and only while you are signed in. There are no service principals and no stored secrets.

You can be signed in with **several accounts at once**. One account can reach many tenants, and Raml KQL picks the right account and tenant for each workspace automatically.

## Adding an account

Open the account menu at the bottom of the activity bar (or the Command Palette, <kbd>F1</kbd>) and choose:

| Command                                          | Use it when                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts: Add Account…**                       | The normal case: your browser opens for the Microsoft sign-in.                                                                    |
| **Accounts: Add Account with Device Code**       | The browser sign-in can't redirect back to the app (some locked-down machines). You enter a code on another device.               |
| **Accounts: Add Azure CLI Account**              | You are signed in with `az login` and prefer to reuse that, for example because your organization doesn't allow the Raml KQL app. |
| **Accounts: Add Account with Custom Client ID…** | Your organization registered its own Entra app. See [Registering your own Entra app](../guides/register-your-own-entra-app.md).   |

Sign-ins always open your **system browser**, never an embedded window, so your password manager, passkeys and Conditional Access work as usual. Sign-in tokens are stored encrypted with your operating system's keychain, so you stay signed in across restarts. On Linux without a keyring, Raml KQL tells you and offers a session-only mode (`auth.sessionOnly`) instead of storing anything unencrypted.

## Lighthouse and guest access

Workspaces in other tenants reach you in one of three ways, and Raml KQL handles all of them:

- **Home tenant:** workspaces in the tenant your account belongs to.
- **Azure Lighthouse:** delegated subscriptions of your customers. They are visible from your own (managing) tenant and are accessed with a token from your home tenant.
- **Guest (B2B):** your account is a guest in another tenant. Raml KQL lists the tenants you belong to and asks for a token per tenant.

If the same workspace is reachable through two accounts or two routes, it appears **once**, and you can choose the preferred access path in the workspace settings. If the preferred path fails because of permissions, Raml KQL can try the next one (`query.fallbackAccessPaths`, on by default); every attempt is recorded in the [audit log](privacy-and-security.md#the-audit-log).

## Tenants that need you to sign in again

Multi-factor authentication, Conditional Access or a consent prompt sometimes require an interactive sign-in for one tenant. Raml KQL never opens a browser in the middle of a query. Instead the tenant shows a warning in the Accounts view with a **Sign in** action, and a single notification such as "2 tenants need you to sign in again" appears. Choose **Accounts: Sign In to Tenants That Need It** (or the notification's button), sign in, and then run **Query: Re-run Failed Workspaces**.

## Managing accounts

The **Accounts** view lists every account with its tenants and their state. Commands (all under **Accounts:**):

- **Set Account Label…** gives an account a friendly name ("Work – Contoso").
- **Sign In Again…** refreshes one account.
- **Refresh Accounts and Tenants** reloads the tenant list.
- **Sign Out…** removes the account and its tokens from the app.

Account labels and order are stored in `accounts.jsonc` in the [configuration folder](../reference/config-files.md); the file contains no tokens.

## Permissions you need

Raml KQL needs the same access you would need in the Azure portal: for example the **Log Analytics Reader** role on each workspace. If a workspace is listed but a query on it fails with a permission error, ask the workspace owner for the role. See [Troubleshooting](troubleshooting.md) for sign-in and consent problems.
