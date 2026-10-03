## Packages

The public API contract and SDK. Apps consume these from source inside the workspace, so there is no build step during development.

- **`types` (`@tattoo-drip/types`):** `openapi.yaml` is the public API contract. After editing it, run `pnpm --filter @tattoo-drip/types generate`. `src/openapi.gen.ts` is generated; never edit it. `src/index.ts` re-exports friendly type names.
- **`sdk` (`@tattoo-drip/sdk`):** framework-independent API client (`src/client.ts`, `src/errors.ts`). Depends only on `@tattoo-drip/types`. No React, AdonisJS or app imports.
- **`react` (`@tattoo-drip/react`):** TanStack Query provider, query keys and hooks on top of the SDK (`src/provider.tsx`, `src/queries.ts`, `src/hooks.ts`).

## Rules

- Change the contract first, then the SDK, then the hooks, so all three stay in step.
- The draft contract still describes the old booking flow (`bookings.create`, availability). It must move to inquiries; see `docs/sdk.md` and the "Current state" section of `docs/architecture.md`.
- Typecheck each package with `pnpm --filter @tattoo-drip/<name> typecheck`.

Relevant docs: `docs/sdk.md`, `docs/architecture.md`.
