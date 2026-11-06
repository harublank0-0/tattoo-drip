# Inquiry details and one request reference: design

Date: 6 Nov 2026. Sub-project E of the platform gaps after Ink Noir (TAT-78, "Follow-ups with no ticket yet"). The work is ordered pilot first: this sub-project (E), then studio FAQ, policies and contact (F), then services (A). Availability and booking a slot directly wait for gate 1.

## Intent

- **Studio:** sees a request's style, colour and notes as their own fields, not as lines inside the idea text. Can find the request a client is talking about from one short code.
- **Client:** gets one code when they send a request, and quotes it on WhatsApp or Viber. The same code is the payment reference on the deposit page later.
- **Success:**
  - Every new inquiry has a code that is unique within its studio.
  - A project born from an inquiry gets that same code on its deposit link.
  - `/book` sends the three details as fields.
  - Nothing that used to be private becomes public.

The user chose "one code per journey" over two separate codes.

## Decisions

### Data (one migration)

The migration adds these columns to `inquiries`, all nullable:

| Column | Type | Rule |
|---|---|---|
| `style` | `varchar(40)` | A slug of `TATTOO_STYLES` (`#modules/artists/styles`). The API takes only listed slugs. The database checks the slug shape (`STYLE_SLUG_SHAPE`), not the list, so retiring a style never breaks old rows. |
| `colour` | `varchar(20)` | Check: `black-grey`, `colour` or `undecided`. |
| `notes` | `text` | Check: at most 1000 characters. |
| `reference_code` | `varchar(6)` | Same format check as `deposit_links.reference_code` (`^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$`). Unique per `(tenant_id, reference_code)`. |

- New inquiries always get a `reference_code`, and the intake service guarantees it. Existing rows stay null: the freeze trigger forbids a backfill, and there is no production data yet. The column stays nullable, and the dashboard shows no reference for those rows.
- The freeze trigger (`inquiries_guard_update`) already freezes any column not in `free`, so the new columns are frozen after insert with no change.
  - `notes` is client free text, so it joins the `scrub` list: TAT-42's anonymisation may clear it.
  - The migration replaces the function and keeps `set search_path = pg_catalog, pg_temp`. `down` restores the old body.
  - `style`, `colour` and `reference_code` are not personal data and stay frozen.

The migration also adds a new table `reference_codes`:

- `tenant_id` (FK to tenants), `code` (`varchar(6)`, same format check), `created_at`, primary key `(tenant_id, code)`.
- Row-level security comes from `enableTenantRls`. The app role may insert and select, never update or delete.
- The migration copies in every existing `deposit_links.reference_code`.
- It has no other columns and no link back. Its only job is to make a code unique per studio across inquiries and deposit links, which a unique constraint on either table can't do alone.

### Drawing a code

A new module function, `ReferenceCodeService.claim(tenant)`:

1. Draws `newReferenceCode()` (moved from `payments/deposit_links.ts` into a shared `#modules/references/reference_codes.ts`; payments re-exports it).
2. Inserts it into `reference_codes` in a savepoint.
3. On the primary-key violation, draws again, up to `REFERENCE_TRIES`. After that the violation surfaces, as `insertWithCode` does today.

A protected `newCode()` lets a test force a collision. The service must run inside the caller's request transaction, so a rolled-back intake gives its code back.

### Intake

- `IntakeService.submit` claims a code before it creates the inquiry, in the same transaction, and stores the code with the new fields.
- The validator (`#modules/inquiries/validators`) adds:
  - `style`: optional, one of `STYLE_SLUGS`
  - `colour`: optional, the enum above
  - `notes`: optional, trimmed, 1000 at most, empty means null
- A bad value is `validation_failed` on that field. Nothing else in the intake changes: limits, challenge, honeypot and errors are as they were.

### Deposit link: one code per journey

`DepositLinkService.insertWithCode` (the project's first link):

- **The project has an inquiry, and the inquiry has a code that no other link of the studio holds:** the link uses that code, which is already in `reference_codes`.
  - The check is the existing `deposit_links (tenant_id, reference_code)` unique constraint. On that violation, fall back to a fresh code.
  - That covers a deleted earlier project's link that still holds it.
- **Otherwise** (a desk project, an inquiry with no code, or the fallback): `ReferenceCodeService.claim` draws a code, and the link uses it.
- A replaced link keeps its code, as today.

### API (`packages/types/openapi.yaml` first, then `pnpm --filter @tattoo-drip/types generate`)

- `InquiryInput` gets three new properties:
  - `style`: `type: [string, "null"]`, a `TattooStyle.slug` from `listStyles`
  - `colour`: `type: [string, "null"]`, enum `black-grey`, `colour`, `undecided`
  - `notes`: `type: [string, "null"]`, `maxLength: 1000`
- `InquiryReceipt` gets `reference` (required, 6 characters, the pattern above). Its description: "Quote it when you message the studio. The deposit page shows the same code later." Nothing in the public API reads an inquiry back by it.
- The `createInquiry` description notes that the new fields are validated per field.
- The SDK needs no code change: `inquiries.create` already sends every field it is given. `docs/sdk.md` gets one line about `reference`.

### Dashboard

- The inquiry page (`inertia/pages/inquiries/show.tsx`):
  - shows "Request K7MP3Q" next to the title when the inquiry has a code;
  - lists Style (the style's name from `TATTOO_STYLES`), Colour (in words) and Notes (plain text, line breaks kept) with the other details, each only when set.
- The project page's payments card already shows the deposit code. It is now the same code for inquiry-born projects, and nothing there changes.
- Inbox rows don't change.

### Storefront

- `src/booking/booking.ts`:
  - `ideaText` returns the client's idea alone;
  - `intakeValuesOf` sends `style` (the slug: `BookingContext.styles` changes from names to `{ slug, name }`), `colour` and `notes`;
  - the idea's 4000-character check no longer counts the added lines.
- The sent screen (`BookingSent`, which both themes' `/book` share through `IntakeForm`) shows "Your request reference: **K7MP3Q**. Quote it when you message {studio}." It still says the request is received and not confirmed. `IntakeForm` passes the receipt's `reference` through.

### Tests

- **Platform functional, intake:**
  - the three fields are stored;
  - an unlisted style, a wrong colour and notes over 1000 characters are each refused on that field;
  - the receipt carries a `reference` in the right format, stored on the inquiry;
  - two inquiries in one studio get different codes, and a forced collision draws again;
  - a failed intake leaves no row in `reference_codes`.
- **Freeze trigger:** the new columns can't change after insert, except `notes` in the anonymising update.
- **Deposit link:**
  - an inquiry-born project's first link has the inquiry's code;
  - a desk project's link has a fresh code that is registered;
  - an inquiry whose code another link already holds falls back to a fresh code;
  - a replaced link keeps its code.
- **Isolation and RLS** for `reference_codes`: another tenant's codes are invisible, and the app role can't update or delete.
- **API contract:** the receipt matches the schema.
- **Storefront:**
  - booking tests: the idea is the client's own words, the three fields are sent, the slug is sent and not the name;
  - the sent screen shows the reference and still never says confirmed.

## Out of scope

The reference in WhatsApp and Viber message templates, finding an inquiry by its code in the inbox, and backfilling codes for existing inquiries.
