## Packages

Public API contract and SDK, consumed from source in the workspace; no development build step.

- `types`: `openapi.yaml` is canonical; `src/index.ts` re-exports friendly names. Generation command is in [root instructions](../AGENTS.md).
- `sdk`: framework-independent client (`src/client.ts`, `src/errors.ts`); depends only on `@tattoo-drip/types`.
- `react`: TanStack Query provider, keys and hooks (`src/provider.tsx`, `src/queries.ts`, `src/hooks.ts`) on the SDK.

## Rules

- Change the contract first, then the SDK, then the hooks, so all three stay in step.
- Before API changes, read [SDK guidance](../docs/sdk.md#public-api-by-stage): the booking draft must move to inquiries. Read [architecture](../docs/architecture.md) for tenancy/module design.
- Typecheck each package with `pnpm --filter @tattoo-drip/<name> typecheck`.

No test scripts here; root `pnpm test` does not cover SDK/hooks. Validate changed behavior explicitly.
