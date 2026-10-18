# Session cookie hardening and the app/storefront domain split (TAT-9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In production the dashboard's session cookie is `__Host-td-session` (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain), the platform refuses to start with an http `APP_URL` or one that shares the studio pages' domain, and CSRF protection is pinned by tests.

**Architecture:** One pure cookie policy (`#services/cookie_policy`) feeds `config/session.ts` and `config/app.ts`'s cookie defaults, switched by `app.inProduction` only. One pure boot check (`#services/app_origin`) runs in `start/env.ts` after `Env.create`. Tests cover the policy in both modes, production's real `Set-Cookie` lines through `ResponseFactory`, every cookie the dashboard sets, session fixation, CSRF refusals and production boots in real processes.

**Tech Stack:** AdonisJS 7 (`@adonisjs/session` 8.1.0, `@adonisjs/shield` 9.0.0, `@adonisjs/auth` 10.1.0, `@adonisjs/http-server` 9.3.1 with cookie-es 3.1.1), Japa (`@japa/api-client`, the session, shield and auth plugins), Node 24.3.0, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-9-session-cookie-hardening-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- **No migration, no route, no dependency change, no new setting.** No `package.json` or lockfile edit. Never edit `apps/platform/database/schema.ts`, `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts` or `apps/platform/.adonisjs/`; nothing here needs codegen.
- Names and values, verbatim: `SESSION_COOKIE = "td-session"`; production name `__Host-td-session`; attributes `{ path: "/", httpOnly: true, secure: <production>, sameSite: "lax" }`, never a `domain`; the HTTP defaults keep `maxAge: "2h"`; the session keeps `age: "2h"`, `clearWithBrowser: false`; `useRememberMeTokens` stays `false`; Shield's config does not change.
- Error messages start, verbatim: `APP_URL must be an https URL in production` and `APP_URL (<host>) and the studio pages (STOREFRONT_URL, *.<domain>) must be on separate domains in production`.
- The cookie switch is `app.inProduction` (`NODE_ENV=production`) only. Never `request.secure()`, `request.protocol()` or a setting.
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root. Platform tests use `PORT=3402` (3333 is taken). `<scratchpad>` is the session's scratchpad directory; logs go there, never `/tmp`. Never `sh -c`, never `pkill -f`; a full suite runs in the background (about 2 minutes): wait for its notification, no foreground `sleep`.
- A spec that imports a missing module makes Japa hang: RED runs use `timeout 90` and a log file; exit 124 plus "Cannot find module" is that RED. Read the log's `Tests N passed` / `failed` line, not the wrapper's exit code.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with an area scope, header and body lines at most 100 characters, ending with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never open a PR.
- New test slugs and emails end in `td9` (the dev database keeps every slug ever used).

## Review Focus

1. No `Set-Cookie` from the dashboard carries a `Domain`, in any mode, and every one has `Path=/` and `SameSite=Lax`. Tests: Task 2 "every cookie the dashboard sets…"; Task 1 "in production a Domain… makes the serializer throw"; mutation (b) in Task 7.
2. The prefix and `Secure` switch together, on `app.inProduction` only. Tests: Task 1's two policy tests and the exact production lines; mutation (a) and (e).
3. A planted session id never survives login. Test: Task 2 "signing in issues a new session id…".
4. A dashboard write without a token, or with another session's token, changes nothing. Test: Task 3; mutation (c).
5. Production boot refuses an http `APP_URL` (web server and ace) and a nested domain; a loopback `APP_URL` skips only the domain comparison. Tests: Task 4 and Task 5; mutation (d).

## Files

| File | Task | Role |
|---|---|---|
| `apps/platform/app/services/cookie_policy.ts` (new) | 1 | `SESSION_COOKIE`, `sessionCookieName`, `cookieAttributes` |
| `apps/platform/tests/helpers/cookies.ts` (new) | 1 | `setCookieLines`, `parseSetCookie` |
| `apps/platform/tests/unit/services/cookie_policy.spec.ts` (new) | 1 | the policy and production's real lines |
| `apps/platform/config/session.ts`, `apps/platform/config/app.ts` | 2 | the policy wired in |
| `apps/platform/tests/functional/auth/cookies.spec.ts` (new) | 2 | every cookie, resolved configs, fixation |
| `apps/platform/tests/functional/api/stateless.spec.ts` | 2 | the name from the policy |
| `apps/platform/tests/functional/auth/csrf.spec.ts` (new) | 3 | CSRF refusals and the Shield guard |
| `apps/platform/app/services/app_origin.ts` (new) | 4 | `checkAppOrigin`, `studioDomain` |
| `apps/platform/tests/unit/services/app_origin.spec.ts` (new) | 4 | the boot check's cases |
| `apps/platform/tests/helpers/boot.ts` (new), `apps/platform/tests/functional/rls/role_guard.spec.ts` | 5 | `boot`, moved |
| `apps/platform/start/env.ts` | 5 | the boot call |
| `apps/platform/tests/functional/auth/production_boot.spec.ts` (new) | 5 | real production boots |
| `docs/architecture.md`, `docs/requirements.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/.env.example`, `README.md`, and `apps/platform/docs/deploy.md` or `apps/platform/database/README.md` | 6 | docs and the checklist |

---

## Task 0: Preconditions

**Files:** none changed.

- [ ] **Step 1: The base holds the built chain.** This branch was designed on 37a612d, which has only TAT-24's code. Run:

```bash
git log --oneline -1
git status --short
rg -n "export function checkStorefrontUrl|export function studioHostname|export function pointsAtThisMachine" apps/platform/app/services/storefront_url.ts
rg -n "STOREFRONT_URL|export default await Env.create" apps/platform/start/env.ts
rg -n "=== \"production\"" apps/platform/start/env.ts
rg -n "cookieName: \"adonis-session\"|secure: app.inProduction" apps/platform/config/session.ts
rg -n "domain: \"\"|secure: app.inProduction" apps/platform/config/app.ts
rg -n "useRememberMeTokens: false" apps/platform/config/auth.ts
rg -n "enabled: true|exceptRoutes: \[\]|enableXsrfCookie: true" apps/platform/config/shield.ts
rg -n "adonis-session=" apps/platform/tests/functional/api/stateless.spec.ts
rg -n "^async function boot|^function bootAsOwner|^const run = promisify" apps/platform/tests/functional/rls/role_guard.spec.ts
rg -n "export async function studioWithOwner" apps/platform/tests/helpers/tenants.ts
rg -n -i "adonis-session|adonis_session" apps packages README.md docs --glob '!docs/superpowers/**'
ls apps/platform/docs/deploy.md
```

