---
title: Privacy policy
description: What data Raml KQL handles, where it goes, and what the project does and does not collect. Short version - nothing.
---

# Privacy policy

_Last updated: 6 October 2026._

## The short version

Raml KQL is open-source software that runs on your computer. **The project does not collect, receive or store any data about you or your use of the app.** There is no telemetry, no analytics, no user account, no advertising and no Raml KQL server. The app talks directly to Microsoft (to sign you in and run your queries), to GitHub (to check for updates), and to the git hosts and extension services **you** choose to use.

## Who is responsible

Raml KQL is developed as an open-source project by Luca Ramseyer and contributors. The project does not operate any service that the app connects to for its own purposes, so it does not act as a processor or controller of your data. You, or your organization, remain responsible for the data you query and for having the right to access it.

## What the app does with data

### Sign-in

You sign in with your own Microsoft account. Sign-in happens in your system browser, directly with Microsoft, and Microsoft's privacy statement applies to it. Access and refresh tokens are stored **on your computer only**, encrypted with the operating system's keychain, and removed when you sign out. The app asks Microsoft for delegated permissions (reading Azure resources, reading Log Analytics data and your basic profile) and can only do what your account is allowed to do. It uses no secrets and no service principal in your tenant.

### Queries and results

Your queries go from your computer straight to the Microsoft services you query (Azure Resource Graph, Azure Resource Manager, the Log Analytics Query API), using your identity. Results are held in memory, or in an encrypted cache on your computer whose key exists only in memory; the cache is destroyed when you close the app. Results are never written to disk in the clear and are never sent to the project. The only way result data leaves your computer is something you ask for: an export, a copy, or an extension you allowed.

### What is kept on your computer

Settings, saved queries, query history (the text and counts, never results), workspace choices, tab layout, schema names (table and column names, never data) and a local audit log of which queries ran where. These are plain files in the configuration folder; see [Configuration folder and files](reference/config-files.md). Nothing in them is sent anywhere. You can delete them at any time.

### Network traffic the app starts

- **Microsoft** identity and Azure endpoints, for sign-in, discovery and your queries.
- **GitHub**, to check for new versions (release information and downloads). Like any web request, this lets GitHub see your IP address, the app version and your operating system. You can turn it off with the setting `update.checkAutomatically`.
- **Git hosts of query pack and extension sources that you add**, and nothing else.
- **Extensions you installed**, only for the hosts you allow, and only after you allow them. Extensions are written by third parties, who have their own privacy practices. For example, the VirusTotal example extension sends the values you choose to enrich to VirusTotal.

The command **Developer: Show Network Activity** lists every host the app contacted in the current session.

### Crash reports

If the app crashes it keeps a sanitized report on your computer (tenant and workspace names and IDs, e-mail addresses, IP addresses, tokens, file paths and query text are removed). Nothing is sent. If you choose to report the problem, the app opens a prefilled GitHub issue that you read, edit and submit yourself; it is then handled under GitHub's terms and is public.

## What the project does not do

- It does not collect telemetry, usage statistics, device identifiers or crash data.
- It does not use cookies or tracking in the app.
- It does not sell or share data, because it has none.
- It does not read your tenants, workspaces, queries or results.

## The Microsoft Entra app

To let you sign in, Raml KQL uses a Microsoft Entra application registration (a public client without secrets). Registering and consenting to it gives the project **no access** to your tenant or your data: the app acts only as you, on your computer. Tenant administrators can review or remove the app under **Enterprise applications** in the Microsoft Entra admin center, and organizations can [register their own app](guides/register-your-own-entra-app.md) instead.

## Documentation and project pages

The source code, releases and documentation are hosted on GitHub, whose privacy statement applies when you visit them. The project adds no analytics or tracking to its documentation pages. If that ever changes, this page will say so before it does.

## Your rights

Because the project holds no personal data about you, there is nothing for it to access, correct or delete. For data held by Microsoft, GitHub or an extension's service, contact that provider; they are the ones who hold it.

## Changes

If this policy changes, the new text is published here and the change is visible in the repository's history. Material changes (for example any data collection) would be announced in the release notes.

## Contact

Questions about this policy: [open an issue](https://github.com/luca-ramseyer/raml-kql/issues/new/choose). For anything sensitive, use **Report a vulnerability** on the repository's [Security tab](https://github.com/luca-ramseyer/raml-kql/security) (private reporting).
