# Documentation index

Select guidance for the current task. Follow ordinary links when needed; this index is not a required reading sequence.

| When needed | Read |
|---|---|
| Local setup, workspace commands, deployment overview | [Repository README](../README.md) |
| Product intent, users, core journeys | [Product](product.md) |
| Required behavior, tenant isolation, project/payment/privacy rules | [Requirements](requirements.md) |
| System boundaries, backend modules, tenancy, auth, request flows | [Architecture](architecture.md) |
| Conceptual entities and ownership | [Data model](data-model.md) |
| API contract, SDK boundaries, React adapter | [SDK](sdk.md) |
| Phase scope and release gates | [Roadmap](roadmap.md) |
| Market evidence, only when requested | [Research](research.md) |
| Platform services, controllers, tenancy, database conventions | [Backend development](../apps/platform/docs/backend.md) |
| Platform React, Inertia, forms, shadcn and styling | [Platform UI](../apps/platform/docs/ui.md) |
| Queue dispatch, worker, retries, email templates | [Jobs and email](../apps/platform/docs/jobs-and-email.md) |
| Platform test setup, narrowing tests, recurring pitfalls | [Platform testing](../apps/platform/docs/testing.md) |
| Storefront forms, routing, data fetching and monitoring | [Storefront development](../apps/storefront/docs/development.md) |
| Repository exploration, Claude loading behavior, sessions and memory | [Agent workflow](agent-workflow.md) |
| Maintaining this instruction setup and checking context sizes | [Agent context audit](agent-context-audit.md) |

Product documents describe intended behavior and design; they are not implementation status reports. Check the relevant routes, source and tests for what exists today. The OpenAPI contract is in `packages/types/openapi.yaml`.

Historical decisions and task plans remain in [specs](superpowers/specs/) and [plans](superpowers/plans/). Select a matching dated filename when revisiting that feature; do not read these folders routinely. Verify historical instructions against current code and canonical guidance before applying them.
