# Inquiry-to-deposit models (data layer)

Date: 2026-10-12
Refs: TAT-37. Its blocker TAT-28 (row-level security) and the `artists` table from TAT-31 are done. It blocks TAT-36 (sessions), TAT-41, TAT-42, TAT-43, TAT-46, TAT-51, TAT-64 and TAT-65.

## Goal

The inquiry-to-deposit loop needs one place to keep the people who write in, what they asked, the sale, its price and the money. This ticket creates that foundation: six tenant-owned tables (`clients`, `inquiries`, `tattoo_projects`, `reference_images`, `quotes`, `payments`) with their Lucid models, composite tenant foreign keys, row-level security, and the database rules that must hold even when a service has a bug: payments are append-only and an inquiry is a frozen record.

It is the data layer only. It has no routes, pages, services or API. TAT-51 (intake and client matching), TAT-46 (inbox and lifecycle), TAT-64 (quote builder), TAT-65 (deposit page and proof), TAT-41/42/43 (clients, privacy deletion, walk-ins) and TAT-36 (sessions, which reference `tattoo_projects` and `artists`) build on it.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Scope | Data layer only: tables, models, constraints, triggers, seeds, tests, docs. No services | The later tickets define their own rules; guessing their API shapes here is waste. Tests and seeds create rows through the models |
| Payments append-only | A database trigger | The ticket and the data model say a payment is never edited or deleted. A buggy service or a manual query must not be able to rewrite the books |
| Inquiry immutability | A database trigger, with a privacy exception: the contact snapshot may change only in the one update that first sets `anonymized_at` (TAT-42) | "Immutable record of what was submitted" should be true in the database too, without blocking the legal deletion path |
| A decided payment | Final: `status` can change only from `submitted`. A mistaken verification is corrected with a refund (a negative payment) plus a new payment; a rejected proof is replaced by a new payment | Keeps the history honest and matches "never edited" |

## Modules and conventions