Expected: the tree is clean and every pattern is found. The `adonis-session` search lists only `config/session.ts` and `stateless.spec.ts`; anything else it lists is updated in Task 2 Step 4 the same way. If any other pattern is missing, STOP: the branch must first be rebased onto the newest built tip of the stack (it must hold TAT-32 and TAT-65 at least; the newest tip also has TAT-12, 23, 44, 48 and 55); that is the coordinator's call, and only the spec and plan commit sits on top. Note two answers for later: (1) the settings `start/env.ts` requires in production (the `=== "production"` lines): Task 5's `PRODUCTION` list must cover every one besides `STOREFRONT_URL`; (2) whether `apps/platform/docs/deploy.md` exists (TAT-38 built): Task 6 Step 7 uses it.

- [ ] **Step 2: Node and a baseline.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` (expect `v24.3.0`). Then, in the background, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 600 pnpm -C apps/platform test > <scratchpad>/t9-baseline.log 2>&1` and note the `Tests N passed` count: every later full run must be N plus the new tests.

No commit.

---

### Task 1: The cookie policy

**Files:**
- Create: `apps/platform/tests/helpers/cookies.ts`
- Create: `apps/platform/tests/unit/services/cookie_policy.spec.ts`
- Create: `apps/platform/app/services/cookie_policy.ts`

**Interfaces:**
- Produces: `SESSION_COOKIE`, `sessionCookieName(production)`, `cookieAttributes(production)` (Tasks 2, 3); `setCookieLines`, `parseSetCookie` (Task 2).

- [ ] **Step 1: The test helpers.** Create `apps/platform/tests/helpers/cookies.ts`:

```ts
/**
 * Set-Cookie lines from a test client response
 * (`response.headers()["set-cookie"]`) or from a response built with
 * ResponseFactory (`response.getHeader("set-cookie")`).
 */
export function setCookieLines(header: unknown): string[] {
	if (header === undefined || header === null) {
		return [];
	}
	return [header].flat().map(String);
}

export type SetCookie = { name: string; attributes: string[] };

/**
 * One Set-Cookie line: the cookie's name and its attributes in lower case
 * ("path=/", "httponly", "samesite=lax"), without the value.
 */
export function parseSetCookie(line: string): SetCookie {
	const [pair, ...attributes] = line.split(/;\s*/);
	return {
		name: pair.slice(0, pair.indexOf("=")),
		attributes: attributes.map((attribute) => attribute.toLowerCase()),
	};
}
```

- [ ] **Step 2: Write the failing test.** Create `apps/platform/tests/unit/services/cookie_policy.spec.ts`:

```ts
import { ResponseFactory } from "@adonisjs/core/factories/http";
import { test } from "@japa/runner";
import {
	cookieAttributes,
	SESSION_COOKIE,
	sessionCookieName,
} from "#services/cookie_policy";
import { setCookieLines } from "#tests/helpers/cookies";

/**
 * A response with production's cookie defaults (config/app.ts with
 * NODE_ENV=production), written by the real serializer. Tests never run in
 * production, so this is where production's Set-Cookie lines are checked.
 */
function productionResponse() {
	return new ResponseFactory()
		.merge({ config: { cookie: { ...cookieAttributes(true), maxAge: "2h" } } })
		.create();
}

test.group("Cookie policy (TAT-9)", () => {
	test("production: __Host-td-session, Secure, HttpOnly, SameSite=Lax, on /, no domain", ({
		assert,
	}) => {
		assert.equal(SESSION_COOKIE, "td-session");
		assert.equal(sessionCookieName(true), "__Host-td-session");
		assert.deepEqual(
			{ ...cookieAttributes(true) },
			{ path: "/", httpOnly: true, secure: true, sameSite: "lax" },
		);
	});

	test("development and tests: td-session, the same without Secure", ({
		assert,
	}) => {
		assert.equal(sessionCookieName(false), "td-session");
		assert.deepEqual(
			{ ...cookieAttributes(false) },
			{ path: "/", httpOnly: true, secure: false, sameSite: "lax" },
		);
	});

	test("the real serializer writes production's session and XSRF-TOKEN lines exactly", ({
		assert,
	}) => {
		const response = productionResponse();
		response.cookie(sessionCookieName(true), "a-session-id", {
			...cookieAttributes(true),
			maxAge: "2h",
		});
		// What Shield's CSRF guard does on every dashboard response.
		response.encryptedCookie("XSRF-TOKEN", "a-token", { httpOnly: false });

		const [session, xsrf] = setCookieLines(response.getHeader("set-cookie"));
		assert.match(
			session,
			/^__Host-td-session=[^;]+; Max-Age=7200; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
		);
		assert.match(
			xsrf,
			/^XSRF-TOKEN=[^;]+; Max-Age=7200; Path=\/; Secure; SameSite=Lax$/,
		);
	});

	test("in production a Domain, or a missing Secure, makes the serializer throw for the session cookie", ({
		assert,
	}) => {
		const response = productionResponse();
		assert.throws(
			() =>
				response.cookie(sessionCookieName(true), "an-id", {
					...cookieAttributes(true),
					domain: "example.com",
				}),
			/Domain/,
		);
		assert.throws(
			() =>
				response.cookie(sessionCookieName(true), "an-id", {
					...cookieAttributes(false),
				}),
			/Secure/,
		);
	});
});
```

- [ ] **Step 3: Run it to see it fail.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=cookie_policy.spec.ts > <scratchpad>/t9-t1-red.log 2>&1`. Expected: exit 124 and "Cannot find module" naming `cookie_policy` in the log.

- [ ] **Step 4: Write the policy.** Create `apps/platform/app/services/cookie_policy.ts`:

```ts
/**
 * The dashboard's cookie policy (TAT-9). Studio pages run on subdomains of
 * the storefront's domain, and a studio can bring a domain of its own, so
 * no page but the dashboard's own host may ever read, set or overwrite its
 * session. In production the session cookie is `__Host-td-session`: the
 * prefix makes browsers refuse it unless it is Secure, on `/` and without
 * a Domain, so no other host can plant or replace it.
 *
 * Development and tests run over plain http (localhost, `*.localhost`, a
 * phone on the LAN), where browsers drop Secure and `__Host-` cookies, so
 * there the name is `td-session` and Secure is off; everything else is the
 * same everywhere. The switch is the environment (`app.inProduction`),
 * never the request: behind a TLS-terminating proxy the app sees http.
 * Pure: imports nothing.
 */

/** The session cookie's name without its production prefix. */
export const SESSION_COOKIE = "td-session";

