# Tattoo Drip

Multi-tenant platform for tattoo studios and independent artists. Use the [documentation index](docs/README.md) to find guidance for your task.

## Layout

```text
apps/
├── platform/     AdonisJS + Inertia + React: dashboard, REST API, worker
└── storefront/   TanStack Start: hosted storefront
packages/
├── types/        @tattoo-drip/types: OpenAPI contract (openapi.yaml) + generated types
├── sdk/          @tattoo-drip/sdk: framework-independent API client
└── react/        @tattoo-drip/react: TanStack Query hooks on top of the SDK
```

Packages are consumed from source inside the workspace, so there's no build step during development.

## Setup

Use the repo's Node 24.3.0 (`.nvmrc`) and pnpm 12.8.1 (`package.json`) pins, plus Podman with podman-compose.

```bash
pnpm install
cp apps/platform/.env.example apps/platform/.env
pnpm --filter @tattoo-drip/platform exec node ace generate:key
cp apps/storefront/.env.local.example apps/storefront/.env.local   # set API_URL to the platform's address

pnpm podman:up                           # Postgres 18, Redis, Mailpit (foreground)
```

Then, in a second terminal:

```bash
pnpm --filter @tattoo-drip/platform migrate
```

`pnpm podman:up` runs in the foreground and streams the services' logs; `Ctrl+C` stops them, and `pnpm podman:up -d` runs them in the background instead. It reads `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` and `DB_PORT` from `apps/platform/.env`, so the container and the app always agree, and Postgres creates the database on first start. Postgres only applies these values when its data volume is first created: after changing them, recreate it with `podman-compose down -v` (this deletes local data).

The database has two roles. `DB_MIGRATION_USER` (the owner, `postgres` by default) owns the tables and runs migrations; `DB_USER` (`tattoo_drip_app`) is the restricted role the app connects as, and row-level security applies to it, not to the owner. A new volume gets the app role from `docker/postgres/init`. For an existing dev database, create it once, then copy the new `DB_*` lines from `apps/platform/.env.example` into your `.env`:

    PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d tattoo_drip -v ON_ERROR_STOP=1 \
      -v app_user=tattoo_drip_app -v app_password=tattoo_drip_app -v owner_user=postgres \
      -f apps/platform/database/setup_roles.sql

An existing checkout must update `apps/platform/.env` from `.env.example` before `pnpm dev`, `pnpm test` or the platform's `pnpm migrate` work: `DB_USER` / `DB_PASSWORD` become the app role, and `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD` are new. The server and the test runner refuse to boot as a role that bypasses row-level security. More in [database conventions](apps/platform/database/README.md#row-level-security).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run platform (port 3333) and storefront (port 3000) |
| `pnpm dev:platform` / `pnpm dev:storefront` | Run one app |
| `pnpm worker` | Run the platform's job worker (queued jobs and emails) |
| `pnpm build` | Build every package and app |
| `pnpm typecheck` | Typecheck every package and app |
| `pnpm test` | Run every package's tests: platform (Japa), SDK, React and storefront (`node:test`) |
| `pnpm check` | Biome lint + format check (`pnpm format:fix` to format) |
| `pnpm --filter @tattoo-drip/types generate` | Regenerate API types after editing `openapi.yaml` |

Narrow work with `pnpm --filter @tattoo-drip/<area> typecheck` and [platform test guidance](apps/platform/docs/testing.md). Functional tests need migrated PostgreSQL; boot commands need the platform environment. The SDK, React and storefront tests (`node:test` with `tsx`) need no database. To try a studio page, run the platform and open `http://<slug>.localhost:3000` for a studio in its database; `http://localhost:3000` is the landing page.

To try the installed dashboard app locally, build the platform and run the built server (the service worker is off in development): `pnpm --filter @tattoo-drip/platform build`, then `NODE_ENV=production node bin/server.js` from `apps/platform/build` with the platform's environment variables set (for example by copying `apps/platform/.env` into `build/`). Open it in Chrome on `http://localhost` and install it from the address bar (browsers only offer installation on HTTPS or `localhost`, so a phone needs an HTTPS tunnel; on iPhone: Share → Add to Home Screen). In DevTools → Network, "Offline" then a reload shows the offline page.

