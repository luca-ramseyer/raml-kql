## What and why

<!-- What does this change, and why? Link the issue it closes (Closes #123). -->

## Checklist

- [ ] The title is a Conventional Commit (`feat(scope): …`, `fix: …`, `docs: …`). It becomes the commit message.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (and `pnpm test:e2e` for UI or main-process changes)
- [ ] Tests added or updated
- [ ] Works in demo mode
- [ ] Docs, spec and `docs/DECISIONS.md` updated if behaviour or a design decision changed
- [ ] No real tenant or subscription IDs, customer names, tokens or query results anywhere (code, tests, screenshots)
