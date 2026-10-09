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
cp apps/storefront/.env.local.example apps/storefront/.env.local

pnpm podman:up                           # Postgres 18, Redis, Mailpit (foreground)
```

Then, in a second terminal:

```bash
pnpm --filter @tattoo-drip/platform exec node ace migration:run
```

`pnpm podman:up` runs in the foreground and streams the services' logs; `Ctrl+C` stops them, and `pnpm podman:up -d` runs them in the background instead. It reads `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` and `DB_PORT` from `apps/platform/.env`, so the container and the app always agree, and Postgres creates the database on first start. Postgres only applies these values when its data volume is first created: after changing them, recreate it with `podman-compose down -v` (this deletes local data).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run platform (port 3333) and storefront (port 3000) |
| `pnpm dev:platform` / `pnpm dev:storefront` | Run one app |
| `pnpm worker` | Run the platform's job worker (queued jobs and emails) |
| `pnpm build` | Build every package and app |
| `pnpm typecheck` | Typecheck every package and app |
| `pnpm test` | Run packages with test scripts; currently only platform (Japa) |
| `pnpm check` | Biome lint + format check (`pnpm format:fix` to format) |
| `pnpm --filter @tattoo-drip/types generate` | Regenerate API types after editing `openapi.yaml` |

Narrow work with `pnpm --filter @tattoo-drip/<area> typecheck` and [platform test guidance](apps/platform/docs/testing.md). Functional tests need migrated PostgreSQL; boot commands need the platform environment. Storefront and public packages currently have no test scripts, so root tests do not validate their behavior.

CI runs install, `pnpm check`, `pnpm typecheck`, `pnpm build`, platform migrations on PostgreSQL 18 and `pnpm test`, on PRs and pushes to `main` (`.github/workflows/ci.yml`). It checks that regenerated `apps/platform/database/schema.ts` is included. Pre-commit runs Biome on staged files; pre-push runs check/typecheck. Commitlint enforces Conventional Commits; use area scopes (`platform`, `storefront`, `types`, `sdk`, `react`).

## Working with AI agents

`AGENTS.md` is the shared source of instructions. Each `CLAUDE.md` imports its neighboring `AGENTS.md` using Claude Code's supported import syntax, so compatibility does not depend on direct AGENTS discovery. Start in the affected area to load root plus area instructions and its scoped skills:

```bash
cd apps/platform && claude      # or apps/storefront, or packages
```

Start at the root for changes spanning areas. Skills live in `.agents/skills/` and remain symlinked into each area's `.claude/skills/`; names/descriptions may enter context before invocation, while bodies load when invoked. Documentation links are pointers, not imports or guarantees of lazy loading: read the relevant guide explicitly before editing. See [agent workflow](docs/agent-workflow.md) for loading/settings behavior, exploration, memory, continuing and handing off tasks, and [context audit](docs/agent-context-audit.md) for size comparisons and verification limits.

Use `/td-work <goal>` for a scoped implementation task and `/td-handoff <task>` to save a compact resume note. These two root skills are manual-only and available from each area; they add no automatic skill description/body context. A repo-local status line displays current context use and estimated session API cost. See [workflow commands and usage](docs/agent-workflow.md#task-entry-and-completion).

## Deployment

- **Storefront:** Vercel, with the project's Root Directory set to `apps/storefront`.
- **Platform:** a Node container (`node ace build`, then `node bin/server.js` in `build/`).