CI runs install, `pnpm check`, `pnpm typecheck`, `pnpm build`, platform migrations on PostgreSQL 18 and `pnpm test`, on PRs and pushes to `main` (`.github/workflows/ci.yml`). It checks that regenerated `apps/platform/database/schema.ts` is included. Pre-commit runs Biome on staged files; pre-push runs check/typecheck. Commitlint enforces Conventional Commits; use area scopes (`platform`, `storefront`, `types`, `sdk`, `react`).

## Working with AI agents

`AGENTS.md` is the shared source of instructions. Each `CLAUDE.md` imports its neighboring `AGENTS.md` using Claude Code's supported import syntax, so compatibility does not depend on direct AGENTS discovery. Start in the affected area to load root plus area instructions and its scoped skills:

```bash
cd apps/platform && claude      # or apps/storefront, or packages
```

Start at the root for changes spanning areas. Skills live in `.agents/skills/` and remain symlinked into each area's `.claude/skills/`; names/descriptions may enter context before invocation, while bodies load when invoked. Documentation links are pointers, not imports or guarantees of lazy loading: read the relevant guide explicitly before editing. See [agent workflow](docs/agent-workflow.md) for loading/settings behavior, exploration, memory, continuing and handing off tasks, and [context audit](docs/agent-context-audit.md) for size comparisons and verification limits.

Use `/td-work <goal>` for a scoped implementation task and `/td-handoff <task>` to save a compact resume note. These two root skills are manual-only and available from each area; they add no automatic skill description/body context. A repo-local status line displays current context use and estimated session API cost. See [workflow commands and usage](docs/agent-workflow.md#task-entry-and-completion).

## Deployment

- **Storefront:** Vercel, with the project's Root Directory set to `apps/storefront`, the apex and wildcard domains, and `API_URL` (the API's public origin: browsers call it too) and `STOREFRONT_URL` (`https://{tenant}.<domain>`) set, plus `STOREFRONT_SERVER_KEY` once TAT-38 checks it (TAT-13). On the first deploy, check that functions see the studio's domain in `Host`, open the landing page (a bad `API_URL` or `STOREFRONT_URL` is read on the first request, not at start, so it shows as a 500 on every page) and check that a server function call works (Start's CSRF Origin fallback sees the scheme `http:` behind Vercel's TLS, so only clients that send no `Sec-Fetch-Site` are affected). See [tenants and hosts](apps/storefront/docs/development.md#tenants-and-hosts).
- **Platform:** a Node container (`node ace build`, then `node bin/server.js` in `build/`).
- **Deposit links:** `STOREFRONT_URL` is required in production: the platform, its worker and every `ace` command refuse to start without it. Set it to the studio pages' origin with `{tenant}` for the slug (e.g. `https://{tenant}.example.com`, an http(s) URL with the slug in the host); deposit links are built from it (TAT-65). In development and tests it is optional and links use the dev host `http://{tenant}.localhost:3000`; the project page then warns that no client can open them.
- **Bot challenge:** the intake form uses Cloudflare Turnstile (TAT-55). In the Cloudflare dashboard (a free account is enough), add a Turnstile widget for the studio pages' domain in Managed mode; its site key is public and goes to the storefront (TAT-57), its secret key to the platform as `TURNSTILE_SECRET_KEY`, which production requires (the platform, its worker and every `ace` command that boots the app refuse to start without it). Leave it unset in development: the check is off. The platform must reach `challenges.cloudflare.com` over HTTPS; when it can't, inquiries are refused with `challenge_unavailable`.
- **Payment proofs:** before a pilot takes deposits, the storefront deposit page (TAT-65b) and object storage (TAT-27) must ship. Private images are served only through 5-minute signed URLs that answer with `Cache-Control: private, no-store` (TAT-66). When the private disk moves to R2 (TAT-27), check that its signed URLs still send that header, and keep `/files` request URLs, which carry the signature, out of access logs.
