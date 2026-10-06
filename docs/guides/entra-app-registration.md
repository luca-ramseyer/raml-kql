# Creating the Raml KQL multi-tenant app registration

This takes about 10 minutes. You need Application Developer (or higher) rights in a tenant you control. Use a tenant that belongs to you or to the project, not an employer's tenant: the app registration should belong to the open-source project.

## Why an app registration at all?

To sign in with MSAL, every desktop app needs a **client ID** (the app's identity towards Entra). Raml KQL still uses **your user's permissions** (delegated): the app can only ever do what you are allowed to do, and only while you are signed in. There is **no secret** and no service principal access to data. The app registration just says "this is Raml KQL, and it wants to call ARM and Log Analytics on behalf of the signed-in user".

## Steps

1. Open the **Microsoft Entra admin center** → **Identity** → **Applications** → **App registrations** → **New registration**.
2. Fill in the form:
   - **Name:** `Raml KQL`
   - **Supported account types:** _Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)_
   - **Redirect URI:** platform **Public client/native (mobile & desktop)**, value `http://localhost`
   - Click **Register**.
3. On the **Overview** page, copy the **Application (client) ID**. This is `RAML_KQL_CLIENT_ID`. It is not secret; it will be public in the repo/build.
4. Go to **Authentication**:
   - Under _Advanced settings_, set **Allow public client flows** to **Yes** (needed for the device-code fallback).
   - Make sure there are **no** web or SPA redirect URIs, only `http://localhost` under Mobile and desktop.
5. Go to **API permissions** → **Add a permission**:
   - **Azure Service Management** → Delegated → `user_impersonation`
   - **APIs my organization uses** → search **Log Analytics API** → Delegated → `Data.Read`
   - Microsoft Graph → Delegated → `User.Read` is already there by default; keep it.
   - Also grant admin consent **in your own tenant** so you can test (button "Grant admin consent for …").
6. **Certificates & secrets:** add nothing. A public client must not have secrets.
7. **Branding & properties:** set the publisher domain to `raml.ch` (verify the domain in your tenant first), and add homepage, terms and privacy URLs later when the repo is public (e.g. GitHub README / PRIVACY.md).

## How consent works for other users

- **Lighthouse users (the most common MSSP case):** they sign in to _their own managing tenant_. Consent is only needed there, once. Customer tenants don't need to consent, because Lighthouse access works through the managing tenant's token.
- **Guest (B2B) access:** the app also needs consent in each tenant the user signs into as a guest.
- **Who can consent:** many organisations block end-user consent for multi-tenant apps from **unverified publishers**. Then an admin must consent via:
  `https://login.microsoftonline.com/<their-tenant-id>/adminconsent?client_id=<RAML_KQL_CLIENT_ID>`
  The app should show this URL in a helpful error when it gets a consent error.
- **Organisations that won't trust your app** can register their own with these exact same steps and use `auth.provider: "custom"` with their client ID, or use `azureCli` mode.

## Later: publisher verification (recommended once public)

Verified publishers get a blue badge in the consent prompt, and more tenants allow user consent for them. It requires:

- a **Microsoft AI Cloud Partner Program** ID (free to join, but needs a verified business identity), and
- the publisher domain matching the account email domain.

This may need a registered business entity. It's worth checking when the tool has users, and not needed to start.

## Check

- In the app: Accounts → Add account → sign in. The consent screen should list "Access Azure Service Management as you" and "Read Log Analytics data as you".
- If sign-in fails with `AADSTS65001` (consent required) or `AADSTS90094` (admin approval required), that's the consent situation described above.
