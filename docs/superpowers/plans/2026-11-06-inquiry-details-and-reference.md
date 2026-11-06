# Inquiry Details and One Request Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inquiries carry optional style, colour and notes as real fields. Every new inquiry gets a 6-character reference, and its project's deposit link reuses that code.

**Architecture:**
- **Data:** one migration adds four columns to `inquiries`, extends the freeze trigger's scrub list, and creates `reference_codes`, the per-studio registry of codes.
- **Code drawing:** a new `references` module owns drawing and claiming codes. Intake and deposit links both call it.
- **Contract first:** `openapi.yaml` changes, then the regenerated types, then the dashboard and the storefront `/book`.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, PostgreSQL (RLS), Japa. TanStack Start, React 19, `node:test`. Biome.

**Spec:** `docs/superpowers/specs/2026-11-06-inquiry-details-and-reference-design.md`

## Global Constraints

- **Code format:** codes match `^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$`, drawn from `REFERENCE_ALPHABET`/`REFERENCE_LENGTH` (today in `#modules/payments/deposit_links`). Retries are `REFERENCE_TRIES = 5`.
- **Colour values:** exactly `black-grey`, `colour`, `undecided`. Notes are at most 1000 characters, trimmed, and empty is null.
- **Style values:** `style` is a slug of `TATTOO_STYLES` (`#modules/artists/styles`). The API takes only `STYLE_SLUGS`. The database checks `STYLE_SLUG_SHAPE` only.
- **Old rows:** existing inquiries keep `reference_code` null. No backfill.
- **Tenant rule:** every query is scoped by tenant, and every tenant-owned table runs `enableTenantRls()` and has its `EXPECTED_POLICIES` entry.
- **Generated files:** never edit `database/schema.ts`, `packages/types/src/openapi.gen.ts` or `apps/storefront/src/routeTree.gen.ts` by hand. Regenerate them (`pnpm migrate` in platform, `pnpm --filter @tattoo-drip/types generate`).
- **Client copy:**
  - The sent screen's line is exactly `Your request reference: {reference}. Quote it when you message {studio}.`
  - It still says received, not confirmed.
- **Commits:** Conventional Commits with area scopes (`feat(platform)`, `feat(storefront)`, `feat(types)`), ending with the session's attribution lines.

## Review Focus

1. **A rolled-back intake** (an image refused after the code was claimed) must leave no row in `reference_codes`, or codes leak. → Task 2's test.
2. **A deleted earlier project whose link still holds the inquiry's code.** The new project's first link must get a fresh code, not a 500 from an aborted transaction. → Task 3's test.
3. **Notes are plain text.** A client's notes containing `<script>` or line breaks must show as text with the line breaks kept, never markup. → Task 4's test.
4. **A request with `colour: ""`** (the storefront's "nothing picked"), which the multipart form never sends: the SDK drops nulls, but an empty string must not be refused. → Task 2's test: `colour: ""` stores null.
5. **A style the studio's artists don't list, but which is on the platform list,** is accepted. The API checks the platform list, not the studio. → Task 2's test.

---

### Task 1: Migration, `reference_codes` and `ReferenceCodeService`

**Files:**
- Create: `apps/platform/database/migrations/1791840000000_add_inquiry_details_and_reference_codes.ts`
- Create: `apps/platform/app/modules/references/reference_codes.ts` (moved `REFERENCE_ALPHABET`, `REFERENCE_LENGTH`, `REFERENCE_TRIES`, `newReferenceCode`, plus `REFERENCE_CODE_PATTERN`)
- Create: `apps/platform/app/modules/references/models/reference_code.ts`
- Create: `apps/platform/app/modules/references/services/reference_code_service.ts`
- Modify: `apps/platform/app/modules/payments/deposit_links.ts` (re-export the moved names, keeping its importers unchanged)
- Modify: `apps/platform/app/modules/payments/services/deposit_link_service.ts` (import `REFERENCE_TRIES` from the new module; re-export it)
- Modify: `apps/platform/app/modules/inquiries/models/inquiry.ts` (the generated schema gives the columns; add doc comments only if the model lists columns)
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`reference_codes: ["tenant_isolation:ALL"]`)
- Test: `apps/platform/tests/functional/references/reference_code_service.spec.ts`
- Test: `apps/platform/tests/functional/inquiries/inquiries_table.spec.ts` (trigger cases)