/** The session cookie's name: `__Host-td-session` in production. */
export function sessionCookieName(production: boolean): string {
	return production ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/**
 * The attributes of every cookie the app sets: `config/session.ts` gives
 * them to the session cookie and `config/app.ts` makes them the defaults of
 * every other cookie. Never add a `domain`: the cookie would reach every
 * subdomain, and in production the serializer refuses it for the `__Host-`
 * session cookie, so every request would fail.
 */
export function cookieAttributes(production: boolean) {
	return {
		path: "/",
		httpOnly: true,
		secure: production,
		sameSite: "lax",
	} as const;
}
```

- [ ] **Step 5: Run it to see it pass.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=cookie_policy.spec.ts > <scratchpad>/t9-t1-green.log 2>&1`. Expected: `Tests 4 passed`. If a `throws` pattern fails only on the message, read the thrown message: cookie-es 3.1.1 says "__Host- cookies must not have a Domain attribute" and "__Host-td-session cookies must have the Secure attribute"; keep the test's point (it throws) and match the real words.

- [ ] **Step 6: Commit.**

```bash
git add apps/platform/app/services/cookie_policy.ts apps/platform/tests/helpers/cookies.ts apps/platform/tests/unit/services/cookie_policy.spec.ts
git commit -m "feat(platform): add the cookie policy, with a __Host- session cookie in production" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The session cookie and the cookie defaults follow the policy

**Files:**
- Create: `apps/platform/tests/functional/auth/cookies.spec.ts`
- Modify: `apps/platform/config/session.ts`, `apps/platform/config/app.ts`, `apps/platform/tests/functional/api/stateless.spec.ts`

**Interfaces:**
- Consumes: Task 1's policy and helpers; `User` (`#models/user`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests.** Create `apps/platform/tests/functional/auth/cookies.spec.ts`:

```ts
import { configProvider } from "@adonisjs/core";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import User from "#models/user";
import { cookieAttributes, sessionCookieName } from "#services/cookie_policy";
import { parseSetCookie, setCookieLines } from "#tests/helpers/cookies";

const SESSION = sessionCookieName(app.inProduction);

/**
 * Every cookie the dashboard sets (TAT-9 spec, ruling 3). A new one fails
 * the guard below: give it the cookie policy, a row in the spec's cookie
 * table, and a place here.
 */
const KNOWN = [SESSION, "XSRF-TOKEN", "remember_web"];

const EMAIL = "owner@cookies-td9.example";
const PASSWORD = "secret-password";

/**
 * Asserts the policy on every Set-Cookie line of a dashboard response and
 * returns the cookies' names.
 */
function assertPolicy(assert: Assert, header: unknown): string[] {
	const lines = setCookieLines(header);
	assert.isAbove(lines.length, 0, "the response sets no cookie");
	for (const line of lines) {
		const { name, attributes } = parseSetCookie(line);
		assert.include(KNOWN, name, `${name} is not a known cookie`);
		assert.isUndefined(
			attributes.find((attribute) => attribute.startsWith("domain=")),
			`${name} names a Domain`,
		);
		assert.include(attributes, "path=/", name);
		assert.include(attributes, "samesite=lax", name);
		assert.equal(
			attributes.includes("secure"),
			app.inProduction,
			`${name}: Secure exactly in production`,
		);
		assert.equal(
			attributes.includes("httponly"),
			name !== "XSRF-TOKEN",
			`${name}: HttpOnly on all but XSRF-TOKEN`,
		);
	}
	return lines.map((line) => parseSetCookie(line).name);
}

test.group("Dashboard cookies (TAT-9)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("every cookie the dashboard sets is host-only, on /, SameSite=Lax, and Secure only in production", async ({
		client,
		assert,
	}) => {
		const user = await User.create({ email: EMAIL, password: PASSWORD });

		const page = await client.get("/login");
		page.assertStatus(200);
		assert.includeMembers(assertPolicy(assert, page.headers()["set-cookie"]), [
			SESSION,
			"XSRF-TOKEN",
		]);

		const login = await client
			.post("/login")
			.form({ email: EMAIL, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);
		login.assertStatus(302);
		assert.includeMembers(
			assertPolicy(assert, login.headers()["set-cookie"]),
			[SESSION, "XSRF-TOKEN", "remember_web"],
		);

		const dashboard = await client.get("/dashboard").loginAs(user).redirects(0);
		dashboard.assertStatus(302);
		assert.include(
			assertPolicy(assert, dashboard.headers()["set-cookie"]),
			SESSION,
		);

		const logout = await client
			.post("/logout")
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);
		logout.assertStatus(302);
		assert.includeMembers(
			assertPolicy(assert, logout.headers()["set-cookie"]),
			[SESSION, "remember_web"],
		);
	});

	test("the resolved session and cookie configs follow the policy and name no domain", async ({
		assert,
	}) => {
		const session = await configProvider.resolve<{
			cookieName: string;
			cookie: Record<string, unknown>;
		}>(app, app.config.get("session"));
		assert.equal(session?.cookieName, SESSION);
		assert.containSubset(session?.cookie, {
			...cookieAttributes(app.inProduction),
		});
		assert.notProperty(session?.cookie, "domain");

		const http = app.config.get<{ cookie: Record<string, unknown> }>(
			"app.http",
		);
		assert.containSubset(http.cookie, { ...cookieAttributes(app.inProduction) });
		assert.notProperty(http.cookie, "domain");
	});

	test("signing in issues a new session id, so a planted one never carries the login", async ({
		client,
		assert,
	}) => {
		await User.create({ email: EMAIL, password: PASSWORD });
		const request = client
			.post("/login")
			.form({ email: EMAIL, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);
		// The session plugin's client is one per request: this is the id the
		// request sends in its session cookie.
		const planted = request.sessionClient.sessionId;

		const response = await request;

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
		const issued = response.cookie(SESSION)?.value;
		assert.isString(issued);
		assert.notEqual(issued, planted);
	});
});
```

- [ ] **Step 2: Run them to see them fail.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=cookies.spec.ts > <scratchpad>/t9-t2-red.log 2>&1`. Expected: all three fail: "adonis-session is not a known cookie"; the resolved name is `adonis-session` (and `config/app.ts` still has `domain: ""`); the fixation test finds no `td-session` cookie. The fixation test fails only on the name: `@adonisjs/auth` already regenerates the id, so after Step 3 it is a regression pin.

- [ ] **Step 3: Wire the policy.** Replace `apps/platform/config/session.ts` with:

```ts
import app from "@adonisjs/core/services/app";
import { defineConfig, stores } from "@adonisjs/session";
import { cookieAttributes, sessionCookieName } from "#services/cookie_policy";
import env from "#start/env";

const sessionConfig = defineConfig({
	/**
	 * Enable or disable session support globally.
	 */
	enabled: true,

	/**
	 * `__Host-td-session` in production, `td-session` in development and
	 * tests (TAT-9, #services/cookie_policy).
	 */
	cookieName: sessionCookieName(app.inProduction),

	/**
	 * When set to true, the session id cookie will be deleted
	 * once the user closes the browser.
	 */
	clearWithBrowser: false,

	/**
	 * Define how long to keep the session data alive without
	 * any activity.
	 */
	age: "2h",

	/**
	 * Host-only (never a Domain), on `/`, HttpOnly, SameSite=Lax, and Secure
	 * in production (#services/cookie_policy). The cookie store's data
	 * cookie, named by the session id, gets the same options.
	 */
	cookie: cookieAttributes(app.inProduction),

	/**
	 * The store to use. Make sure to validate the environment
	 * variable in order to infer the store name without any
	 * errors.
	 */
	store: env.get("SESSION_DRIVER"),

	/**
	 * List of configured stores. Refer documentation to see
	 * list of available stores and their config.
	 */
	stores: {
		/**
		 * Store session data inside encrypted cookies.
		 */
		cookie: stores.cookie(),

		/**
		 * Store session data inside the configured database.
		 */
		database: stores.database(),
	},
});

export default sessionConfig;
```

In `apps/platform/config/app.ts`, replace the whole `cookie: { … },` block of `http` (from the comment "Manage cookies configuration." to the block's closing `},`) with:

```ts
	/**
	 * Defaults for every cookie the app sets (TAT-9, #services/cookie_policy):
	 * host-only (never a Domain), on `/`, HttpOnly, SameSite=Lax, Secure in
	 * production. Shield's XSRF-TOKEN (made readable by the page), the auth
	 * guard's remember_web clearing and every clearCookie use them; the
	 * session cookie's own options are in config/session.ts.
	 */
	cookie: {
		...cookieAttributes(app.inProduction),
		maxAge: "2h",
	},
