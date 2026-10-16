# Inquiry inbox (TAT-46, part 2)

Date: 2026-10-16
Refs: TAT-46, split with the user into part 1 (projects list and manual moves, PR #19, merged as da4a52c) and **part 2 (this spec)**: the inquiry inbox. Builds on TAT-37's inquiry, reference image and project tables, TAT-64's project page and `ProjectService`, and part 1's projects list and `assignArtist`. TAT-51 (intake) is what will create real inquiries; until then the inbox is tried with seeded ones.

## Goal

An owner sees the studio's new inquiries, opens one to read everything the client submitted (references included), and either accepts it, which creates a `reviewing` project with the chosen artist and moves the references onto it, or declines it. Decided inquiries stay findable. A project made from an inquiry shows the original request and its references to owners and its assigned artist.

No migration, no API, SDK or OpenAPI changes.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Who sees the inbox | Owners only (artists get a 404) | The requirements: reference images are private to owners and the artist assigned to a project, and an inquiry has no project yet. A solo artist owns their tenant |
| The artist on accept | An Accept form with an Artist select pre-filled with the inquiry's preferred artist (if that profile is still live) or "No artist" | The project's artist sees it at once; the owner can change the choice |
| Declining and decided inquiries | Decline asks for confirmation and is final; the inbox has a New tab (default) and a read-only Decided tab (accepted ones link to their project). No reason field, no reopen | A mistaken decline can be found again without adding rules |
| Demo data | `pnpm seed:dev` adds 3 new inquiries per tenant with 1–2 generated placeholder images each, stored like real uploads | The gallery and its signed URLs can be checked in the browser |
| Where the accept flow lives | `InquiryService` (inquiries module) orchestrates; `ProjectService.createFromInquiry` creates the project | Dependencies point inquiries → projects, no cycle; the rule stays in one service. `ProjectService.acceptInquiry` and a controller-level flow were rejected |

## `InquiryService`

`app/modules/inquiries/services/inquiry_service.ts`, `@inject()`, every call scoped to the tenant (the routes are owners only, so the methods take only the tenant).

| Operation | Rule |
|---|---|
| `listNew(tenant, page)` | Live `new` inquiries, oldest first (`created_at`, then `id`), 25 per page; returns the page, total and last page |
| `listDecided(tenant, page)` | Live `accepted` and `declined` inquiries, most recent decision first (`decided_at` desc, then `id`) |
| `countNew(tenant)` | The number of live `new` inquiries (`count(*)` parsed with `Number`) |
| `findFor(tenant, id)` | The tenant's live inquiry, else E_ROW_NOT_FOUND (a 404) |
| `images(tenant, of)` (`of` is `{ inquiryId }` or `{ projectId }`) | Live reference images of an inquiry (`{ inquiryId }`) or of a project (`{ projectId }`), by `position`, then `id` |
| `accept(tenant, inquiry, artistId)` | One transaction: lock the inquiry row (`FOR UPDATE`); it must still be `new`, else `InquiryRuleError("already_decided")`. A non-null `artistId` must be a live artist of the tenant (`ArtistService.findFor`), else `InquiryRuleError("artist_unavailable")`. `ProjectService.createFromInquiry` creates the project; the inquiry's live images get `project_id` (they keep `inquiry_id`); the inquiry becomes `accepted` with `decided_at` now (the database requires both together). Returns the project |
| `decline(tenant, inquiry)` | Lock the row; must be `new` (`already_decided`); `declined` with `decided_at` now |

- **Errors** (`app/modules/inquiries/errors.ts`): `InquiryRuleError` with a reason (`already_decided`, `artist_unavailable`), thrown after the failed savepoint rolled back.
- **Concurrency.** Two owners deciding the same inquiry serialize on its row lock; the second gets `already_decided`. The partial unique index `tattoo_projects_inquiry_live_unique` (one live project per inquiry) backs it up.
- **The frozen record.** `inquiries_guard_update` lets only the decision, `updated_at`, `deleted_at` and `anonymized_at` change; nothing here edits what the client submitted.

## `ProjectService` additions

| Operation | Rule |
|---|---|
| `createFromInquiry(tenant, { clientId, inquiryId, brief, artistId })` | Creates a `reviewing` project in the caller's transaction (no lock needed: it is new). The brief is the inquiry's idea (both at most 4,000 characters). The artist was already checked by the caller |
| `projectIdsForInquiries(tenant, inquiryIds)` | A map from inquiry id to its live project's id, for the Decided tab's links; no query for no ids |

## Routes and access

A new `/t/:tenant/inbox` group: auth, dbContext, tenant, `role({ allow: ["owner"] })`.

| Route | Name | Does |
|---|---|---|
| `GET /t/:tenant/inbox` | `tenant.inbox.index` | The list; `?view=` is `new` (default) or `decided` (anything else is `new`); `?page=` from 1 |
| `GET /t/:tenant/inbox/:id` | `tenant.inbox.show` | The inquiry page |
| `POST /t/:tenant/inbox/:id/accept` | `tenant.inbox.accept` | `{ artistId }` (uuid or empty); redirects to `tenant.projects.show` with "Inquiry accepted: project created." |
| `POST /t/:tenant/inbox/:id/decline` | `tenant.inbox.decline` | Redirects to `tenant.inbox.index` with "Inquiry declined." |

- `already_decided` returns to the inquiry page with the flash "This inquiry was already decided."; `artist_unavailable` is a field error on `artistId`: "Choose an artist from the list.".
- Every `:id` loads through `InquiryService.findFor` first. Each route gets a case in `tests/isolation/cases.ts`; the route guard test gains the `inbox` area with `{ allow: ["owner"] }`.
- **Shared prop:** `inboxCount` (the number of new inquiries) for owners on every tenant page, null for artists, from the Inertia middleware.

## Screens

**Navigation** (`inertia/layouts/app.tsx`): an **Inbox** item for owners only, before Projects, with a badge showing `inboxCount` when it is above zero.

**Inbox list** (`inertia/pages/inquiries/index.tsx`), mobile-first: two tabs, **New (n)** and **Decided**. New rows: contact name, the start of the idea, placement and size, the preferred artist ("any artist" if none), "received today / yesterday / N days ago" (calendar days in the studio's timezone), and "N references". Decided rows: contact name, an Accepted or Declined badge, the decision date, and "View project" for an accepted one. Previous and Next paging; an empty state per tab.

**Inquiry page** (`inertia/pages/inquiries/show.tsx`): everything submitted (idea, placement, approximate size, preferred dates, preferred artist, budget, how they found the studio, contact name, phone, email), the **References** as a thumbnail grid whose items open the full image (signed URL, 5 minutes). While `new`: an **Accept** form (Artist select pre-filled with the preferred artist if live, else "No artist"; button "Accept and create project") and a **Decline** button with a confirmation. Once decided: the status and date, and "View project" for an accepted one; no actions.

**Project page** (`inertia/pages/projects/show.tsx`): a **Request** section for a project with an `inquiry_id`: placement, size, preferred dates, budget, source, and the reference thumbnails (`InquiryService.images` by project). Owners and the assigned artist see it, which is the requirements' privacy rule.

## Demo data

The development seeder (`database/seeders/demo_project_seeder.ts`, `pnpm seed:dev`, owner role) also gives each tenant without inquiries three `new` ones: three demo clients (fixed demo phones, reused on a second run), one inquiry naming the tenant's first artist (if any), one with a budget. Each gets 1–2 generated solid-colour JPEGs stored through a new media helper, `ImageService.storeBytes(tenant, purpose, bytes)` (the same processing, key layout and private disk as uploads), and `ReferenceImage` rows. It prints the inbox path.

## Tests

- **`InquiryService`** (functional): `listNew` (only `new`, oldest first, paging), `listDecided` (newest decision first), `countNew`, `findFor` (another tenant's and a deleted inquiry are 404s), `images` (by position, inquiry or project), `accept` (the project: `reviewing`, client, `inquiry_id`, brief, artist or none; images moved; status and `decided_at`), `accept` with a deleted or another tenant's artist (`artist_unavailable`, nothing changed), accepting or declining twice (`already_decided`), `decline`.
- **`ProjectService`**: `createFromInquiry`, `projectIdsForInquiries` (another tenant's ids find nothing).
- **Media**: `storeBytes` writes a private image and returns its key and size.
- **HTTP**: the list's props per tab; `inboxCount` in the shared props for owners and null for artists; the inquiry page's props (references with signed URLs, artist choices with the preferred one selected, actions only while `new`); accept redirects to the project with the flash; decline; already decided gives the flash; a bad artist gives a field error; an artist gets 404 on every inbox route; the project page's Request section (present for an inquiry project, absent otherwise, visible to the assigned artist).
- **Isolation**: the four inbox routes; the route guard's `inbox` area.
- **Not automated**: the seeder (development only, owner-role connection) and the gallery's look (browser checklist).

## Docs

- `apps/platform/docs/backend.md`: an Inquiries paragraph (`InquiryService`, the accept rule, owners-only inbox, images following the project); the TAT-37 "inquiries have no service yet" note narrows to intake (TAT-51).
- `docs/requirements.md`: the inbox is owners only, and accepted references follow the project.
- The `Inquiry` model comment.

## Carry-forwards

Posted when the PR is ready: TAT-46 itself is Done with this PR. TAT-51 (intake creates the `new` inquiries the inbox reads; `ImageService.storeBytes` exists next to `store`), TAT-52 (no "received" chat message or staff alert yet: both TAT-52's), TAT-42 (deleting a client must handle their inquiries and reference images).

## Not in this part

The intake form and API (TAT-51, TAT-57), staff alerts and message templates (TAT-52), abuse limits (TAT-55), reopening a declined inquiry, a decline reason, artists seeing the inbox, the client history page, editing anything the client submitted, any migration.

## Assumptions the user can overrule at review

Oldest first in New; 25 per page; the "received N days ago" wording; "Accept and create project" as the button; the badge counts only new inquiries; the brief is the idea alone (placement, size and dates show in the Request section instead); demo data of 3 inquiries with generated images; an accepted inquiry's images keep `inquiry_id` as well as gaining `project_id`.

## Verification

`PORT=3402 node ace test` passes, including the isolation cases and the new specs; `pnpm typecheck`, `pnpm check` and `node ace codegen` are clean. A browser pass with `pnpm seed:dev`: the badge, both tabs, an inquiry with its references (open a full image), accept with and without an artist (lands on the project, Request section with references, the artist sees it), decline, a second accept from a stale tab, 375 px. Then the whole-branch review and the Codex code and security reviews before the PR.