**Interfaces:**
- Produces:
  - `ReferenceCodeService.claim(tenant: { id: string }): Promise<string>`: runs in the caller's transaction (`withTransaction` savepoint per try).
  - `protected newCode(): string`: overridable in tests.
  - `REFERENCE_CODE_PATTERN: RegExp`.
  - `inquiries.style | colour | notes | reference_code` (model: `style: string | null`, `colour: string | null`, `notes: string | null`, `referenceCode: string | null`).

- [ ] **Step 1: Write the failing tests**

`reference_code_service.spec.ts`. Use `studioWithOwner` and `inTenant` from `#tests/helpers/...` as `work_photo_service.spec.ts` does, and `testUtils.db().wrapInGlobalTransaction()`.

- `"claim draws a code in the reference format and registers it for the studio"`
  - `assert.match(code, /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/)`
  - one `ReferenceCode` row with that code and `tenantId`
- `"a code the studio already holds is drawn again; after REFERENCE_TRIES collisions the unique violation surfaces"`
  - a subclass returns a taken code first, then `"ZZZZZ2"`: the result is `"ZZZZZ2"`
  - a subclass always returns the taken code: rejects with `reference_codes_tenant_id_code_unique`
- `"two studios may hold the same code"`: the same forced code in two tenants both succeed.
- `"another tenant's codes are invisible, and none can be inserted for it, from this tenant's context"`
  - `ReferenceCode.query()` in B's context returns no row of A
  - claiming with A's tenant ref inside B's context rejects (RLS `with check`)

In `inquiries_table.spec.ts`, follow its existing update-guard tests:

- `"style, colour and reference_code cannot change after insert; notes only in the anonymising update"`
  - updating `style`, `colour` or `reference_code` raises `inquiries_guard_update: <col> cannot change`
  - an update setting `anonymized_at` and `notes = null` together succeeds
  - a plain `notes` update raises
