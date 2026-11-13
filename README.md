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

Narrow work with `pnpm --filter @tattoo-drip/<area> typecheck` and [platform test guidance](apps/platform/docs/testing.md). Functional tests need migrated PostgreSQL, and the video specs need `ffmpeg` and `ffprobe` on `PATH` (they run them on generated clips; e.g. `apt-get install ffmpeg` or `brew install ffmpeg`); boot commands need the platform environment. The SDK, React and storefront tests (`node:test` with `tsx`) need no database. To try a studio page, run the platform and open `http://<slug>.localhost:3000` for a studio in its database; `http://localhost:3000` is the landing page.

To try the installed dashboard app locally, build the platform and run the built server (the service worker is off in development): `pnpm --filter @tattoo-drip/platform build`, then `NODE_ENV=production node bin/server.js` from `apps/platform/build` with the platform's environment variables set (for example by copying `apps/platform/.env` into `build/`) plus what production requires (`STOREFRONT_URL=http://{tenant}.localhost:3000`, `TRUST_PROXY=loopback`, a `STOREFRONT_SERVER_KEYS` value from `openssl rand -base64 32`, Cloudflare's always-passing test secret `1x0000000000000000000000000000000AA` as `TURNSTILE_SECRET_KEY`, and any other setting the boot error names). Production signs in only over HTTPS: its session cookie is `__Host-` and `Secure`, and it refuses an http `APP_URL`. So put a local HTTPS proxy in front, for example Caddy (`caddy trust` once, then `caddy reverse-proxy --from 127.0.0.1:8443 --to localhost:3333`), set `APP_URL=https://127.0.0.1:8443`, open that address in Chrome and install it from the address bar (a phone needs an HTTPS tunnel; on iPhone: Share → Add to Home Screen). In DevTools → Network, "Offline" then a reload shows the offline page. Use the IP, not `localhost`: Shield sends `Strict-Transport-Security` (180 days) on every response and browsers pin it per host, whatever the port, so a trial on `https://localhost:8443` would make Chrome and Firefox upgrade `http://localhost:3333` and `http://localhost:3000` to https afterwards, while they never store it for an IP address (`127.0.0.1` still counts as loopback for the `APP_URL` check). If you already tried it on `localhost`, remove the entry at `chrome://net-internals/#hsts` (Delete domain security policies, `localhost`). The Caddy command and the install step have not been run here; check them on your machine.

CI runs install, `pnpm check`, `pnpm typecheck`, `pnpm build`, platform migrations on PostgreSQL 18, installs ffmpeg and runs `pnpm test`, on PRs and pushes to `main` (`.github/workflows/ci.yml`). It checks that regenerated `apps/platform/database/schema.ts` is included. Pre-commit runs Biome on staged files; pre-push runs check/typecheck. Commitlint enforces Conventional Commits; use area scopes (`platform`, `storefront`, `types`, `sdk`, `react`).

## Working with AI agents

`AGENTS.md` is the shared source of instructions. Each `CLAUDE.md` imports its neighboring `AGENTS.md` using Claude Code's supported import syntax, so compatibility does not depend on direct AGENTS discovery. Start in the affected area to load root plus area instructions and its scoped skills:

```bash
cd apps/platform && claude      # or apps/storefront, or packages
```

Start at the root for changes spanning areas. Skills live in `.agents/skills/` and remain symlinked into each area's `.claude/skills/`; names/descriptions may enter context before invocation, while bodies load when invoked. Documentation links are pointers, not imports or guarantees of lazy loading: read the relevant guide explicitly before editing. See [agent workflow](docs/agent-workflow.md) for loading/settings behavior, exploration, memory, continuing and handing off tasks, and [context audit](docs/agent-context-audit.md) for size comparisons and verification limits.

