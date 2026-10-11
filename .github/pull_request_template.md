## What changed

## Checklist

- [ ] Every new or changed tenant-owned endpoint (`/t/:tenant/...`) has an isolation case in `apps/platform/tests/isolation/cases.ts`, or an exemption with a reason. A test fails for a route without one.
- [ ] Every new tenant-owned table runs `enableTenantRls()` in its migration. A test fails for a table without it.
- [ ] Every new service query that reads or writes tenant-owned rows has a test that runs it from the other tenant's context (`inTenantAs`), because the isolation harness cannot see a missing filter while RLS hides the rows.
- [ ] Work outside the database (deleting files, sending email, calling APIs) uses `afterCommit` / `afterRollback`, never right after a service's own transaction returns.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.
