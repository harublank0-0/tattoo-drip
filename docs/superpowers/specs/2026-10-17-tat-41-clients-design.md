# Clients: list, profile and history (TAT-41)

Date: 2026-10-17
Refs: TAT-41 (Clients by phone: list, profile, history). Builds on TAT-37's `Client` model (one live client per phone per tenant, phone in E.164), TAT-46's inquiry inbox and projects list, TAT-64's project page and chat links, and TAT-67's shell (the nav list). The intake that creates clients from inquiries is TAT-51; walk-ins are TAT-43; deleting a client's personal data is TAT-42; payments are TAT-65 and TAT-66.

## Goal

An owner (or the front desk) looks a client up by name or phone, sees everything the studio has done with them (projects, inquiries, reference images, notes) on one page, reaches them in one tap, and fixes their details when they change.

No migration, no API, SDK or OpenAPI changes.

## Decisions made with the user

| Question | Decision | Why |
|---|---|---|
| Who sees clients | Owners only: a Clients tab for owners; artists get a 404 | The role table gives artists their own profile and assigned projects only; they keep seeing the client's name and chat links on their projects |
| Profile contents | Contact details, notes, projects, inquiries (declined included), reference images. No payments section yet | No flow creates payments until TAT-65/66, which add the section |
| Editable fields | Name, phone, email, notes | Covers typos and clients who change numbers; the phone stays unique per studio |
| Profile layout | One page; "Edit details" opens an edit page | Like the project page and the artist form; tap-to-chat by the number |
| List order | Newest clients first, 25 per page; search by name or phone | Simple and fast; new contacts on top; search is the main way in |
| Where the history comes from | Each module answers for its own records (`ProjectService`, `InquiryService`); the controller combines them | No module reads another module's tables (the rule in `apps/platform/AGENTS.md`); the pages are small |

## Routes and access

A new `/t/:tenant/clients` group: auth, dbContext, tenant, `role({ allow: ["owner"] })`.

| Route | Name | Does |
|---|---|---|
| `GET /t/:tenant/clients` | `tenant.clients.index` | The list; `?q=` searches, `?page=` from 1 |
| `GET /t/:tenant/clients/:id` | `tenant.clients.show` | The profile |
| `GET /t/:tenant/clients/:id/edit` | `tenant.clients.edit` | The edit form |
| `PUT /t/:tenant/clients/:id` | `tenant.clients.update` | Saves; redirects to the profile with "Client updated." |

- Every `:id` loads through `ClientService.findFor` first, so another tenant's or a deleted client is a 404.
- Each route gets a case in `tests/isolation/cases.ts`; the route guard test gains the `clients` area with `{ allow: ["owner"] }`.
- **Navigation:** owners get **Clients** (lucide `Contact` icon) between Projects and Settings in `inertia/components/shell/nav_items.ts`; artists' items are unchanged.

## Screens

**List** (`inertia/pages/clients/index.tsx`):