Use `/td-work <goal>` for a scoped implementation task and `/td-handoff <task>` to save a compact resume note. These two root skills are manual-only and available from each area; they add no automatic skill description/body context. A repo-local status line displays current context use and estimated session API cost. See [workflow commands and usage](docs/agent-workflow.md#task-entry-and-completion).

## Deployment

The first production deploy runs everything on one server behind a Cloudflare Tunnel: follow the [server runbook](deploy/README.md) (server, Cloudflare, settings, first start, updates, backups, restore). The bullets below are the general rules it applies.

- **Storefront:** its own host (the one-server deploy runs it behind nginx on the same server; any host works that sets the studio's domain in `Host`), with the apex and wildcard domains, and `API_URL` (the API's public origin: browsers call it too), `MEDIA_URL` (the origin the photos are served from, the platform's `R2_PUBLIC_URL`: the pages show no photo from anywhere else) and `STOREFRONT_URL` (`https://{tenant}.<domain>`) set, `TURNSTILE_SITE_KEY` (the Turnstile widget's public site key: with `NODE_ENV=production` a missing one makes every page a 500), and `STOREFRONT_SERVER_KEY` (required in production: one of the platform's `STOREFRONT_SERVER_KEYS`) (TAT-13). On the first deploy, check that the server sees the studio's domain in `Host`, open the landing page (a bad `API_URL` or `STOREFRONT_URL` is read on the first request, not at start, so it shows as a 500 on every page) and check that a server function call works (Start's CSRF Origin fallback sees the scheme `http:` behind a host's TLS termination, so only clients that send no `Sec-Fetch-Site` are affected). See [tenants and hosts](apps/storefront/docs/development.md#tenants-and-hosts).
- **Platform:** a Node container (`node ace build`, then `node bin/server.js` in `build/`). Follow the [public API production checklist](apps/platform/docs/deploy.md#public-api-production-checklist). With `NODE_ENV=production` it starts only with an https `APP_URL` on a domain of its own, apart from the studio pages' ([dashboard cookies and domains](apps/platform/docs/deploy.md#dashboard-cookies-and-domains)).
- **Platform settings in production:** `STOREFRONT_SERVER_KEYS` (the storefront's key, two while rotating) and `TRUST_PROXY` (the reverse proxy's addresses) are required with `NODE_ENV=production`, as are `STOREFRONT_URL` and `TURNSTILE_SECRET_KEY`.
- **Account email:** signup, email confirmation and password reset (TAT-18) need working SMTP in production (`MAIL_FROM_ADDRESS` on a sending domain with SPF, DKIM and DMARC, TAT-20). Until then, confirm a pilot's account with `node build/ace.js account:verify <email>`: see the [account email checklist](apps/platform/docs/deploy.md#account-email).
- **Deposit links:** `STOREFRONT_URL` is required in production: the platform, its worker and every `ace` command refuse to start without it. Set it to the studio pages' origin with `{tenant}` for the slug (e.g. `https://{tenant}.example.com`, an http(s) URL with the slug in the host); deposit links are built from it (TAT-65). In development and tests it is optional and links use the dev host `http://{tenant}.localhost:3000`; the project page then warns that no client can open them.
- **Bot challenge:** the intake form uses Cloudflare Turnstile (TAT-55). In the Cloudflare dashboard (a free account is enough), add a Turnstile widget for the studio pages' domain in Managed mode (a hostname covers its subdomains, so that domain is enough; each custom domain, TAT-79, needs its own entry); its site key is public and goes to the storefront as `TURNSTILE_SITE_KEY` (the storefront's settings on its host; TAT-57), its secret key to the platform as `TURNSTILE_SECRET_KEY`, which production requires (the platform, its worker and every `ace` command that boots the app refuse to start without it). Leave it unset in development: the check is off. The platform must reach `challenges.cloudflare.com` over HTTPS; when it can't, inquiries are refused with `challenge_unavailable`.
- **Payment proofs:** object storage (TAT-27) is done: production keeps both photo disks on Cloudflare R2 and refuses to start on local folders. Private images are served only through 5-minute signed URLs that answer with `Cache-Control: private, no-store` (TAT-66); on R2 the object is stored with that header, and the runbook's deploy-day checks look at it. Wherever the platform serves private files itself (`/files`), keep those request URLs, which carry the signature, out of access logs.
