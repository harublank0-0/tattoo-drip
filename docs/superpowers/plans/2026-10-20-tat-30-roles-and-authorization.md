# Roles and authorization: owner and artist (TAT-30) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One table, `TENANT_ROUTE_ROLES`, says which roles may use each `/t/:tenant` route; the role middleware reads it on every tenant request; tests prove the table and the routes agree and send every route as an artist. Artists can edit their own profile (and only that one). About 3 points.

**Architecture:** A pure module `app/modules/tenancy/access.ts` (the table, `rolesFor`). `RoleMiddleware` loses its `{ allow }` option and reads the table by route name; `middleware.role()` joins the `/t/:tenant` group after `tenant()` and the nested groups drop their own role checks. `ArtistService` gains `profileOf`, `findEditable` and `updateOwn` (sharing `update`'s body through a private `save`); `ArtistsController` gains `mine` and routes owners and artists to the right service call. The settings layout shows a non-owner only the card; the account menu links "Your artist profile" for artists.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, VineJS, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4; Tuyau `urlFor`.

**Spec:** `docs/superpowers/specs/2026-10-20-tat-30-roles-and-authorization-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides; say which in your report). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **No migration, no setting.** Never read or edit `apps/platform/.env`.
- **Routes:** one new route, `GET /t/:tenant/artists/mine` named `tenant.artists.mine` (`ArtistsController.mine`). Every other route keeps its path and name.
- **Copy (verbatim):** `Your artist profile`, `What clients see about you on the studio page.`, `Profile`, `No artist profile is linked to you in {studio} yet. Ask an owner to link one.`; the existing flash `"{name}" saved.` is reused.
- Fixture slugs in new tests end in `-30` (`roles-30`, `own-30`, …): tests share the dev database, where a slug someone once used stays taken. Tests added to an existing file keep that file's studio.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only), touch targets 44 px (`h-11`), nothing wider than 375 px.
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes a few minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After controller, route or page changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 6), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.
- **If the walk (Task 3 or 4) finds a route whose verdict for an artist differs from the table** (an `OWNERS` route that answers an artist with something other than 404, or a `MEMBERS` route that refuses an artist who is linked and assigned): STOP and report it with the route and the response. Never change a service rule or a table entry to make the walk pass without the coordinator.

## Review Focus

1. **Every tenant route is classified, and the middleware enforces the classification.** Tests: Task 2 "every /t/:tenant route runs auth, the request transaction, the tenant check, then the role check", "every /t/:tenant route has an entry in TENANT_ROUTE_ROLES, and every entry is a route"; `role_middleware.spec.ts` "a route the table doesn't name fails loudly".
2. **An artist reaches exactly the table's routes.** Owner-only routes are a 404 with nothing changed even when the artist is assigned to the project; every other route works for a linked, assigned artist. Tests: Task 3/4 `role_access.spec.ts` (one test per isolation case) and "artists may use exactly the routes in ARTIST_ROUTES".
3. **An artist edits only their own profile, and never its link.** Tests: Task 4 "an artist gets 404 on a profile that isn't theirs, which stays as it was", "an artist saves their own profile and stays linked", "updateOwn refuses a profile unlinked while the form was open".
4. **Owners lose nothing.** Every existing spec passes unchanged except `tenant_routes.spec.ts`'s per-area list, which the table replaces; `cross_tenant.spec.ts` still passes every owner positive control.

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-30-roles-and-authorization-policies-owner-artist`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -2` → the two commits "docs: plan TAT-30 …" and "docs: design TAT-30 …" on top of 65eab5f.

- [ ] **Step 2: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -n 'options: { allow: MembershipRole\[\] },' -- apps/platform/app/middleware/role_middleware.ts
git -C <repo> grep -n '.use(\[middleware.auth(), middleware.dbContext(), middleware.tenant()\]);' -- apps/platform/start/routes.ts
git -C <repo> grep -n 'TAT-30 opens this area to artists by changing the' -- apps/platform/start/routes.ts
git -C <repo> grep -n '{ area: "alerts", allow: \["owner", "artist"\] },' -- apps/platform/tests/functional/tenancy/tenant_routes.spec.ts
git -C <repo> grep -n '^async function studio(slug: string, name: string) {' -- apps/platform/tests/helpers/tenants.ts
git -C <repo> grep -n '^function urlFor(' -- apps/platform/tests/helpers/isolation.ts
git -C <repo> grep -n 'TAT-30 folds this into the roles.' -- apps/platform/app/modules/scheduling/outcomes.ts
git -C <repo> grep -n 'async update(' -- apps/platform/app/modules/artists/services/artist_service.ts
git -C <repo> grep -n 'ArtistForm.layout = \[AppLayout, SettingsLayout\];' -- apps/platform/inertia/pages/artists/form.tsx
git -C <repo> grep -n '<Form route="session.destroy">' -- apps/platform/inertia/components/shell/account_menu.tsx
```

Each of these must print nothing:

```
git -C <repo> ls-files apps/platform/app/modules/tenancy/access.ts
git -C <repo> grep -n "TENANT_ROUTE_ROLES\|findEditable\|updateOwn\|tenant.artists.mine" -- apps/platform
git -C <repo> grep -rn "middleware.role({" -- apps/platform/tests
```

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 3: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok` (if not, ask the coordinator). Check the database is migrated: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists every migration up to `1791680000002_create_account_tokens_table` as completed.

- [ ] **Step 4: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=artists_page.spec.ts --files=artist_form.spec.ts --files=artist_service.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts`. Expected: PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (Task 7 compares).

---

### Task 1: The table

**Files:**
- Create: `apps/platform/app/modules/tenancy/access.ts`
- Test: `apps/platform/tests/unit/modules/tenancy/access.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/tenancy/access`: `TENANT_ROUTE_ROLES`, `type TenantRouteName`, `rolesFor(name: string | undefined): readonly MembershipRole[] | undefined`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/tenancy/access.spec.ts`:

```ts
import { test } from "@japa/runner";
import { rolesFor, TENANT_ROUTE_ROLES } from "#modules/tenancy/access";

const ROLES = ["owner", "artist"];

test.group("TENANT_ROUTE_ROLES", () => {
	test("owners may use every route, and only known roles are listed", ({
		assert,
	}) => {
		for (const [name, roles] of Object.entries(TENANT_ROUTE_ROLES)) {
			assert.include(roles, "owner", name);
			for (const role of roles) assert.include(ROLES, role, name);
			assert.equal(new Set(roles).size, roles.length, name);
		}
	});

	test("rolesFor gives the entry of a route the table names", ({ assert }) => {
		assert.deepEqual(rolesFor("tenant.inbox.index"), ["owner"]);
		assert.deepEqual(rolesFor("tenant.projects.show"), ["owner", "artist"]);
	});

	test("rolesFor knows nothing else, prototype names included", ({
		assert,
	}) => {
		for (const name of [
			undefined,
			"",
			"tenant.unknown",
			"constructor",
			"__proto__",
			"toString",
			"hasOwnProperty",
		]) {
			assert.isUndefined(rolesFor(name), String(name));
		}
	});
});
```

- [ ] **Step 2: Run it (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=access.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → 124 with "Cannot find module" for `#modules/tenancy/access`.

- [ ] **Step 3: Write the table**

Create `apps/platform/app/modules/tenancy/access.ts`. The artists entries are all `OWNERS` here; Task 4 opens three of them.

```ts
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/** Owners only: any other member gets the same 404 as an unknown URL. */
const OWNERS: readonly MembershipRole[] = ["owner"];

/**
 * Every member. An artist then reaches only their own records: the rule
 * named above each group of entries decides which.
 */
const MEMBERS: readonly MembershipRole[] = ["owner", "artist"];

/**
 * Who may use each /t/:tenant route, by route name (TAT-30): the one
 * definition of what an owner and an artist may do in a studio. Owners may
 * use every route. The role middleware reads this table on every tenant
 * request, before the controller; a route missing here fails loudly. The
 * services named below keep their own record checks.
 *
 * tenant_routes.spec.ts fails for a route without an entry or an entry
 * without a route; role_access.spec.ts sends every route as an artist and
 * pins the list of routes open to artists (ARTIST_ROUTES). Staff roles (V2)
 * are new names in these lists, not a second table.
 */
export const TENANT_ROUTE_ROLES = {
	// The studio's address: owners land on the inbox, artists on Projects.
	"tenant.dashboard": MEMBERS,

	// Studio settings.
	"tenant.settings": OWNERS,
	"tenant.settings.profile": OWNERS,
	"tenant.settings.profile.update": OWNERS,
	"tenant.settings.slug.update": OWNERS,
	"tenant.settings.payments": OWNERS,
	"tenant.settings.deposits.update": OWNERS,
	"tenant.settings.payments.create": OWNERS,
	"tenant.settings.payments.store": OWNERS,
	"tenant.settings.payments.update": OWNERS,
	"tenant.settings.payments.edit": OWNERS,
	"tenant.settings.payments.move": OWNERS,
	"tenant.settings.payments.destroy": OWNERS,
	"tenant.settings.messages": OWNERS,
	"tenant.settings.messages.update": OWNERS,

	// Artist profiles.
	"tenant.artists": OWNERS,
	"tenant.artists.create": OWNERS,
	"tenant.artists.store": OWNERS,
	"tenant.artists.edit": OWNERS,
	"tenant.artists.update": OWNERS,
	"tenant.artists.destroy": OWNERS,

	// The inquiry inbox: reference images stay private to owners until a
	// project is assigned.
	"tenant.inbox.index": OWNERS,
	"tenant.inbox.show": OWNERS,
	"tenant.inbox.accept": OWNERS,
	"tenant.inbox.decline": OWNERS,
	"tenant.inbox.contacted.store": OWNERS,

	// The studio's clients.
	"tenant.clients.index": OWNERS,
	"tenant.clients.show": OWNERS,
	"tenant.clients.edit": OWNERS,
	"tenant.clients.update": OWNERS,

	// Projects: an artist only the projects assigned to their own live
	// artist profile (ProjectService.findFor, re-checked under the row lock
	// by lockFor); booking and scheduling only themselves
	// (BookingService.bookableArtists, SessionService.scheduleFor); on the
	// page, the balance and the payments but never a screenshot
	// (paymentsCard).
	"tenant.projects.create": MEMBERS,
	"tenant.projects.store": MEMBERS,
	"tenant.projects.index": MEMBERS,
	"tenant.projects.show": MEMBERS,
	"tenant.projects.quotes.store": MEMBERS,
	"tenant.projects.quotes.accept": MEMBERS,
	"tenant.projects.price.store": MEMBERS,
	"tenant.projects.moves.store": MEMBERS,
	"tenant.projects.notes.update": MEMBERS,
	"tenant.projects.contacted.store": MEMBERS,
	"tenant.projects.sessions.store": MEMBERS,
	// Money and who works on a project stay with owners; the services refuse
	// anyone else too (ProjectService.assignArtist, DepositLinkService.issue,
	// PaymentService.requireOwner).
	"tenant.projects.artist.update": OWNERS,
	"tenant.projects.deposit_link.store": OWNERS,
	"tenant.projects.payments.store": OWNERS,
	"tenant.projects.refunds.store": OWNERS,
	"tenant.projects.deposit_outcome.store": OWNERS,

	// Decisions on one payment.
	"tenant.payments.verify": OWNERS,
	"tenant.payments.reject": OWNERS,
	"tenant.payments.reverse": OWNERS,

	// One session: an artist only their own session on a project assigned to
	// their profile (mayChangeSession in #modules/scheduling/outcomes,
	// through SessionService).
	"tenant.sessions.outcome": MEMBERS,
	"tenant.sessions.move": MEMBERS,

	// The calendar: an artist sees their own sessions, with a project's
	// client and brief only when they may open it (CalendarService.load).
	"tenant.calendar.index": MEMBERS,

	// Each member's own alerts (AlertService scopes every read and write).
	"tenant.alerts.index": MEMBERS,
	"tenant.alerts.read": MEMBERS,
	"tenant.alerts.open": MEMBERS,
} as const satisfies Record<string, readonly MembershipRole[]>;

export type TenantRouteName = keyof typeof TENANT_ROUTE_ROLES;

/**
 * The roles that may use the tenant route `name`, or undefined for a name
 * the table doesn't hold (own keys only, so "constructor" is unknown too).
 */
export function rolesFor(
	name: string | undefined,
): readonly MembershipRole[] | undefined {
	if (name === undefined || !Object.hasOwn(TENANT_ROUTE_ROLES, name)) {
		return undefined;
	}
	return TENANT_ROUTE_ROLES[name as TenantRouteName];
}
```

- [ ] **Step 4: Run it (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=access.spec.ts` → 3 passed. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/app/modules/tenancy/access.ts apps/platform/tests/unit/modules/tenancy/access.spec.ts
git -C <repo> commit -m "feat(platform): list which roles may use each tenant route (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The role middleware reads the table on every tenant route

**Files:**
- Modify: `apps/platform/app/middleware/role_middleware.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Test: `apps/platform/tests/functional/tenancy/role_middleware.spec.ts` (create)

- [ ] **Step 1: Write the failing middleware test**

Create `apps/platform/tests/functional/tenancy/role_middleware.spec.ts`:

```ts
import { errors, type HttpContext } from "@adonisjs/core/http";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import RoleMiddleware from "#middleware/role_middleware";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";

/** A request on the tenant route `name`, by a member with `role`. */
async function requestAs(role: "owner" | "artist", name: string | undefined) {
	const ctx = await testUtils.createHttpContext();
	ctx.tenant = { id: "t", slug: "roles-30" } as unknown as Tenant;
	ctx.membership = { role } as unknown as TenantMembership;
	ctx.route = {
		name,
		pattern: "/t/:tenant/somewhere",
	} as unknown as HttpContext["route"];
	return ctx;
}

/** Runs the middleware; gives whether the handler ran and what it threw. */
async function run(ctx: HttpContext) {
	let ran = false;
	const error = await new RoleMiddleware()
		.handle(ctx, async () => {
			ran = true;
		})
		.then(
			() => null,
			(caught: unknown) => caught,
		);
	return { ran, error };
}

test.group("RoleMiddleware (TAT-30)", () => {
	test("lets a role the table allows through", async ({ assert }) => {
		for (const [role, name] of [
			["owner", "tenant.inbox.index"],
			["owner", "tenant.projects.show"],
			["artist", "tenant.projects.show"],
		] as const) {
			const { ran, error } = await run(await requestAs(role, name));
			assert.isNull(error, `${role} ${name}`);
			assert.isTrue(ran, `${role} ${name}`);
		}
	});

	test("gives any other role the router's 404, and the handler never runs", async ({
		assert,
	}) => {
		const { ran, error } = await run(
			await requestAs("artist", "tenant.inbox.index"),
		);
		assert.instanceOf(error, errors.E_ROUTE_NOT_FOUND);
		assert.isFalse(ran);
	});

	test("a route the table doesn't name fails loudly, for owners too", async ({
		assert,
	}) => {
		for (const name of ["tenant.not_in_the_table", undefined]) {
			const { ran, error } = await run(await requestAs("owner", name));
			assert.instanceOf(error, Error);
			assert.notInstanceOf(error, errors.E_ROUTE_NOT_FOUND);
			assert.match(String(error), /No TENANT_ROUTE_ROLES entry/);
			assert.isFalse(ran);
		}
	});
});
```

- [ ] **Step 2: Replace the per-area test in `tenant_routes.spec.ts`**

Add the import (keep Biome's order: `#modules/tenancy/access` goes after `#models/user`):

```ts
import { TENANT_ROUTE_ROLES } from "#modules/tenancy/access";
```

Add this helper above `test.group("Tenant routes", …)`:

```ts
/** The app's /t/:tenant routes: the test-only ones (EXEMPT_ROUTES) left out. */
function appTenantRoutes() {
	return Object.values(router.toJSON())
		.flat()
		.filter(({ pattern }) => /^\/t\/:tenant(\/|$)/.test(pattern))
		.filter(
			({ pattern, methods }) =>
				!methods.some((method) => `${method} ${pattern}` in EXEMPT_ROUTES),
		);
}
```

Replace the whole `for (const { area, allow } of [ … ]) { test(`every ${area} route runs auth, then the tenant check, then the role check …`, …); }` block (from `for (const { area, allow } of [` through its closing `}` before `test("every /t/:tenant route has an isolation case or a written exemption"`) with:

```ts
	test("every /t/:tenant route runs auth, the request transaction, the tenant check, then the role check", ({
		assert,
	}) => {
		const routes = appTenantRoutes();
		assert.isNotEmpty(routes);

		for (const route of routes) {
			const names = [...route.middleware.all()].map((entry) =>
				typeof entry === "function" ? undefined : entry.name,
			);
			const auth = names.indexOf("auth");
			const dbContext = names.indexOf("dbContext");
			const tenant = names.indexOf("tenant");
			const role = names.indexOf("role");
			assert.isAtLeast(auth, 0, route.pattern);
			assert.isAbove(dbContext, auth, route.pattern);
			assert.isAbove(tenant, dbContext, route.pattern);
			assert.isAbove(role, tenant, route.pattern);
			// One role check per route: the group's, which reads the table.
			assert.equal(
				names.filter((name) => name === "role").length,
				1,
				route.pattern,
			);
		}
	});

	test("every /t/:tenant route has an entry in TENANT_ROUTE_ROLES, and every entry is a route", ({
		assert,
	}) => {
		const routes = appTenantRoutes();
		const unnamed = routes.filter(({ name }) => !name);
		assert.deepEqual(
			unnamed.map(({ pattern }) => pattern),
			[],
			"every tenant route needs a name: the role table is keyed by it",
		);

		const names = new Set(routes.map(({ name }) => String(name)));
		const listed = new Set(Object.keys(TENANT_ROUTE_ROLES));
		assert.deepEqual(
			[...names].filter((name) => !listed.has(name)).sort(),
			[],
			"add the route to TENANT_ROUTE_ROLES (#modules/tenancy/access)",
		);
		assert.deepEqual(
			[...listed].filter((name) => !names.has(name)).sort(),
			[],
			"entries in TENANT_ROUTE_ROLES for routes that no longer exist",
		);
	});
```

- [ ] **Step 3: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=role_middleware.spec.ts --files=tenant_routes.spec.ts`. Expected failures: `role_middleware.spec.ts` "lets a role the table allows through" (the middleware reads `options.allow` of undefined: a TypeError) and the other two; `tenant_routes.spec.ts` "…then the role check" fails on `/t/:tenant` (the root has no role check).

- [ ] **Step 4: Rewrite the middleware**

Replace the whole of `apps/platform/app/middleware/role_middleware.ts` with:

```ts
import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { rolesFor } from "#modules/tenancy/access";

/**
 * Lets a member use a tenant route only when TENANT_ROUTE_ROLES
 * (#modules/tenancy/access, TAT-30) gives their role that route. Everyone
 * else gets the same 404 as an unknown URL, like the tenant middleware, so
 * a URL never reveals that a page exists. A route the table doesn't name is
 * a programming error and fails loudly; tenant_routes.spec.ts keeps the
 * table and the routes in step. It runs on the /t/:tenant group after the
 * tenant middleware: tenantContext() throws without it.
 */
export default class RoleMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const { membership } = tenantContext(ctx);
		const roles = rolesFor(ctx.route?.name);
		if (!roles) {
			throw new Error(
				`No TENANT_ROUTE_ROLES entry for ${ctx.request.method()} ${ctx.route?.pattern ?? ctx.request.url()} (#modules/tenancy/access)`,
			);
		}
		if (!roles.includes(membership.role)) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
```

- [ ] **Step 5: Move the role check to the tenant group in `start/routes.ts`**

1. The outer group's comment and middleware. Replace

```ts
/**
 * Pages of one tenant. The tenant middleware checks the user's membership
 * on every request and 404s anyone else; read the tenant with
 * tenantContext(ctx). Every tenant route goes in this group (a test checks).
 */
```

with

```ts
/**
 * Pages of one tenant. The tenant middleware checks the user's membership
 * on every request and 404s anyone else; read the tenant with
 * tenantContext(ctx). The role middleware then lets the member through only
 * if TENANT_ROUTE_ROLES (#modules/tenancy/access) gives their role the
 * route (TAT-30). Every tenant route goes in this group and needs a name
 * and an entry in that table (a test checks).
 */
```

and replace

```ts
	.prefix("/t/:tenant")
	.use([middleware.auth(), middleware.dbContext(), middleware.tenant()]);
```

with

```ts
	.prefix("/t/:tenant")
	.use([
		middleware.auth(),
		middleware.dbContext(),
		middleware.tenant(),
		middleware.role(),
	]);
```

2. Delete the nine nested role checks. Each is the line `.use(middleware.role({ allow: [...] }));` right after a group's `.prefix(...)`; delete it and end the `.prefix(...)` line with `;`. The nine, in file order: `.prefix("/settings")`, `.prefix("/artists")`, `.prefix("/inbox")`, `.prefix("/clients")`, `.prefix("/projects")`, `.prefix("/payments")`, `.prefix("/sessions")`, `.prefix("/calendar")`, `.prefix("/alerts")`. For example

```ts
			.prefix("/settings")
			.use(middleware.role({ allow: ["owner"] }));
```

becomes

```ts
			.prefix("/settings");
```

After this, `git -C <repo> grep -n "middleware.role(" -- apps/platform/start/routes.ts` prints exactly one line (the outer group's `middleware.role(),`).

3. The group comments. Replace each group's doc comment with the text below (the code under each comment is unchanged):

- Settings: `Studio settings: owners only (TENANT_ROUTE_ROLES).`
- Artists: `Artist profiles (TENANT_ROUTE_ROLES).`
- Inbox: `The inquiry inbox: owners only (TENANT_ROUTE_ROLES); reference images are private to owners until a project is assigned.`
- Clients: `Clients: owners only (TENANT_ROUTE_ROLES); artists get their assigned projects, not the studio's client list.`
- Projects: `Projects: owners, and the artist assigned to the project (ProjectService.findFor gives anyone else a 404). Money and the project's artist are owners only (TENANT_ROUTE_ROLES, and their services). Booking a session (new, store) is open to both; BookingService decides which artists a member may book.`
- Payments: `Decisions on one payment (TAT-66): owners only (TENANT_ROUTE_ROLES), and PaymentService.findFor checks again.`
- Sessions: `One session's outcome and time (TAT-85): owners any session, an artist only their own on a project assigned to them (SessionService.findChangeable gives anyone else a 404).`
- Calendar: `The calendar: owners (the whole studio or one artist) and artists (their own sessions); CalendarService decides what each member sees.`
- Alerts: `Each member's own alerts (TAT-52): owners and artists; AlertService scopes every read and write to the member.`

Keep the `/** … */` form and the wrapping width (Biome doesn't wrap comments; keep lines under about 80 columns by hand).

- [ ] **Step 6: The mayChangeSession comment**

In `apps/platform/app/modules/scheduling/outcomes.ts`, replace ` * (the project page they can open). TAT-30 folds this into the roles.` with ` * (the project page they can open). The record rule behind the sessions\n * entries of TENANT_ROUTE_ROLES (#modules/tenancy/access, TAT-30).` (two comment lines).

- [ ] **Step 7: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=role_middleware.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=artists_page.spec.ts --files=inbox.spec.ts --files=payments_http.spec.ts --files=deposit_links_http.spec.ts` → all pass (`cross_tenant.spec.ts` proves every owner still gets every route). If a spec name doesn't exist (`ls <repo>/apps/platform/tests/functional/*/<name>`), drop it from the list. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 8: Commit**

```
git -C <repo> add apps/platform/app/middleware/role_middleware.ts apps/platform/start/routes.ts apps/platform/app/modules/scheduling/outcomes.ts apps/platform/tests/functional/tenancy/role_middleware.spec.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): check every tenant route's roles against the one table (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Walk every tenant route as an artist

**Files:**
- Modify: `apps/platform/tests/helpers/tenants.ts` (export the one-studio seeder)
- Modify: `apps/platform/tests/helpers/isolation.ts` (export `caseRequest`)
- Test: `apps/platform/tests/functional/tenancy/role_access.spec.ts` (create)

- [ ] **Step 1: Export the one-studio seeder**

In `apps/platform/tests/helpers/tenants.ts`: rename `async function studio(slug: string, name: string) {` to `export async function seededStudio(slug: string, name: string) {`, add above it the comment `/** One studio seeded as each of twoStudios' studios is (see twoStudios); for tests that need only one. */`, change `export type Studio = Awaited<ReturnType<typeof studio>>;` to `export type Studio = Awaited<ReturnType<typeof seededStudio>>;`, and in `twoStudios()` call `seededStudio("studio-a", "Studio A")` and `seededStudio("studio-b", "Studio B")`.

- [ ] **Step 2: Export one request of a case**

In `apps/platform/tests/helpers/isolation.ts`, add after `function send(…) { … }`:

```ts
/**
 * Sends `isolationCase` as `user` to `studio`'s slug, with
 * `resourceOwner`'s resource for an :id and the case's body built for
 * `studio`: one request of the harness, for other walks over the cases
 * (role_access.spec.ts, TAT-30).
 */
export function caseRequest(
	client: ApiClient,
	isolationCase: IsolationCase,
	studio: Studio,
	resourceOwner: Studio,
	user: User,
) {
	return send(
		client,
		isolationCase,
		urlFor(isolationCase, studio, resourceOwner),
		user,
		isolationCase.body?.(studio),
	);
}
```

- [ ] **Step 3: Write the walk**

Create `apps/platform/tests/functional/tenancy/role_access.spec.ts`:

```ts
import router from "@adonisjs/core/services/router";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import StaffAlert from "#modules/notifications/models/staff_alert";
import TattooProject from "#modules/projects/models/tattoo_project";
import { rolesFor, TENANT_ROUTE_ROLES } from "#modules/tenancy/access";
import { caseRequest } from "#tests/helpers/isolation";
import { inTenant, type Studio, seededStudio } from "#tests/helpers/tenants";
import { type IsolationCase, isolationCases } from "#tests/isolation/cases";

/**
 * The routes an artist may use (TAT-30), sorted. A checksum of
 * TENANT_ROUTE_ROLES, not a second definition: nothing in the app reads it.
 * Opening a route to artists is a conscious edit of both files.
 */
const ARTIST_ROUTES = [
	"tenant.alerts.index",
	"tenant.alerts.open",
	"tenant.alerts.read",
	"tenant.calendar.index",
	"tenant.dashboard",
	"tenant.projects.contacted.store",
	"tenant.projects.create",
	"tenant.projects.index",
	"tenant.projects.moves.store",
	"tenant.projects.notes.update",
	"tenant.projects.price.store",
	"tenant.projects.quotes.accept",
	"tenant.projects.quotes.store",
	"tenant.projects.sessions.store",
	"tenant.projects.show",
	"tenant.projects.store",
	"tenant.sessions.move",
	"tenant.sessions.outcome",
];

/** The name of the route an isolation case sends. */
function routeName({ method, pattern }: IsolationCase): string {
	const route = Object.values(router.toJSON())
		.flat()
		.find(
			(entry) => entry.pattern === pattern && entry.methods.includes(method),
		);
	if (!route?.name) throw new Error(`No named route ${method} ${pattern}`);
	return route.name;
}

/**
 * A studio whose artist member is linked to its artist profile, with every
 * project of the studio assigned to that profile and an unread alert of the
 * artist's own (the alerts routes' resource). An owner-only route can then
 * refuse the artist only for their role, never for a missing assignment,
 * and every other route has something of the artist's to act on.
 */
async function artistsStudio(): Promise<Studio> {
	const studio = await seededStudio("roles-30", "Roles Thirty");
	const alert = await inTenant(studio.tenant, async () => {
		await Artist.query()
			.where("tenant_id", studio.tenant.id)
			.where("id", studio.artistProfile.id)
			.update({ user_id: studio.artist.id });
		await TattooProject.query()
			.where("tenant_id", studio.tenant.id)
			.update({ artist_id: studio.artistProfile.id });
		return StaffAlert.create({
			tenantId: studio.tenant.id,
			userId: studio.artist.id,
			kind: "new_inquiry",
			inquiryId: studio.newInquiry.id,
		});
	});
	return { ...studio, alert };
}

test.group("What an artist may use (TAT-30)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("artists may use exactly the routes in ARTIST_ROUTES", ({ assert }) => {
		const open = Object.keys(TENANT_ROUTE_ROLES)
			.filter((name) => rolesFor(name)?.includes("artist"))
			.sort();
		assert.deepEqual(open, ARTIST_ROUTES);
	});

	for (const isolationCase of isolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern} as an artist`, async ({
			client,
			assert,
		}) => {
			const studio = await artistsStudio();
			const name = routeName(isolationCase);
			const allowed = rolesFor(name)?.includes("artist") ?? false;
			const writes = isolationCase.method !== "GET";
			const before = await isolationCase.snapshot(studio);

			const response = await caseRequest(
				client,
				isolationCase,
				studio,
				studio,
				studio.artist,
			);

			if (allowed) {
				// The same positive control the cross-tenant spec gives owners,
				// and a write must have written (a refused form is a 302 too).
				response.assertStatus(isolationCase.ownStatus);
				if (writes) {
					assert.notDeepEqual(
						await isolationCase.snapshot(studio),
						before,
						`${name}: the artist's write changed nothing`,
					);
				}
				return;
			}
			response.assertStatus(404);
			assert.deepEqual(
				await isolationCase.snapshot(studio),
				before,
				`${name}: an owner-only route changed the studio for an artist`,
			);
		});
	}
});
```

- [ ] **Step 4: Run it**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=role_access.spec.ts > <scratchpad>/walk.log 2>&1`. Expected: every test passes (one per isolation case plus the list). This task adds no app code: the walk is GREEN on Task 2's table. If any route fails, follow the Global Constraints' STOP rule: report the route, the expected verdict and the response, and change nothing.

Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=cross_tenant.spec.ts --files=harness.spec.ts` → pass (the helpers still work).

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/tests/helpers/tenants.ts apps/platform/tests/helpers/isolation.ts apps/platform/tests/functional/tenancy/role_access.spec.ts
git -C <repo> commit -m "test(platform): send every tenant route as an artist and pin what artists may use (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Artists edit their own profile

**Files:**
- Modify: `apps/platform/app/modules/artists/services/artist_service.ts`
- Modify: `apps/platform/app/controllers/artists_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/app/modules/tenancy/access.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Modify: `apps/platform/tests/functional/tenancy/role_access.spec.ts` (`ARTIST_ROUTES`)
- Modify: `apps/platform/tests/functional/artists/artist_service.spec.ts`
- Test: `apps/platform/tests/functional/artists/own_profile.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/artists/services/artist_service`: `type ProfileEditor = Pick<TenantMembership, "userId" | "role">`, `type OwnProfileInput = Omit<ArtistInput, "linkToMe">`; `ArtistService.profileOf(tenant, userId): Promise<Artist | null>`, `findEditable(tenant, editor: ProfileEditor, id): Promise<Artist>`, `updateOwn(tenant, userId: string, artist: Artist, input: OwnProfileInput): Promise<Artist>`. TAT-33 uses `profileOf`.

