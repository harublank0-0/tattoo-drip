# Tattoo Drip

pnpm monorepo. Start in the affected area; use the root for work spanning areas. Read that area's `AGENTS.md` before editing if not already loaded.

- `apps/platform`: AdonisJS + Inertia + React; data, business rules, REST API and worker.
- `apps/storefront`: TanStack Start; hosted storefront.
- `packages/{types,sdk,react}`: OpenAPI contract, framework-independent client, React hooks.

## Boundaries

- The platform owns all data. Storefront has no database/auth layer; platform access only through `@tattoo-drip/sdk` / `@tattoo-drip/react`.
- The storefront never imports from `apps/platform`, and `packages/*` never import from `apps/*`.
- No framework, AdonisJS or app imports in `packages/sdk`.

## Work and validation

- pnpm only; versions in `.nvmrc` / root `package.json`. Run package scripts with `pnpm --filter @tattoo-drip/<area> <script>` or from that package. Use `pnpm why` / `pnpm list` for dependency questions.
- Root gates: `pnpm check` (Biome), `pnpm typecheck`, `pnpm build`, `pnpm test`. Narrow checks to changed behavior first; prerequisites, hooks and CI are in [README](README.md). Use Biome, not ESLint/Prettier. Conventional Commits use area scopes.
- Search filenames (`rg --files <area> -g '<pattern>'`) and symbols (`rg -n '<symbol>' <directory>`) first; read bounded sections. Skip dependencies, generated files, build outputs, logs, screenshots, archives and lockfiles during routine exploration; inspect them when needed. Bound output, batch independent reads, and reuse findings until evidence changes.
- Preserve user edits. Test changed behavior; retain necessary debugging, security and tenant-isolation checks. Repeat checks only after relevant changes or new evidence.

## Generated files

Never edit these; regenerate them instead:

- `packages/types/src/openapi.gen.ts`: `pnpm --filter @tattoo-drip/types generate` after editing `openapi.yaml`
- `apps/storefront/src/routeTree.gen.ts`: `pnpm --filter @tattoo-drip/storefront generate-routes` (also its dev server).
- Platform `database/schema.ts`: new migration, then `node ace migration:run` in platform. `.adonisjs/`: `node ace codegen` after route/page/controller changes; include generated changes.

## Task guidance

[Documentation index](docs/README.md): choose only the needed document/section. Area guides route backend, UI and test work. Read research only when asked; dated plans/specs are historical evidence.

Memory: retain stable decisions, verified commands and recurring pitfalls absent from canonical docs. Correct/deduplicate/prune stale entries; keep temporary progress in a compact handoff. See [agent workflow](docs/agent-workflow.md) for sessions and memory.
