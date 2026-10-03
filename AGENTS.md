## Repo layout

pnpm monorepo. Read `docs/` (start with `docs/product.md`) before feature work.

- `apps/platform`: AdonisJS + Inertia + React. Dashboard, REST API, all business rules and data.
- `apps/storefront`: TanStack Start hosted storefront. Talks to the platform only through `@tattoo-drip/sdk`.
- `packages/types`: `openapi.yaml` is the public API contract. Run `pnpm --filter @tattoo-drip/types generate` after editing it.
- `packages/sdk`, `packages/react`: the public SDK. No framework, AdonisJS or app imports in `sdk`.
- Biome formats and lints everything (`pnpm check`). Do not add ESLint or Prettier.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