- **Modules follow the [architecture](../../architecture.md#backend-modules) table.** `app/modules/clients/` owns `Client`; `app/modules/inquiries/` owns `Inquiry` and `ReferenceImage`; `app/modules/projects/` owns `TattooProject` and `Quote`; the existing `app/modules/payments/` gains `Payment`. Each has `models/` and, where it has allowed values, a `rules.ts` with the const arrays and types: `INQUIRY_STATUSES`, `SOURCE_CHANNELS`, `PROJECT_STATUSES`, `QUOTE_KINDS`, `PAYMENT_KINDS`, `PAYMENT_STATUSES`. `Payment.method` reuses `PAYMENT_METHOD_KINDS`.
- **Migrations.** One per table, after `1791580000000_create_artists_table`, in dependency order: `1791590000000` clients, `1791590000001` inquiries, `1791590000002` tattoo_projects, `1791590000003` reference_images, `1791590000004` quotes, `1791590000005` payments. Each runs `enableTenantRls`, links other tenant-owned tables with `tenantReference`, and gets its `tenant_isolation:ALL` entry in `EXPECTED_POLICIES` (`tests/functional/rls/catalog_guard.spec.ts`).
- **Column conventions.** UUIDv7 primary keys; instants are `timestamptz`; enums are `table.enum` string columns (a check constraint, like `payment_methods.kind`); money is an integer in paisa plus a `currency` column defaulting to `NPR`; soft delete (`deleted_at`, `withSoftDeletes`) on every table except `payments`. Every foreign-key column gets an index (the [database conventions](../../../apps/platform/database/README.md)), on top of the indexes listed per table.
- **Composite foreign keys use `NO ACTION`**, not the helper's default `CASCADE`: hard-deleting a client, artist or project that something still points to is refused. Nothing in the product hard-deletes these rows (everything is soft-deleted). A hard purge of a tenant that has payments is also refused, by the payments trigger below; if a purge is ever needed it is an explicit operations step.
- **Tenant deletion.** `Tenant.softDelete` also soft-deletes the tenant's live clients, inquiries, projects, quotes and reference images; payments stay. The method's repeated update statements become a loop over the models that carry `tenant_id` and `deleted_at`.
- **Images.** `IMAGE_PURPOSES` gains `reference_image: { visibility: "private" }` (`payment_proof` is already there, for TAT-65).

## Tables

All six have `id`, `tenant_id` (references `tenants`, cascade, indexed), `created_at` and `updated_at`; all but `payments` also have `deleted_at`. Only the other columns are listed.

### `clients` (module `clients`)

| Column | Type | Notes |
|---|---|---|
| `name` | varchar(120), not null | |
| `phone` | varchar(16), null | E.164. Null only once the client is anonymized |
| `email` | varchar(254), null | |
| `notes` | varchar(2000), null | The studio's notes |
| `anonymized_at` | timestamptz, null | Set by TAT-42 |

- Checks: `clients_phone_e164` (`phone ~ '^\+[1-9][0-9]{7,14}$'`, the shape `normalizePhone` produces) and `clients_phone_unless_anonymized` (`phone is not null or anonymized_at is not null`).
- Partial unique `clients_tenant_phone_live_unique` on `(tenant_id, phone)` where `deleted_at is null and phone is not null`: one client per phone per tenant, and a deleted client frees its phone.

### `inquiries` (module `inquiries`)

| Column | Type | Notes |
|---|---|---|
| `client_id` | uuid, not null | Composite FK to `clients` |
| `idea` | varchar(4000), not null | |
| `placement` | varchar(120), not null | Free text; platform placement lists are V1 |
| `approximate_size` | varchar(120), not null | Free text |
| `preferred_dates` | varchar(500), not null | Free text |
| `preferred_artist_id` | uuid, null | Composite FK to `artists` |
| `budget` | varchar(120), null | Free text, like the draft contract's string |
| `source_channel` | enum, not null | `instagram`, `facebook`, `tiktok`, `google`, `friend`, `other` |
| `contact_name` | varchar(120), not null | The contact snapshot, as submitted |
| `contact_phone` | varchar(16), null | E.164; null only once anonymized |
| `contact_email` | varchar(254), null | |
| `status` | enum, not null, default `new` | `new`, `accepted`, `declined` |
| `decided_at` | timestamptz, null | |
| `anonymized_at` | timestamptz, null | Set by TAT-42 |

- Checks: `inquiries_decided_matches_status` (`(status = 'new') = (decided_at is null)`), `inquiries_contact_phone_e164` and `inquiries_contact_phone_unless_anonymized` (the same two rules as `clients`).
- Indexes: `(tenant_id, status, created_at)` for the inbox, and `(tenant_id, client_id)`.
- **Trigger `inquiries_guard_update`** (BEFORE UPDATE):
  - Always rejects a change to `tenant_id`, `client_id`, `idea`, `placement`, `approximate_size`, `preferred_dates`, `preferred_artist_id`, `budget`, `source_channel` and `created_at`.
  - Rejects a change to `contact_name`, `contact_phone` or `contact_email` unless the same update sets `anonymized_at` from null to a value. Once `anonymized_at` is set it cannot change.
  - Allows `status`, `decided_at`, `deleted_at` and `updated_at`.

### `tattoo_projects` (module `projects`)

| Column | Type | Notes |
|---|---|---|
| `client_id` | uuid, not null | Composite FK to `clients` |
| `artist_id` | uuid, null | Composite FK to `artists`; a walk-in may not have one yet |
| `inquiry_id` | uuid, null | Composite FK to `inquiries`; null for a walk-in |
| `brief` | varchar(4000), not null | |
| `notes` | varchar(4000), null | The studio's private notes |
| `last_contacted_at` | timestamptz, null | |
| `status` | enum, not null, default `reviewing` | `reviewing`, `quoted`, `on_hold`, `deposit_pending`, `booked`, `in_progress`, `completed`, `healing_check`, `declined`, `cancelled` |

- There is no `inquiry` project status: the inquiry is its own entity, and an accepted inquiry becomes a project in `reviewing`. The transition rules belong to TAT-46.
- Partial unique `tattoo_projects_inquiry_live_unique` on `(tenant_id, inquiry_id)` where `deleted_at is null and inquiry_id is not null`: an inquiry becomes at most one project.
- Indexes: `(tenant_id, status)`, `(tenant_id, artist_id)`, `(tenant_id, client_id)`.

### `reference_images` (module `inquiries`)

| Column | Type | Notes |
|---|---|---|
| `inquiry_id` | uuid, null | Composite FK to `inquiries` |
| `project_id` | uuid, null | Composite FK to `tattoo_projects` |
| `image_key` | varchar(255), not null | Private disk key |
| `width`, `height` | integer, not null | |
| `position` | smallint, not null | Order within the inquiry |

- Check `reference_images_attached`: `inquiry_id is not null or project_id is not null`.
- The row is created with the inquiry, and `project_id` is filled in when the inquiry is accepted. A walk-in project's images have only `project_id`. The limit of 5 per inquiry is TAT-51's rule.

### `quotes` (module `projects`)

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid, not null | Composite FK to `tattoo_projects` |
| `version` | integer, not null | ≥ 1 |
| `kind` | enum, not null | `fixed`, `hourly` |
| `fixed_price` | integer, null | Paisa |
| `hourly_rate` | integer, null | Paisa per hour |
| `estimated_hours` | numeric(5,2), null | |
| `deposit_amount` | integer, not null, default 0 | Paisa; may be zero |
| `currency` | varchar(3), not null, default `NPR` | |
| `expires_at` | timestamptz, not null | |

- Unique `quotes_project_version_unique` on `(project_id, version)`: versions are never reused, deleted rows included.
- Checks: `quotes_kind_columns` (`fixed` has a price and no rate or hours; `hourly` has a rate and hours and no price), `quotes_amounts_positive` (price, rate and hours > 0; deposit ≥ 0), `quotes_deposit_within_total` (`deposit_amount <= coalesce(fixed_price, round(hourly_rate * estimated_hours))`).
- A revision is a new row with the next `version`; the current quote is the highest live version, so there is no flag to drift. Quotes are never mutated, by convention (no trigger). `sent_at` is left to TAT-64, and whether a quote has expired is computed from `expires_at`.

### `payments` (module `payments`; no `deleted_at`)

| Column | Type | Notes |
|---|---|---|
| `project_id` | uuid, not null | Composite FK to `tattoo_projects` |
| `kind` | enum, not null | `deposit`, `session`, `balance`, `refund` |
| `amount` | integer, not null | Signed paisa; a refund is negative |
| `currency` | varchar(3), not null, default `NPR` | |
| `method` | enum, not null | `fonepay`, `esewa`, `khalti`, `bank`, `cash` |
| `proof_image_key` | varchar(255), null | Private; `payment_proof` purpose |
| `proof_image_width`, `proof_image_height` | integer, null | |
| `status` | enum, not null, default `submitted` | `submitted`, `verified`, `rejected` |
| `verified_by_user_id` | uuid, null | References `users`, ON DELETE SET NULL; set on rejection too |
| `verified_at` | timestamptz, null | |

- `method` is stored as a kind, not as a link to `payment_methods`: methods can be edited or deleted, the books must not depend on that, and a desk payment may match no configured method.
- Checks: `payments_amount_sign` (a refund is negative, every other kind positive), `payments_verified_matches_status` (`(status = 'submitted') = (verified_at is null)`), `payments_proof_all_or_none` (the three proof columns are all set or all null).
- Index on `(tenant_id, project_id)`.
- **Trigger `payments_guard`** (BEFORE UPDATE OR DELETE):
  - Rejects every DELETE.
  - Rejects a change to `tenant_id`, `project_id`, `kind`, `amount`, `currency`, `method` and `created_at`.
  - The proof columns may only be cleared (all three to null, for TAT-42), never set to a new value.
  - `status` may change only from `submitted`. On a decided payment `verified_at` cannot change and `verified_by_user_id` may only become null, so the `SET NULL` from deleting an account keeps working.
- Balance due (the current quote's total minus verified payments) is computed elsewhere and is not part of this ticket.

## Tests, seeds and docs

- **Tests** (functional, raw SQL like `artists_table.spec.ts`, plus model-level checks):
  - Per table: every constraint and partial index (including a soft delete freeing a phone or an inquiry), composite foreign keys rejecting a link to another tenant's row, `NO ACTION` refusing a parent delete, and RLS isolation (own rows only, no context sees none, `WITH CHECK` blocks moving a row).
  - Payments trigger: DELETE rejected; each frozen column rejected; proof clearable but not replaced; `submitted` to `verified` or `rejected` allowed; a decided payment final; deleting a user still nulls `verified_by_user_id` on a decided payment.
  - Inquiries trigger: each frozen column rejected; the contact snapshot rejected unless `anonymized_at` is set in the same update; `status` and `decided_at` allowed; `anonymized_at` immutable once set.
  - Models: each maps its columns and soft-deletes where it should; `Payment` has no soft delete.
  - `Tenant.softDelete` cascade test extended to the new tables, and the six `tenant_isolation:ALL` entries in the catalog guard.
- **Seeds.** `twoStudios()` gives each studio one client, inquiry, project, quote, payment and reference image through a new `tests/helpers/pipeline.ts`. There are no new routes, so no new isolation cases; the isolation proof for this ticket is the database-level cross-tenant tests above.
- **Docs.** `apps/platform/docs/backend.md` (the three new modules, `Payment` in the Payments section, the new image purpose); `apps/platform/database/README.md` (which tables have triggers and why, and that TAT-42 must use the `anonymized_at` path); `docs/data-model.md` (`anonymized_at`, the immutable inquiry, final payments, `method` as a kind, no `inquiry` project status). `database/schema.ts` regenerates with `pnpm migrate`; run `node ace codegen` if anything generated changes.

## Not in this ticket

Services, controllers, pages, the API and `openapi.yaml` (TAT-51 moves the booking draft to inquiries). The project state machine (TAT-46). Quote sending, expiry jobs, the quote builder and `sent_at` (TAT-64). The deposit page, reference code and proof upload flow (TAT-65). Client matching, the open-inquiry limit and the 5-image limit (TAT-51). Balance due. Privacy deletion itself (TAT-42; this ticket only makes it possible). Sessions (TAT-36). A `payment_method_id` link, `paid_at` and payment notes (add when a ticket needs them).

## Assumptions the user can overrule at review

Table name `tattoo_projects`; the `source_channel` list; budget, size and dates as free text; all composite foreign keys `NO ACTION`; the `deposit ≤ total` check; no `inquiry` project status; `method` stored as a kind without a link to `payment_methods`; `sent_at` deferred to TAT-64; reference images attach with nullable `inquiry_id` and `project_id` on one row.

## Verification

`pnpm migrate` on the dev database, and from zero on a scratch database (identical regenerated `database/schema.ts`); `pnpm migrate:rollback` then `pnpm migrate` clean. `PORT=3402 node ace test` passes, including the catalog guard and the new trigger and constraint specs. `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. Then the whole-branch review and the Codex code and security reviews before the PR.
