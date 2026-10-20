# Agent environment: commands and pitfalls

Read this before running commands as a coding agent in this repository (any tool: Claude Code, opencode, Codex). It holds verified commands and recurring pitfalls that the area guides don't repeat. The area `AGENTS.md` files still decide conventions.

## Working copy

- Work in your own git worktree on your own branch, outside the main checkout (for example `/home/blank/Coding/tattoo-drip-wt/<ticket>`). Never check out, edit or commit in a checkout another agent or the user is using. Don't run `git worktree remove`, `git gc` or `git prune`.
- After creating a worktree run `pnpm install --frozen-lockfile` in it.
- Commit locally only. Never `git push`, never open or merge a pull request: the user decides after a review.
- Commits are Conventional Commits with an area scope (`test(sdk): ...`, `feat(platform): ...`, `docs: ...`). The pre-commit hook runs lint-staged (Biome) and commitlint; Biome may rewrite staged files, so read a file again before editing it after a commit attempt. End each commit message with a line naming the model, for example `Assisted-by: opencode (deepseek-v4.1-flash-free)`.

## Node and pnpm

- Node is pinned in `.nvmrc` (24.3.0). The default `node` on this machine is newer and misbehaves (the multipart parser stalls). Prefix every node or pnpm command: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm ...` and check `node --version`.
- pnpm only. Run package scripts with `pnpm --filter @tattoo-drip/<package> <script>`.
- Packages (`packages/sdk`, `packages/react`, `packages/types`) test without a database: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm --filter @tattoo-drip/sdk typecheck`. `pnpm check` (Biome) and `pnpm typecheck` run from the root.
- Editor or language-server diagnostics go stale; `pnpm typecheck` is the authority.

## Ports and databases (shared machine)

- The user's own servers use ports 3333 (platform dev) and 3000 (storefront) against the database `tattoo_drip`. Never touch them or that database. Other agents may hold other databases (`tattoo_drip_ux`) and ports (3401, 3402).
- An opencode worktree uses the database `tattoo_drip_oc`, the platform dev server on port 3411 and tests on port 3412.
- Create the database once, with the PostgreSQL container `tattoo-drip_postgres_1`: `podman exec tattoo-drip_postgres_1 psql -U postgres -c 'CREATE DATABASE tattoo_drip_oc'`, then grant the app role: `podman exec -i tattoo-drip_postgres_1 psql -U postgres -v ON_ERROR_STOP=1 -d tattoo_drip_oc -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres < apps/platform/database/setup_roles.sql`, then migrate: `DB_DATABASE=tattoo_drip_oc pnpm -C apps/platform migrate`. Migrating rewrites `apps/platform/database/schema.ts`: `git checkout -- apps/platform/database/schema.ts` if the diff is only formatting. Drop the database when the ticket is done.
- `apps/platform/.env` is gitignored and a new worktree has none. The user copies it from the main checkout by hand; agents never read, print or commit `.env` files. Override values with process environment variables: `DB_DATABASE=tattoo_drip_oc` must be on EVERY platform command (tests, migrate, seed, dev server, ace commands), because the `.env` points at `tattoo_drip`.
- Never `pkill -f` or `pgrep -f` with a pattern that appears in your own command line. List with `pgrep -af`, then `kill` exact PIDs you started. Stop every server you started before you finish.

## Platform tests

- Run from the repo root: `DB_DATABASE=tattoo_drip_oc PORT=3412 pnpm -C apps/platform exec node ace test` (all, about 2 minutes: run it in the background) or `... node ace test functional --files=<name>.spec.ts`.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` first: an exported value beats `.env.test`.
- A spec that imports a missing module makes Japa hang instead of failing. Wrap red runs in `timeout 120` and read the log's `Tests` line, not the exit code.
- Empty `queue_jobs` in your database before a full run (`TRUNCATE queue_jobs`), or `new_inquiry_alert_flow.spec.ts` fails.
- Every new `/t/:tenant` route needs a name, an isolation case in `tests/isolation/cases.ts` and (after TAT-30) an entry in `TENANT_ROUTE_ROLES`. Read [testing](../apps/platform/docs/testing.md).

## Generated files

Never edit `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts`, `apps/platform/database/schema.ts` or `apps/platform/.adonisjs/`. Regenerate them as `AGENTS.md` says and commit the result.

## Recurring pitfalls

- Lucid seeders and instance writes: pass `{ connection: client.connectionName }`, not a plain `{ client }`, or the write fails row-level security.
- `@inject()` dependencies need value imports with the `useImportType` suppression comment (see backend guidance).
- Screenshots, logs and scratch files stay out of the repository.