- `"the database refuses a bad colour, notes over 1000 characters, a bad style slug and a bad code"`: `colour: "red"`, `notes: "x".repeat(1001)`, `style: "Fine Line"`, `reference_code: "ABC12O"`.

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/platform`, with the env loaded):

```
NODE_ENV=test node ace test functional --files=reference_code_service.spec.ts --files=inquiries_table.spec.ts
```

Expected: FAIL. Missing module, missing columns.

- [ ] **Step 3: Write the migration**

**`up`:**
- `alter table inquiries add`:
  - `style varchar(40) null`
  - `colour varchar(20) null`
  - `notes text null`
  - `reference_code varchar(6) null`
- Checks on `inquiries`:
  - `inquiries_style_shape`: `style ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`
  - `inquiries_colour_known`: `colour in ('black-grey','colour','undecided')`
  - `inquiries_notes_length`: `char_length(notes) <= 1000`
  - `inquiries_reference_code_format`: the pattern
- `unique (tenant_id, reference_code)` on `inquiries`.
- `create table reference_codes`:
  - `id uuid primary key default uuidv7()`
  - `tenant_id uuid not null references tenants(id) on delete cascade`
  - `code varchar(6) not null`
  - `created_at timestamptz not null default now()`
  - unique `(tenant_id, code)`, named so knex gives `reference_codes_tenant_id_code_unique`
  - the format check `reference_codes_code_format`
- `enableTenantRls("reference_codes")`.
- Copy in today's deposit codes: `insert into reference_codes (tenant_id, code, created_at) select tenant_id, reference_code, created_at from deposit_links`.
- `create or replace function inquiries_guard_update()`: same body as `1791590000001_create_inquiries_table.ts`, with `'notes'` appended to `scrub` and the same `set search_path = pg_catalog, pg_temp`.

**`down`:** reverses each step, and restores the original function body verbatim.

- [ ] **Step 4: Move the code helpers; write the model and the service**

- `claim` loops `attempt = 1..REFERENCE_TRIES`:
  - `withTransaction(() => ReferenceCode.create({ tenantId, code: this.newCode() }))`
  - on `isUniqueViolation(error, "reference_codes_tenant_id_code_unique")` below the limit, draw again; otherwise rethrow.
- That's the loop `DepositLinkService.insertWithCode` uses today.
- Add the `EXPECTED_POLICIES` entry.

- [ ] **Step 5: Migrate and run the tests**

Run `pnpm migrate` (the owner role; this regenerates `database/schema.ts`), then the Step 2 command, then the `catalog_guard.spec.ts` and `deposit_link_service.spec.ts` suites.

Expected: all PASS. Deposit links are unchanged so far.

- [ ] **Step 6: Commit** `feat(platform): add inquiry detail columns and the per-studio reference code registry`, including the regenerated `database/schema.ts`.

---

### Task 2: Intake stores the details and returns the reference (contract first)

**Files:**
- Modify: `packages/types/openapi.yaml`
  - `InquiryInput`: `style`, `colour`, `notes`
  - `InquiryReceipt`: required `reference`, `pattern: "^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$"`, description from the spec
  - `createInquiry` description: one sentence on the new fields
- Regenerate: `packages/types/src/openapi.gen.ts` (`pnpm --filter @tattoo-drip/types generate`)
- Modify: `apps/platform/app/modules/inquiries/validators/intake.ts`
- Modify: `apps/platform/app/modules/inquiries/services/intake_service.ts` (`Submission`, `submit`, inject `ReferenceCodeService`)
- Modify: `apps/platform/app/controllers/public_inquiries_controller.ts` (pass the new fields)
- Modify: `apps/platform/app/transformers/inquiry_receipt_transformer.ts` (`{ id, reference }`)
- Modify: `docs/sdk.md` (one line: `inquiries.create` resolves `{ id, reference }`)
- Test: `apps/platform/tests/functional/inquiries/intake_service.spec.ts`
- Test: `apps/platform/tests/functional/api/inquiries.spec.ts`

**Interfaces:**
- Consumes: `ReferenceCodeService.claim` (Task 1).
- Produces:
  - `Submission.style?: StyleSlug | null`, `Submission.colour?: "black-grey" | "colour" | "undecided" | null`, `Submission.notes?: string | null`
  - receipt JSON `{ data: { id: string, reference: string } }`
  - generated `InquiryInput.style | colour | notes` and `InquiryReceipt.reference`, for Task 5

- [ ] **Step 1: Write the failing tests**

In `intake_service.spec.ts`:

- `"the style, colour and notes are stored as sent, and the inquiry gets a reference"`
  - submit with `style: "fine-line"`, `colour: "black-grey"`, `notes: "Cover-up"`
  - the row has those values, and `referenceCode` matches the pattern
  - a `ReferenceCode` row with that code exists
- `"two inquiries in one studio get different references"`
- `"a submission refused after the code was drawn leaves no registered code"`
  - force `InquiryRuleError("too_many_open_inquiries")` with 3 open inquiries
  - `ReferenceCode` count is unchanged

In `api/inquiries.spec.ts`, following its multipart helpers:

- `"the receipt is the id and the reference, nothing else"`
  - `assert.deepEqual(Object.keys(body.data).sort(), ["id", "reference"])`
  - `body.data.reference` equals the stored code
- `"an unlisted style, an unknown colour and notes over 1000 characters are each validation_failed on that field"`
  - three requests: `style: "watercolour-x"`, `colour: "red"`, `notes: "x".repeat(1001)`
  - each 422, with `errors` naming `style`, `colour` or `notes`
- `"an empty colour, style or notes is none"`: send `""` for each, expect 201 and null columns.
- `"a style on the platform list that no artist of the studio lists is accepted"`

- [ ] **Step 2: Run them to see them fail**

```
NODE_ENV=test node ace test functional --files=intake_service.spec.ts --files=inquiries.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Edit `openapi.yaml`, then regenerate the types**

- [ ] **Step 4: Add the validator fields**
  - `style`: `vine.enum(STYLE_SLUGS).nullable().optional()`, with an empty string mapped to null before the enum: an `optionalText`-style `transform` or vine's `.optional()` on an empty string, whichever the file already uses for `budget`
  - `colour`: the same, with the three values
  - `notes`: `optionalText(1000)`

- [ ] **Step 5: Store the fields in `submit`**
  - add the three fields and `referenceCode: await this.references.claim(tenant)` to `Inquiry.create`
  - the claim goes right before `Inquiry.create`, inside the same `withTransaction`
  - `idea` stays as sent

- [ ] **Step 6: Return the reference**
  - the receipt transformer returns `{ id, reference: referenceCode }`
  - throw if it is null, which a new inquiry never has

- [ ] **Step 7: Run the tests**

The Step 2 command, plus `intake_guard.spec.ts`, `inquiry_refusals.spec.ts`, `inquiry_isolation.spec.ts` and `new_inquiry_alert_job.spec.ts`. Then `pnpm --filter @tattoo-drip/platform typecheck`.

Expected: PASS.