- [ ] **Step 1: Write the failing service tests**

Append to `apps/platform/tests/functional/artists/artist_service.spec.ts` (add `import { errors as lucidErrors } from "@adonisjs/lucid";` and `artistIn` to the `#tests/helpers/tenants` import; keep Biome's order):

```ts
test.group("ArtistService own profiles (TAT-30)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A studio with an artist member linked to "Asha" and an unlinked "Mira". */
	async function linked() {
		const { owner, tenant } = await studioWithOwner("own-svc-30", "Own Svc");
		const member = await artistIn(tenant, "asha@own-svc-30.example");
		const { asha, mira } = await inTenant(tenant, async () => ({
			asha: await artists.create(
				tenant,
				input({ name: "Asha", slug: "asha" }),
				owner,
			),
			mira: await artists.create(
				tenant,
				input({ name: "Mira", slug: "mira" }),
				owner,
			),
		}));
		await inTenant(tenant, () =>
			Artist.query().where("id", asha.id).update({ user_id: member.id }),
		);
		return { owner, tenant, member, asha, mira };
	}

	test("profileOf gives the live profile linked to the account, else null", async ({
		assert,
	}) => {
		const { owner, tenant, member, asha } = await linked();

		await inTenant(tenant, async () => {
			assert.equal((await artists.profileOf(tenant, member.id))?.id, asha.id);
			assert.isNull(await artists.profileOf(tenant, owner.id));
			await artists.delete(tenant, await artists.findFor(tenant, asha.id));
			assert.isNull(await artists.profileOf(tenant, member.id));
		});
	});

	test("findEditable: owners any live profile, an artist only their own", async ({
		assert,
	}) => {
		const { owner, tenant, member, asha, mira } = await linked();
		const asOwner = { userId: owner.id, role: "owner" as const };
		const asArtist = { userId: member.id, role: "artist" as const };

		await inTenant(tenant, async () => {
			assert.equal(
				(await artists.findEditable(tenant, asOwner, mira.id)).id,
				mira.id,
			);
			assert.equal(
				(await artists.findEditable(tenant, asArtist, asha.id)).id,
				asha.id,
			);
			await assert.rejects(
				() => artists.findEditable(tenant, asArtist, mira.id),
				lucidErrors.E_ROW_NOT_FOUND,
			);
		});
	});

	test("updateOwn changes the profile and never its link", async ({
		assert,
	}) => {
		const { tenant, member, asha } = await linked();

		const saved = await inTenant(tenant, () =>
			artists.updateOwn(tenant, member.id, asha, {
				name: "Asha Gurung",
				slug: "asha-g",
				bio: "Fine line",
				visible: false,
				acceptingInquiries: false,
				closedMessage: "Back in May",
			}),
		);

		assert.equal(saved.name, "Asha Gurung");
		assert.equal(saved.slug, "asha-g");
		assert.isFalse(saved.visible);
		assert.equal(saved.closedMessage, "Back in May");
		assert.equal(saved.userId, member.id);
	});

	test("updateOwn refuses a profile unlinked or deleted while the form was open", async ({
		assert,
	}) => {
		const { tenant, member, asha, mira } = await linked();
		const change = { ...input({ name: "Mine now", slug: "asha" }) };

		await inTenant(tenant, async () => {
			// The form was loaded while linked; an owner's change commits first.
			await Artist.query().where("id", asha.id).update({ user_id: null });
			await assert.rejects(
				() => artists.updateOwn(tenant, member.id, asha, change),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			// A profile that was never theirs.
			await assert.rejects(
				() =>
					artists.updateOwn(tenant, member.id, mira, {
						...change,
						slug: "mira",
					}),
				lucidErrors.E_ROW_NOT_FOUND,
			);
			assert.equal((await Artist.findOrFail(asha.id)).name, "Asha");
			assert.isNull((await Artist.findOrFail(asha.id)).userId);
		});
	});
});
```

Note: `updateOwn` takes `OwnProfileInput`; passing `input(...)` (an `ArtistInput` with `linkToMe`) is allowed by TypeScript and the extra field is ignored.

- [ ] **Step 2: Write the failing HTTP tests**

Create `apps/platform/tests/functional/artists/own_profile.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { addArtist } from "#tests/helpers/artists";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const base = "/t/own-30/artists";

/**
 * A studio, its owner, an artist member linked to "Asha", an unlinked
 * "Mira" and the owner's own "Oona".
 */
async function studio() {
	const { owner, tenant } = await studioWithOwner("own-30", "Own Thirty");
	const member = await artistIn(tenant, "asha@own-30.example");
	const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
	const mira = await addArtist(tenant, owner, { name: "Mira", slug: "mira" });
	const oona = await addArtist(tenant, owner, {
		name: "Oona",
		slug: "oona",
		linkToMe: true,
	});
	await inTenant(tenant, () =>
		Artist.query().where("id", asha.id).update({ user_id: member.id }),
	);
	return { owner, tenant, member, asha, mira, oona };
}

test.group("An artist's own profile (TAT-30)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist opens their own profile, without the link to their login", async ({
		client,
		assert,
	}) => {
		const { member, asha } = await studio();

		const response = await client
			.get(`${base}/${asha.id}/edit`)
			.withInertia()
			.loginAs(member);

		response.assertStatus(200);
		response.assertInertiaComponent("artists/form");
		assert.equal(response.inertiaProps.artist.id, asha.id);
		assert.isTrue(response.inertiaProps.artist.isMine);
		assert.isFalse(response.inertiaProps.canLink);
	});

	test("an artist saves their own profile and stays linked", async ({
		client,
		assert,
	}) => {
		const { tenant, member, asha } = await studio();

		// No linkToMe: for an owner that unlinks their own profile; for an
		// artist the link is never read. No visible: an unchecked box.
		const response = await client
			.put(`${base}/${asha.id}`)
			.fields({
				name: "Asha Gurung",
				slug: "asha-g",
				bio: "Fine line",
				acceptingInquiries: "on",
				closedMessage: "",
			})
			.withCsrfToken()
			.loginAs(member)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", `${base}/${asha.id}/edit`);
		response.assertFlashMessage("success", '"Asha Gurung" saved.');
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.equal(saved.name, "Asha Gurung");
		assert.equal(saved.slug, "asha-g");
		assert.equal(saved.bio, "Fine line");
		assert.isFalse(saved.visible);
		assert.isTrue(saved.acceptingInquiries);
		assert.equal(saved.userId, member.id);
	});

	test("an artist gets 404 on a profile that isn't theirs, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant, member, mira, oona } = await studio();

		for (const profile of [mira, oona]) {
			for (const request of [
				client.get(`${base}/${profile.id}/edit`),
				client
					.put(`${base}/${profile.id}`)
					.fields({ name: "Taken", slug: profile.slug }),
				// A bad body is still a 404: the profile is loaded first.
				client.put(`${base}/${profile.id}`).fields({ name: "", slug: "-" }),
			]) {
				const response = await request.withCsrfToken().loginAs(member);
				response.assertStatus(404);
			}
		}
		const rows = await inTenant(tenant, () =>
			Artist.query().whereIn("id", [mira.id, oona.id]).orderBy("slug"),
		);
		assert.deepEqual(
			rows.map(({ name, userId }) => ({ name, userId })),
			[
				{ name: "Mira", userId: null },
				{ name: "Oona", userId: oona.userId },
			],
		);
	});

	test("the list, a new profile and deleting stay owners only", async ({
		client,
	}) => {
		const { member, asha } = await studio();

		for (const request of [
			client.get(base),
			client.get(`${base}/new`),
			client.post(base).fields({ name: "Sneaky", slug: "sneaky" }),
			client.delete(`${base}/${asha.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(member);
			response.assertStatus(404);
		}
	});

	test("mine opens the member's own profile", async ({ client }) => {
		const { owner, member, asha, oona } = await studio();

		const artist = await client
			.get(`${base}/mine`)
			.loginAs(member)
			.redirects(0);
		artist.assertStatus(302);
		artist.assertHeader("location", `${base}/${asha.id}/edit`);

		const ownerResponse = await client
			.get(`${base}/mine`)
			.loginAs(owner)
			.redirects(0);
		ownerResponse.assertHeader("location", `${base}/${oona.id}/edit`);
	});

	test("mine without a linked profile: an artist goes to Projects with a note, an owner to the list", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("mine-30", "Mine Thirty");
		const member = await artistIn(tenant, "new@mine-30.example");

		const artist = await client
			.get("/t/mine-30/artists/mine")
			.loginAs(member)
			.redirects(0);
		artist.assertHeader("location", "/t/mine-30/projects");
		artist.assertFlashMessage(
			"error",
			"No artist profile is linked to you in Mine Thirty yet. Ask an owner to link one.",
		);

		const ownerResponse = await client
			.get("/t/mine-30/artists/mine")
			.loginAs(owner)
			.redirects(0);
		ownerResponse.assertHeader("location", "/t/mine-30/artists");
	});

	test("an owner still edits any profile and goes back to the list", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha } = await studio();

		const response = await client
			.put(`${base}/${asha.id}`)
			.fields({ name: "Asha R", slug: "asha", visible: "on" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const saved = await inTenant(tenant, () => Artist.findOrFail(asha.id));
		assert.equal(saved.name, "Asha R");
		// An owner's edit of someone else's profile never changes its link.
		assert.isNotNull(saved.userId);
	});
});
```

- [ ] **Step 3: Run them (RED)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts --files=own_profile.spec.ts > <scratchpad>/red.log 2>&1; echo $?`. Expected: the service tests fail (`profileOf` / `findEditable` / `updateOwn` are not functions); the HTTP tests that need an artist to get in fail with 404 (and `mine` with 404); "the list, a new profile and deleting stay owners only" and "an owner still edits …" already pass.

