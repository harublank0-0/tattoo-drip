# Studio FAQ and policies: design

Date: 6 November 2026. This is sub-project F1 of the platform gaps after Ink Noir, tracked on TAT-78 under "Follow-ups with no ticket yet". It covers every theme, platform first. The contact-message endpoint is its own sub-project, F2, not part of this one.

## Intent

**Studio.** A studio can:
- write its own FAQ questions and answers;
- write its own policies as titled sections (deposits, cancellations, touch-ups, anything it needs);
- order and remove both.

**Client.** The FAQ and Policies pages show what the studio actually wrote, in either theme, with the date the policies last changed.

**Success means:**
- Both themes show the studio's entries.
- The fixed answers about how requesting works stay.
- The Good to know texts keep their single source.
- Stencil & Ink studios can reach these pages from the page itself.

These choices were made with the user:
- **Policies are titled sections** the studio adds, orders and removes, with one "last updated" date for the whole page.
- **FAQ entries are added to** the fixed product answers and the Good to know answers; they don't replace them.
- **New tables; Good to know stays as it is** (approach A). The deposit policy, age rule and walk-ins text keep their one source: the deposit page and the FAQ's deposit answer read them as today.

## Decisions

### Data (one migration)

**`studio_faq_entries`**

| Column | Rule |
|---|---|
| `id` | uuid, `uuidv7()` |
| `tenant_id` | Foreign key to tenants, on delete cascade |
| `position` | smallint, 0-based, unique per `(tenant_id, position)` |
| `question` | varchar(200), not null, at least 1 character after trimming |
| `answer` | varchar(2000), not null, at least 1 character after trimming |
| `created_at`, `updated_at` | timestamps |

The table runs `enableTenantRls`.

**`studio_policy_sections`**

Same shape as the FAQ table, with `title` varchar(80) and `text` varchar(4000) in place of question and answer.

**Both tables**
- **Not soft-deleted.** They are settings replaced in place, like `studio_hours` and `studio_closures`.
- **Limits.** At most 20 FAQ entries and 12 policy sections per studio. The service enforces these when it saves, as it does for work photos.
- **Database checks.** Each table also has a check for `position between 0 and 19` (FAQ) or `0 and 11` (policies), so the database refuses a list that runs past the limit.

**`tenants.policies_updated_at`**

A nullable `timestamptz`. It is set to now when the policy sections are saved with a change (added, removed, reordered or edited). A `before update` trigger on `tenants` also sets it whenever `deposit_policy`, `age_rule_text` or `walk_ins_text` changes value: the three texts `/policies` shows. A trigger is used because the deposit policy is edited on the Payments page and the other two on Good to know, so one rule covers both and any later path. It is not set for a save that changes nothing. Existing studios start null, and the page then shows no date.

### Service (`#modules/studio_content`)

`StudioContentService` has three methods:
- `faq(tenant)` and `policySections(tenant)` read the lists in position order.
- `saveFaq(tenant, entries)` and `savePolicies(tenant, sections)` replace a whole list in one transaction. Each locks the studio's `tenants` row (`FOR UPDATE`) so two saves never interleave, deletes the old rows, and inserts the new ones with positions 0..n-1. `savePolicies` also sets `policies_updated_at` when the list differs from the stored one.
- Every query is scoped by tenant.

The three Good to know policy texts need no service change: the `tenants` trigger above dates them.

### Dashboard (Settings → FAQ & policies)

There is a new page at `/t/:tenant/settings/faq-policies`, owners only, with an entry in `TENANT_ROUTE_ROLES` and an isolation case. The settings navigation links it next to Good to know.

**Layout.** The page has two cards:
- **FAQ:** a list of question and answer pairs.
- **Policies:** a list of title and text pairs, with the page's "Last updated …" date shown under the card's title.

Each row has Edit (inline fields), Move up, Move down and Remove. Each card has "Add a question" or "Add a section", and one Save that sends the card's whole list.

**Saving.** Each card saves on its own:
- `PUT …/faq-policies/faq`
- `PUT …/faq-policies/policies`

