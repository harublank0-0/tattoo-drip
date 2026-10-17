## Packages

Public API contract and SDK, consumed from source in the workspace; no development build step.

- `types`: `openapi.yaml` is canonical; `src/index.ts` re-exports friendly names. Generation command is in [root instructions](../AGENTS.md).
- `sdk`: framework-independent client (`src/client.ts`, `src/errors.ts`); depends only on `@tattoo-drip/types`.
- `react`: TanStack Query provider, keys and hooks (`src/provider.tsx`, `src/queries.ts`, `src/hooks.ts`) on the SDK.

## Rules

- Change the contract first, then the SDK, then the hooks, so all three stay in step.
- Before API changes, read [SDK guidance](../docs/sdk.md#public-api-by-stage) (what each stage exposes; V1 operations are tagged `V1` in the contract). Read [architecture](../docs/architecture.md) for tenancy/module design.
- Typecheck each package with `pnpm --filter @tattoo-drip/<name> typecheck`.

The SDK has tests in `packages/sdk/test` (`pnpm --filter @tattoo-drip/sdk test`: `node:test` run by `tsx`, a mocked `fetch`); root `pnpm test` runs them too. The React package tests its query and mutation option factories in `packages/react/test` (`pnpm --filter @tattoo-drip/react test`, same runner, no rendering); rendered hook tests are TAT-11, so validate changed hook behavior explicitly.