- [ ] **Step 4: The service**

In `apps/platform/app/modules/artists/services/artist_service.ts`:

1. Imports: add `import { errors as lucidErrors } from "@adonisjs/lucid";` and `import type TenantMembership from "#modules/tenancy/models/tenant_membership";` (Biome orders them).

2. After the `ArtistInput` type, add:

```ts
/** Who is editing a profile: their user and their role in the tenant (TAT-30). */
export type ProfileEditor = Pick<TenantMembership, "userId" | "role">;

/**
 * What an artist may change on their own profile (TAT-30): everything but
 * the link to a login.
 */
export type OwnProfileInput = Omit<ArtistInput, "linkToMe">;
```

3. After `findFor`, add:

```ts
	/**
	 * The tenant's live profile linked to `userId`, or null (TAT-30): the
	 * member's own profile.
	 */
	async profileOf(tenant: TenantRef, userId: string): Promise<Artist | null> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.first();
	}

	/**
	 * The live profile `editor` may edit (TAT-30): any of the tenant's for an
	 * owner (findFor), only the one linked to them for anyone else. Anything
	 * else throws E_ROW_NOT_FOUND (a 404), the same as another tenant's
	 * profile.
	 */
	async findEditable(
		tenant: TenantRef,
		editor: ProfileEditor,
		id: string,
	): Promise<Artist> {
		if (editor.role === "owner") return this.findFor(tenant, id);
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.where("user_id", editor.userId)
			.firstOrFail();
	}
```