- [ ] **Step 8: Commit** `feat(platform): store an inquiry's style, colour and notes and give it a reference`, including `openapi.yaml`, `openapi.gen.ts` and `docs/sdk.md`.

---

### Task 3: A project's first deposit link reuses its inquiry's code

**Files:**
- Modify: `apps/platform/app/modules/payments/services/deposit_link_service.ts` (`insertWithCode`)
- Test: `apps/platform/tests/functional/payments/deposit_link_service.spec.ts`

**Interfaces:**
- Consumes: `ReferenceCodeService.claim` (Task 1) and `inquiries.reference_code`, read through the project's `inquiryId`, tenant-scoped.

- [ ] **Step 1: Write the failing tests**

Use the file's existing project and quote helpers:

- `"an inquiry-born project's first link has the inquiry's reference"`
- `"a desk project's link has a fresh code, registered for the studio"`: there is a `ReferenceCode` row with `link.referenceCode`.
- `"when another link already holds the inquiry's code, the link gets a fresh code and the request goes on"`
  - project 1 from the inquiry gets a link, then is soft-deleted
  - project 2 from the same inquiry gets a link
  - its code differs from the inquiry's and matches the pattern
  - no error, and the surrounding transaction can still run a query afterwards
- `"an inquiry without a reference (an older one) gives its project a fresh code"`
- `"a replaced link keeps its code"`: the existing test, if one covers this, stays green; otherwise add it.

- [ ] **Step 2: Run them to see them fail**

```
NODE_ENV=test node ace test functional --files=deposit_link_service.spec.ts
```

Expected: the reuse tests FAIL.

- [ ] **Step 3: Change `insertWithCode`**
  - First, when the project's inquiry (`Inquiry.query().where("tenant_id", tenant.id).where("id", project.inquiryId)`) has a `referenceCode`, try `DepositLink.create` with it inside `withTransaction`, which is a savepoint.
  - On `isUniqueViolation(error, CODE_TAKEN)` fall through. Rethrow anything else.
  - Then loop as today, but the code comes from `await this.references.claim(tenant)`.
  - The `newCode()` hook moves to `ReferenceCodeService`, so tests that forced deposit collisions override that service instead. Update them.
  - `ProjectRef` needs `inquiryId`: widen the type, or read it from the locked project `live`.

- [ ] **Step 4: Run the tests**

`deposit_link_service.spec.ts`, `deposit_links_http.spec.ts`, `deposit_links_table.spec.ts` and `deposit_page_service.spec.ts`.

Expected: PASS.

- [ ] **Step 5: Commit** `feat(platform): give a project's deposit link its inquiry's reference`

---

### Task 4: The dashboard shows the reference and the details