```

and add `import { cookieAttributes } from "#services/cookie_policy";` to its imports (Biome sorts them: it goes before any other `#services/…` import and before `#start/env`).

- [ ] **Step 4: TAT-32's stateless test reads the name from the policy.** In `apps/platform/tests/functional/api/stateless.spec.ts`, test "the dashboard still gets its session and CSRF cookies", replace `assert.include(cookies, "adonis-session=");` with:

```ts
		assert.include(cookies, `${sessionCookieName(app.inProduction)}=`);
```

and add the imports `import app from "@adonisjs/core/services/app";` and `import { sessionCookieName } from "#services/cookie_policy";`. Do the same for any other file Task 0's `adonis-session` search listed.

- [ ] **Step 5: Run them to see them pass.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=cookies.spec.ts --files=stateless.spec.ts --files=access.spec.ts --files=page_history.spec.ts --files=rate_limits.spec.ts > <scratchpad>/t9-t2-green.log 2>&1`. Expected: every test passes (`.loginAs()` and `.withCsrfToken()` read the configured name). If `request.sessionClient` doesn't typecheck, the session plugin's typings aren't loaded in that file: add `import "@adonisjs/session/plugins/api_client";` at the top, as a side-effect import.

- [ ] **Step 6: Commit.**

```bash
git add apps/platform/config/session.ts apps/platform/config/app.ts apps/platform/tests/functional/auth/cookies.spec.ts apps/platform/tests/functional/api/stateless.spec.ts
git commit -m "feat(platform): name the session cookie td-session, __Host- and Secure in production" -m "Every cookie the dashboard sets is host-only, on /, SameSite=Lax. Everyone signs out once." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CSRF stays on, pinned

**Files:**
- Create: `apps/platform/tests/functional/auth/csrf.spec.ts`

**Interfaces:**
- Consumes: `studioWithOwner`, `inTenant` (`#tests/helpers/tenants`), `Tenant` (`#modules/tenancy/models/tenant`).

- [ ] **Step 1: Write the tests.** Create `apps/platform/tests/functional/auth/csrf.spec.ts`:

```ts
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "csrf-guard-td9";
const PROFILE = `/t/${SLUG}/settings/profile`;
const REFUSED = "Invalid or expired CSRF token";

/** The studio profile form as the browser sends it (studio_profile.spec.ts). */
const form = {
	name: "Renamed Studio",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@csrf-guard-td9.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
};

async function nameOf(tenant: Tenant) {
	return (await inTenant(tenant, () => Tenant.findOrFail(tenant.id))).name;
}

test.group("CSRF on dashboard writes (TAT-9)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a write without a token, or with another session's token, is refused and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "CSRF Guard");

		const missing = await client
			.put(PROFILE)
			.form(form)
			.loginAs(owner)
			.redirects(0);
		missing.assertStatus(302);
		missing.assertFlashMessage("error", REFUSED);

		// A real token, issued to another visitor's session.
		const elsewhere = (await client.get("/login")).cookie("XSRF-TOKEN")?.value;
		assert.isString(elsewhere);
		const foreign = await client
			.put(PROFILE)
			.form(form)
			.header("x-csrf-token", String(elsewhere))
			.loginAs(owner)
			.redirects(0);
		foreign.assertStatus(302);
		foreign.assertFlashMessage("error", REFUSED);

		assert.equal(await nameOf(tenant), "CSRF Guard");

		// Positive control: the same write with this session's token saves.
		const saved = await client
			.put(PROFILE)
			.form(form)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		saved.assertStatus(302);
		saved.assertHeader("location", PROFILE);
		assert.equal(await nameOf(tenant), "Renamed Studio");
	});

	test("a logout without a token leaves the user signed in", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner(SLUG, "CSRF Guard");

		const response = await client.post("/logout").loginAs(owner).redirects(0);

		response.assertStatus(302);
		response.assertFlashMessage("error", REFUSED);
		response.assertSession("auth_web");
	});

	test("Shield's CSRF stays on for every write, with no exceptions", ({
		assert,
	}) => {
		const csrf = app.config.get<{
			enabled: boolean;
			exceptRoutes: unknown;
			enableXsrfCookie: boolean;
			methods: string[];
			cookieOptions?: Record<string, unknown>;
		}>("shield.csrf");
		assert.isTrue(csrf.enabled);
		assert.deepEqual(csrf.exceptRoutes, []);
		assert.isTrue(csrf.enableXsrfCookie);
		assert.sameMembers(csrf.methods, ["POST", "PUT", "PATCH", "DELETE"]);
		assert.notProperty(csrf.cookieOptions ?? {}, "domain");
	});
});
```

- [ ] **Step 2: Run them.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=csrf.spec.ts > <scratchpad>/t9-t3.log 2>&1`. Expected: `Tests 3 passed`: they pin today's behaviour. If the flash text differs, read it from the log (`response.flashMessages()`) and use Shield's real message.

- [ ] **Step 3: Prove they can fail.** Set `enabled: false` in `csrf` of `apps/platform/config/shield.ts`, run Step 2 again: the first two tests and the config guard must fail. Then `git checkout -- apps/platform/config/shield.ts` and run Step 2 once more (3 passed).

- [ ] **Step 4: Commit.**

```bash
git add apps/platform/tests/functional/auth/csrf.spec.ts
git commit -m "test(platform): pin CSRF refusals on dashboard writes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The boot check for the dashboard's origin

**Files:**
- Create: `apps/platform/tests/unit/services/app_origin.spec.ts`
- Create: `apps/platform/app/services/app_origin.ts`

**Interfaces:**
- Consumes: `studioHostname`, `pointsAtThisMachine` (`#services/storefront_url`).
- Produces: `checkAppOrigin(appUrl, storefrontTemplate, production)`, `studioDomain(template)` (Task 5).