4. Replace the whole `update` method (its doc comment and body) with `update`, `updateOwn` and the private `save`:

```ts
	/**
	 * Saves an owner's edit. A new `photo` replaces the stored one and
	 * `removePhoto` drops it; the old file is deleted once the outermost
	 * transaction commits.
	 */
	async update(
		tenant: TenantRef,
		artist: Artist,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
		return this.save(tenant, artist.id, input, (live) =>
			nextUserId(live.userId, input.linkToMe, member),
		);
	}

	/**
	 * An artist's edit of their own profile (TAT-30): the profile fields and
	 * the photo, never the link to a login. Under the row lock the profile
	 * must still be live and linked to `userId` (an owner may have deleted it
	 * since the form loaded, or TAT-33 unlinked a removed member):
	 * E_ROW_NOT_FOUND otherwise.
	 */
	async updateOwn(
		tenant: TenantRef,
		userId: string,
		artist: Artist,
		input: OwnProfileInput,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
		return this.save(tenant, artist.id, input, (live) => {
			if (live.userId !== userId) {
				throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
			}
			return live.userId;
		});
	}

	/**
	 * The body of update and updateOwn: stores a new photo, locks the live
	 * row (a profile deleted since the form loaded is a 404), saves the
	 * fields, the photo and the link `linkFor` decides from the locked row,
	 * and deletes a replaced photo once the outermost transaction commits.
	 */
	private async save(
		tenant: TenantRef,
		id: string,
		input: OwnProfileInput,
		linkFor: (live: Artist) => string | null,
	): Promise<Artist> {
		try {
			return await withTransaction(async (trx) => {
				// Stored inside the transaction: nothing is stored if it cannot
				// open, and the cleanup is registered right after the store
				// resolves. It comes before the row lock below, so the lock is
				// not held while the image is processed.
				const photo = await this.storePhoto(tenant, input.photo);
				// Lock the live row: a delete that landed since the form loaded
				// makes this a 404, and the photo and link are read from the row,
				// not from the form's copy.
				const live = await Artist.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("id", id)
					.forUpdate()
					.firstOrFail();
				const previous = live.photoKey;
				const keepsPhoto = !photo && !input.removePhoto;
				live.merge({
					...profileFields(input),
					userId: linkFor(live),
					...(keepsPhoto ? {} : photoColumns(photo)),
				});
				await live.save();
				// The replaced file goes only once the change is committed for good.
				if (previous && previous !== live.photoKey) {
					afterCommit(() => this.images.delete(PHOTO, previous));
				}
				return live;
			});
		} catch (error) {
			rethrowConflict(error, input.slug);
		}
	}
```