**Files:**
- Modify: `apps/platform/app/controllers/inquiries_controller.ts` (the show props, near line 197: `referenceCode`, `style` as the style's name from `TATTOO_STYLES` or null, `colour`, `notes`)
- Modify: `apps/platform/inertia/pages/inquiries/show.tsx`
  - "Request {code}" next to the title when set
  - details rows `Style`, `Colour` (labels `Black and grey`, `Colour`, `Not decided yet`), `Notes` (`whitespace-pre-line` text), each only when set
- Run: `node ace codegen` (include `.adonisjs/` changes)
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts` (the file holding the show-page prop tests)

**Interfaces:**
- Consumes: the model columns (Task 1).

- [ ] **Step 1: Write the failing test**

`"the inquiry page carries the reference, the style's name, the colour and the notes as sent"`:
- the props have `referenceCode` (the code), `style: "Fine line"` (the name for `fine-line`), `colour: "black-grey"` and `notes: "<b>bold</b>\nsecond line"`, unchanged
- an older inquiry gives `referenceCode: null`

- [ ] **Step 2: Run it to see it fail**

```
NODE_ENV=test node ace test functional --files=inbox.spec.ts
```

- [ ] **Step 3: Add the props and the rendering**
  - Notes render as a text child. Never `dangerouslySetInnerHTML`.
  - The details list already skips empty values: check how `budget` null renders and do the same.

- [ ] **Step 4: Run** the test, `node ace codegen`, then `pnpm --filter @tattoo-drip/platform typecheck`.

Expected: PASS.

- [ ] **Step 5: Browser check.** Run `pnpm dev`, open an inquiry sent with all three fields, at phone width and at desktop width. Take a screenshot for yourself.

- [ ] **Step 6: Commit** `feat(platform): show an inquiry's reference, style, colour and notes`

---

### Task 5: `/book` sends the fields and shows the reference

**Files:**
- Modify: `apps/storefront/src/booking/booking.ts`
  - `BookingContext.styles: readonly { readonly slug: string; readonly name: string }[]`
  - `BookingValues.style` holds the slug
  - `ideaText` returns the idea alone
  - `intakeValuesOf` adds `style`, `colour` and `notes` (empty is left out)
  - the idea check counts only the idea
- Modify: `apps/storefront/src/studio/loaders.ts` (the booking context's styles: build `{ slug, name }` with `filterStyles(raw.styles)` as line 399 does, de-duplicated by slug, in platform order)
- Modify: `apps/storefront/src/booking/components/booking-steps.tsx` (the style choice: value is the slug, label is the name)
- Modify: `apps/storefront/src/booking/components/booking-review.tsx`
  - the review shows the name for the slug
  - `BookingSent` takes `reference: string` and shows the copy line
  - fix the doc comment that says no reference is shown
- Modify: `apps/storefront/src/booking/copy.ts` (the `sent.reference` template)
- Modify: `apps/storefront/src/intake/components/intake-form.tsx` (`setSent({ ..., reference: result.receipt.reference })`)
- Modify: `apps/storefront/src/intake/submission.ts` (if the fields pass through `toInquiryInput`)
- Test: `apps/storefront/test/booking/booking.test.ts`
- Test: `apps/storefront/test/intake/submission.test.ts`
- Test: `apps/storefront/test/studio/default-theme.snapshot.json` (only if the snapshot covers `/book`; regenerate it through its test's update path)

**Interfaces:**
- Consumes: the generated `InquiryInput.style | colour | notes` and `InquiryReceipt.reference` (Task 2).

- [ ] **Step 1: Change the failing tests**

In `booking.test.ts`:

- `"the idea carries only the choices made…"` becomes `"the idea is the client's own words; style, colour and notes are their own fields"`:
  - `ideaText(values({ style: "fine-line", colour: "black-grey", notes: " A cover-up " }))` is `"A fine-line peony"`
  - `intakeValuesOf(...)` has `style: "fine-line"`, `colour: "black-grey"` and `notes: "A cover-up"`
  - an empty `style`, `colour` or `notes` key is absent
- In `"the inquiry sent is the intake's own fields…"`, the sorted keys gain `colour`, `notes` and `style` when they are set.
- `"the idea with its added lines must still fit…"` becomes `"the idea alone must fit the API's 4000 characters"`:
  - a 3990-character idea with 40 characters of notes gives no idea error
  - a 4001-character idea gives one
- The sent-screen test:
  - render `BookingSent` with `reference: "K7MP3Q"`
  - `assert.match(html, /Your request reference: <strong>K7MP3Q<\/strong>\. Quote it when you message <bdi>Black Needle<\/bdi>\./)`
  - keep the "Not confirmed yet" assertion
  - replace the `doesNotMatch(... reference ...)` with `assert.doesNotMatch(html, /confirmed!|Booked|0199f000/i)`

- [ ] **Step 2: Run them to see them fail**

```
pnpm --filter @tattoo-drip/storefront test
```

Expected: FAIL on the changed tests.

- [ ] **Step 3: Make the changes listed above**

The review and summary show the style's name. The value sent is the slug.

- [ ] **Step 4: Run the checks**

`pnpm --filter @tattoo-drip/storefront test`, `typecheck` and `build`. Then `pnpm check` at the root.

Expected: PASS.

- [ ] **Step 5: Browser check**

Run the storefront dev server against the platform (or the stub API, extended so its inquiry POST answers `{ data: { id, reference: "K7MP3Q" } }`). Send a request in both themes, and check the sent screen shows the reference at 320 px.

- [ ] **Step 6: Commit** `feat(storefront): send the booking's style, colour and notes as fields and show the request reference`

---

### Task 6: Whole-branch verification

- [ ] **Step 1:** Run the root gates: `pnpm check`, `pnpm typecheck`, `pnpm test` (the full platform functional suite included) and `pnpm build`. Expected: all pass. The known flaky `test/tenancy` timing tests may need one re-run alone. Report it if they do.
- [ ] **Step 2:** Run an independent code review of `origin/main...HEAD` and fix its findings.
- [ ] **Step 3:** Tick the TAT-78 checklist lines "Inquiry fields for style, colour and notes" and "A request reference the client can quote", once merged.