- [ ] **Step 1: Write the failing test.** Create `apps/platform/tests/unit/services/app_origin.spec.ts`:

```ts
import { test } from "@japa/runner";
import { checkAppOrigin, studioDomain } from "#services/app_origin";

const HTTPS = /APP_URL must be an https URL in production/;
const SEPARATE = /must be on separate domains in production/;

test.group("APP_URL at boot (TAT-9)", () => {
	test("outside production nothing is checked", ({ assert }) => {
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"http://localhost:3333",
				"http://{tenant}.localhost:3000",
				false,
			),
		);
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"http://app.example.com",
				"https://{tenant}.example.com",
				false,
			),
		);
	});

	test("in production APP_URL must be https", ({ assert }) => {
		for (const appUrl of [
			"http://app.tattoodrip.app",
			"http://localhost:3333",
			"app.tattoodrip.app",
		]) {
			assert.throws(
				() =>
					checkAppOrigin(appUrl, "https://{tenant}.tattoodrip.studio", true),
				HTTPS,
				appUrl,
			);
		}
	});

	test("separate domains pass", ({ assert }) => {
		for (const [appUrl, template] of [
			["https://app.tattoodrip.app", "https://{tenant}.tattoodrip.studio"],
			// Two names under a public suffix are separate.
			["https://app.tattoodrip.com.np", "https://{tenant}.inkpages.com.np"],
			["https://tattoodrip.app", "https://{tenant}-ink.tattoodrip.studio"],
			["https://203.0.113.5", "https://{tenant}.example.com"],
			["https://app.example.com:8443/", "https://{tenant}.example-studios.com"],
		]) {
			assert.doesNotThrow(
				() => checkAppOrigin(appUrl, template, true),
				`${appUrl} ${template}`,
			);
		}
	});

	test("an APP_URL on, under or above the studio pages' domain is refused", ({
		assert,
	}) => {
		for (const [appUrl, template] of [
			["https://app.example.com", "https://{tenant}.example.com"],
			["https://example.com", "https://{tenant}.example.com"],
			["https://app.example.com", "https://{tenant}.studios.app.example.com"],
			["https://app.example.com:8443", "https://{tenant}.example.com:3000"],
			["https://APP.Example.COM.", "https://{tenant}.example.com"],
			["https://app.example.com", "https://{tenant}-ink.example.com"],
		]) {
			assert.throws(
				() => checkAppOrigin(appUrl, template, true),
				SEPARATE,
				`${appUrl} ${template}`,
			);
		}
	});

	test("the message names both hosts and a layout that works", ({ assert }) => {
		assert.throws(
			() =>
				checkAppOrigin(
					"https://app.example.com",
					"https://{tenant}.example.com",
					true,
				),
			/APP_URL \(app\.example\.com\) and the studio pages \(STOREFRONT_URL, \*\.example\.com\).*https:\/\/app\.example\.com with studio pages on https:\/\/\{tenant\}\.example-studios\.com/,
		);
	});

	test("a loopback APP_URL (the local production trial) skips the domain comparison, never https", ({
		assert,
	}) => {
		for (const appUrl of ["https://localhost:8443", "https://127.0.0.1:8443"]) {
			assert.doesNotThrow(() =>
				checkAppOrigin(appUrl, "http://{tenant}.localhost:3000", true),
			);
		}
		assert.throws(
			() =>
				checkAppOrigin(
					"http://localhost:8443",
					"http://{tenant}.localhost:3000",
					true,
				),
			HTTPS,
		);
	});

	test("a missing STOREFRONT_URL is left to its own check", ({ assert }) => {
		assert.doesNotThrow(() =>
			checkAppOrigin("https://app.example.com", undefined, true),
		);
	});

	test("known limit: a sibling under a parent you own is not detected (the checklist covers it)", ({
		assert,
	}) => {
		// app.example.com and *.sites.example.com share example.com, but
		// without the Public Suffix List this looks like two .com.np names.
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"https://app.example.com",
				"https://{tenant}.sites.example.com",
				true,
			),
		);
	});

	test("studioDomain is the labels every studio host shares", ({ assert }) => {
		assert.equal(studioDomain("https://{tenant}.example.com"), "example.com");
		assert.equal(studioDomain("https://{tenant}-ink.example.com"), "example.com");
		assert.equal(
			studioDomain("https://ink-{tenant}.studios.example.com:8443/ignored"),
			"studios.example.com",
		);
		assert.equal(studioDomain("http://{tenant}.localhost:3000"), "localhost");
		assert.equal(studioDomain("https://{tenant}.example.com."), "example.com");
	});
});
```

- [ ] **Step 2: Run it to see it fail.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=app_origin.spec.ts > <scratchpad>/t9-t4-red.log 2>&1`. Expected: exit 124 and "Cannot find module" naming `app_origin`.

- [ ] **Step 3: Write the check.** Create `apps/platform/app/services/app_origin.ts`:

```ts
import { pointsAtThisMachine, studioHostname } from "#services/storefront_url";

/**
 * The dashboard's origin in production (TAT-9). The session cookie is
 * `__Host-` and Secure (#services/cookie_policy), so APP_URL must be https,
 * and it must not share a domain with the studio pages (STOREFRONT_URL): a
 * studio page on, under or above the dashboard's host could set and
 * receive its cookies and would be same-site with it. Two hosts under a
 * shared parent (app.example.com and *.sites.example.com) are not detected:
 * without the Public Suffix List that looks like two names under a public
 * suffix such as com.np. start/env.ts runs this once the environment is
 * read, so it imports nothing from the app but the pure storefront_url.
 */

const LAYOUT =
	"https://app.example.com with studio pages on https://{tenant}.example-studios.com";