5. Change `function profileFields(input: ArtistInput) {` to `function profileFields(input: OwnProfileInput) {`.

- [ ] **Step 5: The controller**

In `apps/platform/app/controllers/artists_controller.ts`:

1. Change the class comment to:

```ts
/**
 * The studio's artist profiles. Owners manage every one; an artist edits
 * only the profile linked to them (TAT-30: TENANT_ROUTE_ROLES lets them
 * reach edit, update and mine, and ArtistService.findEditable decides
 * which profile). Every :id loads through the service first, so another
 * tenant's artist, or another artist's, is a 404.
 */
```

2. Add after `index`:

```ts
	/**
	 * The member's own profile (TAT-30): its edit page. Without one, an
	 * owner goes to the list and an artist to Projects with a note (straight
	 * there: a flash doesn't survive a second redirect).
	 */
	async mine(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const profile = await this.artists.profileOf(tenant, membership.userId);
		if (profile) {
			return ctx.response
				.redirect()
				.toRoute("tenant.artists.edit", { tenant: tenant.slug, id: profile.id });
		}
		if (membership.role === "owner") {
			return ctx.response
				.redirect()
				.toRoute("tenant.artists", { tenant: tenant.slug });
		}
		ctx.session.flash(
			"error",
			`No artist profile is linked to you in ${tenant.name} yet. Ask an owner to link one.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.index", { tenant: tenant.slug });
	}
