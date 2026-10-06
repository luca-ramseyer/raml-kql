---
title: Releasing
description: How a release is made, signed and published, and how the app updates itself.
---

# Releasing

Releases are automated. Maintainers merge one pull request and the workflows do the rest. Commit messages decide the version number, so read [Testing and CI](testing-and-ci.md#conventional-commits-and-releases-release-please) first if Conventional Commits are new to you.

## What happens when you merge the release PR (`release.yml`)

1. release-please tags the commit (`v1.2.0`) and creates a **draft** GitHub Release. Drafts are invisible to everyone but the maintainers.
2. The same workflow builds the installers on three machines (macOS, Windows, Linux) and uploads them to that draft, together with the small `latest*.yml` files that installed apps read to learn that an update exists.
3. After each packaged app has been started once as a smoke test, a last job writes `SHA256SUMS` and **publishes** the release. If any build fails, the release stays a draft and nobody sees it. Fix the problem on `main`, then build the draft again with `gh workflow run release.yml -f tag=v1.2.0` (or Actions → Release → Run workflow). Re-running the old failed run can't pick up fixes to the workflow itself.

(It is one workflow, not "run when a release is published", because events caused by GitHub's built-in token don't start other workflows.)

**Signing is optional, per secret.** The secrets live in a GitHub _environment_ called `release` that only the `main` branch may use, so other branches can't read the certificate. Without the signing secrets you simply get unsigned installers (macOS Gatekeeper and Windows SmartScreen warn). Add a secret and the next release is signed. Nothing else changes.

**Choosing the version.** release-please works it out from the commits. To force one, add a line `Release-As: 1.0.0` to the body of a commit (or the squash-merge description). Pre-release versions such as `1.1.0-beta.1` are published as GitHub pre-releases and are only offered to people who set `update.channel` to `beta`.

## Building installers yourself

`pnpm dist` builds unsigned installers for your current OS into `apps/desktop/release/` (on a Mac: arm64 and x64 dmg + zip). `pnpm smoke:packaged` then starts the packaged app in demo mode and checks it stays up for 15 seconds. CI does both on all three systems. Why a separate smoke test? The Playwright tests run the _unpackaged_ app. Packaging flips Electron "fuses" (switches that remove risky features) and signs the result, and either can leave an app that builds fine but dies at start. That happened during development: flipping fuses broke the ad-hoc signature and Apple Silicon killed the app.

## Auto-update

Installed apps look at GitHub Releases 30 seconds after start and every 6 hours (setting `update.checkAutomatically`; **Help → Check for Updates…** works regardless). A new version downloads in the background; then a notification offers **Restart to Update**. `update.channel` picks `stable` or `beta`. Development builds, demo mode and deb/rpm installs never update themselves.

## Signing

| Platform | How                                                                                                                                                                                  | Secrets                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| macOS    | Developer ID Application certificate, hardened runtime, notarized by Apple                                                                                                           | `CSC_LINK` (base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (base64 `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows  | Not signed yet. Free signing for open-source projects (SignPath Foundation) is planned; a certificate or Microsoft's cloud signing service also work through the build configuration | none yet                                                                                                               |
| Linux    | No OS-level signing. Every release has a `SHA256SUMS` file                                                                                                                           | none                                                                                                                   |

The secrets are _environment secrets_ of the `release` environment, which only the `main` branch may use. Each signing step skips itself when its secrets are missing, so forks and local builds simply produce unsigned installers. See `apps/desktop/electron-builder.config.mjs` for the switches.

## Signing the example extensions

The Country Map and VirusTotal example extensions are published signed, so the app shows **Verified by Raml KQL**. The release workflow signs them with an Ed25519 key; the app trusts the matching public key, which is compiled into it (`apps/desktop/src/main/extensions/trusted-keys.ts`).

**Setting the key up (once):**

1. Generate a key pair on your own machine: `npx @raml-kql/extension-cli keygen --out ~/raml-kql-signing`. It prints a key id and writes `raml-kql-signing.key` (private) and `raml-kql-signing.pub` (public).
2. Store the private key in a password manager. Add its full text as the secret `EXTENSION_SIGNING_KEY` in the `release` environment. Never commit it or paste it anywhere else.
3. Add the public key to `TRUSTED_SIGNING_KEYS` in `trusted-keys.ts` (name: `Raml KQL`) in a pull request. The next app release can then verify packages signed with it.

The release after that signs the two examples and attaches them to the release. Packages signed before an app that trusts the key is released show as not verified in older apps.

**Rotating or revoking a key:** add the new public key to the list first and re-sign the examples with it; remove the old key in a later app release. Removing a key from the list removes the badge from everything it signed.

**Checking a package by hand:** `raml-kql-ext verify <file.rkqlx> --key raml-kql-signing.pub`. Verification means "this is the package the project signed, unchanged", not "this code was reviewed".

## Publishing the npm packages

`@raml-kql/extension-api` and `@raml-kql/extension-cli` are published to npm separately (`pnpm --filter <package> publish --access public` from `main`, with an npm account that belongs to the `raml-kql` organization). Their version numbers are independent of the app's.
