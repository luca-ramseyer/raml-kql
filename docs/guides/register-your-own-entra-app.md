---
title: Registering your own Entra app
description: How an organization registers its own Microsoft Entra app for Raml KQL sign-in.
---

# Registering your own Entra app

Raml KQL signs in with a Microsoft Entra **app registration**. Official builds use the project's own multi-tenant registration. Some organizations don't allow users to consent to third-party apps. They can register their own app with the steps below, then set `auth.provider` to `custom` and enter the client ID when adding an account. The same steps apply to people who build Raml KQL themselves.

This takes about 10 minutes. You need Application Developer (or higher) rights in the tenant that will own the registration.

## Why an app registration at all?

To sign in with MSAL, every desktop app needs a **client ID** (the app's identity towards Entra). Raml KQL still uses **your user's permissions** (delegated): the app can only ever do what you are allowed to do, and only while you are signed in. There is **no secret** and no service principal access to data. The app registration just says "this is Raml KQL, and it wants to call ARM and Log Analytics on behalf of the signed-in user".

## Steps

1. Open the **Microsoft Entra admin center** → **Identity** → **Applications** → **App registrations** → **New registration**.
2. Fill in the form:
   - **Name:** for example `Raml KQL (Contoso)`
   - **Supported account types:** _Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)_
   - **Redirect URI:** platform **Public client/native (mobile & desktop)**, value `http://localhost`
   - Click **Register**.
3. On the **Overview** page, copy the **Application (client) ID**. This is the **client ID** you will enter in Raml KQL (or put in the `RAML_KQL_CLIENT_ID` environment variable when building the app yourself). It is not a secret.
4. Go to **Authentication**:
   - Under _Advanced settings_, set **Allow public client flows** to **Yes** (needed for the device-code fallback).
   - Make sure there are **no** web or SPA redirect URIs, only `http://localhost` under Mobile and desktop.
5. Go to **API permissions** → **Add a permission**:
   - **Azure Service Management** → Delegated → `user_impersonation`
   - **APIs my organization uses** → search **Log Analytics API** → Delegated → `Data.Read`
   - Microsoft Graph → Delegated → `User.Read` is already there by default; keep it.
   - Grant admin consent in the tenant that owns the registration (button "Grant admin consent for …"), so your own users don't each have to consent.
6. **Certificates & secrets:** add nothing. A public client must not have secrets.
7. **Branding & properties (optional):** a name, logo and your organization's homepage, terms and privacy URLs make the consent screen look trustworthy to users.
8. In Raml KQL, open **Accounts → Add Account**, choose the custom client ID option, and paste the client ID. To make it the default, set `auth.provider` to `custom` (see the [settings reference](../reference/settings.md)).

## How consent works

- **Lighthouse users (the most common MSSP case):** they sign in to _their own managing tenant_. Consent is only needed there, once. Customer tenants don't need to consent, because Lighthouse access works through the managing tenant's token.
- **Guest (B2B) access:** the app also needs consent in each tenant the user signs into as a guest.
- **Who can consent:** many organisations block end-user consent for multi-tenant apps from **unverified publishers**. Then an admin must consent via:
  `https://login.microsoftonline.com/<their-tenant-id>/adminconsent?client_id=<RAML_KQL_CLIENT_ID>`
- **No app registration at all:** sign in through the Azure CLI instead (`auth.provider: "azureCli"`, after `az login`).

## Publisher verification (optional)

Verified publishers get a blue badge in the consent prompt, and more organizations allow user consent for them. It requires a Microsoft AI Cloud Partner Program ID (free to join, but it needs a verified business identity) and a publisher domain matching the account's email domain. It is only worth the effort if you distribute the app registration to other organizations.

## Check

- In the app: Accounts → Add account → sign in. The consent screen should list "Access Azure Service Management as you" and "Read Log Analytics data as you".
- If sign-in fails with `AADSTS65001` (consent required) or `AADSTS90094` (admin approval required), that's the consent situation described above.
