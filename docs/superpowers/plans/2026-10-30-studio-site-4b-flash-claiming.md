# Studio site 4b/5 (TAT-129): one-of-a-kind flash and claiming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An artist can mark a flash design **one of a kind**; such a design is claimed automatically at its project's first verified deposit or when the project is booked, whichever comes first, or by hand in one tap; the studio chooses whether claimed designs stay on the site greyed out ("Claimed") or disappear; a new request for a claimed design is refused and the request page offers "ask for something similar"; the other open requests and projects for it get "Design taken: offer something similar", and sending a price, a deposit link or verifying a payment for one warns first. Nothing is ever cancelled for it.

**Architecture:** Three columns on `flash_designs` (`one_of_a_kind`, `claimed_at`, `claimed_project_id`, with checks that only a one-of-a-kind design is claimed) and `tenants.storefront_claimed_flash`. The claim is one conditional `UPDATE` in a plain module function, `claimFlashFor` (`#modules/flash/services/flash_claim`), called by `PaymentService` after a deposit is verified or recorded and by `SessionService` where it books a project; the first to commit wins, a second claim changes nothing. It is a function, not a `FlashService` method, so `PaymentService` and `SessionService` keep their constructors (`tests/helpers/payments.ts`, `tests/helpers/deposits.ts` and a dozen specs build them by hand). The public reads add `status` and honour the studio's setting; intake refuses `flash_claimed`. The dashboard derives "taken" from the design (claimed, by anything but this project) for open inquiries and projects only, and the storefront greys claimed designs and turns the request page into a custom request "for something similar".

