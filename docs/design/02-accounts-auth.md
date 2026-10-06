---
title: Accounts and authentication
description: Multi-account, multi-tenant sign-in with MSAL, token routing and tenant enumeration.
---

# Accounts and authentication

## Goals

- Users sign in with **their own user identities** (delegated permissions). There are no service principals and no stored secrets.
- **Multiple accounts** can be signed in at once. One account can reach one or many tenants. Workspaces are reachable through:
  - the account's home tenant,
  - Azure Lighthouse delegations, which appear as subscriptions visible from the home tenant,
  - B2B guest memberships in other tenants.
- Queries run with the right account and the right tenant authority automatically.

## Auth provider modes (setting `auth.provider`)

1. **`builtin`** (default): MSAL public client using the Raml KQL multi-tenant app registration. The client ID is injected at build time from `RAML_KQL_CLIENT_ID`. Builds without a client ID fall back to `custom` mode. See [Registering your own Entra app](../guides/register-your-own-entra-app.md).
2. **`custom`**: same MSAL flow with a user-supplied client ID (and optional authority host for sovereign clouds). This is for organisations that won't consent to a third-party app and register their own.
3. **`azureCli`**: tokens via `az account get-access-token --tenant <id> --resource <res>`. This requires Azure CLI installed and `az login` done. Accounts then mirror `az account list`. It is useful where app consent is impossible. "Sign in" for a tenant that needs it runs `az login --tenant <id>`, which opens the system browser (D-035).

The provider is chosen per account, so a user can mix a `builtin` account and an `azureCli` account.

## MSAL setup (builtin / custom)

- `@azure/msal-node` `PublicClientApplication`, `authority: https://login.microsoftonline.com/organizations`.
- Client capabilities: `["cp1"]` (CAE-ready).
- Token cache: `@azure/msal-node-extensions` persistence plugin (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
  - If libsecret is unavailable on Linux, show a clear error with install instructions.
  - Do **not** silently fall back to plaintext. Offer an explicit opt-in "session-only (no persistent sign-in)" mode instead.
- Interactive sign-in: `acquireTokenInteractive` with loopback redirect (`http://localhost`) and the **system browser** (`shell.openExternal`). Never use an embedded webview for login.
- Fallback flow: device code, available from the "Add account" dropdown for environments where the loopback redirect is blocked.
- Scopes:
  - ARM: `https://management.azure.com/user_impersonation`
  - Log Analytics: `https://api.loganalytics.io/Data.Read`
  - Sign-in: `openid profile offline_access`
- Request ARM at sign-in. Acquire Log Analytics tokens silently afterwards (incremental consent).

## Token routing

`AuthService.getToken({ accountId, tenantId, resource }): Promise<AccessToken>`

- Authority = `https://login.microsoftonline.com/{tenantId}`.
- Try `acquireTokenSilent({ account, authority, scopes })`.
- On `InteractionRequiredAuthError` (MFA, Conditional Access, consent), do **not** pop a browser in the middle of a fan-out:
  - Mark that `(account, tenant)` as `needsReauth`.
  - Fail the affected workspaces with `AUTH_INTERACTION_REQUIRED`.
  - Show a single aggregated notification: "2 tenants need you to sign in again — Sign in".
  - The Sign in action runs interactive auth for those tenants sequentially, then offers "Re-run failed".
- Cache tokens per `(account, tenant, resource)` in memory. Refresh 5 min before expiry. Coalesce concurrent requests for the same key into one promise.
- **Lighthouse:** delegated subscriptions are accessed with a token from the account's **home/managing tenant**. The discovery result records which tenant authority to use for each workspace (spec 03), so the engine never guesses.

## Tenant enumeration per account

- `GET https://management.azure.com/tenants?api-version=2022-12-01` with a home-tenant token. This returns tenants the account is a member or guest of, with `displayName` and `defaultDomain` where available.
- For each listed tenant, try a silent ARM token for that tenant.
  - On failure: mark the tenant `needsReauth` (show it greyed out with "Sign in to this tenant").
  - Tenants where the user has no Azure access at all are hidden by default. Setting: `accounts.showTenantsWithoutAccess`.
- Lighthouse customer tenants are **not** in `/tenants`. They come from discovery (spec 03) via subscription `tenantId`.

## Accounts UI

- Activity bar bottom: an "Accounts" icon like VS Code, with a badge when an account needs re-auth.
- The Accounts view lists each account (UPN, provider, home tenant) and, under it, its tenants with state: OK / needs sign-in / no access.
- Actions:
  - Add account, with a provider picker: Microsoft sign-in (browser), device code, Azure CLI, custom client ID.
  - Sign out (removes the account from the MSAL cache), re-authenticate, and refresh.
  - Set a display label for the account ("Work – Contoso", "Fabrikam guest").
- The label and ordering are stored in `accounts.jsonc` (no secrets; spec 09).

## Security rules

- Tokens never leave the main process and are never logged. The redacting logger strips `Authorization` headers and any JWT-shaped string.
- Sign-out clears the in-memory token cache for that account immediately.
- No refresh tokens or accounts are written anywhere except the MSAL encrypted cache.

## Sovereign clouds (design for, don't build yet)

Keep the authority host and resource endpoints in a `CloudProfile` object (`public` only for now). Do not hard-code URLs in call sites.

## Tests

- Unit: routing decisions, request coalescing, `needsReauth` aggregation. Uses a fake MSAL client.
- Integration: discovery + auth against the fake Azure server in demo mode.
- Manual live test (needs real tenants): sign in with two accounts, verify the Lighthouse workspace listing, verify the guest-tenant re-auth prompt.
