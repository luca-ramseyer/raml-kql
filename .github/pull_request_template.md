## What and why

<!-- What does this change, and why? Link the issue it closes (Closes #123). -->

## Checklist

- [ ] The title is a Conventional Commit (`feat(scope): …`, `fix: …`, `docs: …`). It becomes the commit message.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (and `pnpm test:e2e` for UI or main-process changes)
- [ ] Tests added or updated
- [ ] Works in demo mode
- [ ] Docs updated (`docs/`; run `pnpm docs:generate` and `pnpm check:docs`), and `docs/design/decisions.md` if a design decision changed
- [ ] No real tenant or subscription IDs, customer names, tokens or query results anywhere (code, tests, screenshots)