- A search box (a GET form submitting `q`) above the rows; a "Clear" link while searching.
- Each row: the name, the phone (as stored), "N projects" or "no projects", and "last activity today / yesterday / N days ago" (`daysAgoText` in the studio's timezone). A row opens the profile.
- Newest clients first, 25 per page, Previous / Next.
- Empty states: "No clients yet. They appear when an inquiry arrives." (no clients) and "No clients match "q"." (a search with no result).

**Profile** (`inertia/pages/clients/show.tsx`), one page:

- **Header:** the name as the title; the phone and email below it; then **WhatsApp**, **Viber** and **Call** links (only with a phone) and **Edit details** (hidden for an anonymized client).
- **Notes:** the client's notes, or "No notes."
- **Projects:** each row shows the start of the brief, the status label, the artist ("no artist" if none) and the date it was created, and opens the project page. "No projects." when empty.
- **Inquiries:** each row shows the start of the idea, New / Accepted / Declined, and the date it was received, and opens the inquiry in the inbox. "No inquiries." when empty.
- **References:** the existing `ReferenceGrid` with every live reference image from the client's inquiries and projects, each image once (an accepted inquiry's images carry both its `inquiry_id` and its project's `project_id`), by inquiry or project and then position. Signed URLs, 5 minutes.
- "Client since 12 Oct 2026."
- An anonymized client (TAT-42; none exist yet) shows "This client's details were deleted." in place of the contact details, and no links.

**Edit** (`inertia/pages/clients/edit.tsx`):

| Field | Rule |
|---|---|
| Name | Required, trimmed, at most 120 characters |
| Phone | Required; the existing `phoneNumber` rule normalizes it to E.164 ("9812345678" becomes "+9779812345678") |
| Email | Optional (empty becomes null), a valid email, at most 254 characters |
| Notes | Optional (empty becomes null), at most 2,000 characters |

- **Save** redirects to the profile with the flash "Client updated."; **Cancel** returns to the profile.
- A phone another live client of the studio already has is a field error on `phone`: "Another client already has this number: {name}." Nothing changes.
- An anonymized client can't be edited: the edit page and a stale form's PUT return to the profile with the flash "This client's details were deleted and can't be edited."

**Links in from other pages (owners only):** the project page shows a "View client" link next to the client's name when the viewer is an owner (a new prop `clientId: string | null`, null for artists); the inquiry page shows the same link (the inbox is owners only).

## Services

### `ClientService` (clients module)

| Operation | Rule |
|---|---|
| `list(tenant, { search, page })` | Live clients, newest first (`created_at` desc, then `id` desc), 25 per page; returns the clients, the total and the last page. With a search (trimmed, non-empty): the name contains it, case-insensitively, with `%`, `_` and `\` escaped so a search is never a pattern; or, when it has at least 3 digits, the phone contains those digits (the phone without its `+`) |
| `findFor(tenant, id)` | The tenant's live client, else E_ROW_NOT_FOUND (a 404) |
| `findByPhone(tenant, phone)` | The tenant's live client with this E.164 phone, or null |
| `update(tenant, client, { name, phone, email, notes })` | One transaction: lock the row (`FOR UPDATE`); an anonymized client is refused with `ClientRuleError("anonymized")`; save; a violation of `clients_tenant_phone_live_unique` becomes `ClientRuleError("phone_taken")` (caught inside the savepoint, so the request stays usable). Returns the client |

- **Errors** (`app/modules/clients/errors.ts`): `ClientRuleError` with a reason (`phone_taken`, `anonymized`).
- **Contact links:** `chatLinks` moves from `#modules/projects/quotes` to `#modules/clients/contact_links` (contact details are the clients module's business); its message becomes optional (no `text` parameter on WhatsApp without one), and a `telLink(phone)` is added. The project page imports it from the new place; behavior there is unchanged.

### Reads added to other modules

| Service | Operation | Returns |
|---|---|---|
| `ProjectService` | `forClient(tenant, clientId)` | The client's live projects, newest first (callers are owners only, so no member scoping) |
| `ProjectService` | `countsForClients(tenant, clientIds)` | A map from client id to their number of live projects (no query for no ids) |
| `ProjectService` | `lastChangeForClients(tenant, clientIds)` | A map from client id to their latest live project's `updated_at` |
| `InquiryService` | `forClient(tenant, clientId)` | The client's live inquiries, newest first |
| `InquiryService` | `latestForClients(tenant, clientIds)` | A map from client id to their newest live inquiry's `created_at` |
| `InquiryService` | `imagesFor(tenant, { inquiryIds, projectIds })` | Live reference images on any of these inquiries or projects, each once, by `inquiry_id`, `project_id`, `position`, then `id` (no query for no ids) |

**Last activity** on a list row is the latest of the client's `created_at`, their newest inquiry and their latest project change.

`ClientsController` combines these with `ArtistService.list` (artist names) and `ImageService.url` (signed reference URLs); it reads no table itself.

## Rules for other tickets

- **Form submissions never overwrite a client** (TAT-51): the intake matches an existing client with `ClientService.findByPhone` and records what was submitted on the inquiry's frozen contact copy; it never changes the client's name, email or notes. Only an owner's edit does.
- Walk-ins and phone bookings (TAT-43) look the client up with `findByPhone` before creating one.

## Tests

- **`ClientService`** (functional): list order and paging; search by part of a name in any case, by phone digits (with and without the country code), a `%` in the query matching literally, and fewer than 3 digits not searching phones; `findFor` (another tenant's and a deleted client are 404s); `findByPhone`; `update` (saved), a taken phone (`phone_taken`, nothing changed), an anonymized client refused.
- **`ProjectService` / `InquiryService`** reads: `forClient`, the count, last-change and latest maps (no ids, another tenant finds nothing), `imagesFor` (each image once, deleted ones excluded).
- **Contact links** (unit): WhatsApp with and without a message, Viber, `tel:`.
- **HTTP:** the list's props (rows, counts, last activity, paging), `?q=` search, the profile's props (projects with status and artist, inquiries, signed reference URLs, chat links), the edit page, a successful save (redirect and flash), a taken phone (field error naming the other client), an invalid email, an anonymized client's edit refused, artists get 404 on all four routes, the project page's `clientId` (owner) and null (artist).
- **Isolation:** the four clients routes; the route guard's `clients` area.
- **Nav (unit):** owners get Inbox, Projects, Clients, Settings; artists get Projects.
- **Not automated:** the screens' look (browser checklist).

## Browser pass (in the PR)

The Clients tab at 375px and 1280px; search by part of a name and by the last digits of a phone; a profile with projects, inquiries and references (open a full image); WhatsApp / Viber / Call links; edit and save; a phone already used by another client; "View client" from a project and from an inquiry; as an artist (if available), no Clients tab.

## Docs

- `apps/platform/docs/backend.md`: a Clients bullet (`ClientService`, the editing rules, owners only, `contact_links`); the TAT-37 note "clients have only `ClientService.find` / `findMany`" is updated.
- `docs/requirements.md`: the client list and profile are owners only; form submissions never change a client's details.

## Carry-forwards

Posted when the PR is ready: TAT-51 (match by `findByPhone`, never overwrite a client, keep the inquiry's frozen copy), TAT-65 and TAT-66 (add a Payments section to the client profile), TAT-42 (the anonymized client's profile and edit rules; deleting must cover the client's inquiries, projects and reference images), TAT-43 (reuse `findByPhone` before creating a client).

## Not in this ticket

Creating clients by hand (TAT-43, TAT-51), deleting or merging clients (TAT-42), payments on the profile (TAT-65/66), artists seeing clients, sorting other than newest first, any migration.

## Assumptions the user can overrule at review

The tab label "Clients" and its icon; 25 per page; the 3-digit threshold for phone search; the wording of the empty states and errors; "last activity" as defined above; showing the phone as stored (E.164) rather than reformatted.

## Verification

`PORT=3402 node ace test` passes; `pnpm typecheck`, `pnpm check`, `pnpm build` and `node ace codegen` are clean; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
