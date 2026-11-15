# Platform Admin Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` pages (Studios, studio page, Reports, Metrics, Accounts) that do what the Discover, reviews, `account:verify` and `metrics:pilot` shell commands do.

**Architecture:** Thin controllers under the existing `/admin` route group (auth → dbContext → platformAdmin) call the same services the commands call. Cross-tenant listing uses a new SECURITY DEFINER function `live_tenants()` (ids only), then each studio is read in its own `withDbContext({ tenantId })`. No request uses the `owner` connection.

**Tech Stack:** AdonisJS 7, Lucid/PostgreSQL, VineJS, Inertia + React, shadcn, Japa.

**Spec:** `docs/superpowers/specs/2026-11-15-platform-admin-pages-design.md` (read it first; this plan argues from it).

## Global Constraints

- Work from `apps/platform`. Read `docs/backend.md`, `database/README.md`, `docs/ui.md` and `docs/testing.md` before the tasks that touch those areas.
- Every new route goes in the existing `/admin` group in `start/routes.ts` (`.use([middleware.auth(), middleware.dbContext(), middleware.platformAdmin()])`), and in the `SIGNED_IN` list of `tests/functional/identity/account_routes.spec.ts`.
- The test admin is `admin@platform.example` (`.env.test` `PLATFORM_ADMIN_EMAILS`), created with `emailVerifiedAt: DateTime.utc()`, as in `tests/functional/billing/billing.spec.ts:426`.
- After any route/page/controller change: `node ace codegen`, then `pnpm typecheck`; commit the regenerated `.adonisjs/` files with the change.
- Never edit `database/schema.ts`; new migration + `pnpm migrate`.
- Validation limits, verbatim from the commands: Discover reason trimmed, 1–500 characters, required. Review takedown `reason` ∈ `TAKEDOWN_REASONS`; `note` optional, trimmed, empty → null, at most `MAX_TAKEDOWN_NOTE_LENGTH` (500) characters counted with `Array.from`. Metrics `days` a whole number 1–3650, default `GATE_DAYS` (42).
- Service errors become an error flash with the error's message, never a 500: `OperatorTargetError` (publication), `ReviewOperatorError` (reviews), `ImageDeleteError` (post takedown: "Storage couldn't delete the post's public copies, so nothing changed. Try again once storage recovers.").
- Success flash wording reuses the commands' sentences (see each command in `commands/`).
- Dates on admin pages are UTC (`yyyy-MM-dd HH:mm 'UTC'`), like Billing/Payments.
- Studio- or client-typed text is rendered as plain React text; no `dangerouslySetInnerHTML` in `inertia/pages/admin/`.
- Every action route is `POST` and redirects back (`ctx.response.redirect().back()`) with a flash.
- Conventional Commits with the `platform` scope.

## Review Focus

1. **A photo id from another studio** posted under studio A's slug must change nothing and flash an error (the service's `lockPhoto` refuses it); test in Task 5.
2. **Stale page / double submit**: taking down something already taken down, restoring something not taken down, dismissing a closed report → error flash from the service, page still loads; tests in Tasks 5 and 6.
3. **An old slug or a deleted studio's slug** on `/admin/studios/:slug`: an old slug 302s to the current slug's page; a deleted or unknown one is 404; test in Task 4.
4. **Post takedown while storage can't delete** (`failDeletes` helper): error flash, post unchanged; test in Task 6.
5. **Bad `days`** (`0`, `3651`, `abc`, `1.5`) on Metrics → validation error flash and the page renders with the default 42, not a 500; test in Task 7.

---

### Task 1: `live_tenants()` database function

**Files:**
- Create: `database/migrations/1792010000000_create_live_tenants_function.ts`
- Test: `tests/functional/admin/live_tenants.spec.ts`

**Interfaces:**
- Produces: SQL `public.live_tenants() returns table (tenant_id uuid)` — every tenant with `deleted_at is null`, granted to the app role. Order isn't guaranteed; callers sort.

- [ ] **Step 1: Write the failing test** (pattern: `tests/functional/reviews/open_review_reports.spec.ts`, using `sql({}, …)` and `twoStudios()`, inside `wrapInGlobalTransaction`)

