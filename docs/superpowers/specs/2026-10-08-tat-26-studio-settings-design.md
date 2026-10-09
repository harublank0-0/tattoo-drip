# Studio profile and payment settings

Date: 2026-10-08
Refs: TAT-26 (blocks TAT-65, the deposit page)

## Goal

A tenant's owners can edit the studio's public profile, set a default deposit percentage and deposit policy, and keep a list of payment methods: Fonepay, eSewa and Khalti QR codes, bank details and cash. Each method can be marked to show on the deposit page that TAT-65 builds. Artists can't reach any of it.

## Access

- A new named middleware, `role`, used after `tenant()`: `middleware.role({ allow: ["owner"] })`.
  - It reads `membership.role` from `tenantContext(ctx)`, so it fails loudly on a route without the tenant middleware.
  - A role that isn't allowed gets the same `E_ROUTE_NOT_FOUND` 404 as the tenant middleware, never a 403: a URL doesn't reveal that a page exists.
  - TAT-30 reuses it.
- Every settings route sits in a group nested inside the `/t/:tenant` group, adding `middleware.role({ allow: ["owner"] })`.
- The app nav shows a "Settings" link only when the shared `tenant.role` prop is `owner`.

## Data

### Profile columns on `tenants` (new migration)

| Column | Type | Rule |
|---|---|---|
| `intro` | varchar(1000), null | |
| `contact_phone` | varchar(16), null | E.164 (`database/README.md`): typed as people write it (`98-1234-5678`, `01 4123456`, `+1 415 555 0100`), stored as `+9779812345678`; no country code means +977 |
| `contact_email` | varchar(254), null | email |
| `address` | varchar(300), null | |
| `instagram_url`, `facebook_url`, `tiktok_url`, `website_url` | varchar(500), null | https URL |
| `default_deposit_percent` | smallint, null, check 0–100 | null means no default |
| `deposit_policy` | varchar(2000), null | |

- Name and timezone become editable. The timezone uses the existing `ianaTimezone` rule, so any spelling is stored under its canonical name.
- Slug and type stay fixed. Slug changes come with aliases in TAT-24.
- Empty form fields arrive as null (`convertEmptyStringsToNull`) and clear the column.

### `payment_methods` (new `payments` module)

| Column | Type |
|---|---|
| `id` | uuid, `uuidv7()` |
| `tenant_id` | uuid, not null, FK `tenants.id` on delete cascade |
| `kind` | enum `fonepay`, `esewa`, `khalti`, `bank`, `cash`, not null |
| `label` | varchar(80), not null |
| `account_name` | varchar(120), null |
| `account_number` | varchar(64), null: the bank account number, or the eSewa/Khalti wallet ID |
| `bank_name` | varchar(120), null |
| `qr_image_key` | varchar(255), null |
| `show_on_deposit_page` | boolean, not null, default false |
| `position` | integer, not null |
| `created_at`, `updated_at`, `deleted_at` | timestamptz |

- Index on `(tenant_id, position)`.
- The model uses `withSoftDeletes`.
- Lists sort by `position, id`.

### Fields and rules per kind

| Kind | Fields shown | Required besides the label |
|---|---|---|
| `fonepay` | label, QR | QR |
| `esewa`, `khalti` | label, QR, wallet ID, account name | QR or wallet ID |
| `bank` | label, bank name, account name, account number, QR | bank name, account name, account number |
| `cash` | label | nothing; can't show on the deposit page |

- The service saves only the kind's own fields and stores the others as null, so no stale data is hidden in a row.
- The kind is fixed once the method exists. To change it, delete the method and add a new one.
- The form pre-fills the label with the kind's name ("Fonepay", "eSewa", "Khalti", "Bank transfer", "Cash").

## Services

### `TenancyService`

- `updateProfile(tenant, input)`: name, timezone, intro, contact fields, social links.
- `updateDepositSettings(tenant, input)`: `defaultDepositPercent`, `depositPolicy`.

### `PaymentMethodService` (`#modules/payments/services/payment_method_service`)

- `list(tenant)`, `findFor(tenant, id)`: always scoped to the tenant. `findFor` throws a 404 for a missing, deleted or other tenant's id.
- `create(tenant, input)`, `update(tenant, method, input)`, `move(tenant, method, "up" | "down")`, `delete(tenant, method)`.

**Kind rules** live in one pure function, `checkPaymentMethod(state)` (`#modules/payments/rules`).
- It takes the state after the change: the kind, its fields, `show_on_deposit_page`, and whether a QR will exist (new upload, kept, or removed).
- It returns every broken rule as `{ field, message }`, with messages written for the user ("Upload your Fonepay QR code.", "Add a QR code or your eSewa ID.").
- The service throws `PaymentMethodRuleError` carrying that list. The controller turns it into field errors, the same pattern onboarding uses for `SlugTakenError`.

**QR files**, following the image rules in `apps/platform/AGENTS.md`:
1. Run the kind rules first, so a bad request is rejected before any image work.
2. `ImageService.store(qr, { tenant, purpose: "payment_qr" })`. `InvalidImageError` becomes a field error on `qr`.
3. Save the row in a transaction. If that throws, call `ImageService.delete("payment_qr", newKey)` and rethrow.
4. After the commit, if a QR was replaced or removed, call `delete` on the old key.
5. Soft-deleting a method keeps its file.

**Ordering**
- A new method takes `max(position) + 1` among the tenant's live methods, inside the create transaction.
- `move` swaps positions with the nearest live neighbour in that direction, in a transaction. At the edge it does nothing.

## Routes and pages