```

3. Replace `edit` with:

```ts
	async edit(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const userId = membership.userId;
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		// Linking has to succeed: not to someone else's profile, and not a
		// second profile for the same person. Artists never link or unlink.
		const canLink =
			membership.role === "owner" &&
			(artist.userId === userId ||
				(artist.userId === null && !(await this.hasProfile(tenant, userId))));

		return ctx.inertia.render("artists/form", {
			artist: await this.toProps(tenant, artist, userId),
			canLink,
		});
	}
```

4. Replace `update` with:

```ts
	async update(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		// Load first: another tenant's id, or a profile that isn't the
		// artist's, is a 404 even with a bad body.
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(updateArtistValidator);
		const input = toInput(data);
		const owner = membership.role === "owner";

		const saved = await asFieldErrors(() =>
			owner
				? this.artists.update(tenant, artist, input, user)
				: this.artists.updateOwn(tenant, user.id, artist, input),
		);

		ctx.session.flash("success", `"${saved.name}" saved.`);
		return owner
			? ctx.response.redirect().toRoute("tenant.artists", { tenant: tenant.slug })
			: ctx.response
					.redirect()
					.toRoute("tenant.artists.edit", { tenant: tenant.slug, id: saved.id });
	}
```

- [ ] **Step 6: The route and the table**

In `start/routes.ts`, in the artists group, add right after `router.get("/", [controllers.Artists, "index"]).as("tenant.artists");`:

```ts
				// The member's own profile (TAT-30): its edit page, or a note.
				router
					.get("mine", [controllers.Artists, "mine"])
					.as("tenant.artists.mine");
