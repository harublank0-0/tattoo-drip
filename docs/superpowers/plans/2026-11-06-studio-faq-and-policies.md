# Studio FAQ and Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studios write their own FAQ entries and titled policy sections in the dashboard, and both storefront themes show them, with a "last updated" date on Policies.

**Architecture:**
- Two new tenant-owned tables and `tenants.policies_updated_at`, plus a `tenants` trigger that dates changes to the Good to know policy texts.
- A `StudioContentService` that replaces each list whole.
- An owner-only Settings page.
- `getStudio` gains `faq` and `policies`.
- The storefront's `info.ts` merges them into the existing FAQ and Policies content, so every theme gets them.

**Tech Stack:** AdonisJS 7, Lucid, VineJS, PostgreSQL row-level security, Inertia and React, Japa; TanStack Start, React 19, `node:test`; Biome.

**Spec:** `docs/superpowers/specs/2026-11-06-studio-faq-and-policies-design.md`

## Global Constraints

- **Limits:**
  - at most 20 FAQ entries per studio, with question ≤ 200 and answer ≤ 2000 characters;
  - at most 12 policy sections per studio, with title ≤ 80 and text ≤ 4000 characters;
  - every text is trimmed, and an empty one is refused.
- **Plain text everywhere.** It is rendered as React text children with `whitespace-pre-line` or `user-text`. Never `dangerouslySetInnerHTML`. Rich text comes later, so the columns stay plain text.
- **Not soft-deleted.** Both tables are replaced in place, and every query is scoped by tenant. Each table runs `enableTenantRls()` and gets its `EXPECTED_POLICIES` entry.
- **Owners only.** Every new `/t/:tenant` route is owner-only, with a `TENANT_ROUTE_ROLES` entry and an isolation case.
- **Hidden Good to know section.** While the studio hides it (`info` not in its look's sections), `getStudio` sends `faq: []` and `policies: { updatedAt: null, sections: [] }`.
- **Policies order.** The Good to know sections come first (Deposits, Age, Walk-ins, Closed days), then the studio's own. Titles never merge.
- **Copy, exact strings:**
  - FAQ group title: `From {studio}`
  - the date line: `Last updated {date}`, with the date as `d MMMM yyyy` in the studio's timezone (for example `6 November 2026`)
  - settings nav label: `FAQ & policies`
- **Generated files:** regenerate them, never edit by hand:
  - `database/schema.ts` (via `pnpm migrate`)
  - `packages/types/src/openapi.gen.ts`
  - `.adonisjs/` (via `node ace codegen`)
  - `apps/storefront/test/studio/default-theme.snapshot.json`: delete it, then re-run `default-theme.test.ts`.
- **Local test environment:** `source <scratchpad>/platform-test-env.sh`, which sets `SESSION_DRIVER=memory` and `NODE_ENV=test`.

## Review Focus

1. **Two owners saving at once.** Two saves of the same list at once (two owners, or a double click) must leave one complete list, never a mix or a position clash. → Task 2's test.
2. **Reordering only.** A save that only reorders policy sections dates the page. A save that changes nothing leaves the date alone. → Task 2's test.
3. **Markup in studio text.** A question or section containing `<script>` or line breaks shows as text, line breaks kept, in both themes. → Task 5's test.
4. **Non-ASCII and repeated titles.** A Nepali policy title (no ASCII letters) and two sections with the same title get unique, valid anchor ids. The contents list links each correctly. → Task 5's test.
5. **Stencil footer links.** The footer never links a page that would be a not-found, for example Policies for a studio with no sections and no Good to know policy texts. → Task 5's test.

---

### Task 1: Migration, models and the policies date trigger

**Files:**
- Create: `apps/platform/database/migrations/1791850000000_create_studio_faq_and_policy_sections.ts`
- Create: `apps/platform/app/modules/studio_content/models/studio_faq_entry.ts` and `studio_policy_section.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`: add `studio_faq_entries` and `studio_policy_sections`, each `["tenant_isolation:ALL"]`.
- Test: `apps/platform/tests/functional/studio_content/studio_content_tables.spec.ts`

**Interfaces:**
- Produces:
  - models `StudioFaqEntry` (`tenantId`, `position`, `question`, `answer`) and `StudioPolicySection` (`tenantId`, `position`, `title`, `text`);
  - `Tenant.policiesUpdatedAt: DateTime | null`.

- [ ] **Step 1: Write the failing tests.** Use `insertRow` / `updateRow` from `#tests/helpers/sql`, inside `withDbContext`, as in `inquiries_table.spec.ts`.
  - `"an entry needs its question and answer within their lengths, a position from 0 to 19, unique per studio"`: empty or whitespace-only question; question of 201 characters; answer of 2001; position 20; two rows at position 0. Each is rejected by its named constraint, and the valid row inserts.
  - `"a policy section needs its title and text within their lengths, a position from 0 to 11, unique per studio"`: the same cases with 81 / 4001 / position 12.
  - `"changing the deposit policy, age rule or walk-ins dates the policies; other changes and same-value saves don't"`. Start from `policies_updated_at` null:
    - updating `intro` leaves it null;
    - updating `walk_ins_text` to a new value sets it;
    - updating `age_rule_text` to its current value leaves it unchanged;
    - updating `deposit_policy` sets a later value.
  - `"row-level security"`: `assertRowLevelSecurity` for both tables, as `inquiries_table.spec.ts` does.
- [ ] **Step 2: Run them to see them fail.**
  ```
  NODE_ENV=test node ace test functional --files=studio_content_tables.spec.ts
  ```
  Expected: FAIL (the tables don't exist).
- [ ] **Step 3: Write the migration.** Follow `1791790000000_create_studio_hours_and_closures.ts`.
  - **Tables:** `uuidv7()` ids, a tenant FK with cascade, `smallint position`, varchar text columns, `created_at` and `updated_at`, `unique(tenant_id, position)`.
  - **Checks:**
    - `<table>_position_range`
    - `studio_faq_entries_question_filled` / `_answer_filled` (`btrim(x) <> ''`)
    - `studio_policy_sections_title_filled` / `_text_filled`
  - **RLS:** `enableTenantRls` on both.
  - **Column:** `tenants.policies_updated_at timestamptz null`.
  - **Trigger:** a `before update` row trigger `tenants_date_policies`, a plpgsql function with `set search_path = pg_catalog, pg_temp`. It sets `new.policies_updated_at := now()` when `new.deposit_policy`, `new.age_rule_text` or `new.walk_ins_text` is distinct from the old value.
  - **`down`:** reverses all of it.
- [ ] **Step 4: Write the models** from the generated schema classes, with a doc comment each.
- [ ] **Step 5: Migrate, then run the Step 2 test and `catalog_guard.spec.ts`.**
  ```
  pnpm migrate
  ```
  Expected: PASS, with `database/schema.ts` regenerated.
- [ ] **Step 6: Commit** `feat(platform): add studio FAQ entries, policy sections and the policies date`. The commit includes `schema.ts`.

---

### Task 2: StudioContentService

**Files:**
- Create: `apps/platform/app/modules/studio_content/services/studio_content_service.ts`
- Create: `apps/platform/app/modules/studio_content/limits.ts`. Exports `MAX_FAQ_ENTRIES = 20`, `MAX_POLICY_SECTIONS = 12` and `FAQ_LIMITS = { question: 200, answer: 2000 }`, `POLICY_LIMITS = { title: 80, text: 4000 }`.
- Create: `apps/platform/app/modules/studio_content/errors.ts` (`ContentLimitError`)
- Test: `apps/platform/tests/functional/studio_content/studio_content_service.spec.ts`

**Interfaces:**
- Consumes: Task 1's models and `Tenant.policiesUpdatedAt`.
- Produces:
  - `faq(tenant: TenantRef): Promise<{ question: string; answer: string }[]>`
  - `policySections(tenant: TenantRef): Promise<{ title: string; text: string }[]>`
  - `saveFaq(tenant: TenantRef, entries: readonly { question: string; answer: string }[]): Promise<void>`
  - `savePolicies(tenant: TenantRef, sections: readonly { title: string; text: string }[]): Promise<{ changed: boolean }>`
  - All are in position order.
  - `ContentLimitError` carries `list: "faq" | "policies"` and is thrown before any write when a list exceeds its limit.

- [ ] **Step 1: Write the failing tests.**
  - `"saveFaq replaces the list in the order given; faq reads it back in order"`: save 3 entries, then 2 entries. The read gives exactly the 2, in order.
  - `"savePolicies replaces the list and dates the policies only when the list changed"`:
    - the first save sets `policiesUpdatedAt`;
    - saving the same list returns `{ changed: false }` and keeps the date;
    - reordering returns `{ changed: true }` with a later date;
    - editing one text likewise;
    - saving `[]` after a list is a change.
  - `"a list over its limit is refused before anything is written"`: 21 FAQ entries, or 13 sections, throws `ContentLimitError`. The stored list is unchanged.
  - `"two saves of the same list at once leave one whole list"`: run two `saveFaq` calls with different lists concurrently, each in its own `withDbContext` (as the race tests in `work_photo_service.spec.ts` do). The result equals one of the two lists exactly, and its positions are 0..n-1.
  - `"another studio's lists are invisible and its save touches only its own"`: run `faq` for A in B's context with `inTenantAs`, and get `[]`. B's save leaves A's rows.
- [ ] **Step 2: Run them to see them fail.**
  ```
  NODE_ENV=test node ace test functional --files=studio_content_service.spec.ts
  ```
  Expected: FAIL.
- [ ] **Step 3: Implement the service.**
  - Each save runs in `withTransaction`. It first locks the tenant row (`Tenant.query({ client: trx }).where("id", tenant.id).forUpdate()`), so concurrent saves serialise. Then it deletes the tenant's rows and inserts the new list with positions `0..n-1`.
  - `savePolicies` compares the stored `(title, text)` sequence with the new one. Only when they differ does it set `tenants.policies_updated_at = now()`, with a direct update on the locked row.
  - Every query has `.where("tenant_id", tenant.id)`.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): save a studio's FAQ entries and policy sections as whole lists`

---

### Task 3: Settings → FAQ & policies (dashboard)

**Files:**
- Create: `apps/platform/app/controllers/studio_content_controller.ts`
  - `show`: GET `/t/:tenant/settings/faq-policies`, named `tenant.settings.faq_policies`
  - `updateFaq`: PUT `…/faq`, named `.faq.update`
  - `updatePolicies`: PUT `…/policies`, named `.policies.update`
- Create: `apps/platform/app/modules/studio_content/validators/studio_content.ts`
  - `faqValidator`: `{ entries: array of { question, answer } }`
  - `policiesValidator`: `{ sections: array of { title, text } }`
  - Both trim, require at least one character, and use Task 2's limits. The arrays' `maxLength` comes from `MAX_*`.
- Create: `apps/platform/inertia/pages/settings/faq_policies.tsx`
- Modify:
  - `apps/platform/start/routes.ts`: the routes in the owner settings group, next to Good to know.
  - `apps/platform/app/modules/tenancy/access.ts`: the three route names as `OWNERS`.
  - `apps/platform/tests/isolation/cases.ts`: three cases. GET returns 200; each PUT returns 302 with a snapshot of the studio's rows of that table.
  - `apps/platform/inertia/layouts/settings.tsx`: the nav item `FAQ & policies` after Good to know, with icon `MessageCircleQuestion` from lucide.
- Run: `node ace codegen` (commit the `.adonisjs/` changes).
- Test: `apps/platform/tests/functional/studio_content/studio_content_http.spec.ts`

**Interfaces:**
- Consumes: Task 2's service, limits and `ContentLimitError`.
- Produces the page props: `{ faq: { question, answer }[], policies: { title, text }[], policiesUpdatedOn: string | null, shownOnPage: boolean }`.
  - `policiesUpdatedOn` is the formatted `d MMMM yyyy` in the studio's timezone.
  - `shownOnPage` means `info` is among the look's sections, as Good to know's page computes it.

- [ ] **Step 1: Write the failing tests.** Follow `scheduling/good_to_know_http.spec.ts`, with `withInertia()` and `loginAs(owner)`.
  - `"the page carries the studio's lists in order, the policies date and whether Good to know is shown"`
  - `"saving the FAQ replaces it and goes back with a success flash"`. The PUT body is `{ entries: [...] }`, and it redirects back to the page.
  - `"saving policies replaces them and dates them; an unchanged save keeps the date"`
  - `"an empty question, a 2001-character answer or 21 entries is a field error; nothing is saved"`. The errors are keyed `entries.0.question`, `entries.0.answer` and `entries`.
  - `"an artist gets a 404 for each route"`
- [ ] **Step 2: Run them to see them fail.**
  ```
  NODE_ENV=test node ace test functional --files=studio_content_http.spec.ts
  ```
  Expected: FAIL.
- [ ] **Step 3: Implement the routes, controller, validators and access entries.** A `ContentLimitError` from the service becomes a validation error on `entries` / `sections`.
- [ ] **Step 4: Implement the page.**
  - Use `Page`, `Card`, `Field` and `Button` from `~/components`.
  - One Inertia `useForm` per card holds the list. Each row has inline fields, and the buttons Move up, Move down and Remove. Remove uses the existing `InlineConfirm`.
  - The add buttons are labelled "Add a question" and "Add a section", and each card has a Save.
  - Field errors show per row.
  - When `shownOnPage` is false, a note says the studio page hides Good to know, so these don't show, and links to Page look.
  - The policies card shows `Last updated {date}` when the date is set.
  - Follow `docs/ui.md`.
- [ ] **Step 5: Codegen, then check.**
  - Run `node ace codegen`.
  - Run the Step 2 tests, `tenant_routes.spec.ts`, `role_access.spec.ts` and the cross-tenant isolation spec.
  - Run `pnpm --filter @tattoo-drip/platform typecheck`.
  - Expected: PASS.
- [ ] **Step 6: Browser check.** Run `pnpm dev`. Add, reorder, remove and save in both cards, at phone and desktop width.
- [ ] **Step 7: Commit** `feat(platform): edit the studio's FAQ and policies in Settings`

---

### Task 4: `getStudio` carries `faq` and `policies` (contract first)

**Files:**
- Modify: `packages/types/openapi.yaml`
  - new schemas `StudioFaqEntry` `{question, answer}` and `StudioPolicies` `{updatedAt: date-time|null, sections: [{title, text}]}`, with `additionalProperties: false` and the descriptions "plain text: render it as text";
  - `Studio` gets `faq` and `policies`, both required.
- Regenerate: `pnpm --filter @tattoo-drip/types generate`
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts`. `profile` reads both lists through `StudioContentService` (injected), and applies the hidden-section rule.
- Modify: `apps/platform/app/transformers/public_studio_transformer.ts` (the two fields)
- Modify: `docs/sdk.md` (one sentence in the `studio.get` paragraph)
- Test: `apps/platform/tests/functional/api/public_studio.spec.ts`

**Interfaces:**
- Consumes: Task 2's `faq` and `policySections`.
- Produces: `Studio.faq: { question: string; answer: string }[]` and `Studio.policies: { updatedAt: string | null; sections: { title: string; text: string }[] }` (the generated types). Task 5 relies on these.

- [ ] **Step 1: Write the failing tests.**
  - `"getStudio carries the studio's FAQ and policy sections in order, with the policies date"`
  - `"with Good to know hidden, faq is [] and policies is { updatedAt: null, sections: [] }"`
  - `"a studio with none has faq [] and policies { updatedAt: null, sections: [] }"`
- [ ] **Step 2: Run them to see them fail.**
  ```
  NODE_ENV=test node ace test functional --files=public_studio.spec.ts
  ```
  Expected: FAIL.
- [ ] **Step 3: Implement.** Edit `openapi.yaml`, regenerate the types, then change the service and the transformer.
- [ ] **Step 4: Run the Step 2 command, `studio_page_service.spec.ts` and `studio_page_privacy.spec.ts`.** Then run the platform and SDK typechecks.
- [ ] **Step 5: Commit** `feat(platform): serve the studio's FAQ and policies with the studio`. The commit includes the yaml, the generated types and `docs/sdk.md`.

---

### Task 5: Storefront: FAQ and Policies in every theme, and Stencil's footer links

**Files:**
- Modify: `apps/storefront/src/studio/info.ts`
  - `faqContent` appends the group `{ id: "studio", title: "From {studio}" filled, items }`. The items have ids `studio-1…`, `source: "studio"` and `link: null`.
  - `policiesContent` appends the studio sections after the Good to know ones, with ids from `sectionId(title, used)`.
  - `PoliciesContent.updatedAt: string | null` is the formatted date.
  - `infoContent` reads `studio.faq` and `studio.policies` defensively: anything not a list is `[]`, an entry missing a text is dropped, and texts are cleaned with `cleanText`.
- Create: `apps/storefront/src/studio/anchors.ts`. Exports `sectionId(title: string, used: Set<string>, n: number): string`, which returns a lowercase ASCII slug, `-2`, `-3`… on a repeat, and `section-<n>` when the slug would be empty.
- Modify: `apps/storefront/src/studio/view-model.ts`. In `shownPages`, `policies` is also true when `studio.policies.sections` has an entry.
- Modify: `apps/storefront/src/studio/components/info.tsx`. `PolicySections` takes `updatedAt` and renders `<p class="policies-updated">Last updated {date}</p>` under the contents list. Stencil's `InfoPage` passes it.
- Modify: `apps/storefront/src/studio/theme/ink-noir/info/info-page.tsx`. Ink Noir's policies layout shows the same line under its title.
- Modify: `apps/storefront/src/studio/components/shell.tsx`. `StencilShell`'s footer gets `<nav aria-label="More about {studio}">` listing `navItems(…)`'s info links (services, about, contact) and `moreNavItems(…)` (FAQ, policies, aftercare). It uses the same `studio.pages` and sections Ink Noir passes. `StencilShell` then needs the theme's sections and `artistsShown`, which its props already carry.
- Modify: `apps/storefront/test/studio/fixtures.ts`. Fixtures gain `faq` and `policies`: `[]` and `{ updatedAt: null, sections: [] }` by default, plus a `CONTENT_STUDIO` with two FAQ entries and three sections, one titled in Nepali (`नीति`) and two titled `Cancellations`.
- Regenerate: `test/studio/default-theme.snapshot.json`. Delete it, then run `default-theme.test.ts`, and check the diff is only the footer nav.
- Test: `apps/storefront/test/studio/info-pages.test.ts` (and `anchors` in the same file)

**Interfaces:**
- Consumes: Task 4's `Studio.faq` and `Studio.policies` types.

- [ ] **Step 1: Write the failing tests.**
  - `"the FAQ ends with the studio's own entries under From {studio}, in order, as text"`:
    - the group title is `From Black Needle`;
    - the ids are `studio-1` and `studio-2`;
    - an answer containing `<script>x</script>\nsecond` renders escaped, with the line break kept in a `user-text` element.
  - `"Policies lists the Good to know sections first, then the studio's, with unique anchors and the date"`:
    - the ids are `["deposits", "age", "walk-ins", "closed-days", "section-5", "cancellations", "cancellations-2"]` for `CONTENT_STUDIO`;
    - each has a matching `<a href="#…">` in the contents;
    - `Last updated 6 November 2026` appears in both themes, for `updatedAt: "2026-11-06T05:00:00Z"` and timezone `Asia/Kathmandu`.
  - `"a studio with only its own sections has a Policies page; one with neither is a not-found"`
  - `"with Good to know hidden the studio's FAQ entries and sections show nowhere"`. This holds through the API's empty lists and through the storefront's own `info` check.
  - `"Stencil & Ink's footer links each informational page that has content, and none that doesn't"`:
    - `CONTENT_STUDIO` links `/faq` and `/policies`;
    - `EMPTY_STUDIO` links `/faq` but not `/policies` or `/aftercare`.
  - The existing `"in both themes … every rule of a studio page"` test runs for `CONTENT_STUDIO` too (`assertSafePage`).
- [ ] **Step 2: Run them to see them fail.**
  ```
  pnpm --filter @tattoo-drip/storefront test
  ```
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement the changes listed in Files.**
- [ ] **Step 4: Regenerate the snapshot, then run the checks.**
  - Delete the snapshot and run `node --import tsx --test test/studio/default-theme.test.ts`. Check its diff by eye.
  - Run `pnpm --filter @tattoo-drip/storefront test`, `typecheck` and `build`.
  - Expected: PASS.
- [ ] **Step 5: Browser check.** Use the stub API, adding `faq` and `policies` to its `full` and `stencil` tenants. Look at `/faq` and `/policies` in both themes at 320 px and desktop width, and at Stencil's footer.
- [ ] **Step 6: Commit** `feat(storefront): show the studio's FAQ and policies in every theme; link the info pages from Stencil & Ink`

---

### Task 6: Whole-branch verification

- [ ] **Step 1: Run the root gates.**
  - `pnpm check`, `pnpm typecheck` and `pnpm build`.
  - The generated types and schema must match their generators.
  - Run the full platform `node ace test` with the test env.
  - Run `pnpm --filter @tattoo-drip/storefront test`.
  - Expected: all green. The exceptions are the 3 known `file_serving` local-env failures and the tenancy timing cancels; report them if seen.
- [ ] **Step 2: Review.** Run a fresh whole-branch review of `origin/main...HEAD` and fix its Critical and Important findings test-first.
- [ ] **Step 3: Docs.** Update the canonical docs the review or this plan touched:
  - `docs/data-model.md`: the two tables and `policies_updated_at`;
  - `apps/platform/database/README.md`: the not-soft-deleted list and the tenants trigger;
  - `apps/storefront/docs/development.md`: the Informational pages section.
- [ ] **Step 4: Linear.** Tick TAT-78's "Studio-written FAQ entries and policy documents" once merged.