**Validation and limits.** A VineJS validator trims every text and refuses an empty question, answer, title or text, refusing too long text per field (`entries.3.answer`). A list over its limit is refused as a whole.

**Conventions.** Copy, components and the inline confirm for Remove follow `apps/platform/docs/ui.md`. There are no `window.confirm` calls.

### API (`packages/types/openapi.yaml` first, then regenerate)

`Studio` (`getStudio`) gets two required properties.

**`faq`** is an array of `StudioFaqEntry` `{ question, answer }`:
- plain text, in the studio's order;
- `[]` when there are none, or while the studio hides its Good to know section.

**`policies`** is `StudioPolicies` `{ updatedAt, sections }`:
- `updatedAt` is a date-time or null;
- `sections` is an array of `{ title, text }` in order;
- `{ updatedAt: null, sections: [] }` while the Good to know section is hidden. `updatedAt` stays as stored when there are no sections, because the Good to know texts may still make a policies page.

The schema description says "plain text: render it as text". The read stays one cached `getStudio`, with no extra request. `StudioPageService.profile` reads the two lists with one query each.

### Storefront (`src/studio/info.ts`, every theme)

**FAQ**
- The groups are as today: Booking (the fixed product answers, plus walk-ins), Before your session, Pricing and deposits, Healing.
- A last group, "From {studio}", holds the studio's own entries in order. Each has `source: "studio"` and an id `studio-<n>` (1-based, stable for a given list).
- A studio entry whose question matches a fixed or Good to know question still shows. The studio wrote it.

**Policies**
- The Good to know sections come first, as today: Deposits, Age, Walk-ins, then Closed days.
- The studio's own sections follow, always after the Good to know ones. Titles never merge: a studio section called "Deposits" shows as its own section. The deposit policy keeps its one source, so `/policies` and the deposit page never disagree.
- Section ids are the title as a slug: lowercase ASCII letters and digits joined by single hyphens. An id already used on the page (a Good to know section's included) gets `-2`, `-3` and so on, and a title with no ASCII letter or digit (Nepali, say) becomes `section-<n>`.
- `PoliciesContent` gets `updatedAt: string | null`, formatted as "Last updated 6 November 2026" in the studio's timezone.
- The page is still a not-found when it has no section at all.

**Links**
- `StudioView.pages.policies` is true when either source has a section.
- `pages.faq` doesn't exist: the FAQ always has the fixed answers.

**Themes**
- **Ink Noir's policies layout** shows the date line under the title.
- **Stencil & Ink's `InfoPage`** shows the date line, and its footer gains a list of the informational pages. The list uses the same `navItems` and `moreNavItems` rules as Ink Noir, so no link leads to a not-found. The default-theme snapshot is updated with the new footer.

### Tests

**Platform**
- **Tables:** the tables' checks, position uniqueness and RLS (`EXPECTED_POLICIES`).
- **`StudioContentService`:**
  - saving replaces the list in order;
  - the limits refuse a list that is too long;
  - an unchanged save leaves `policies_updated_at` as it was, and a changed one sets it;
  - the trigger sets it only when one of the three texts changes (a Good to know or Payments save that changes nothing leaves it);
  - another tenant's rows are invisible.
- **Dashboard HTTP:**
  - owner-only access;
  - an artist gets a 404;
  - the isolation case;
  - validation errors by field;
  - the page's props.
- **API:** `getStudio` carries `faq` and `policies` in order, and empty lists while the Good to know section is hidden.

**Storefront**
- `info.ts`: the FAQ's studio group; the policies' order, unique ids (repeated and Nepali titles included) and the date.
- Both themes render the date.
- Stencil's footer links only the pages with content.
- The page safety rules (`assertSafePage`) for every theme and studio fixture, with studio text containing markup.

## Out of scope

- The contact-message endpoint (F2).
- Rich text, links or images in answers and sections.
- A date per entry or per section.
- Translations.
- Letting a studio hide the fixed product answers.

Later: rich text for answers and sections comes next, and the text columns stay plain text for now. A date per section waits until it is clear what it is for.
