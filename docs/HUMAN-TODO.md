# Things only Luca can do

Claude Code appends items here when blocked, and keeps working. Tick them off when done.

## Known upfront

- [ ] **Entra multi-tenant app registration.** Follow `docs/guides/entra-app-registration.md`, then put the client ID in a local `.env` (`RAML_KQL_CLIENT_ID=...`) and later in the GitHub Actions secret `RAML_KQL_CLIENT_ID`.
- [ ] **Branding:** a 1024×1024 app icon (`apps/desktop/build/icon.png`) and the Raml colour values for the optional Raml theme.
- [ ] **Apple signing:** create a "Developer ID Application" certificate, export it as .p12, and create an App Store Connect API key. Add the secrets `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (base64 .p8), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
- [ ] **Windows signing:** after going public, apply to SignPath Foundation (OSS program), or evaluate Microsoft's cloud signing service eligibility.
- [ ] **Live test:** sign in with two accounts, verify Lighthouse workspaces are listed, run a query across them, and verify the guest-tenant re-auth prompt.
- [ ] **Work approval:** before using Raml KQL on customer tenants at work, get it approved internally (it uses your delegated access, but it's still a new tool touching customer data).
- [ ] **Going public (Phase 12):** flip repo visibility, enable private vulnerability reporting, CodeQL and branch protection.
