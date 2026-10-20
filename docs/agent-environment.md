# Agent environment: commands and pitfalls

Read this before running commands as a coding agent in this repository (any tool: Claude Code, opencode, Codex). It holds verified commands and recurring pitfalls that the area guides don't repeat. The area `AGENTS.md` files still decide conventions.

## Working copy

- Work in your own git worktree on your own branch, outside the main checkout (for example `/home/blank/Coding/tattoo-drip-wt/<ticket>`). Never check out, edit or commit in a checkout another agent or the user is using. Don't run `git worktree`, `git gc` or `git prune`: the human creates and removes worktrees.
- A new worktree needs `pnpm install --frozen-lockfile` and the database and `.env` setup under "Before you run opencode" below. The human does both before the agent starts.
- Commit locally only. Never `git push`, never open or merge a pull request: the user decides after a review.
- Commits are Conventional Commits with an area scope (`test(sdk): ...`, `feat(platform): ...`, `docs: ...`). The pre-commit hook runs lint-staged (Biome) and commitlint; Biome may rewrite staged files, so read a file again before editing it after a commit attempt. End each commit message with a line naming the model, for example `Assisted-by: opencode (deepseek-v4.1-flash-free)`.

## Node and pnpm

- Node is pinned in `.nvmrc` (24.3.0). The default `node` on this machine is newer and misbehaves (the multipart parser stalls). Prefix every node or pnpm command: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm ...` and check `node --version`.
- pnpm only. Run package scripts with `pnpm --filter @tattoo-drip/<package> <script>`.
- Packages (`packages/sdk`, `packages/react`, `packages/types`) test without a database: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm --filter @tattoo-drip/sdk typecheck`. `pnpm check` (Biome) and `pnpm typecheck` run from the root.
- Editor or language-server diagnostics go stale; `pnpm typecheck` is the authority.

## Ports and databases (shared machine)

- The user's own servers use ports 3333 (platform dev) and 3000 (storefront) against the database `tattoo_drip`. Other agents use the database `tattoo_drip_ux` and ports 3401 and 3402. An opencode worktree uses only the database `tattoo_drip_oc`, port 3411 (platform dev) and port 3412 (tests). Never use 3333, 3000, 3401 or 3402, and never touch another database.
- Agents never create, drop or truncate a database, never run `psql`, `podman` or `docker`, and never kill a process. The human does those (see "Before you run opencode" below): ask when a task needs one.
- The worktree has its own `apps/platform/.env`, built by the human from `.env.example` with `DB_DATABASE=tattoo_drip_oc` and `PORT=3411` set in the file, so a command that forgets the prefix below still cannot reach `tattoo_drip`. Never read, print, copy or commit `.env` files.
- Keep the override as a second layer anyway: `DB_DATABASE=tattoo_drip_oc` goes on EVERY platform command that can reach the database (tests, migrate, ace commands) and `PORT=3412` on test runs.
- Migrate with `DB_DATABASE=tattoo_drip_oc pnpm --filter @tattoo-drip/platform migrate`. Migrating rewrites `apps/platform/database/schema.ts`: `git checkout -- apps/platform/database/schema.ts` if the diff is only formatting.
- Don't start the dev server or the worker: ask the human if a ticket needs a running server. Long commands run under `timeout`, so they end by themselves.

## Before you run opencode (human setup; the agent never runs these)

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

Also check before the first session:

- Start `opencode` from the worktree root, never with `--auto` (it approves every prompt that is not an explicit deny).
- Your global config (`~/.config/opencode/opencode.json`) adds a Linear MCP server, which gives the model Linear write tools (issues, comments) if it is signed in. The project config cannot switch it off: check `opencode mcp list` and remove it or log out if you do not want that.
- Every run loads the root `AGENTS.md`, both area `AGENTS.md` files and this guide (`instructions` in `opencode.json`): trim that list for a ticket in one area to save tokens. The `model` line pins the free model. To change the default model, set `model` in your own global config and delete that line (the project file loads after the global one, so the pinned line wins until then: unverified).

## opencode permissions

`opencode.json` decides what runs without asking. Checked against opencode v2.0.32 on this machine (see the end of this section for what is verified).

