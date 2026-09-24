# Decision log

Format: `## D-NNN — Title (YYYY-MM-DD)`, then **Context**, **Decision**, **Consequences**. Append only. Supersede by adding a new entry that references the old one.

## D-001 — Rewrite from zero; electron-vite instead of Nextron (2026-09-24)

**Context:** v1 (Nextron) was lost. Nextron couples Next.js routing/SSR concepts to a desktop app that needs neither, and its maintenance lags Electron releases.

**Decision:** Electron + electron-vite + React SPA.

**Consequences:** simpler build, fast HMR, first-class worker support for Monaco. No Next.js.

## D-002 — VS Code look-alike, not a Code-OSS fork or VS Code extension (2026-09-24)

**Context:** we want VS Code familiarity, our own sandboxed extension model, and full control over security.

**Decision:** build our own workbench replicating VS Code's themes, layout and interaction patterns. Use the VS Code colour theme JSON format so themes are interchangeable.

**Consequences:** more UI work, but a small attack surface and our own permission model. We do not load VS Code extensions.

## D-003 — Log Analytics only as built-in data source (2026-09-24)

**Context:** Lighthouse gives Azure RBAC access to customer workspaces; Defender XDR advanced hunting needs per-tenant app consent and isn't reachable via Lighthouse.

**Decision:** the built-in source is the Log Analytics Query API. Other sources are possible via extensions implementing `DataSource`.

## D-004 — Delegated user auth with MSAL, optional custom client ID and Azure CLI modes (2026-09-24)

**Decision:** see spec 02. There are no app secrets anywhere.

## D-005 — No telemetry; crash reports are local-first and user-submitted (2026-09-24)

**Decision:** see spec 10. The security audience values this over usage insight; adoption is gauged by GitHub stars, release download counts and issues.

## D-006 — Results never persisted; crypto-shredded session cache (2026-09-24)

**Decision:** see spec 04.

## D-007 — Query pack parameters bound via typed `let` statements (2026-09-24)

**Context:** templating placeholders break portability and invite injection bugs.

**Decision:** parameters are KQL identifiers; the app prepends or replaces `let` statements using a tested literal encoder.
