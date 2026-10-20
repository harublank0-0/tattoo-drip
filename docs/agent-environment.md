# Agent environment: commands and pitfalls

Read this before running commands as a coding agent in this repository (any tool: Claude Code, opencode, Codex). It holds verified commands and recurring pitfalls that the area guides don't repeat. The area `AGENTS.md` files still decide conventions.

## Working copy

- Work in your own git worktree on your own branch, outside the main checkout (for example `/home/blank/Coding/tattoo-drip-wt/<ticket>`). Never check out, edit or commit in a checkout another agent or the user is using. Don't run `git worktree`, `git gc` or `git prune`: the human creates and removes worktrees.
- A new worktree needs `pnpm install --frozen-lockfile` and the database and `.env` setup under "Human setup" below. The human does both before the agent starts.
- Commit locally only. Never `git push`, never open or merge a pull request: the user decides after a review.
- Commits are Conventional Commits with an area scope (`test(sdk): ...`, `feat(platform): ...`, `docs: ...`). The pre-commit hook runs lint-staged (Biome) and commitlint; Biome may rewrite staged files, so read a file again before editing it after a commit attempt. End each commit message with a line naming the model, for example `Assisted-by: opencode (deepseek-v4.1-flash-free)`.

## Node and pnpm

- Node is pinned in `.nvmrc` (24.3.0). The default `node` on this machine is newer and misbehaves (the multipart parser stalls). Prefix every node or pnpm command: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm ...` and check `node --version`.
- pnpm only. Run package scripts with `pnpm --filter @tattoo-drip/<package> <script>`.
- Packages (`packages/sdk`, `packages/react`, `packages/types`) test without a database: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm --filter @tattoo-drip/sdk typecheck`. `pnpm check` (Biome) and `pnpm typecheck` run from the root.
- Editor or language-server diagnostics go stale; `pnpm typecheck` is the authority.

## Ports and databases (shared machine)

- The user's own servers use ports 3333 (platform dev) and 3000 (storefront) against the database `tattoo_drip`. Other agents use the database `tattoo_drip_ux` and ports 3401 and 3402. An opencode worktree uses only the database `tattoo_drip_oc`, port 3411 (platform dev) and port 3412 (tests). Never use 3333, 3000, 3401 or 3402, and never touch another database.
- Agents never create, drop or truncate a database, never run `psql`, `podman` or `docker`, and never kill a process. The human does those (see "Human setup" below): ask when a task needs one.
- The worktree has its own `apps/platform/.env`, built by the human from `.env.example` with `DB_DATABASE=tattoo_drip_oc` and `PORT=3411` set in the file, so a command that forgets the prefix below still cannot reach `tattoo_drip`. Never read, print, copy or commit `.env` files.
- Keep the override as a second layer anyway: `DB_DATABASE=tattoo_drip_oc` goes on EVERY platform command that can reach the database (tests, migrate, ace commands) and `PORT=3412` on test runs.
- Migrate with `DB_DATABASE=tattoo_drip_oc pnpm --filter @tattoo-drip/platform migrate`. Migrating rewrites `apps/platform/database/schema.ts`: `git checkout -- apps/platform/database/schema.ts` if the diff is only formatting.
- Don't start the dev server or the worker: ask the human if a ticket needs a running server. Long commands run under `timeout`, so they end by themselves.

## Human setup (the agent never runs these)

Run once per opencode worktree before the first opencode session; steps 2 to 7 run from the worktree root. The database is a throwaway; drop it when the ticket is done. One opencode worktree at a time: two would share `tattoo_drip_oc` and ports 3411 and 3412.

1. Create the worktree from the main checkout: `git worktree add /home/blank/Coding/tattoo-drip-wt/<ticket> -b <branch> origin/main`.
2. Install: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile`.
3. Create the database and the app role's grants (`tattoo-drip_postgres_1` is the PostgreSQL container):

   ```bash
   podman exec tattoo-drip_postgres_1 psql -U postgres -c 'CREATE DATABASE tattoo_drip_oc'
   podman exec -i tattoo-drip_postgres_1 psql -U postgres -v ON_ERROR_STOP=1 -d tattoo_drip_oc \
     -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres \
     < apps/platform/database/setup_roles.sql
   ```

4. Give the worktree its own environment file. Copy the template, never the real `.env` of the main checkout:

   ```bash
   cp apps/platform/.env.example apps/platform/.env
   ```

   Then edit `apps/platform/.env`: `DB_DATABASE=tattoo_drip_oc`, `PORT=3411`, and `APP_KEY=` a fresh value (`openssl rand -base64 32`). The other values stay as in `.env.example`: they are local defaults, not secrets.
5. Make sure `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` are not exported in the shell that starts opencode: an exported value beats `.env.test` and fails the tests.
6. Before a full test run (the agent asks), empty the job queue; otherwise `new_inquiry_alert_flow.spec.ts` fails:

   ```bash
   podman exec tattoo-drip_postgres_1 psql -U postgres -d tattoo_drip_oc -c 'TRUNCATE queue_jobs'
   ```

7. When the ticket is done, drop the database:

   ```bash
   podman exec tattoo-drip_postgres_1 psql -U postgres -c 'DROP DATABASE tattoo_drip_oc'
   ```

## Platform tests

- Run from the repo root: `DB_DATABASE=tattoo_drip_oc PORT=3412 pnpm -C apps/platform exec node ace test` (all, about 2 minutes: run it in the background, log under `apps/platform/tmp/`, which git ignores) or `... node ace test functional --files=<name>.spec.ts`.
- If a run fails as if `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` or `ALERT_EMAILS` were set in the shell (they beat `.env.test`), tell the human: you cannot unset them for opencode.
- A spec that imports a missing module makes Japa hang instead of failing. Wrap red runs in `timeout 120` and read the log's `Tests` line, not the exit code.
- A full run needs `queue_jobs` in `tattoo_drip_oc` empty, or `new_inquiry_alert_flow.spec.ts` fails. You cannot truncate it: ask the human (Human setup, step 6).
- Every new `/t/:tenant` route needs a name, an isolation case in `tests/isolation/cases.ts` and (after TAT-30) an entry in `TENANT_ROUTE_ROLES`. Read [testing](../apps/platform/docs/testing.md).

## Generated files

Never edit `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts`, `apps/platform/database/schema.ts` or `apps/platform/.adonisjs/`. Regenerate them as `AGENTS.md` says and commit the result.

## Recurring pitfalls

- Lucid seeders and instance writes: pass `{ connection: client.connectionName }`, not a plain `{ client }`, or the write fails row-level security.
- `@inject()` dependencies need value imports with the `useImportType` suppression comment (see backend guidance).
- Screenshots, logs and scratch files stay out of the repository.