```ts
test("lists every live studio's id to the app role, which sees no tenant row itself", async ({ assert }) => {
	const { a, b } = await twoStudios();
	const { rows: seen } = await sql({}, "select count(*)::int as n from tenants");
	assert.equal(seen[0].n, 0);
	const { rows } = await sql({}, "select tenant_id from public.live_tenants()");
	const ids = rows.map((r: { tenant_id: string }) => r.tenant_id);
	assert.includeMembers(ids, [a.tenant.id, b.tenant.id]);
});

test("leaves out a deleted studio", async ({ assert }) => {
	const { a, b } = await twoStudios();
	await inTenant(b.tenant, () => Tenant.query().where("id", b.tenant.id).update({ deleted_at: new Date() }));
	const ids = (await sql({}, "select tenant_id from public.live_tenants()")).rows.map((r: { tenant_id: string }) => r.tenant_id);
	assert.include(ids, a.tenant.id);
	assert.notInclude(ids, b.tenant.id);
});
```

(If soft-deleting a tenant needs another path in the helpers, use whatever `open_review_reports.spec.ts`'s "deleted studio" case uses.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test functional --files=live_tenants.spec.ts`
Expected: FAIL, `function public.live_tenants() does not exist`.

- [ ] **Step 3: Write the migration**

Copy the shape of `billing_tenants()` in `database/migrations/1791950000002_create_payment_lookup_functions.ts`: `language sql stable security definer`, `set search_path = pg_catalog, pg_temp`, `begin atomic … end`, `revoke all … from public`, `grant execute … to ${appRole}`; `down()` drops it. Body: `select t.id from public.tenants t where t.deleted_at is null;`. Doc comment: ids only, for the admin's Studios and Metrics pages, each studio then read in its own context.

- [ ] **Step 4: Migrate and run the test**

Run: `pnpm migrate && pnpm test functional --files=live_tenants.spec.ts`
Expected: PASS. `database/schema.ts` unchanged (functions don't regenerate it); if it changed, keep the regenerated file.

- [ ] **Step 5: Commit**

`git commit -m "feat(platform): add the live_tenants() listing for the admin pages"`

---

### Task 2: Admin shell (redirect, menu link, sub-nav)

**Files:**
- Modify: `start/routes.ts` (the `/admin` group, ~line 891)
- Modify: `app/middleware/inertia_middleware.ts` (shared data, ~line 146)
- Modify: `inertia/components/shell/account_menu.tsx`
- Create: `inertia/components/admin_nav.tsx`
- Modify: `inertia/pages/admin/billing.tsx`, `inertia/pages/admin/payments.tsx` (use `AdminNav` in place of their cross-links)
- Modify: `inertia/components/shell/breadcrumbs.ts`
- Modify: the shared-props type (wherever `user`/`tenant` shared props are typed for pages; find with `rg -n "tenants\?:" inertia/types* inertia -g '*.ts'`)
- Test: `tests/functional/admin/admin_shell.spec.ts`, `tests/functional/identity/account_routes.spec.ts`

**Interfaces:**
- Produces: route `GET /admin` named `admin.index` → 302 to `admin.studios`. Shared Inertia prop `platformAdmin: boolean` (`isPlatformAdmin(user)` when signed in, else `false`). Component `AdminNav({ current }: { current: "studios" | "reports" | "metrics" | "accounts" | "billing" | "payments" })` rendering links to `admin.studios`, `admin.reports`, `admin.metrics`, `admin.accounts`, `admin.billing`, `admin.payments`.
- Breadcrumb labels: `admin/studios` "Studios", `admin/reports` "Review reports", `admin/metrics` "Pilot metrics", `admin/accounts` "Accounts".

`AdminNav` links to routes that Tasks 4, 6, 7 and 8 create. Don't add placeholder routes for them; give `AdminNav` plain `href` strings (`/admin/studios`, …) so it compiles now, and switch to `urlFor` in Task 9.

- [ ] **Step 1: Write the failing tests**

```ts
test("GET /admin sends the admin to Studios and anyone else to a 404", async ({ client }) => {
	const { owner } = await studioWithOwner("adm-shell", "Shell Ink");
	const admin = await adminUser(); // User.create admin@platform.example, verified
	(await client.get("/admin").loginAs(owner)).assertStatus(404);
	(await client.get("/admin").loginAs(admin).redirects(0)).assertRedirectsTo("/admin/studios");
});

test("only the admin's pages carry platformAdmin: true", async ({ client, assert }) => {
	const { owner, tenant } = await studioWithOwner("adm-flag", "Flag Ink");
	const page = await client.get(`/t/${tenant.slug}/today`).loginAs(owner).withInertia();
	assert.isFalse(page.inertiaProps.platformAdmin);
	const adminPage = await client.get("/admin/billing").loginAs(await adminUser()).withInertia();
	assert.isTrue(adminPage.inertiaProps.platformAdmin);
});
```

Put `adminUser()` in `tests/helpers/admin.ts` (`export async function adminUser(): Promise<User>`); later tasks use it. Add `"GET /admin"` to `SIGNED_IN` in `account_routes.spec.ts`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test functional --files=admin_shell.spec.ts`
Expected: FAIL (404 for the admin on `/admin`; `platformAdmin` undefined).

- [ ] **Step 3: Implement**

`router.get("/", …).as("admin.index")` in the group redirecting to `admin.studios` by path (`/admin/studios`) until that route exists. Shared prop via `ctx.inertia.always`. Account menu: an "Admin" link to `/admin` shown only when `platformAdmin` is true. `AdminNav` as a small row of links, current one marked `aria-current="page"`.

- [ ] **Step 4: Run tests, codegen, typecheck**

Run: `pnpm test functional --files=admin_shell.spec.ts --files=account_routes.spec.ts && node ace codegen && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

`git commit -m "feat(platform): reach the admin pages from the account menu"`

---

### Task 3: Operator reads for the studio page

**Files:**
- Modify: `app/modules/discovery/services/publication_service.ts` (beside `operatorStatus`)
- Modify: `app/modules/reviews/services/review_operator_service.ts` (beside `openReports`; also update its doc comment: the admin pages use it as well as the commands; a request never uses the owner connection)
- Test: `tests/functional/discover/publication_controls.spec.ts` (new group "operator photos"), `tests/functional/reviews/review_operator.spec.ts` (new group "studio items")

**Interfaces:**
- Produces:

```ts
// publication_service.ts
export type OperatorPhoto = {
	id: string;
	artistId: string;
	artistName: string;
	imageKey: string;            // stillKey(photo), ready for ImageService.urlFor
	takedown: { at: DateTime; note: string | null } | null;
};
async operatorPhotos(slug: string): Promise<OperatorPhoto[]>
// every live (not deleted) work photo of the studio's live artists, via asOperator(slug);
// taken-down first (newest takedown first), then by artist name, then newest photo first.

// review_operator_service.ts
export type OperatorItem = {
	kind: TakedownKind;          // "review" | "reply" | "post"
	id: string;                  // the review's id for review and reply, the post's id for post
	at: DateTime;                // when written/published
	shownName: string;
	rating: number | null;       // null for a post
	excerpt: string;             // excerpt(text, 200) from #modules/notifications/alerts
	takedown: { at: DateTime; reason: TakedownReason; note: string | null } | null;
};
async studioItems(tenantId: string, live: { limit: number }): Promise<{ takenDown: OperatorItem[]; live: OperatorItem[] }>
// in withDbContext({ tenantId }): takenDown = every review, reply (replyTakenDownAt etc.) and post
// with a TattooDrip takedown, newest takedown first; live = reviews (each a "review" item, plus a
// "reply" item when it has a reply not taken down) and published posts not taken down, newest first,
// at most `limit` items. Deleted rows left out of both.
```

- [ ] **Step 1: Write the failing tests**

- `operatorPhotos`: a studio with two photos, one suspended via `suspendPhoto` → returns both, suspended first with its note; another studio's photos never appear; unknown slug throws `OperatorTargetError`.
- `studioItems`: using `twoStudios()` (`a.clientReview`, `a.freshInkPost`): before any takedown, `live` contains a `review` item for `a.clientReview.id` and a `post` item for `a.freshInkPost.id`, `takenDown` is empty; after `operator.takedown("review", a.clientReview.id, "hate", "note")`, the review is in `takenDown` with `reason: "hate"`, `note: "note"`, and not in `live`; nothing from `b` appears; `limit: 1` returns one live item.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test functional --files=publication_controls.spec.ts --files=review_operator.spec.ts`
Expected: FAIL, methods not defined.

- [ ] **Step 3: Implement both methods** with the signatures above, using model queries in the tenant context (row-level security keeps them to the studio).

- [ ] **Step 4: Run the tests**

Expected: PASS, including the existing cases in both files.

- [ ] **Step 5: Commit**

`git commit -m "feat(platform): give operators a studio's photos and reviews to act on"`

---

### Task 4: Studios list and studio page (read-only)

**Files:**
- Create: `app/controllers/admin_studios_controller.ts`
- Create: `inertia/pages/admin/studios/index.tsx`, `inertia/pages/admin/studios/show.tsx`
- Modify: `start/routes.ts`, `tests/functional/identity/account_routes.spec.ts`
- Test: `tests/functional/admin/admin_studios.spec.ts`

**Interfaces:**
- Consumes: `live_tenants()` (Task 1), `operatorPhotos`, `studioItems` (Task 3), existing `PublicationService.operatorStatus`, `PublicationService.overview`, `ReviewOperatorService.openReports`, `TenancyService.tenantIdForSlug`, `ImageService.urlFor("artist_work_photo", key, tenant, THUMBNAIL_WIDTH)`.
- Produces: routes `GET /admin/studios` (`admin.studios`), `GET /admin/studios/:slug` (`admin.studios.show`). Props:

```ts
// index
{ studios: { slug: string; name: string; type: "studio" | "independent"; discoverStatus: string; takenDown: boolean; openReports: number }[] }
// show
{
	studio: { slug: string; name: string };
	discover: { status: string; optedIn: boolean; publiclyVisible: boolean; takedown: { atText: string; note: string | null } | null };
	photos: { id: string; artistName: string; thumbnailUrl: string; takedown: { atText: string; note: string | null } | null }[];
	takenDown: (OperatorItem-as-props with atText strings)[];
	live: (same)[];
	reports: { reviewId: string; reportedText: string; reason: string; note: string | null; rating: number | null; shownName: string; body: string }[];
	takedownReasons: readonly string[];  // TAKEDOWN_REASONS
}
```

Live items limit: 20 by default, `?more=1` raises it to 200 (the "show more" link).

- [ ] **Step 1: Write the failing tests**

- Owner of a studio → 404 on both routes; admin → 200.
- Index lists `twoStudios()`' both studios with name, slug and `openReports` (1 after reporting `a.clientReview` as in `open_review_reports.spec.ts`'s `report()`), oldest first.
- Show for `a`: `discover.status` equals `operatorStatus(a slug).status`; `photos` includes `a.workPhoto.id` with a `thumbnailUrl`; `live` includes `a.clientReview.id`; no id from `b` anywhere in the props.
- Old slug: change `a`'s slug through the existing slug service (as `studio_slug` tests do) → `GET /admin/studios/<old>` 302s to `/admin/studios/<new>`.
- Unknown slug and a deleted studio's slug → 404.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm test functional --files=admin_studios.spec.ts`
Expected: FAIL (404 for the admin: no route).

- [ ] **Step 3: Implement the controller and pages**

`index`: ids from `live_tenants()`, each studio's row read in `withDbContext({ tenantId })` (Tenant + `overview`), open-report counts by grouping `openReports()` by `tenantId`; sort by `createdAt`, then id. Browser-side text filter on name/slug. `show`: `tenantIdForSlug(slug)` → null ⇒ 404 (`E_ROUTE_NOT_FOUND`); read the tenant in context; if `tenant.slug !== slug` redirect to the current slug; then gather the props. Page sections in the spec's order (Discover listing, Photos, Reviews and Fresh ink, Open reports), buttons rendered but posting to the routes Tasks 5–6 add (forms may 404 until then; that's fine within the branch). Add both routes to `SIGNED_IN`.

- [ ] **Step 4: Run tests, codegen, typecheck**

Run: `pnpm test functional --files=admin_studios.spec.ts --files=account_routes.spec.ts && node ace codegen && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(platform): list studios and show one studio's moderation state to the admin"`

---

### Task 5: Discover takedown actions

**Files:**
- Modify: `app/controllers/admin_studios_controller.ts`, `start/routes.ts`, `account_routes.spec.ts`
- Create: `app/validators/admin.ts` (or `app/modules/discovery/validators/operator.ts` if module validators are the convention there; check `docs/backend.md`)
- Test: `tests/functional/admin/admin_discover_actions.spec.ts`

**Interfaces:**
- Consumes: `PublicationService.{suspendStudio, restoreStudio, suspendPhoto, restorePhoto, operatorStatus}`.
- Produces: `POST /admin/studios/:slug/discover/suspend` (`admin.studios.discover.suspend`, body `reason`), `POST /admin/studios/:slug/discover/restore` (`admin.studios.discover.restore`), `POST /admin/studios/:slug/photos/:photo/suspend` (`admin.studios.photos.suspend`, body `reason`), `POST /admin/studios/:slug/photos/:photo/restore` (`admin.studios.photos.restore`). Validator `discoverReasonValidator` (`reason`: trimmed string, 1–500).

Flashes (success): studio suspend "The listing is off Discover. The studio page and bookings are unchanged. Public caches can keep it for up to two minutes."; photo suspend "The photo is off Discover. It stays on the studio page. Public caches can keep it for up to two minutes."; restore "Takedown lifted. The listing is now: {status}" + " (the owner's listing is off)" when `!optedIn`.

- [ ] **Step 1: Write the failing tests** (seed a listed studio with `listThroughDashboard` / `studio()` from `publication_controls.spec.ts`; move them into `tests/helpers/discover.ts` if they aren't exported)

- Admin suspends the listing with reason "Copyright complaint #12" → 302, success flash; `publicStatus(client, …)` shows it gone from the public Discover API; `operatorStatus` has the takedown note. Restore → back in the API.
- Photo suspend/restore round trip, checked with `operatorStatus(...).removedPhotos`.
- Empty reason, whitespace reason, 501-character reason → validation error, nothing changed.
- **Review Focus 1:** studio `b`'s photo id under `a`'s slug → error flash, `b`'s photo not suspended.
- **Review Focus 2:** restore when there's no takedown → error flash (or success with unchanged status if the service treats it as a no-op; assert whichever the service does, and no 500).
- Owner of the studio → 404 on all four.

- [ ] **Step 2: Run them to verify they fail** — `pnpm test functional --files=admin_discover_actions.spec.ts`; FAIL (404).

- [ ] **Step 3: Implement** the four actions; catch `OperatorTargetError` → error flash. Wire the studio page's buttons (takedown reason in a small form or dialog, builder's choice).

- [ ] **Step 4: Run tests, codegen, typecheck** — same commands as Task 4 with this spec file; PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(platform): take a studio or photo off Discover from the admin pages"`

---

### Task 6: Reports page and review/post actions

**Files:**
- Create: `app/controllers/admin_reviews_controller.ts`, `inertia/pages/admin/reports.tsx`
- Modify: `app/validators/admin.ts`, `start/routes.ts`, `account_routes.spec.ts`, `inertia/pages/admin/studios/show.tsx` (wire its review/post buttons)
- Test: `tests/functional/admin/admin_reviews.spec.ts`

**Interfaces:**
- Consumes: `ReviewOperatorService.{openReports, takedown, restore, dismiss}`, `TAKEDOWN_REASONS`, `REPORT_LABELS`, `MAX_TAKEDOWN_NOTE_LENGTH`, `ImageDeleteError`.
- Produces: `GET /admin/reports` (`admin.reports`), and POST routes:
  - `/admin/reviews/:id/takedown` (`admin.reviews.takedown`), `/admin/reviews/:id/restore` (`admin.reviews.restore`), `/admin/reviews/:id/dismiss` (`admin.reviews.dismiss`)
  - `/admin/reviews/:id/reply/takedown` (`admin.reviews.reply.takedown`), `/admin/reviews/:id/reply/restore` (`admin.reviews.reply.restore`)
  - `/admin/posts/:id/takedown` (`admin.posts.takedown`), `/admin/posts/:id/restore` (`admin.posts.restore`)
  - Validator `takedownValidator`: `reason` enum `TAKEDOWN_REASONS`, `note` optional string trimmed, ≤ 500 code points, empty → null.
- Reports props: `{ reports: { studioSlug; studioName; reviewId; reportedText; reason; reasonLabel; note; rating; shownName; body }[]; takedownReasons: readonly string[] }`, oldest first. The takedown form defaults `reason` to the report's reason.

Flashes: takedown "The {kind} is off every public surface." (post: "The post is off every public surface and its public copies are deleted."); restore "Takedown lifted. The {kind} follows the client's and the studio's choices again."; dismiss "Report closed. The review stays up."

- [ ] **Step 1: Write the failing tests** (mirror `review_operator.spec.ts`, which already checks each effect for the commands; reuse its `reviewOf` and the client page check with `TAKEDOWN_SENTENCES`)

- Reports page lists `a`'s and `b`'s reported reviews with studio names; owner → 404.
- Take down `a.clientReview` with reason `hate`, note "Report #12" → 302 + flash; review taken down with that reason/note; report closed (gone from `openReports`).
- Dismiss → report closed, review still live.
- Restore review → live again.
- Reply takedown/restore on a review with a reply (seed the reply as `review_operator.spec.ts` does).
- Post takedown/restore on `a.freshInkPost`.
- Validation: unknown reason, 501-character note, non-uuid id → refused, nothing changed.
- **Review Focus 2:** dismiss an already-closed report; take down an already-taken-down review → error flash, no 500.
- **Review Focus 4:** `failDeletes` around a post takedown → error flash with the storage sentence; post unchanged.

- [ ] **Step 2: Run them to verify they fail** — `pnpm test functional --files=admin_reviews.spec.ts`; FAIL (404).

- [ ] **Step 3: Implement** the controller (catch `ReviewOperatorError`, `ImageDeleteError`), the Reports page (each row: studio linked to `admin.studios.show`, *Take down* form, *Keep it up* button), and wire the studio page's review/reply/post buttons.

- [ ] **Step 4: Run tests, codegen, typecheck**; PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(platform): moderate review reports and takedowns from the admin pages"`

---

### Task 7: Metrics page

**Files:**
- Create: `app/controllers/admin_metrics_controller.ts`, `inertia/pages/admin/metrics.tsx`
- Modify: `start/routes.ts`, `account_routes.spec.ts`
- Test: `tests/functional/admin/admin_metrics.spec.ts`

**Interfaces:**
- Consumes: `live_tenants()`, `PilotMetricsService.forStudio(studio, window)`, `lastDays`, `combineFacts`, `pilotTiles`, `GATE_DAYS` (`#modules/reports/pilot_metrics`), `inertia/components/pilot_metrics_card.tsx` (reuse its tile rendering; extract a presentational piece if it's coupled to the studio card).
- Produces: `GET /admin/metrics?days=` (`admin.metrics`). Props: `{ days: number; fromText: string; toText: string; studios: { slug: string; name: string; tiles: PilotTile[] }[]; total: { count: number; tiles: PilotTile[] } }`.

- [ ] **Step 1: Write the failing tests**

- With `twoStudios()`, the admin's page for `days=42` has both studios, and each studio's tiles equal `pilotTiles(await inTenant(t, () => service.forStudio(t, lastDays(42))))`; `total.tiles` equal `pilotTiles(combineFacts([...]))` over the listed studios (filter to the test's studios as `pilot_metrics_command.spec.ts` does, since the dev database may hold others).
- No `days` → `days: 42`.
- **Review Focus 5:** `days=0`, `3651`, `abc`, `1.5` → error flash and `days: 42`, status 200 (render with the default rather than redirect loop).
- Owner → 404.

- [ ] **Step 2: Run them to verify they fail**; FAIL (404).

- [ ] **Step 3: Implement**: each studio in `withDbContext({ tenantId })`, studios sorted oldest first; a day-range input (number field, submit) on the page.

- [ ] **Step 4: Run tests, codegen, typecheck**; PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(platform): show the pilot metrics on an admin page"`

---

### Task 8: Accounts page

**Files:**
- Create: `app/controllers/admin_accounts_controller.ts`, `inertia/pages/admin/accounts.tsx`
- Modify: `app/validators/admin.ts`, `start/routes.ts`, `account_routes.spec.ts`
- Test: `tests/functional/admin/admin_accounts.spec.ts`

**Interfaces:**
- Consumes: `AccountService.markVerified(email): Promise<"unknown" | "already" | "confirmed">`.
- Produces: `GET /admin/accounts` (`admin.accounts`), `POST /admin/accounts/verify` (`admin.accounts.verify`, body `email`: trimmed email). Flashes: `unknown` → error "No account uses that address."; `already` → "That address is already confirmed."; `confirmed` → "Confirmed. The account can now set up a studio." Page copy: "Confirm an address only after checking who is asking some other way, in person or by phone: this skips the proof the confirmation link gives."

- [ ] **Step 1: Write the failing tests** (mirror `verify_account_command.spec.ts`): unconfirmed user → confirmed + flash, and their pending confirmation token revoked; already confirmed → info flash; unknown → error flash; mixed-case address matches (canonicalised by the service); owner → 404.

- [ ] **Step 2: Run them to verify they fail**; FAIL (404).

- [ ] **Step 3: Implement** controller + page.

- [ ] **Step 4: Run tests, codegen, typecheck**; PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(platform): confirm an account's address from the admin pages"`

---

### Task 9: Nav links, docs and full checks

**Files:**
- Modify: `inertia/components/admin_nav.tsx` (plain hrefs → `urlFor("admin.studios")` etc.), `start/routes.ts` (`admin.index` redirect via `toRoute("admin.studios")`)
- Modify: `docs/discover/publication-controls.md` (operator row in the table at line 15; "Takedowns (operators)" section; drop "No moderation UI beyond the three commands, by design" at line 106), `apps/platform/docs/deploy.md` (lines 40–41: confirm from `/admin/accounts`, the command remains), the TAT-70 pilot metrics spec's ruling 11 (`rg -ln "TAT-70" docs/superpowers/specs`; add a dated note that the admin Metrics page now exists, keeping "never the owner connection from a request")
- Modify: each replaced command's doc comment in `commands/` — one line naming its page.

- [ ] **Step 1: Swap the hrefs and the redirect to named routes; codegen; typecheck**

Run: `node ace codegen && pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Update the docs and comments listed above.**

- [ ] **Step 3: Confirm the anti-goal greps are empty**

Run: `rg -n "dangerouslySetInnerHTML" inertia/pages/admin inertia/components/admin_nav.tsx; rg -n "connection\\(\"owner\"\\)" app/controllers`
Expected: no output.

- [ ] **Step 4: Run the gates**

Run: `pnpm check && pnpm typecheck && pnpm test functional --files=admin` then, from the repo root, `pnpm check && pnpm typecheck && pnpm build`.
Expected: all pass; also re-run `--files=account_routes.spec.ts --files=publication_controls.spec.ts --files=review_operator.spec.ts --files=verify_account_command.spec.ts --files=pilot_metrics_command.spec.ts` to confirm the commands still work.

- [ ] **Step 5: Look at the pages**

Start `pnpm dev`, sign in as an admin address listed in your local `PLATFORM_ADMIN_EMAILS`, and click through Studios → a studio → take a photo down and back; Reports; Metrics; Accounts. Screenshot each for the PR.

- [ ] **Step 6: Commit** — `git commit -m "docs(platform): describe the admin pages beside the operator commands"`