/** A URL, or undefined when it doesn't parse. */
function parsed(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/** A hostname without its one trailing dot. */
function bare(hostname: string): string {
	return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** Whether `inner` is `outer` or one of its subdomains. */
function within(inner: string, outer: string): boolean {
	return inner === outer || inner.endsWith(`.${outer}`);
}

/**
 * The domain every studio page sits under: the labels two studios' hosts
 * share (`https://{tenant}.example.com` and `https://{tenant}-ink.example.com`
 * both give `example.com`).
 */
export function studioDomain(template: string): string {
	const one = bare(studioHostname(template, "studio-one")).split(".");
	const two = bare(studioHostname(template, "studio-two")).split(".");
	const shared: string[] = [];
	while (one.length > 0 && one.at(-1) === two.at(-1)) {
		shared.unshift(one.pop() as string);
		two.pop();
	}
	return shared.join(".");
}

/**
 * Throws, in production, when APP_URL is not https or shares a domain with
 * the studio pages. A loopback APP_URL (the local production trial behind
 * an HTTPS proxy) skips the domain comparison, never the https rule. A
 * missing STOREFRONT_URL is left to its own check, which refuses it in
 * production. The messages name hosts only.
 */
export function checkAppOrigin(
	appUrl: string,
	storefrontTemplate: string | undefined,
	production: boolean,
): void {
	if (!production) {
		return;
	}
	const origin = parsed(appUrl);
	if (!origin || origin.protocol !== "https:") {
		throw new Error(
			"APP_URL must be an https URL in production: the dashboard's session cookie is __Host- and Secure, which browsers drop over http, so nobody could sign in (e.g. https://app.example.com)",
		);
	}
	if (!storefrontTemplate || pointsAtThisMachine(appUrl)) {
		return;
	}
	const appHost = bare(origin.hostname);
	const studios = studioDomain(storefrontTemplate);
	if (studios && (within(appHost, studios) || within(studios, appHost))) {
		throw new Error(
			`APP_URL (${appHost}) and the studio pages (STOREFRONT_URL, *.${studios}) must be on separate domains in production: with one inside the other, a studio page can set and receive the dashboard's cookies. Use e.g. ${LAYOUT}`,
		);
	}
}
```

- [ ] **Step 4: Run it to see it pass.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=app_origin.spec.ts --files=storefront_url.spec.ts > <scratchpad>/t9-t4-green.log 2>&1`. Expected: every test passes.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/app_origin.ts apps/platform/tests/unit/services/app_origin.spec.ts
git commit -m "feat(platform): check that the dashboard's origin is https and off the studio domain" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Every production process runs the check

**Files:**
- Create: `apps/platform/tests/helpers/boot.ts`
- Modify: `apps/platform/tests/functional/rls/role_guard.spec.ts`
- Create: `apps/platform/tests/functional/auth/production_boot.spec.ts`
- Modify: `apps/platform/start/env.ts`

**Interfaces:**
- Consumes: `checkAppOrigin` (Task 4).
- Produces: `boot(args, overrides, timeout?)` in `#tests/helpers/boot`.

- [ ] **Step 1: Share TAT-29's `boot`.** Create `apps/platform/tests/helpers/boot.ts` holding the `run` constant and the `boot` function moved verbatim from `role_guard.spec.ts` (its doc comment "Boots a real process…" included), with `export` added:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import app from "@adonisjs/core/services/app";
import env from "#start/env";

const run = promisify(execFile);

/**
 * Boots a real process. It has to end by itself within `timeout`; one that
 * keeps running is killed and comes back as `killed`, which is a failure.
 * SIGKILL, not execFile's default SIGTERM: a warmup app (codegen) handles
 * SIGTERM with app.terminate(), which skips provider shutdown there, so a
 * hung one would ignore it, keep the promise pending until Japa's timeout and
 * outlive the test run.
 */
export async function boot(
	args: string[],
	overrides: Record<string, string>,
	timeout = 30_000,
) {
	try {
		const { stdout, stderr } = await run("node", args, {
			cwd: app.makePath(),
			timeout,
			killSignal: "SIGKILL",
			env: {
				...process.env,
				PORT: String(env.get("PORT") + 1),
				...overrides,
			},
		});
		return { exitCode: 0, killed: false, output: `${stdout}\n${stderr}` };
	} catch (error) {
		const { code, killed, stdout, stderr } = error as {
			code: number | string;
			killed: boolean;
			stdout: string;
			stderr: string;
		};
		return { exitCode: code, killed, output: `${stdout}\n${stderr}` };
	}
}
```

If the function in `role_guard.spec.ts` differs from this copy, move the file's version, not this one. In `role_guard.spec.ts`, delete `const run = promisify(execFile);` and the `boot` function with its comment, add `import { boot } from "#tests/helpers/boot";`, and remove the imports that become unused (`execFile`, `promisify`, and `app` if nothing else uses it; Biome reports them). Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C apps/platform test functional --files=role_guard.spec.ts > <scratchpad>/t9-t5-move.log 2>&1`: the same tests pass as before. Commit:

```bash
git add apps/platform/tests/helpers/boot.ts apps/platform/tests/functional/rls/role_guard.spec.ts
git commit -m "refactor(platform): share the subprocess boot helper" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing tests.** Create `apps/platform/tests/functional/auth/production_boot.spec.ts`. `PRODUCTION` must hold a valid value for every setting Task 0 Step 1 found required in production besides `STOREFRONT_URL` (add any it lists that are missing here); the environment ignores names it doesn't define, so TAT-38's two stay even when TAT-38 isn't built:

```ts
import { test } from "@japa/runner";
import { boot } from "#tests/helpers/boot";

/**
 * What production requires besides APP_URL and STOREFRONT_URL, which each
 * test sets. Every other setting comes from the platform's `.env`, as in
 * role_guard.spec.ts.
 */
const PRODUCTION = {
	NODE_ENV: "production",
	TURNSTILE_SECRET_KEY: "test-secret-td9",
	STOREFRONT_SERVER_KEYS:
		"td9-test-key-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,td9-test-key-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	TRUST_PROXY: "loopback",
};

const APART = {
	APP_URL: "https://app.tattoodrip.app",
	STOREFRONT_URL: "https://{tenant}.tattoodrip.studio",
};

test.group("Production boot: the dashboard's origin (TAT-9)", () => {
	test("an http APP_URL stops the web server before it listens", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await boot(
			["--import", "@poppinss/ts-exec", "bin/server.ts"],
			{ ...PRODUCTION, ...APART, APP_URL: "http://app.tattoodrip.app" },
		);

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /APP_URL must be an https URL in production/);
		assert.notMatch(output, /started HTTP server/);
	}).timeout(40_000);

	test("an APP_URL on the studio pages' domain stops ace commands", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await boot(["ace.js", "list:routes"], {
			...PRODUCTION,
			APP_URL: "https://app.example.com",
			STOREFRONT_URL: "https://{tenant}.example.com",
		});

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /must be on separate domains in production/);
	}).timeout(40_000);

	test("separate https origins boot", async ({ assert }) => {
		const { exitCode, killed, output } = await boot(
			["ace.js", "list:routes"],
			{ ...PRODUCTION, ...APART },
		);

		assert.isFalse(killed);
		assert.equal(exitCode, 0, output);
	}).timeout(40_000);
});
```

`ace list` does not boot the app (TAT-55's build found it); `list:routes` does.

- [ ] **Step 3: Run them to see them fail.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 240 pnpm -C apps/platform test functional --files=production_boot.spec.ts > <scratchpad>/t9-t5-red.log 2>&1`. Expected: the first test fails (the server boots, or is killed after 30 s, without the message) and the second fails (exit 0); the third passes. If the third fails, its output names the setting production still misses: add it to `PRODUCTION` and run again.

- [ ] **Step 4: Call the check.** In `apps/platform/start/env.ts`, replace `export default await Env.create(new URL("../", import.meta.url), {` with `const env = await Env.create(new URL("../", import.meta.url), {`, add `import { checkAppOrigin } from "#services/app_origin";` to the imports, and after the `Env.create` call's closing `});` (the end of the file) add:

```ts

// In production the dashboard's origin is https and off the studio pages'
// domain (TAT-9): its __Host- session cookie needs both. Checked once both
// settings are read, since it compares them.
checkAppOrigin(
	env.get("APP_URL"),
	env.get("STOREFRONT_URL"),
	env.get("NODE_ENV") === "production",
);

export default env;
```

- [ ] **Step 5: Run them to see them pass.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=production_boot.spec.ts --files=role_guard.spec.ts > <scratchpad>/t9-t5-green.log 2>&1`. Expected: every test passes. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck > <scratchpad>/t9-t5-tc.log 2>&1` is clean.

- [ ] **Step 6: Commit.**

```bash
git add apps/platform/start/env.ts apps/platform/tests/functional/auth/production_boot.spec.ts
git commit -m "feat(platform): refuse to boot in production with an http or studio-domain APP_URL" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and the checklist

**Files:**
- Modify: `docs/architecture.md`, `docs/requirements.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `apps/platform/.env.example`, `README.md`, and `apps/platform/docs/deploy.md` (TAT-38 built) or `apps/platform/database/README.md` (not built)

- [ ] **Step 1: Architecture.** In `docs/architecture.md`, "Domains, sessions, auth", replace the first two bullets ("Storefronts run on `{slug}.platform.com`…" and "The dashboard session cookie is host-only (`__Host-`)…") with:

```markdown
- Studio pages run on `{slug}.<studio domain>` (later also a studio's own domain, TAT-79). The dashboard (`app.`) and the API (`api.`) run on a **separate** registrable domain, so no studio page is ever same-site with the dashboard and none can read or set its cookies. With `NODE_ENV=production` the platform refuses to start when `APP_URL` is not https, or sits on, under or above the studio pages' domain (`STOREFRONT_URL`); a sibling under a shared parent can't be detected and is a checklist item.
- The dashboard session cookie is `__Host-td-session` in production: host-only (no `Domain`), `Path=/`, `HttpOnly`, `Secure` and `SameSite=Lax`. Development and tests use `td-session` without `Secure`, since they run over plain http. CSRF protection (Shield) is on for every dashboard write; its `XSRF-TOKEN` cookie keeps the name Shield and Inertia use, and a token is valid only with its own session.
```

- [ ] **Step 2: Requirements.** In `docs/requirements.md`, "Tenant isolation", after the bullet that starts "Slugs are lowercase DNS labels", add:

```markdown
- A studio's page, or a domain a studio brings, can never read or set the dashboard's cookies: the dashboard and the API have a domain of their own, and the session cookie is host-only.
```

- [ ] **Step 3: Backend conventions.** In `apps/platform/docs/backend.md`, "Tenancy and route access", after the bullet that starts "Page history (TAT-82)", add:

```markdown
- Cookies and domains (TAT-9): `#services/cookie_policy` is the one policy. `sessionCookieName(app.inProduction)` is `__Host-td-session` in production and `td-session` elsewhere; `cookieAttributes(app.inProduction)` is `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` in production and never a `Domain`. `config/session.ts` uses both, and `config/app.ts`'s cookie defaults use the attributes, so Shield's `XSRF-TOKEN` (not `HttpOnly`: Inertia sends it back as `X-XSRF-TOKEN`), the auth guard's `remember_web` (only ever cleared: remember-me is off), the cookie store's data cookie (named by the session id) and every `clearCookie` follow it; the browser-set `app_theme` is the only other cookie. A new cookie goes through the policy and into `KNOWN` in `tests/functional/auth/cookies.spec.ts`. Never add a `domain`, never decide `Secure` per request (behind the proxy the app sees http), and never give a cookie the `__Host-` prefix outside the production switch: the serializer throws without `Secure`. `checkAppOrigin` (`#services/app_origin`, run by `start/env.ts` once the environment is read) stops every process in production when `APP_URL` is not https or shares the studio pages' domain (on, under or above it; a loopback `APP_URL` skips that comparison). Production uses `SESSION_DRIVER=cookie`.
```

- [ ] **Step 4: Testing.** In `apps/platform/docs/testing.md`, "Environment and test conventions", after the paragraph that starts "Rate limits (TAT-8)", add:

```markdown
Cookies (TAT-9): the session cookie is `td-session` in tests; read its name from `sessionCookieName(app.inProduction)` (`#services/cookie_policy`), never a literal. `setCookieLines` and `parseSetCookie` (`#tests/helpers/cookies`) read `Set-Cookie` lines, from `response.headers()["set-cookie"]` or a `ResponseFactory` response. Tests never run in production, so production's `__Host-` cookie is checked through the real serializer (`cookie_policy.spec.ts`) and its boot through real processes (`production_boot.spec.ts`, with `boot` from `#tests/helpers/boot`, which TAT-29's role-guard boots use too). Cookies ignore ports: two dev servers on `localhost` share `XSRF-TOKEN` and fail each other's CSRF checks, so open the second on `127.0.0.1`.
```

- [ ] **Step 5: `.env.example`.** In `apps/platform/.env.example`, right above `APP_URL=http://${HOST}:${PORT}`, add:

```
# The dashboard's and API's public origin. With NODE_ENV=production it must be
# https and on a domain of its own, apart from STOREFRONT_URL's (e.g.
# https://app.example.com with studio pages on
# https://{tenant}.example-studios.com): the app refuses to start otherwise.
```

- [ ] **Step 6: README.** In `README.md`, the local production trial paragraph ("To try the installed dashboard app locally…"): replace the text from "with the platform's environment variables set" through "on iPhone: Share → Add to Home Screen)." with:

```markdown
with the platform's environment variables set (for example by copying `apps/platform/.env` into `build/`) plus what production requires (`STOREFRONT_URL=http://{tenant}.localhost:3000`, Cloudflare's always-passing test secret `1x0000000000000000000000000000000AA` as `TURNSTILE_SECRET_KEY`, and any other setting the boot error names). Production signs in only over HTTPS: its session cookie is `__Host-` and `Secure`, and it refuses an http `APP_URL`. So put a local HTTPS proxy in front, for example Caddy (`caddy trust` once, then `caddy reverse-proxy --from localhost:8443 --to localhost:3333`), set `APP_URL=https://localhost:8443`, open that address in Chrome and install it from the address bar (a phone needs an HTTPS tunnel; on iPhone: Share → Add to Home Screen).
```

In "Deployment", append to the **Platform** bullet (after its last sentence, separated by a space):

```markdown
With `NODE_ENV=production` it starts only with an https `APP_URL` on a domain of its own, apart from the studio pages' ([dashboard cookies and domains](apps/platform/docs/deploy.md#dashboard-cookies-and-domains)).
```

Without `deploy.md` (Task 0), link `apps/platform/database/README.md` instead.

- [ ] **Step 7: The checklist.** If `apps/platform/docs/deploy.md` exists, append this section at its end:

```markdown
## Dashboard cookies and domains