- Every action and command asks unless a rule allows it. Rules are matched in order and the LAST matching rule wins, so the denies sit at the end of the list. A pattern is matched against the whole command text, `*` is any text, `?` one character, and a trailing ` *` also matches the bare command. A command made of several parts (`a && b`, `$(...)`) is checked part by part, and one denied part denies it.
- Allowed without asking: `git status|diff|log|show|ls-files|add|commit`, `git branch --show-current`, `git checkout -- <file>`, `rg`, `ls`, `pwd`, `node --version`, `pnpm check|typecheck|build`, `pnpm --filter @tattoo-drip/<package> test|typecheck|build|generate|generate-routes` for the packages and scripts that exist, `timeout -s KILL <2 or 3 digits> pnpm --filter @tattoo-drip/<package> test`, and these platform commands, always with the Node 24 PATH prefix: `ace test` (with `DB_DATABASE=tattoo_drip_oc PORT=3412` in the command, optionally under `timeout -s KILL`), `migrate` (with `DB_DATABASE=tattoo_drip_oc`), `ace codegen` and `ace make:*`. The other commands are also allowed with and without the PATH prefix. Any other spelling (`command git`, `pnpm exec`, another order of the variable assignments) asks the human: do not look for a wrapper that avoids the prompt.
- Denied: `git push`, `gh`, `git -C`, `--no-verify`, shells and interpreters as wrappers (`sh -c`, `bash`, `eval`, `xargs`, `node -e`), `git worktree|gc|prune|clean|reset --hard`, `kill`, `pkill`, `killall`, `fuser`, `podman`, `docker`, `psql`, `DROP DATABASE`, `db:wipe`, `migration:rollback|fresh|reset`, `rm -rf`, any command that names a `.env` file (even `.env.example`: use the Read tool, and keep the name out of commit messages), `printenv`, `env`, `process.env`, the user's home credentials and the main checkout `/home/blank/Coding/tattoo-drip`, redirects to an absolute, home or parent path, and the `rg` flags `-u`, `--hidden`, `--no-ignore`, `--pre`.
- File tools: the Read tool refuses `*.env` and `*.env.*` except `*.env.example`; the build agent edits files without asking except `.env` files (not `.env.example`), `opencode.json`, `.husky/` and `.git/`; the plan, explore and general agents ask before every edit; any path outside the worktree is denied (`external_directory`).
- Not named, so it asks: web fetch and search, skills, subagents, MCP tools. Choose "allow once", not "always", for a command that is not on the list: an always-rule for a broad prefix such as `pnpm exec git *` also covers forms the denies do not name.
- This is a guard against mistakes, not a sandbox. Code the agent writes and then runs (tests, scripts) can do whatever your user can, and text patterns miss disguises such as a shell glob (`.e*`) for a file name.
- `opencode debug agents` and `opencode debug config`, run from the worktree, print the rules (they only print; after editing `opencode.json` wait a few seconds, the background service reloads the file late).

Verified, by reading the installed binary and by printing the merged rules with `opencode debug agents`: the matcher above, last match wins, no match asks, deny-if-any-part-denies, `bash` becoming the `shell` action, config rules landing after the built-in defaults for every agent (so they override `allow *` and the default `.env` read rule), and the effect of this file on 179 sample commands and tool calls, run through a copy of that evaluation. Unverified: how the shell parser splits real commands (compound commands, `$(...)`, heredocs, redirects), which permission names MCP tools use, whether tool output that opencode saves outside the project can still be read under the `external_directory` deny, and `--auto` beyond its help text.

## Platform tests

- Run from the repo root: `DB_DATABASE=tattoo_drip_oc PORT=3412 pnpm -C apps/platform exec node ace test` (all, about 2 minutes: run it in the background, log under `apps/platform/tmp/`, which git ignores) or `... node ace test functional --files=<name>.spec.ts`.
- If a run fails as if `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` or `ALERT_EMAILS` were set in the shell (they beat `.env.test`), tell the human: you cannot unset them for opencode.
- A spec that imports a missing module makes Japa hang instead of failing. Wrap red runs in `timeout 120` and read the log's `Tests` line, not the exit code.
- A full run needs `queue_jobs` in `tattoo_drip_oc` empty, or `new_inquiry_alert_flow.spec.ts` fails. You cannot truncate it: ask the human ("Before you run opencode", step 6).
- Every new `/t/:tenant` route needs a name, an isolation case in `tests/isolation/cases.ts` and (after TAT-30) an entry in `TENANT_ROUTE_ROLES`. Read [testing](../apps/platform/docs/testing.md).

## Generated files

Never edit `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts`, `apps/platform/database/schema.ts` or `apps/platform/.adonisjs/`. Regenerate them as `AGENTS.md` says and commit the result.

## Recurring pitfalls

- Lucid seeders and instance writes: pass `{ connection: client.connectionName }`, not a plain `{ client }`, or the write fails row-level security.
- `@inject()` dependencies need value imports with the `useImportType` suppression comment (see backend guidance).
- Screenshots, logs and scratch files stay out of the repository.
