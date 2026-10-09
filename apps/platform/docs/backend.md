# Backend conventions

Read the relevant section before changing backend behavior. For module boundaries or tenancy design, consult [architecture](../../../docs/architecture.md); for schema changes read [database conventions](../database/README.md) and the relevant [data-model](../../../docs/data-model.md) section. Those contain the canonical schema rules.


## Layout

- `app/controllers`, `app/models`, `app/validators`, `app/transformers`, `app/middleware`, `app/exceptions`
- `app/modules/<module>/`: one folder per backend module from [architecture](../../../docs/architecture.md), owning its `models/`, `services/`, `controllers/`, `validators/` and `emails/`. Import with `#modules/*`. New module code goes here; code still in the flat `app/*` folders moves when its module is built. Controllers and transformers stay in `app/controllers` and `app/transformers` for now: `indexEntities` in `adonisrc.ts` only scans those folders to generate `#generated/*`, so it has to be pointed at the module folders first.
- `start/routes.ts` (routes reference controllers through `#generated/controllers`), `start/kernel.ts` (middleware), `start/env.ts`
- `config/`, `database/migrations/`
- `inertia/pages`, `inertia/layouts`, `inertia/components` (shadcn components in `inertia/components/ui`), `inertia/hooks`, `inertia/css/app.css` (Tailwind entry and theme tokens)
- `tests/unit`, `tests/functional`, `tests/browser` (suites are defined in `adonisrc.ts`)

Import with the subpath aliases from `package.json` (`#controllers/*`, `#models/*`, `#services/*`, `#validators/*`, …), never with long relative paths.

## Dependency injection and module boundaries

- Controllers and services that use `@inject()` must import their dependencies as values, not `import type`: the container reads the class from decorator metadata at runtime. Biome's `useImportType` fix gets this wrong, so mark those imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime`.
- Each backend module owns its models and services; other modules call its services instead of querying its tables. Inertia controllers, API controllers and jobs stay thin and call the same services. See the module table in [architecture](../../../docs/architecture.md).

## API contract and migrations

- The REST API implements the contract in [OpenAPI contract](../../../packages/types/openapi.yaml). Change the contract first, regenerate the types, then implement.
- `database/schema.ts` and `.adonisjs/` are generated. Change the schema with a new migration, never by editing an existing migration that has been run.
- Read [database conventions](../database/README.md) before writing a migration; it owns the UUIDv7, timestamp, ownership, indexing and soft-delete rules.

## Soft deletes

- Soft delete: models of business records use `compose(XSchema, withSoftDeletes)` from `#models/mixins/soft_deletes`. Delete with `record.softDelete(trx?)`, undo with `restore()`; model queries skip deleted rows unless they start from `Model.withTrashed()` or `Model.onlyTrashed()`. The hooks don't reach `whereHas` subqueries or raw `db.from(...)` queries, so add `whereNull("<table>.deleted_at")` there. The hooks append `deleted_at IS NULL` to the end of the query, so a top-level `.orWhere(...)` would let deleted rows through (`a OR (b AND deleted_at IS NULL)`): group your own conditions in `.where((q) => q.where(a).orWhere(b))`. Update queries skip the hooks too; filter `deleted_at` yourself there. Soft-deleting a parent soft-deletes its children in the same transaction (the database's `ON DELETE CASCADE` only covers real purges).

## Tenancy and route access

