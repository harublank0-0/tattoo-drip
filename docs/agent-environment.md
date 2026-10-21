# Agent environment: commands and pitfalls

Read this before running commands as a coding agent in this repository (any tool: Claude Code, opencode, Codex). It holds verified commands and recurring pitfalls that the area guides don't repeat. The area `AGENTS.md` files still decide conventions.

## Working copy

- Work in your own git worktree on your own branch, outside the main checkout (for example `/home/blank/Coding/tattoo-drip-wt/<ticket>`). Never check out, edit or commit in a checkout another agent or the user is using. Don't run `git worktree`, `git gc` or `git prune`: the human creates and removes worktrees.
- A new worktree needs `pnpm install --frozen-lockfile` and the database and `.env` setup under "Before you run opencode" below. The human does both before the agent starts.
- Commit locally only. Never `git push`, never open or merge a pull request: the user decides after a review.
- Commits are Conventional Commits with an area scope (`test(sdk): ...`, `feat(platform): ...`, `docs: ...`). Hooks: pre-commit runs lint-staged (Biome on the staged files, which it may rewrite, so read a file again before editing it after a commit attempt); commit-msg runs commitlint; pre-push (the human's) runs `pnpm check` and `pnpm typecheck`. Never use `--no-verify`. The attribution trailer is a convention, not a hook rule: end each commit message with a line naming the model, for example `Assisted-by: opencode (deepseek-v4.1-flash-free)`, by writing `git commit -m "<subject>" -m "<trailer>"`. `git add` and `git commit` ask the human each time (only exact read-only git commands run unprompted): write each as one plain command.
- Search: the Grep tool is denied (it ignores the `.env` rules). Read single files with the Read tool, list and find files with List and Glob, and expect a prompt for `rg`, `ls` and `cat`.

## Node and pnpm

- Node is pinned in `.nvmrc` (24.3.0). The default `node` on this machine is newer and misbehaves (the multipart parser stalls). Prefix every node or pnpm command: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm ...` and check `node --version`.
- pnpm only. Run package scripts with `pnpm --filter @tattoo-drip/<package> <script>`.
- Packages (`packages/sdk`, `packages/react`, `packages/types`) test without a database: `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm --filter @tattoo-drip/sdk typecheck`. `pnpm check` (Biome) and `pnpm typecheck` run from the root.
- Editor or language-server diagnostics go stale; `pnpm typecheck` is the authority.

## Ports and databases (shared machine)

- The user's own servers use ports 3333 (platform dev) and 3000 (storefront) against the database `tattoo_drip`. Other agents use the database `tattoo_drip_ux` and ports 3401 and 3402. An opencode worktree uses only the database `tattoo_drip_oc`, port 3411 (platform dev) and port 3412 (tests). Never use 3333, 3000, 3401 or 3402, and never touch another database.
- Agents never create, drop or truncate a database, never run `psql`, `podman` or `docker` themselves, and never kill a process. The human does those (see "Before you run opencode" below): ask when a task needs one. A test run does start `psql` as a subprocess and changes cluster-wide roles (see "Platform tests"), which is why a full run asks.
- The worktree has its own `apps/platform/.env`, built by the human from `.env.example` with `DB_DATABASE=tattoo_drip_oc` and `PORT=3411` set in the file, so a command that forgets the prefix below still cannot reach `tattoo_drip`. Never read, print, copy or commit `.env` files.
- Keep the override as a second layer anyway: `DB_DATABASE=tattoo_drip_oc` goes on EVERY platform command that can reach the database (tests, migrate, ace commands) and `PORT=3412` on test runs.
- Migrate with `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=tattoo_drip_oc pnpm --filter @tattoo-drip/platform migrate`. Migrating rewrites `apps/platform/database/schema.ts`. Look at `git diff -- apps/platform/database/schema.ts` first: only when the whole diff is the `import type` line may you `git checkout -- apps/platform/database/schema.ts`; any other change is the schema change of your migration, so the regenerated file is part of the commit.
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

- Make the policy files read-only, from the worktree root: `chmod a-w opencode.json docs/agent-environment.md .git` (`.git` is the worktree's pointer file to its git directory). Then a shell redirect or an edit to them fails with "permission denied", which no pattern can promise (see "opencode permissions"). Git does not track the write bit, so nothing shows in `git status` (checked in a scratch repository, as was a `git checkout` restoring the write bit and a redirect failing with "permission denied"); run `chmod u+w` on a file before you edit it yourself, and run the `chmod` again after a `git checkout` or `rebase` replaced it. It does not stop `rm` (that needs the folder's permission), the `.husky/` hooks, or a redirect to any other file the user can write in or outside the worktree.
- Start `opencode` from the worktree root, never with `--auto`, and read every prompt before you allow it ("opencode permissions" below says why).
- Your global config (`~/.config/opencode/opencode.json`) adds a Linear MCP server, which gives the model Linear write tools (issues, comments) if it is signed in. The project config cannot switch it off: check `opencode mcp list` and remove it or log out if you do not want that.
- Every run loads the root `AGENTS.md`, both area `AGENTS.md` files and this guide (`instructions` in `opencode.json`): trim that list for a ticket in one area to save tokens. The `model` line pins the free model. To change the default model, set `model` in your own global config and delete that line (the project file loads after the global one, so the pinned line wins until then: unverified).

## opencode permissions

`opencode.json` decides what opencode runs without asking. Patterns are not a sandbox. The real protection is, in this order:

1. Everything asks by default. The human reads the whole command in the prompt (it shows the full command text, `export` lines included) and chooses "allow once", never "always".
2. opencode is never started with `--auto`: that approves every prompt that is not an explicit deny and leaves only the deny patterns.
3. A dedicated worktree with its own `.env` (local defaults only) and its own throwaway database, as set up above.

A hostile or prompt-injected model can still get around the text patterns. The parser skips `export` lines, so `export PATH=./bin:$PATH; pnpm check` runs a program from the worktree under an allowed command text, and `export GIT_DIR=...; git status` reads another checkout. A quoted or glob spelling (`--p're'=echo`, `.e*`) changes what the shell runs but not the text that is matched. Redirections are the widest hole: the parser authorises only the command nodes it finds, and counts a redirect only when it is the direct parent of one command. So `(pwd) > opencode.json` is checked as just the allowed `pwd`, a redirect to an absolute path is not caught by the relative-path redirect denies, and a statement that is only a redirect (`> opencode.json`) has no command node at all, so nothing is checked and no prompt appears. Any file the user can write, protected files and files outside the worktree included, can be truncated or overwritten that way. No pattern fixes it; the read-only step above covers only three files. Code the agent writes and then runs (tests, scripts) can do whatever your user can. So do not give opencode tasks that read untrusted web or file content, and do not point it at a database that matters, until a real sandbox exists (a container on a dedicated clone, with no credentials). This repository does not provide one.

What the rules do:

- Every action and command asks unless a rule allows it. Rules are matched in order and the LAST matching rule wins, so the denies sit at the end of the list. A pattern is matched against the whole command text; `*` is any text, `?` one character.
- Allowed without asking, as exact text with no wildcard, so no argument (`--output=<path>`, a quoted flag, a path) can be added: `git status`, `git status --short`, `git branch --show-current`, `git diff`, `git diff --stat`, `git diff --staged`, `git log --oneline -5`, `pwd`, `node --version`, `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @tattoo-drip/<package> test|typecheck|build|generate|generate-routes` for the packages and scripts that exist (platform: `typecheck` and `build` only), the Node 24 PATH-prefixed form of each, `timeout -s KILL 120` around the sdk, react and storefront tests, and two platform commands, with the Node 24 prefix: `DB_DATABASE=tattoo_drip_oc pnpm --filter @tattoo-drip/platform migrate` and `pnpm -C apps/platform exec node ace codegen`. Anything else asks, including `git add`, `git commit`, `rg`, `ls`, `cat`, every platform test run and `ace make:*`. Do not look for a wrapper that avoids the prompt.
- Denied outright: `git push`, `gh`, `git -C`, `--git-dir`, `--work-tree`, any `GIT_*` variable, `--no-verify`, `--output`, `--pre`, shells and interpreters as wrappers (`sh -c`, `bash`, `eval`, `xargs`, `node -e`), `git worktree|gc|prune|clean|reset --hard`, `kill`, `pkill`, `killall`, `fuser`, `podman`, `docker`, `psql`, `DROP DATABASE`, `db:wipe`, `migration:rollback|fresh|reset`, `rm -rf`, `pnpm -C` into another folder, any command that names a `.env` file (even `.env.example`: use the Read tool, and keep the name out of commit messages), `printenv`, `env`, `process.env`, the user's home credentials and the main checkout `/home/blank/Coding/tattoo-drip`, and, for a simple command only, redirects to an absolute, home or parent path (a compound or redirect-only form escapes this, see above).
- File tools: the Read tool refuses `*.env` and `*.env.*` except `*.env.example`; the Grep tool is denied, because it never checks those Read rules and its prompt shows only the pattern, not the path; Glob and List show file names only. The build agent edits files without asking except `.env` files (not `.env.example`), `opencode.json`, `docs/agent-environment.md`, `.husky/`, `.git/` and the `.git` pointer file; the plan, explore and general agents ask before every edit. Any path outside the worktree is denied (`external_directory`), but only for the file tools and `cd`: a shell argument naming an outside path is not checked, which is why `rg` and `cat` ask.
- Not named, so it asks: web fetch and search, skills, subagents, MCP tools.
- `opencode debug agents` and `opencode debug config`, run from the worktree, print the rules (they only print; after editing `opencode.json` wait a few seconds, the background service reloads the file late).

Verified, by reading the installed opencode v2.0.32 binary and by printing the merged rules with `opencode debug agents`: the matcher above, last match wins, no match asks, one denied part denies a command, `bash` becoming the `shell` action, config rules landing after the built-in defaults for every agent, the shell prompt text being `$ <command>` from the tool input (read from the formatter, not seen in a live prompt), and the effect of this file on 183 sample commands and tool calls, run through a copy of that evaluation. The samples include a security review's four exploits (a `git show --output=` write, the Grep tool on `.env`, `export GIT_DIR=...; git add -A`, a quoted `rg --p're'=echo`) and their spelling variants: each comes out deny or ask, never allow. The four samples that still evaluate as allow are the residuals described above: an exact allowed command after an `export` line (two samples), `(pwd) > opencode.json`, and a redirect-only statement. The full platform test run and every other platform test command now ask. Unverified: how the shell parser splits real commands beyond what the review reported (heredocs, `$(...)`, process substitution), which permission names MCP tools use, whether tool output that opencode saves outside the project can still be read under the `external_directory` deny, and `--auto` beyond its help text. Nothing here was exercised through a live opencode session.

## Platform tests

- Run from the repo root, with the assignments in this order: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH DB_DATABASE=tattoo_drip_oc PORT=3412 timeout -s KILL 300 pnpm -C apps/platform exec node ace test > apps/platform/tmp/test.log 2>&1` (all, about 2 minutes: run it in the background; `apps/platform/tmp/` is ignored by git) or `... node ace test functional --files=<name>.spec.ts` with a shorter timeout. Every platform test run asks the human, who reads the command.
- Never run a platform suite while another agent's or the user's suite is running on this PostgreSQL. `setup_roles.spec.ts` and `role_guard.spec.ts` create, alter and drop fixed cluster-wide `td_probe_*` roles, and `setup_roles.spec.ts` runs `psql` as a subprocess; `DB_DATABASE` and `PORT` do not isolate any of that, so two suites at once delete each other's probe roles and fail. Ask the human before a full run.
- If a run fails as if `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` or `ALERT_EMAILS` were set in the shell (they beat `.env.test`), tell the human: you cannot unset them for opencode.
- A spec that imports a missing module makes Japa hang instead of failing, and a hung Japa ignores TERM: always run under `timeout -s KILL <seconds>` (as [testing](../apps/platform/docs/testing.md) says) and read the log's `Tests` line (`rg -n "Tests" <log>`), not the exit code.
- A full run needs `queue_jobs` in `tattoo_drip_oc` empty, or `new_inquiry_alert_flow.spec.ts` fails. You cannot truncate it: ask the human ("Before you run opencode", step 6).
- Every new `/t/:tenant` route needs a name and an isolation case in `tests/isolation/cases.ts`. Once the role table of TAT-30 is on main (it is in review; `rg TENANT_ROUTE_ROLES apps/platform` finds nothing until then) it also needs an entry in `TENANT_ROUTE_ROLES`. Read [testing](../apps/platform/docs/testing.md).

## Generated files

Never edit `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts`, `apps/platform/database/schema.ts` or `apps/platform/.adonisjs/`. Regenerate them as `AGENTS.md` says and commit the result.

## Recurring pitfalls

- Lucid seeders and instance writes: pass `{ connection: client.connectionName }`, not a plain `{ client }`, or the write fails row-level security.
- `@inject()` dependencies need value imports with the `useImportType` suppression comment (see backend guidance).
- Screenshots, logs and scratch files stay out of the repository.