All routes are under `/t/:tenant`, guarded by `auth`, then `tenant`, then `role(owner)`. Controllers live in `app/controllers/` (`indexEntities` only scans there) and stay thin.

| Route | Controller | Page or result |
|---|---|---|
| `GET settings` | redirect | → `settings/profile` |
| `GET settings/profile` | `StudioProfileController.show` | `settings/profile` |
| `PUT settings/profile` | `StudioProfileController.update` | back, with a success flash |
| `GET settings/payments` | `PaymentMethodsController.index` | `settings/payments` |
| `PUT settings/deposits` | `DepositSettingsController.update` | back, with a success flash |
| `GET settings/payments/new` | `PaymentMethodsController.create` | `settings/payment_method_form` |
| `POST settings/payments` | `PaymentMethodsController.store` | → `settings/payments` |
| `GET settings/payments/:id/edit` | `PaymentMethodsController.edit` | `settings/payment_method_form` |
| `PUT settings/payments/:id` | `PaymentMethodsController.update` | → `settings/payments` |
| `POST settings/payments/:id/move` (`direction`: `up` or `down`) | `PaymentMethodsController.move` | back |
| `DELETE settings/payments/:id` | `PaymentMethodsController.destroy` | back, with a success flash |

- The create and update routes take multipart (the QR). The body parser already accepts multipart on `PUT`.
- Validators check the input's shape only: lengths, enums, https URLs, the phone number, 0–100 (whole numbers), and `qr: imageFile().optional()`. The update validator adds `removeQr` (boolean) and has no `kind`. No validator has `tenant_id`. Form fields are camelCase (`contactPhone`, `showOnDepositPage`), like `fullName` on signup.

**`SettingsLayout`**
- Its heading becomes "Studio settings".
- Its sidebar lists "Studio profile" and "Payments", with the tenant in the route params.

**Profile page.** One form in three sections:
- Business: name, timezone, intro
- Contact: phone, email, address
- Social links: Instagram, Facebook, TikTok, website

**Payments page.**
- A "Deposits" section with its own small form: the default percentage and the policy.
- Below it, "Payment methods": one card per method showing the kind, label, QR thumbnail (public `/uploads/...` URL) and an "On deposit page" badge, with move up, move down, edit and delete buttons.
- With no methods, an empty state with "Add a payment method".

**Method form.**
- On create, the kind is chosen first (radio group); the form then shows that kind's fields.
- On edit, the kind is shown, not editable.
- On edit, a stored QR is shown with a "Remove QR" checkbox, plus an upload to replace it.
- The "Show on deposit page" checkbox is hidden for cash.

## Tests

Test-first. Functional tests run inside `wrapInGlobalTransaction()`; images come from `testImages`; files land in `tmp/storage`.

**Access** (`tests/functional/tenancy/tenant_routes.spec.ts`)
- The route-guard test also checks that every `/t/:tenant/settings*` route runs `auth` → `tenant` → `role`, in that order.
- An owner gets 200 on each settings page. An artist gets 404 on every settings route, GET and write routes alike.

**Kind rules** (`tests/unit/modules/payments/rules.spec.ts`)
- A table-driven test over `checkPaymentMethod`:
  - every kind with its required fields present, and with each one missing
  - eSewa/Khalti with only a QR, and with only a wallet ID
  - cash with `show_on_deposit_page`
- Edit states: a kept QR with no upload passes; removing a Fonepay QR fails; removing a bank QR passes.

**Service** (`tests/functional/payments/payment_method_service.spec.ts`)
- Create stores the QR on the public disk and saves its key.
- Replacing a QR deletes the old file after the commit. Removing a QR deletes its file.
- A failed save leaves no new file behind. The failure is real: a label over 80 characters passed straight to the service, which Postgres rejects.
- Soft delete keeps the file.
- Fields that don't belong to the kind are saved as null.
- Ordering:
  - a new method goes last
  - moving up or down swaps with the nearest live neighbour, skipping soft-deleted ones
  - the first one moving up, or the last one moving down, changes nothing

**HTTP** (`tests/functional/payments/payment_methods.spec.ts`, `tests/functional/tenancy/studio_profile.spec.ts`)
- An owner adds a Fonepay method with a multipart QR upload, and it appears in the list page's props with a `/uploads/...` URL.
- A GIF upload gives a field error on `qr`. A broken kind rule gives a field error on the right field (`assertValidationError`).
- Tenant A's owner gets 404 on tenant B's method for edit, update, move and delete, and B's row is unchanged.
- Profile:
  - valid input saves
  - a non-canonical timezone spelling is stored canonically
  - a local phone number is stored in E.164; `http://` social links, a phone number that can't be one and an intro over 1000 characters give field errors
  - `slug`, `type` and `tenant_id` in the body are ignored
- Deposits: 0 and 100 save; 101 and 12.5 fail; an empty value clears the default.

**Manual:** there's no browser suite yet. `pnpm typecheck` covers the page props, and the flows get clicked through on the dev server (port 3401) before the PR.

## Out of scope

- The deposit page itself, amounts, reference codes and proofs (TAT-65).
- Minimum notice and booking horizon (moved to V1 with instant booking).
- Slug changes and aliases (TAT-24).
- Gateway integrations (V1).
- Drag-and-drop ordering.

## Docs and Linear

- `apps/platform/AGENTS.md`:
  - the `role` middleware, which replaces "per-route role checks come with TAT-30"
  - the `payments` module and `PaymentMethodService` as the only way to read methods
  - settings routes go in the owner-only group
- TAT-26: tick the first three items.