**Tech Stack:** AdonisJS 7, Lucid, VineJS, Inertia + React + shadcn (dashboard), PostgreSQL 18, OpenAPI 3.1 + openapi-typescript, `@tattoo-drip/sdk` / `@tattoo-drip/react`, TanStack Start (storefront), Japa and `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-29-studio-website-design.md`, sections "Flash designs (new)" (one of a kind, status claimed, claiming, desk bookings, several clients, the claimed-designs setting), "Requests for a flash design" (the warnings and the refusal), "Request page" (a design taken meanwhile), "My calls" 4 and 8, "Left to the builder" (where the claim happens, a cancelled claiming project). Ticket 4 of the split, second half. Plan 4a (`2026-10-30-studio-site-4a-flash-catalog-and-requests.md`) is built and its Interfaces are used as given: `FlashDesign`, `FlashService` (`add`, `update`, `findEditable`, `page`, `artistsWithDesigns`, `findShown`, `forIds`), `NewFlashDesign` / `FlashDetails`, `FlashCardProps` / `flashCard`, `FlashTray`, `components/flash.ts`, `FlashDesignCard`, the public `FlashDesign` and `StudioPageService.flash` / `flashDesign`, `IntakeService.target`, the storefront's `FlashDesignView`, `flashDesignView`, `FlashRequestView`, `requestPageData`, `FlashSummary`, `flashInquiryState`, `loadStudioPage`'s flash read, the intake `NOTICE_CODES` and `ProblemContext.sentFlash`. The code it touches outside the flash module, as built: `PaymentService.afterPayment(tenant, project, payment)` (a `deposit` goes through `SessionService.settleBooking`), `SessionService.moveToBooked(tenant, project)` (the `deposit_pending` to `booked` rule, under the project's lock; `settleBooking`, `schedule` / `add` and `ProjectService.acceptQuote` all reach it) and `add`'s `in_progress` to `booked` shortcut, `BookingService.book` (a desk booking, created `booked`, no design), `CLOSED_STATUSES` (`#modules/projects/moves`), `deposit_panel.tsx` (the first "Make deposit link" is a plain button; "New link" asks through `InlineConfirm`), `payments_card.tsx` (`PendingProof`'s verify `ConfirmPanel`), `quote_card.tsx` (`QuoteForm` in the first-quote form and `RevisePanel`), `next_step_card.tsx`, `settings/look.tsx` (radio groups through `useStoredChoice`), `updateLookValidator` (every field required: the form always sends them), `TenancyService.updateLook` / `PageLookInput`, `PageLookController.show`'s `look` prop.

## Global Constraints

- **Base: plan 4a's final tip** (after its final review) on `harublank00/tat-129-studio-site-45-flash-designs-flash-pages-flash-requests-and`. Branch `harublank00/tat-129b-studio-site-45-flash-claiming`, created from that tip in the same worktree `/home/blank/Coding/tattoo-drip-wt/site-4` (`git switch -c harublank00/tat-129b-studio-site-45-flash-claiming harublank00/tat-129-studio-site-45-flash-designs-flash-pages-flash-requests-and`); this plan's file is already there (4a's plan commit). Whether 4b gets its own Linear sub-issue of TAT-129 is the coordinator's call. Database `tattoo_drip_site` reused as 4a left it (never drop or recreate it).
- The rest of plan 4a's Global Constraints apply unchanged: the isolated database and environment (`DB_DATABASE=tattoo_drip_site`, `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform`, unset `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS`), never `tattoo_drip`, ports 3333 / 3000 or `/home/blank/Coding/tattoo-drip`; ports 3401 / 3402 / 3404; the Node 24 path; the RED-step `timeout 90`; a full platform suite only under `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock`; no Inertia `optimistic` and no `window.confirm` under `inertia/`; stateless storefront components; generated files; the default-theme snapshot; the commit format (subject lowercase after the colon, at most 100 characters, body wrapped at 100, `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, checked with `pnpm exec commitlint`).
- The migration is `1791810000000_add_flash_claiming.ts`: it sorts after 4a's `1791800000000` and `1791800000001` (`ls apps/platform/database/migrations | tail -3` ends with these three).
- Owner's decisions: **"Can be tattooed again" is the default**; one of a kind is opt-in per design. **A claimed design only warns; nothing is cancelled for it**: no inquiry or project changes status because of a claim, and **the client's deposit page is unchanged**.
- Claim moment (spec call 4): for a project whose `flash_design_id` names a one-of-a-kind design, the **first verified deposit** (verified from a screenshot or recorded at the desk) or the project **becoming booked**, whichever comes first. A design that can be tattooed again is never claimed. Session and balance payments, refunds and reversals never claim.
- Release: only by hand ("Make available"), or by switching the design to "can be tattooed again". A reversed or refunded deposit and a withdrawn, declined or cancelled project keep the claim (decision; the studio talks to the client first).
- "Taken" (the label and the warnings) is only for **open** records: a `new` inquiry for a claimed design, and a project not in `CLOSED_STATUSES` whose design is claimed by anything but that project.
- The claimed-designs setting: `show` (the default: greyed, marked "Claimed", never requestable) or `hide` (in no public answer: lists, filters and the design read, a 404). Intake refuses a claimed design under either.
- Copy, exactly (spec words in bold): the label **"Design taken: offer something similar"**; storefront `studioCopy.flash` gains `{ claimed: "Claimed", similar: "Ask for something similar", similarStart: "Something similar to the {name} flash", claimedNote: "Someone has claimed this design: it was one of a kind." }`; API `flash_claimed` message "Someone has claimed this design: it was one of a kind."; intake notice `"flash-claimed"`: title "Someone just claimed this design", body "It was one of a kind, so your request wasn't sent. Message {studio} to ask for something similar."; dashboard words in Tasks 3 and 5.

## Review Focus

1. **Two clients pay for the same one-of-a-kind design:** the first deposit verified (or project booked) claims it; verifying the second records the payment, claims nothing, moves no status, and its project then shows the label and the warnings. Pinned in Task 2 (`flash_claims.spec.ts`) and Task 5 (`project_page.spec.ts`).
2. **The claiming deposit is reversed or refunded, or the project withdrawn:** the claim stays until the studio taps "Make available". Pinned in Task 2.
3. **A claimed design switched to "can be tattooed again":** the claim clears in the same save, and the database refuses a claim on a repeatable design. Pinned in Task 1.
4. **The studio hides claimed designs:** lists, filters and the design read drop them; `/request?flash=<that id>` is the general form with the "isn't on the page" note, not an error; intake still answers `flash_claimed`. Pinned in Task 4 and Task 6.
5. **A quote with no deposit books the project and claims; a direct booking (no design) claims nothing and costs no flash query.** Pinned in Task 2.

---

### Task 1: One of a kind and the claim, in the table and the service

**Files:**
- Create: `apps/platform/database/migrations/1791810000000_add_flash_claiming.ts`
- Create: `apps/platform/app/modules/flash/claims.ts` (pure), `apps/platform/app/modules/flash/services/flash_claim.ts` (`claimFlashFor`)
- Modify: `apps/platform/app/modules/flash/services/flash_service.ts`, `apps/platform/app/modules/flash/errors.ts` (`FlashRuleError`), `apps/platform/app/modules/storefront/look.ts` (`CLAIMED_FLASH_CHOICES`, `claimedFlashOf`)
- Regenerate: `apps/platform/database/schema.ts`
- Modify (tests): `tests/helpers/artists.ts` (`addFlashDesign` takes `oneOfAKind`, `claimedAt`, `claimedProjectId`)
- Test: `apps/platform/tests/functional/flash/flash_service.spec.ts`, `tests/functional/rls/flash_designs.spec.ts`, `tests/unit/modules/flash/claims.spec.ts` (new), `tests/unit/modules/storefront/look.spec.ts`

**Interfaces:**
- Produces (model, regenerated): `FlashDesign.oneOfAKind: boolean`, `claimedAt: DateTime | null`, `claimedProjectId: string | null`; `Tenant.storefrontClaimedFlash: string`.
- Produces (`#modules/flash/claims`): `export type ClaimState = "none" | "here" | "taken"`; `claimStateOf(design: Pick<FlashDesign, "claimedAt" | "claimedProjectId">, at: { projectId: string | null; open: boolean }): ClaimState` ("here" when `claimedProjectId` is that non-null project, else "taken" when claimed and `open`, else "none"); `isClaimed(design): boolean`.
- Produces (`#modules/flash/services/flash_claim`): `claimFlashFor(tenant: TenantRef, project: Pick<TattooProject, "id" | "flashDesignId">): Promise<boolean>`: no query without a design; else, through `dbClient()` (the caller's transaction, under the project's lock), `update flash_designs set claimed_at = now(), claimed_project_id = ?, updated_at = now() where tenant_id = ? and id = ? and one_of_a_kind and claimed_at is null`; true when it changed a row.
- Produces (`FlashService`): `NewFlashDesign.oneOfAKind: boolean` (so `FlashDetails` too); `update` with `oneOfAKind: false` also clears `claimed_at` and `claimed_project_id`; `setClaimed(tenant, editor, design: FlashDesign, claimed: boolean): Promise<FlashDesign>` (under `lockEditable`; a repeatable design is `FlashRuleError("repeatable")`; `true` on an unclaimed design sets `claimed_at` now and `claimed_project_id` null, on a claimed one changes nothing; `false` clears both); `FlashFilter` gains `withClaimed: boolean` (false leaves claimed designs out of `page`), and `artistsWithDesigns(tenant, artistIds, withClaimed: boolean)`. `findShown` and `forIds` return claimed designs too (their callers decide).
- Produces (`look.ts`): `CLAIMED_FLASH_CHOICES = ["show", "hide"] as const`, `type ClaimedFlash`, `claimedFlashOf(row: { storefrontClaimedFlash: string }): ClaimedFlash` (anything off the list is `"show"`). Not part of `PageLook`, so the public `Studio.storefront` is unchanged.

- [ ] **Step 1: Write the failing tests**

`flash_designs.spec.ts`: "a repeatable design can't be claimed (`flash_designs_claim_one_of_a_kind`), a claiming project needs a claim time (`flash_designs_claim_project_needs_time`), and another tenant's project can't claim a design (composite key)".
`claims.spec.ts`: `claimStateOf` for unclaimed (`none`), claimed by hand (`taken` when open, `none` when closed), claimed by project P seen from P (`here`), from Q open (`taken`), from Q closed (`none`), from an inquiry (`projectId` null, `open` true: `taken`).
`flash_service.spec.ts`:
- "add and update store one of a kind; a new design can be tattooed again unless asked".
- "switching a claimed design to can be tattooed again clears the claim in the same save" (Review Focus 3).
- "setClaimed marks a one-of-a-kind design claimed by hand and available again; a repeatable one is FlashRuleError 'repeatable'; an artist unlinked meanwhile is E_ROW_NOT_FOUND".
- "claimFlashFor claims an unclaimed one-of-a-kind design for the project, once: a second project's claim returns false and changes nothing; a repeatable design and a design claimed by hand stay as they were; no design means no query" (`recordQueries`).
- "page and artistsWithDesigns leave claimed designs out when withClaimed is false".
`look.spec.ts`: `claimedFlashOf({ storefrontClaimedFlash: "hide" })` is "hide"; "nope" and "" are "show".

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test unit --files=claims.spec.ts > /tmp/site4b-red.log 2>&1`, then `PORT=3402 pnpm test functional --files=flash_service.spec.ts --files=flash_designs.spec.ts` and `PORT=3402 pnpm test unit --files=look.spec.ts`
Expected: exit 124 with "Cannot find module '#modules/flash/claims'"; FAIL (no columns).

- [ ] **Step 3: Write the migration**

`1791810000000_add_flash_claiming.ts`, `up`: `flash_designs` gets `one_of_a_kind` boolean not null default false, `claimed_at` timestamptz nullable, `claimed_project_id` uuid nullable with an index on `(tenant_id, claimed_project_id)` and, by raw SQL, `flash_designs_claimed_project_fk` foreign key `(tenant_id, claimed_project_id)` references `tattoo_projects (tenant_id, id)` (no action: projects are never purged by the app), and the checks `flash_designs_claim_one_of_a_kind` (`claimed_at is null or one_of_a_kind`) and `flash_designs_claim_project_needs_time` (`claimed_project_id is null or claimed_at is not null`). `tenants` gets `storefront_claimed_flash` varchar(20) not null default `'show'` with the shape check `tenants_storefront_claimed_flash_format` (`storefront_claimed_flash ~ '^[a-z]{1,20}$'`; which values exist is the app's list, as for the other look columns). `down` drops them. Run `pnpm migrate`, the `biome` step, then `pnpm migrate:rollback` and `pnpm migrate` (this batch alone rolls back); `ls database/migrations | tail -3` as in the Global Constraints.

- [ ] **Step 4: Implement** per Interfaces; the service's and `claimFlashFor`'s doc comments state the claim rules and that nothing else ever releases a claim.

- [ ] **Step 5: Run the tests to verify they pass**

Run: the commands of Step 2 without `timeout`, plus `--files=catalog_guard.spec.ts --files=page_look_columns.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): one-of-a-kind flash designs and their claim" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: The claim happens at the first verified deposit or the booking

**Files:**
- Modify: `apps/platform/app/modules/payments/services/payment_service.ts` (`afterPayment`), `apps/platform/app/modules/scheduling/services/session_service.ts` (`moveToBooked`)
- Test: `apps/platform/tests/functional/flash/flash_claims.spec.ts` (new)

**Interfaces:**
- Consumes: `claimFlashFor` (Task 1); `paymentServices()`, `proofFor()`, `ownerMember()` (`#tests/helpers/payments`), `makeProject` with `flashDesignId`, `makeQuote`, `makeSession` (`#tests/helpers/pipeline`), `recordQueries` (`#tests/helpers/query_count`).
- Produces: `PaymentService.afterPayment` calls `claimFlashFor(tenant, project)` for a `deposit` payment, before `settleBooking`; `SessionService.moveToBooked` calls it right after `setStatus(project, "booked")`, which covers every move to booked (`schedule` / `add`, `settleBooking` from `PaymentService` and from `ProjectService.acceptQuote`); `add`'s `in_progress` to `booked` shortcut needs none (the project was booked before, and a claim never releases by itself). Both run inside the existing transaction, under the project's lock. No constructor changes, and no status, payment, session or deposit link changes.

- [ ] **Step 1: Write the failing tests** in `flash_claims.spec.ts` (each project made from a one-of-a-kind design unless the test says otherwise)

- "a deposit verified from a screenshot claims the design for its project": after `verify`, the design's `claimedProjectId` is the project and `claimedAt` is set.
- "a deposit recorded at the desk claims it too".
- "a quote with no deposit claims it when the project is booked" (accept a quote of deposit 0 with a scheduled tattoo session: the project is `booked` and the design claimed) (Review Focus 5).
- "scheduling the tattoo session that books a paid project changes nothing more": already claimed at the deposit, `claimedAt` unchanged.
- "the first project keeps it: a second project's verified deposit claims nothing and both keep their statuses" (Review Focus 1).
- "a design that can be tattooed again is never claimed; nor by a session or balance payment".
- "reversing or refunding the claiming deposit, and withdrawing its project, keep the claim" (Review Focus 2).
- "a design already claimed by hand stays claimed by hand (`claimedProjectId` null)".
- "a direct booking and a project without a design run no flash query" (`recordQueries` around `BookingService.book` and `verify`: no statement names `flash_designs`).

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=flash_claims.spec.ts`
Expected: FAIL (nothing claims).

- [ ] **Step 3: Implement** per Interfaces, with one comment at each call naming the claim rule.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the command of Step 2, plus `--files=payment_decisions.spec.ts --files=payment_entries.spec.ts --files=session_scheduling.spec.ts --files=project_service.spec.ts --files=booking_service.spec.ts --files=session_service.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): a one-of-a-kind design is claimed at its first verified deposit or booking" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: The dashboard: one of a kind, one-tap claim and the claimed-designs setting

**Files:**
- Modify: `apps/platform/app/modules/flash/validators/flash_design.ts` (`oneOfAKind`; `claimFlashDesignValidator`), `apps/platform/app/controllers/flash_designs_controller.ts` (`claim`), `apps/platform/start/routes.ts`, `apps/platform/app/modules/tenancy/access.ts`, `apps/platform/app/controllers/artists_controller.ts` (`flashDesigns` props)
- Modify: `apps/platform/app/modules/tenancy/validators/tenant.ts` (`updateLookValidator.claimedFlash`), `apps/platform/app/modules/tenancy/services/tenancy_service.ts` (`PageLookInput.claimedFlash`, `updateLook` writes it), `apps/platform/app/controllers/page_look_controller.ts` (`look.claimedFlash`, `claimedFlashChoices`)
- Modify: `apps/platform/inertia/components/flash.ts`, `apps/platform/inertia/components/flash_tray.tsx`, `apps/platform/inertia/components/page_look.ts`, `apps/platform/inertia/pages/settings/look.tsx`
- Regenerate: `apps/platform/.adonisjs/`
- Modify (tests): `tests/isolation/cases.ts` (the claim case; the `PUT /t/:tenant/settings/look` case's body gains `claimedFlash: "show"`), `tests/functional/tenancy/role_access.spec.ts`
- Test: `tests/functional/flash/flash_http.spec.ts`, `tests/functional/tenancy/page_look_http.spec.ts` (its `BODY` gains `claimedFlash: "show"`; the page's `props.look` pin (≈line 69) gains `claimedFlash: "show"`), `tests/unit/inertia/flash_copy.spec.ts`, `tests/unit/inertia/page_look_copy.spec.ts`

**Interfaces:**
- Consumes: `setClaimed`, `FlashRuleError`, `CLAIMED_FLASH_CHOICES`, `claimedFlashOf` (Task 1).
- Produces (route): `PUT /t/:tenant/artists/flash/:id/claim` (`tenant.artists.flash.claim.update`, `MEMBERS`; body `claimed` boolean; loads first, then validates; flash "Marked claimed." or "Available again."; a repeatable design is the error flash "A design that can be tattooed again is never claimed.").
- Produces (props): `FlashDesignProps` gains `oneOfAKind: boolean` and `claimed: boolean`; the add and edit forms post `oneOfAKind` (`"1"` when ticked; missing is false). Page look: `updateLookValidator.claimedFlash: vine.enum(CLAIMED_FLASH_CHOICES)`, required like the other look fields (the form always sends it); `PageLookInput.claimedFlash`, so `updateLook` writes six look columns; the page gets `look.claimedFlash` (`claimedFlashOf(tenant)`) and `claimedFlashChoices`.
- Produces (`components/flash.ts`): `ONE_OF_A_KIND_LABEL`, `ONE_OF_A_KIND_HELP`, `MARK_CLAIMED`, `MAKE_AVAILABLE`; `designNote`'s argument gains optional `oneOfAKind?` and `claimed?` (so plan 4a's calls stand) and the note gains "One of a kind" and "Claimed". (`page_look.ts`): `CLAIMED_FLASH_WORDS`, `CLAIMED_FLASH_LEGEND`, `CLAIMED_FLASH_HELP`.

- [ ] **Step 1: Write the failing tests**

`flash_copy.spec.ts`:
```ts
assert.equal(flash.ONE_OF_A_KIND_LABEL, "One of a kind");
assert.equal(flash.ONE_OF_A_KIND_HELP, "You'll tattoo it only once. It's marked Claimed when its client's deposit is verified or their project is booked. Leave it unchecked for a design that can be tattooed again.");
assert.equal(flash.MARK_CLAIMED, "Mark claimed");
assert.equal(flash.MAKE_AVAILABLE, "Make available");
assert.equal(flash.designNote({ size: "About 3 in", priceText: "NPR 3,000", hidden: false, oneOfAKind: true, claimed: true }), "About 3 in · NPR 3,000 · One of a kind · Claimed");
assert.equal(flash.designNote({ size: "About 3 in", priceText: null, hidden: true, oneOfAKind: false, claimed: false }), "About 3 in · Hidden");
```
`page_look_copy.spec.ts`: `CLAIMED_FLASH_WORDS` has exactly the server's `CLAIMED_FLASH_CHOICES`: `show` "Show them, greyed out and marked Claimed", `hide` "Hide them"; `CLAIMED_FLASH_LEGEND` "Claimed flash designs"; `CLAIMED_FLASH_HELP` "One-of-a-kind designs that someone has claimed.".
`flash_http.spec.ts`:
- "the add and edit forms save One of a kind; unticked means it can be tattooed again".
- "Mark claimed and Make available are one tap each": `claimed` "1" then "0", with their flashes; the edit page's `claimed` follows; "a repeatable design's claim is refused with its words and nothing changes"; "an artist claims their own design; another artist's is a 404".
`page_look_http.spec.ts`: "saves the claimed flash choice; an unknown one is a field error and nothing changes"; "the page offers both choices and the stored one, show by default".
`cases.ts`: `PUT /t/:tenant/artists/flash/:id/claim` (`resource: "flashDesign"` made one of a kind in the seed, body `{ claimed: "1" }`, snapshot `flashDesignRows`); `ARTIST_ROUTES` gains its name, kept sorted.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test unit --files=flash_copy.spec.ts --files=page_look_copy.spec.ts`, `PORT=3402 pnpm test functional --files=flash_http.spec.ts --files=page_look_http.spec.ts --files=tenant_routes.spec.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** per Interfaces. `FlashTray`: the add form and the sheet gain the `ONE_OF_A_KIND_LABEL` checkbox (`name="oneOfAKind"`, `value="1"`, `ONE_OF_A_KIND_HELP`); a one-of-a-kind row gains a "Claimed" badge while claimed and one button, `MARK_CLAIMED` or `MAKE_AVAILABLE`, that sends the claim route with `router.put` (`preserveScroll`, disabled while out; focus stays on it; no `optimistic`). Page look: a "Claimed flash designs" `RadioGroup` (legend, help, the two choices) under the Sections list, its value held with `useStoredChoice` like the theme and font groups, its error under it. Run `node ace codegen`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the commands of Step 2, plus `PORT=3402 pnpm test functional --files=cross_tenant.spec.ts --files=role_access.spec.ts --files=page_look_columns.spec.ts`, `PORT=3402 pnpm test unit --files=page_look_source.spec.ts --files=tap_targets.spec.ts --files=slow_connection_source.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): one of a kind, a one-tap claim and how the studio page shows claimed flash" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: The contract, the public reads and intake know about claims

**Files:**
- Modify: `packages/types/openapi.yaml` (`FlashDesign.status`, `listFlash`'s `available`, `flash_claimed`); regenerate; `packages/sdk/test/client.test.ts`; `docs/sdk.md`
- Modify: `apps/platform/app/modules/storefront/services/studio_page_service.ts`, `apps/platform/app/modules/storefront/validators/flash.ts` (`available`), `apps/platform/app/controllers/public_flash_controller.ts`, `apps/platform/app/transformers/public_flash_design_transformer.ts`
- Modify: `apps/platform/app/modules/inquiries/errors.ts` (`flash_claimed`), `apps/platform/app/modules/inquiries/services/intake_service.ts`, `apps/platform/app/services/public_api.ts` (`ApiErrorCode`, `API_ERRORS.flash_claimed`), `apps/platform/app/controllers/public_inquiries_controller.ts`
- Test: `apps/platform/tests/functional/api/public_flash.spec.ts`, `tests/functional/api/inquiries.spec.ts`

**Interfaces:**
- Consumes: `isClaimed`, `claimedFlashOf`, `FlashFilter.withClaimed` (Task 1).
- Produces (contract): `FlashDesign.status`: enum `[available, claimed]`, required, "`claimed`: one of a kind and taken. Listed only while the studio shows claimed designs: show it greyed, marked Claimed; it is never requestable. Treat an unknown value as `claimed`."; `requestable` now also needs `available`; `listFlash` takes `available` (boolean, "`true`: only designs nobody has claimed"); `flash_claimed` (409) in `createInquiry` and `ErrorResponse`. The SDK needs no code (the query encoder takes booleans since plan 2).
- Produces (`StudioPageService`): `FlashQuery.available: boolean`; `ShownFlashDesign.status: "available" | "claimed"`; under `claimedFlashOf(tenant)` `"hide"` (or with `available`) the page and `filters.artists` leave claimed designs out, and `flashDesign` is null for a claimed design under `"hide"`.
- Produces (intake): after `flash_unavailable` and before the artist checks, a claimed design is `InquiryRuleError("flash_claimed")`, answered 409 `flash_claimed` with the message in the Global Constraints.

- [ ] **Step 1: Write the failing tests**

`public_flash.spec.ts`:
- The exact-fields test gains `status`.
- "a claimed design is listed as claimed and never requestable while the studio shows claimed designs" (its artist takes flash requests: `requestable` false).
- "with available=true, or under hide, claimed designs are in no page and no filter; under hide the design read is 404" (Review Focus 4).
`inquiries.spec.ts`: "a request for a claimed design is flash_claimed and stores nothing, under either setting"; "a request for a design claimed by hand is refused the same way".
`client.test.ts`: `flash.list({ available: true, limit: 6 })` calls `${T}/flash?available=true&limit=6`.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=public_flash.spec.ts --files=inquiries.spec.ts` and `pnpm --filter @tattoo-drip/sdk test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** per Interfaces; regenerate the types; `docs/sdk.md` adds `status`, `available` and `flash_claimed` to the flash paragraph.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the commands of Step 2, plus `--files=public_api.spec.ts --files=api_routes.spec.ts --files=errors.spec.ts`, `pnpm --filter @tattoo-drip/react test`, and `pnpm typecheck` (root)
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add packages docs/sdk.md apps/platform
git commit -m "feat(types): a flash design's status, the available filter and flash_claimed" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: "Design taken" on requests and projects, and the warnings

**Files:**
- Modify: `apps/platform/app/modules/flash/flash_card.ts` (`oneOfAKind`, `claim`), `apps/platform/app/controllers/inquiries_controller.ts`, `apps/platform/app/controllers/projects_controller.ts`
- Modify: `apps/platform/inertia/components/flash.ts`, `inquiries.ts`, `projects.ts`, `flash_design_card.tsx`, `quote_card.tsx` (`QuoteForm`, in the first-quote form and `RevisePanel`), `deposit_panel.tsx`, `payments_card.tsx` (`PendingProof`'s verify `ConfirmPanel`), `next_step_card.tsx` (passes `designTaken` to what it draws), `apps/platform/inertia/pages/inquiries/index.tsx`, `inquiries/show.tsx`, `projects/show.tsx`
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts`, `tests/functional/projects/project_page.spec.ts`, `tests/unit/inertia/flash_copy.spec.ts`

**Interfaces:**
- Consumes: `claimStateOf`, `ClaimState` (Task 1); `CLOSED_STATUSES` (`#modules/projects/moves`).
- Produces (props): `FlashCardProps` gains `oneOfAKind: boolean` and `claim: ClaimState` (`flashCard(images, tenant, design, artistName, at: { projectId: string | null; open: boolean })`: an inquiry passes `projectId` null and `open` = status `new`; a project its id and `open` = not in `CLOSED_STATUSES`); an inbox row's `flash` gains `taken: boolean`.
- Produces (`components/flash.ts`): `TAKEN_LABEL = "Design taken: offer something similar"`, `CLAIMED_HERE = "Claimed for this client"`, `QUOTE_TAKEN_WARNING = "This design is already claimed by another client. Talk to this client about something similar before you send a price."`, `LINK_TAKEN_QUESTION = "This design is already claimed by another client. Make a deposit link anyway?"`, `LINK_TAKEN_CONFIRM = "Make the link anyway"`, `LINK_TAKEN_KEEP = "Not yet"`, `VERIFY_TAKEN_NOTE = "This design is already claimed by another client: talk to this client before you verify."`.
- Produces (UI): `designTaken = flash?.claim === "taken"` in `projects/show.tsx`, passed to every place that draws the quote form, the deposit link button or Verify (their own cards and the Next step card): the quote form shows `QUOTE_TAKEN_WARNING` (with an `aria-hidden` warning icon) right above its submit; the first "Make deposit link", a plain button today, asks through `InlineConfirm` while the design is taken (`LINK_TAKEN_QUESTION`, `LINK_TAKEN_CONFIRM`, `LINK_TAKEN_KEEP`; outside any sheet) and "New link"'s existing question starts with the same first sentence; the verify `ConfirmPanel`'s question starts with `VERIFY_TAKEN_NOTE`. `FlashDesignCard` shows `TAKEN_LABEL` as a badge for `taken` and `CLAIMED_HERE` for `here`; the inbox row shows `TAKEN_LABEL` under "Flash: {name}".

- [ ] **Step 1: Write the failing tests**

`inbox.spec.ts`: "a new request for a claimed design is marked taken, a decided one is not": the row's `flash.taken` and the page's `flash.claim` are `true` / `"taken"` for a `new` inquiry and `false` / `"none"` once declined; an unclaimed design gives `false` / `"none"`.
`project_page.spec.ts` (functional, Review Focus 1): "the claiming project shows 'here'; another open project for the design 'taken'; a closed one 'none'; a repeatable design 'none'" (`flash.claim` for each, to the owner and the assigned artist; `props.project` unchanged).
`flash_copy.spec.ts`: the seven words above, exactly.

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=project_page.spec.ts` and `PORT=3402 pnpm test unit --files=flash_copy.spec.ts`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** per Interfaces. No server write changes: the warnings are on the page only, and every action still goes through as before. No `optimistic`, no `window.confirm`; the pages' contact recording stays as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the commands of Step 2, plus `PORT=3402 pnpm test unit --files=inline_confirms_source.spec.ts --files=slow_connection_source.spec.ts --files=next_step.spec.ts --files=project_page.spec.ts`, `PORT=3402 pnpm test functional --files=next_step_agreement.spec.ts --files=page_affordances.spec.ts`, and `pnpm typecheck`
Expected: PASS and clean. The warnings are checked in Task 7's browser pass.

- [ ] **Step 5: Commit**

```bash
git add apps/platform
git commit -m "feat(platform): mark taken designs on requests and projects, and warn before price, link or verify" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6: The storefront greys claimed designs and offers "something similar"

**Files:**
- Modify: `apps/storefront/src/studio/flash.ts` (`FlashDesignView.claimed`, `FlashRequestView.claimed`), `src/studio/copy.ts`, `src/studio/loaders.ts` (the home read, `requestPageData`), `src/studio/components/flash.tsx` (`FlashGrid`, `FlashSummary`), `src/studio/components/pages.tsx` (`FlashDesignPage`), `src/studio/inquiry.ts` (`similarInquiryState`), `src/styles.css`, `scripts/check-page.mjs` (the home page's flash read becomes `/flash?available=true&limit=6`)
- Modify: `apps/storefront/src/intake/problems.ts`, `src/intake/copy.ts`
- Test: `apps/storefront/test/studio/flash.test.ts`, `fixtures.ts`, `render.test.ts`, `loaders.test.ts` (the studio page's `/flash?limit=6` pins become `/flash?available=true&limit=6`), `inquiry.test.ts`, `test/intake/problems.test.ts`, `copy.test.ts`

**Interfaces:**
- Consumes: the public `status` and `available` (Task 4); plan 4a's request page.
- Produces: `FlashDesignView.claimed: boolean` (`status` other than `"available"` is claimed; a missing `status`, from an older API, is not); `closedNoteFor` is null for a claimed design (the "Claimed" badge says it). `FlashRequestView` gains `{ kind: "claimed"; design: FlashDesignView }`, which `requestPageData` gives for a found claimed design whose artist is in the list (checked before `requestable`), with `similarInquiryState` as its inquiry and the chat subject "the {name} flash". The design page's Status reads "Claimed". `similarInquiryState(studio: StudioView, design: FlashDesignView, artist: ArtistView, artists: readonly ArtistView[]): InquiryState`: while the artist takes new work, open for them with `start` `{ idea: "Something similar to the {name} flash", approximateSize: design.size }` and no `flashDesignId`; otherwise `inquiryState(studio, artists, artist)`. `loadStudioPage` reads `{ available: true, limit: HOME_FLASH_COUNT }` (still only when the sections include `flash`). `NOTICE_CODES` gain `"flash-claimed"`; `flash_claimed` gives that notice with `contact: true`.

- [ ] **Step 1: Write the failing tests**

`flash.test.ts`: "status claimed makes the design claimed; a missing status does not"; "closedNoteFor is null for a claimed design".
`render.test.ts`:
- "a claimed design shows greyed, marked Claimed, still linking to its page" (`flash-card-claimed`, a `Claimed` badge).
- "the design page of a claimed design says Claimed and offers something similar": no "Request this design"; `<a … href="/request?flash=<id>">Ask for something similar</a>` while the artist takes new work; when the artist doesn't but the studio does, `href="/request"` "Send your idea"; when neither, no request link.
- "a claimed design on the request page asks the artist for something similar": the summary marked Claimed with `claimedNote`; the h1 is "Send your idea"; the fallback names `Something similar to the Moth flash`; no `flashDesignId` in the open state.
`loaders.test.ts`: "the studio page asks for available designs only" (a URL ending `/flash?available=true&limit=6`); "a claimed design's request page is the similar request; under hide (a 404) it is the general form with the gone note" (Review Focus 4).
`inquiry.test.ts`: `similarInquiryState` for an artist taking new work (open, `start.idea` "Something similar to the Moth flash", no `flashDesignId`) and for one whose books are closed (artist-closed with their words).
`problems.test.ts`: `flash_claimed` gives the notice `flash-claimed` with `contact: true`. `copy.test.ts`: the new notice has copy.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement** per Interfaces and the Global Constraints' copy; CSS for `.flash-card-claimed` and the badge with the theme's tokens only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @tattoo-drip/storefront test`, `pnpm --filter @tattoo-drip/storefront typecheck`, `pnpm --filter @tattoo-drip/storefront build`, `pnpm --filter @tattoo-drip/storefront check:page`
Expected: PASS and clean; the default-theme snapshot unchanged; "Page check passed".

- [ ] **Step 5: Commit**

```bash
git add apps/storefront
git commit -m "feat(storefront): claimed flash shows greyed, and its request becomes something similar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Docs, whole-branch checks and the browser pass

**Files:**
- Modify: `apps/platform/docs/backend.md` (Flash: one of a kind, `claimFlashFor` and its two callers, no automatic release, the setting; Public API: `status`, `available`, hide; Intake: `flash_claimed`; Page look: six columns), `apps/platform/database/README.md` (the claim checks and `flash_designs_claimed_project_fk`), `apps/platform/docs/ui.md` (the one-of-a-kind box, the claim button, the "Design taken" label, the three warnings; Page look: claimed flash designs), `apps/storefront/docs/development.md` (claimed designs, "Ask for something similar", the home's `available=true`), `docs/data-model.md` (FlashDesign: one of a kind, claimed when and by what, released by hand), `docs/requirements.md` (the flash line from plan 4a gains one of a kind and the claim).

- [ ] **Step 1: Update the docs** in the files above, one to three sentences each, in the existing voice.

- [ ] **Step 2: Run the root gates** as plan 4a's Task 11 Step 2 (the full platform suite under `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock`).
Expected: all clean; `Tests N passed`; "Page check passed".

- [ ] **Step 3: Browser pass** (servers and Playwright as in plan 4a, both widths, light and dark): mark a design one of a kind; send two flash requests for it from two phone numbers and accept both; on the first project issue a quote and verify a deposit screenshot: the design shows Claimed in the dashboard and greyed "Claimed" on `/flash` (gone from the home's Flash section); the second inquiry or project shows "Design taken: offer something similar", its quote form shows the warning, "Make deposit link" asks first, Verify's panel says so; nothing changed status; `/request?flash=<id>` now asks for "something similar"; a third request sent from a page loaded before the claim shows the notice; switch Page look to hide claimed designs: gone from `/flash`, its page is the not-found, its request page the general form with the note; tap "Make available": it is requestable again everywhere; on another one-of-a-kind design, "Mark claimed" by hand. Stop both servers by their exact PIDs.

- [ ] **Step 4: Commit**

```bash
git add docs apps/platform/docs apps/platform/database/README.md apps/storefront/docs
git commit -m "docs: one-of-a-kind flash, claiming and the claimed warnings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Tear down**

Leave `tattoo_drip_site` in place; delete scratch files; stop every process this plan started; `git status` clean.
