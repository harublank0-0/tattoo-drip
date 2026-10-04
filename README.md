# Tattoo Drip

Multi-tenant platform for tattoo studios and independent artists. Read [`docs/`](docs/product.md) first.

## Layout

```text
apps/
├── platform/     AdonisJS + Inertia + React: dashboard, REST API, (later) worker
└── storefront/   TanStack Start: hosted storefront
packages/
├── types/        @tattoo-drip/types: OpenAPI contract (openapi.yaml) + generated types
├── sdk/          @tattoo-drip/sdk: framework-independent API client
└── react/        @tattoo-drip/react: TanStack Query hooks on top of the SDK
```

Packages are consumed from source inside the workspace, so there's no build step during development.

## Setup

Requires Node 24+, pnpm, and Podman with podman-compose.

```bash
pnpm install
pnpm podman:up                           # Postgres 18, Redis, Mailpit
podman-compose exec postgres createdb -U postgres tattoo_drip

cp apps/platform/.env.example apps/platform/.env
pnpm --filter @tattoo-drip/platform exec node ace generate:key
pnpm --filter @tattoo-drip/platform exec node ace migration:run

cp apps/storefront/.env.local.example apps/storefront/.env.local
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run platform (port 3333) and storefront (port 3000) |
| `pnpm dev:platform` / `pnpm dev:storefront` | Run one app |
| `pnpm build` | Build every package and app |
| `pnpm typecheck` | Typecheck every package and app |
| `pnpm check` | Biome lint + format check (`pnpm format:fix` to format) |
| `pnpm --filter @tattoo-drip/types generate` | Regenerate API types after editing `openapi.yaml` |

CI runs the same checks, plus the build, the platform migrations on Postgres 18 and the tests, on every pull request to `main` (`.github/workflows/ci.yml`).

## Working with AI agents

Each area has its own `AGENTS.md` (read by Claude Code, Codex and Cursor), and Claude Code gets per-area skills and settings in `<area>/.claude/`. Start the agent in the area you're working on so it loads only that area's context:

```bash
cd apps/platform && claude      # or apps/storefront, or packages
claude --add-dir ../storefront  # one-off access to a sibling area
```

Start at the repository root only for changes that span areas. Skills live in `.agents/skills/` and are symlinked into each area's `.claude/skills/`.

## Deployment

- **Storefront:** Vercel, with the project's Root Directory set to `apps/storefront`.
- **Platform:** a Node container (`node ace build`, then `node bin/server.js` in `build/`).