The dashboard's session cookie is `__Host-td-session`: host-only, `Secure`, `HttpOnly` and `SameSite=Lax` (TAT-9), so no studio page can read, set or replace it. These settings keep it that way.

- Two registrable domains, bought separately: one for the platform (the dashboard on `app.<platform>`, the API on `api.<platform>` or the same host) and one for the studio pages (the storefront's apex and `*.<studios>`). Never the dashboard or the API under the studio domain, the studio pages under the platform's, or both under one parent you own (`app.example.com` with `{tenant}.sites.example.com` passes the boot check but shares `example.com`). Two names under a public suffix such as `com.np` are separate; check a doubtful parent at publicsuffix.org.
- `APP_URL` is the dashboard's https origin. With `NODE_ENV=production` the web server, the worker and every `ace` command that boots the app refuse to start when it is http, or on, under or above `STOREFRONT_URL`'s domain.
- `SESSION_DRIVER=cookie`: `memory` loses every session on restart and between processes, and `database` needs a `sessions` table this app doesn't have. `APP_KEY` signs and encrypts the session and CSRF cookies: rotating it signs everyone out.
- The storefront's `API_URL` is on the platform's domain (`api.<platform>` or `APP_URL`'s host), never on a studio domain.
- The proxy terminates TLS for the platform's hosts and redirects http to https: the app never redirects, and over plain http the browser drops the `Secure` cookie, so every sign-in would end on "Invalid or expired CSRF token". Shield sends HSTS (180 days). The cookies need no `TRUST_PROXY`: the app writes `Secure` whatever protocol it sees.
- DNS: the studio domain's apex and wildcard go to Vercel only (TAT-13); the platform's names go to the platform. No wildcard on the platform's domain.
- Custom studio domains (TAT-79) are never the platform's hosts or on its domain.
- After the first deploy: sign in at `https://app.<platform>`; in DevTools, Application, Cookies, `__Host-td-session` shows Secure, HttpOnly, SameSite Lax and no Domain; `curl -sI http://app.<platform>/login` answers a redirect to https.
```

If it doesn't exist, add this bullet to "Production checklist" in `apps/platform/database/README.md`, after the bullet that starts "Set `TURNSTILE_SECRET_KEY`":

```markdown
  - Dashboard cookies and domains (TAT-9): put the dashboard (`APP_URL`, https) and the API on a registrable domain of their own, apart from the studio pages' (`STOREFRONT_URL`). With `NODE_ENV=production` every process refuses to start when `APP_URL` is http or on, under or above the studio pages' domain; a sibling under one parent you own (`app.example.com` with `{tenant}.sites.example.com`) is not detected, so don't. Keep `SESSION_DRIVER=cookie`, the storefront's `API_URL` on the platform's domain, TLS and an http-to-https redirect at the proxy (the `__Host-td-session` cookie is `Secure`; it needs no `TRUST_PROXY`), the studio domain's DNS wildcard on Vercel only, and custom studio domains (TAT-79) off the platform's domain. After the first deploy, check the cookie in DevTools (Secure, HttpOnly, SameSite Lax, no Domain) and that `http://` redirects to `https://`.
```

- [ ] **Step 8: Check and commit.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check > <scratchpad>/t9-t6-check.log 2>&1` (no new warnings); `rg -n "adonis-session" apps packages README.md docs --glob '!docs/superpowers/**'` finds nothing. Then:

```bash
git add docs/architecture.md docs/requirements.md apps/platform/docs/backend.md apps/platform/docs/testing.md apps/platform/.env.example README.md
git add apps/platform/docs/deploy.md   # or apps/platform/database/README.md: the file Step 7 edited
git commit -m "docs(platform): document dashboard cookies, the domain split and the production checks" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification

**Files:** none changed (fix what fails in the task that owns it).

- [ ] **Step 1: Gates.** Each into its own `<scratchpad>/t9-final-*.log`, all with the Node 24.3.0 PATH prefix: `pnpm check`, `pnpm typecheck`, `pnpm build`, and the full platform suite in the background (`PORT=3402 timeout 600 pnpm -C apps/platform test`): Task 0's count plus every new test, all passing. `git status --short` is clean after the build. No codegen is needed (no route, page or controller changed): `pnpm -C apps/platform exec node ace codegen` leaves no diff.

- [ ] **Step 2: Mutation checks (revert each with `git checkout -- <file>`).** (a) `sessionCookieName` returns `` `__Host-${SESSION_COOKIE}` `` always: Task 1's development test and Task 2's tests fail (the serializer throws without `Secure`). (b) Add `domain: "localhost",` to `config/app.ts`'s cookie block: Task 2's guard and resolved-config tests fail. (c) `csrf.enabled: false` in `config/shield.ts`: Task 3 fails (done in Task 3 Step 3; repeat). (d) Comment out the `checkAppOrigin(…)` call in `start/env.ts`: Task 5's first two tests fail. (e) `secure: false` in `cookieAttributes`: Task 1's production tests fail. Record each result in the PR text.

- [ ] **Step 3: Leak and scope checks.** `rg -n "request\.(secure|protocol)\(" apps/platform/app apps/platform/config` shows no new use; `rg -n "domain" apps/platform/config/app.ts apps/platform/config/session.ts apps/platform/app/services/cookie_policy.ts` finds only comments; `git diff --stat <Task 0 HEAD>..HEAD -- package.json apps/*/package.json pnpm-lock.yaml apps/platform/database` is empty.

- [ ] **Step 4: PR text.** Write `<scratchpad>/pr3-tat-9.md`: what and why (a few bullets), the rulings in one line each, test counts, mutation results, and this list for the user, verbatim from the spec's checklist:
  1. Two registrable domains, bought separately: the platform's (`app.`, `api.`) and the studio pages' (apex and `*.` on Vercel); not siblings under one parent you own.
  2. Platform: `NODE_ENV=production`, `APP_URL=https://app.<platform>` (http, or a host on, under or above the studio domain, now stops every process), `STOREFRONT_URL=https://{tenant}.<studios>`, `SESSION_DRIVER=cookie`. No new setting.
  3. Storefront: `API_URL` on the platform's domain.
  4. Proxy (TAT-14): TLS for the platform's hosts and an http-to-https redirect.
  5. DNS (TAT-13): the studio domain's wildcard and apex on Vercel only; no wildcard on the platform's domain.
  6. TAT-79: refuse custom domains that are the platform's hosts or on its domain (post this on TAT-79).
  7. After the first deploy: `__Host-td-session` in DevTools (Secure, HttpOnly, SameSite Lax, no Domain); `http://` redirects to `https://`.
  8. Everyone signs out once (the cookie's new name); in development, sign in again. TAT-32's manual check now looks for `td-session`, not `adonis-session`.
  9. If TAT-38 lands after this branch: move the database/README.md bullet into `deploy.md` (only when Task 6 used the fallback).

No commit.