```

and change the artists group comment to `Artist profiles: owners manage every one; an artist edits only the profile linked to them (TENANT_ROUTE_ROLES, ArtistService.findEditable).`

In `app/modules/tenancy/access.ts`, replace the artists entries with:

```ts
	// Artist profiles: owners manage every one; an artist edits only the
	// live profile linked to them, never its link (ArtistService.findEditable,
	// updateOwn).
	"tenant.artists": OWNERS,
	"tenant.artists.mine": MEMBERS,
	"tenant.artists.create": OWNERS,
	"tenant.artists.store": OWNERS,
	"tenant.artists.edit": MEMBERS,
	"tenant.artists.update": MEMBERS,
	"tenant.artists.destroy": OWNERS,
```

In `tests/functional/tenancy/role_access.spec.ts`, add to `ARTIST_ROUTES` (keeping it sorted): `"tenant.artists.edit"`, `"tenant.artists.mine"`, `"tenant.artists.update"` (they go right after `"tenant.alerts.read"`).

In `tests/isolation/cases.ts`, add after the `GET /t/:tenant/artists/new` case:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/artists/mine",
		actor: "owner",
		// The owner has no profile of their own: the list.
		ownStatus: 302,
		snapshot: none,
	},
```

- [ ] **Step 7: Run them (GREEN)**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=artist_service.spec.ts --files=own_profile.spec.ts --files=artists_page.spec.ts --files=artist_form.spec.ts --files=artist_photo.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=role_access.spec.ts` → all pass (the walk now expects the artist to open and save their own profile and to be sent to it by `mine`). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean.

- [ ] **Step 8: Commit**

```
git -C <repo> add apps/platform/app/modules/artists/services/artist_service.ts apps/platform/app/controllers/artists_controller.ts apps/platform/start/routes.ts apps/platform/app/modules/tenancy/access.ts apps/platform/tests apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): let artists edit their own profile, never its link (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The artist's screens and the menu

**Files:**
- Modify: `apps/platform/inertia/layouts/settings.tsx`
- Modify: `apps/platform/inertia/pages/artists/form.tsx`
- Modify: `apps/platform/inertia/components/shell/account_menu.tsx`
- Modify: `apps/platform/tests/unit/inertia/nav_items.spec.ts`

- [ ] **Step 1: The failing nav test**

In `apps/platform/tests/unit/inertia/nav_items.spec.ts`, add `import { rolesFor } from "#modules/tenancy/access";` after the `@japa/runner` import, and add inside `test.group("navItems", …)`:

```ts
	test("every destination a member sees is a route their role may use (TAT-30)", ({
		assert,
	}) => {
		for (const role of ["owner", "artist"] as const) {
			for (const item of navItems({ slug: "bnt", role }, 3, 2)) {
				assert.include(rolesFor(item.route) ?? [], role, `${role}: ${item.route}`);
			}
		}
	});
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts` → passes already (today's nav is right); it guards the next change.

- [ ] **Step 2: The settings layout for a non-owner**

In `apps/platform/inertia/layouts/settings.tsx`, at the top of `SettingsLayout`'s body, replace

```tsx
	const { tenant } = usePage().props;
	const items = tenant ? settingsNav(tenant.slug) : [];
```

with

```tsx
	const { tenant } = usePage().props;
	// An artist reaches only their own profile here (TAT-30): no settings
	// sidebar, whose links are all owners only.
	if (tenant && tenant.role !== "owner") {
		return (
			<Page
				title="Your artist profile"
				description="What clients see about you on the studio page."
			>
				<Card>
					<CardContent>{children}</CardContent>
				</Card>
			</Page>
		);
	}
	const items = tenant ? settingsNav(tenant.slug) : [];
```

and add to the layout's doc comment: ` * A non-owner (an artist on their own profile, TAT-30) gets the card alone.`

- [ ] **Step 3: The form for an artist**

In `apps/platform/inertia/pages/artists/form.tsx`:

1. In `ArtistForm`, after `const params = { tenant: tenant.slug };`, add `const owner = tenant.role === "owner";` and change the `Section` title to `title={owner ? (artist ? "Edit artist" : "Add an artist") : "Profile"}`.
2. Pass `owner={owner}` to both `<ArtistFields …/>` and add `owner: boolean;` to `ArtistFields`' props (destructure it).
3. Replace the Cancel link with:

```tsx
				<Link
					route={owner ? "tenant.artists" : "tenant.projects.index"}
					routeParams={{ tenant: tenantSlug }}
					className={buttonVariants({ variant: "ghost" })}
				>
					Cancel
				</Link>
```

4. Change the doc comment of `ArtistForm` to: `Adds an artist (artist is null) or edits one. canLink says whether "This is my profile" can succeed for the signed-in owner; an artist on their own profile (TAT-30) never gets it, and their Cancel goes to Projects.`

The submit button already reads "Saving…" while in flight and the inputs are the existing ones; nothing else changes. If `Link`'s `route` prop rejects a conditional expression in typecheck, write two `<Link>` elements under `owner ? … : …` instead.

- [ ] **Step 4: The account menu**

In `apps/platform/inertia/components/shell/account_menu.tsx`:

1. Imports: add `Link` to `import { Form } from "@adonisjs/inertia/react";` (→ `import { Form, Link } from "@adonisjs/inertia/react";`) and `UserRound` to the lucide import.
2. Change `const { user } = usePage().props;` to `const { user, tenant } = usePage().props;`.
3. Right after `<DropdownMenuSeparator />`, add:

```tsx
				{tenant?.role === "artist" && (
					<DropdownMenuItem asChild>
						<Link
							route="tenant.artists.mine"
							routeParams={{ tenant: tenant.slug }}
						>
							<UserRound />
							Your artist profile
						</Link>
					</DropdownMenuItem>
				)}
```

4. Add to the component's doc comment: `Artists also get "Your artist profile" (TAT-30).`

- [ ] **Step 5: Checks**

`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck` → clean; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check` → clean (fix with `pnpm -C <repo> exec biome check --write <files>` on the changed files only); `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts` → pass.

- [ ] **Step 6: Commit**

```
git -C <repo> add apps/platform/inertia apps/platform/tests/unit/inertia/nav_items.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): give artists their profile page and a way to it (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:** `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/docs/ui.md`, `docs/requirements.md`, `docs/architecture.md`.

- [ ] **Step 1: backend.md**

1. "Tenancy and route access", the third bullet: replace the sentences from `Limit a route to some roles with` through `without the role check.` with:

`Who may use each tenant route is one table, TENANT_ROUTE_ROLES in #modules/tenancy/access (TAT-30): route name → the roles that may use it (OWNERS or MEMBERS; owners are in every entry). The role middleware (middleware.role(), last in the /t/:tenant group after tenant()) reads it on every request and gives any other role the same 404; a route the table doesn't name throws. A new tenant route needs a name, an entry there (tenant_routes.spec.ts fails otherwise), an isolation case, and, if artists may use it, an edit of ARTIST_ROUTES in role_access.spec.ts, which sends every route as an artist. The table decides routes; which records an artist reaches stays with each module's service (its comments name them: ProjectService.findFor / lockFor, BookingService.bookableArtists, mayChangeSession, CalendarService.load, AlertService, paymentsCard, ArtistService.findEditable). Never add a role check to a route group.`

2. "Artists": replace `The dashboard area is owners only for now; TAT-30 opens it to artists by changing the allow list.` with `Owners manage every profile; an artist edits only the live profile linked to them (TAT-30): findEditable(tenant, editor, id) loads it (owners any, an artist their own, a 404 otherwise), updateOwn(tenant, userId, artist, input) saves every field but the link and re-checks the link under the row lock, and profileOf(tenant, userId) gives a member's own profile (GET /t/:tenant/artists/mine opens it). update and updateOwn share a private save.`

3. "Scheduling", the TAT-85 bullet: after `Who may change a session is mayChangeSession (#modules/scheduling/outcomes):` keep the sentence and add at its end ` It is the record rule behind the sessions entries of TENANT_ROUTE_ROLES.`

- [ ] **Step 2: testing.md**

In "Tenant isolation tests", after the bullet that starts `Every /t/:tenant route needs an entry in tests/isolation/cases.ts`, add:

`- Roles (TAT-30): every /t/:tenant route also needs an entry in TENANT_ROUTE_ROLES (#modules/tenancy/access); tenant_routes.spec.ts fails for a route without one and for a route without the role check after tenant. role_access.spec.ts sends every isolation case as studio A's artist, linked to its artist profile with every project assigned to it and an alert of their own: an owner-only route must be a 404 with the case's snapshot unchanged, any other route the case's own status (and a write must change the snapshot). It pins ARTIST_ROUTES, the routes open to artists: opening one is an edit of the table and of that list. seededStudio(slug, name) (#tests/helpers/tenants) seeds one studio like twoStudios' and caseRequest (#tests/helpers/isolation) sends one case.`

- [ ] **Step 3: ui.md**

In "App shell", after the sentence about the Alerts link, add: `The account menu has "Your artist profile" for artists (tenant.artists.mine, TAT-30); SettingsLayout shows a non-owner (an artist on their own profile) only the card, titled "Your artist profile", without the settings sidebar. TAT-107 and TAT-108 redo navigation.`

- [ ] **Step 4: requirements.md and architecture.md**

`docs/requirements.md`, the role table's artist row: replace `Their own profile, plus the projects and sessions assigned to them (with those projects' payments and balance, read-only)` with `Their own profile (everything on it but the link to their login), plus the projects and sessions assigned to them (with those projects' payments and balance, read-only)`.

`docs/architecture.md`, under the numbered tenant-isolation rules (after rule 5), add a line: `Which role may use each dashboard route is one table (TENANT_ROUTE_ROLES), read on every request; which records an artist reaches is the owning module's service rule (TAT-30).` If the numbered list there has no rule about roles, put it as a sentence after the list.

- [ ] **Step 5: Commit**

```
git -C <repo> add apps/platform/docs docs/requirements.md docs/architecture.md
git -C <repo> commit -m "docs: describe the role table and the artist's own profile (TAT-30)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> typecheck`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> build` → clean.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` leaves `git -C <repo> status` clean.
- [ ] The full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/final.log 2>&1` → its `Tests` line shows no failure. The count is the baseline's plus: 3 (`access.spec.ts`), 3 (`role_middleware.spec.ts`), −7 (`tenant_routes.spec.ts`: two tests replace the nine per-area tests), 57 (`role_access.spec.ts`: one per isolation case, 56 after Task 4, plus the list test), 4 (`artist_service.spec.ts`), 7 (`own_profile.spec.ts`), 1 (`nav_items.spec.ts`) and 1 (the new `cross_tenant.spec.ts` case): baseline + 69. If your count differs, list each file's count in the report; don't chase the number.
- [ ] `git -C <repo> grep -n "middleware.role({" -- apps/platform` prints nothing.

### Task 8: Browser pass (owner regression)

No artist account can exist before TAT-33 (the artist screens are TAT-33's browser pass). Dev server on `PORT=3401` (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3401 pnpm -C <repo>/apps/platform dev`), signed in as the QA owner. At 375 px and 1280 px, light and dark:

1. Inbox, a project (open it; make or copy a deposit link; record a desk payment), Clients, Calendar: all work as before.
2. Settings: each page (Studio profile, Payments, Messages, Artists) opens with the sidebar; edit and save an artist.
3. The account menu has no "Your artist profile" (owners only see it never).
4. `/t/<slug>/artists/mine` as the owner: the artists list (or the owner's own profile if linked).

Stop the dev server afterwards.

### Task 9: PR text (not committed)

Write `<scratchpad>/tat-30-pr.md`: title `feat(platform): one role table for every tenant route, and artists' own profiles (TAT-30)`; body: the rulings in one line each, what changed for owners (nothing) and for artists (their own profile, the account menu link), the tests (the walk, the table checks), the size (3 points, ruling 1), the carry-forwards of the spec, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