- The tenant always comes from the URL (`/t/:slug/…` for the dashboard, `/api/v1/tenants/:slug/…` for the API). Services scope every query by tenant; never trust a tenant ID from a request body. Every tenant-owned endpoint needs a test proving tenant A can't reach tenant B's data.
- Tenancy: the `tenancy` module (`app/modules/tenancy/`) owns tenants and memberships. Other modules read them through `TenancyService` (`#modules/tenancy/services/tenancy_service`): `createTenant`, `tenantsFor`, `hasTenant` (one cheap yes/no query), and `assertKeepsAnOwner`, which every remove or demote of a member must call inside its transaction. New users create their first tenant at `/onboarding` (only while they have none: one tenant per account for now). Login, signup and onboarding land on `/dashboard`, which redirects to the tenant the user opened last, else their oldest, else `/onboarding`. Login and logout forget the last tenant (`LAST_TENANT_KEY`), so a shared browser doesn't carry it over. Soft-deleting a tenant (`tenant.softDelete(trx?)`) also soft-deletes its live memberships.
- Tenant pages live in the `/t/:tenant` route group with `[middleware.auth(), middleware.tenant()]`. The tenant middleware calls `TenancyService.membershipFor(user, slug)` on every request (never cache it) and turns `null` into the same 404 as an unknown URL, never a 403, so a URL doesn't reveal that a tenant exists. Every tenant route goes in that group; a test fails for a `/t/:tenant` route without the middleware. Read the result with `tenantContext(ctx)` from `#middleware/tenant_middleware`, which returns `{ tenant, membership }` and throws outside the group (`ctx.tenant` is optional for that reason; the role is `membership.role`). Limit a route to some roles with `middleware.role({ allow: ["owner"] })` after `tenant()`: other members get the same 404. Studio settings (`/t/:tenant/settings/…`) are owners only. They go in the nested settings group, and a test fails for a settings route without the role check. `:id` route params use `.where("id", router.matchers.uuid())`, so a malformed id is a 404 rather than a database error. Controllers pass the tenant to services explicitly; never read a tenant id from the body, query string or headers, and keep `tenant_id` out of validators. Every page gets the `tenant` and `tenants` props from `InertiaMiddleware.share()`; nav items for tenant pages pass `params: { tenant: slug }`.

## Images

- Images: the `media` module (`app/modules/media/`) owns uploads. Every upload field uses `imageFile()` (`#modules/media/validators/image_file`: 10 MB; jpg, jpeg, png, webp), and every upload is stored with `ImageService.store(file, { tenant, purpose })` (`#modules/media/services/image_service`), never written to a disk directly. `store()` checks the real format by its first bytes, rejects images over 40 MP, applies the EXIF orientation, fits the image in 2048 px and re-encodes it with no metadata; anything else throws `InvalidImageError`, whose message is meant for the user (show it as a field error). The purpose (`IMAGE_PURPOSES`) decides the disk: add one per new kind of image, public only if anyone may see it. The owning record keeps the returned key in a column (e.g. `qr_image_key`). If saving the record fails, call `delete(purpose, key)` in the `catch`; when replacing an image, delete the old key after the transaction commits. Soft-deleted records keep their files. `url(purpose, key)` gives the public URL, or a 5-minute signed URL for a private purpose: load the owning record scoped to the tenant first, which is the access check. Drive disks (`config/drive.ts`): `public` served at `/uploads`, `private` at `/files` (signed only). Files live in `storage/` in dev and `tmp/storage/` in tests (cleared each run); production moves to R2 (TAT-27).

## Payments

- Payments: the `payments` module (`app/modules/payments/`) owns payment methods. Read and change them through `PaymentMethodService` (`#modules/payments/services/payment_method_service`): `list(tenant)`, `findFor(tenant, id)` (throws a 404 for an unknown, deleted or other tenant's id), `create`, `update`, `move` and `delete`. The rules for each kind (which details it needs, QR or not, deposit page or not) live in `checkPaymentMethod` (`#modules/payments/rules`). Validators check only the shape. The service throws `PaymentMethodRuleError`; controllers turn it into field errors. eSewa and Khalti wallet IDs are stored in `account_number`. The deposit page (TAT-65) shows `list(tenant)` filtered to `showOnDepositPage`, with the tenant's `defaultDepositPercent` and `depositPolicy`.

## Phone numbers

- Phone numbers: validate with `phoneNumber()` from `#validators/phone`, which stores E.164 (+977 when no country code is given).

See [testing](testing.md) before adding endpoint tests and [jobs and email](jobs-and-email.md) before adding transactional jobs.
