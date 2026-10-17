# Encrypted page history, cleared on the guest pages (TAT-82) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After logout or a change of user on a shared browser, Back never shows the previous user's pages, and plain-HTTP LAN development keeps working.

**Architecture:** `config/inertia.ts` turns on `encryptHistory` for every page. The guest middleware (login, signup) calls `ctx.inertia.clearHistory()`. The flag only rides on a rendered page, and every signed-out visitor lands on a guest page. A pure `encryptsHistory(request, inProduction)` helper lets `InertiaMiddleware` turn encryption off in development when a request comes over plain HTTP from a non-loopback host, where browsers have no `crypto.subtle`.

**Tech Stack:** AdonisJS 7, `@adonisjs/inertia` 5.0.1, `@inertiajs/react` / `@inertiajs/core` 3.8.0, Japa (api client with the session, auth, shield and inertia plugins).

**Spec:** `docs/superpowers/specs/2026-10-17-tat-82-inertia-history-design.md`

## Global Constraints

- No migration, route, page, controller, API, SDK or OpenAPI change, so `node ace codegen` must change nothing.
- Config key is `encryptHistory` (the Inertia constructor reads `config.encryptHistory`). The `history: { encrypt }` key in `defineConfig`'s defaults is unused, so don't use it.
- Production always encrypts. Only development and test skip it, and only for a request that is not `https` and whose lower-cased host isn't `localhost`, `*.localhost`, `127.x.x.x` (`^127(\.\d{1,3}){3}$`) or `[::1]`.
- Don't call `clearHistory()` in `SessionController` or `NewAccountController`: their responses are redirects, which drop the flag.
- Commands run from `apps/platform` unless stated. Tests use `PORT=3402`. A spec that imports a missing module hangs Japa after the error, so RED steps run as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts` (exit 124 plus "Cannot find module" is the expected RED for a missing module). Don't wrap commands in `sh -c`, and don't read `.env`. `pnpm typecheck` is the authority over editor diagnostics.
- Biome formats (tabs, double quotes, trailing commas). The pre-commit hook may rewrite staged files, so re-Read a file before the next Edit.
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder. Never push or open a PR (run brief).

## Review Focus

1. Hosts that only look like loopback (`127.0.0.1.nip.io`, `localhost.example.com`, `mylocalhost`) must not count as secure in development. Expected: no encryption, so the visits don't hang. (Task 2 unit test.)
2. A request with no `Host` header: treated as insecure in development, with no crash. (Task 2 unit test.)
3. Production with plain `http` or a LAN host (a TLS proxy without `trustProxy`) still encrypts. (Task 2 unit test.)
4. A signed-in page (the first page after login) is encrypted and does not clear history, so the user's own Back keeps working. (Task 1 and Task 3 functional tests.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-82-encrypt-inertia-page-history-and-clear-it-on-logout` (from main 98bb156, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Baseline: `PORT=3402 pnpm test functional --files=access.spec.ts`. Expected: PASS (4 tests).

---

### Task 1: Encrypt every page's history

**Files:**
- Modify: `apps/platform/config/inertia.ts`
- Test: `apps/platform/tests/functional/auth/page_history.spec.ts` (create)

**Interfaces:**
- Produces: the spec file with `LOCAL` and `makeUser()`, which Tasks 2 and 3 add tests to.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/auth/page_history.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

/**
 * Inertia's history flags (TAT-82). Requests name their Host, so the
 * result doesn't depend on HOST in .env.
 */
const LOCAL = "localhost:3402";

function makeUser() {
	return User.create({ email: "ink@example.com", password: "secret-password" });
}

test.group("Page history", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("encrypts history on guest and signed-in pages", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const login = await client
			.get("/login")
			.header("host", LOCAL)
			.withInertia();
		const onboarding = await client
			.get("/onboarding")
			.header("host", LOCAL)
			.withInertia()
			.loginAs(user);

		login.assertInertiaComponent("auth/login");
		assert.isTrue(login.body().encryptHistory);
		onboarding.assertInertiaComponent("onboarding/create_tenant");
		assert.isTrue(onboarding.body().encryptHistory);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts`
Expected: FAIL, 1 failing: `expected undefined to be true` (the page object has no `encryptHistory` yet).

- [ ] **Step 3: Turn encryption on**

In `apps/platform/config/inertia.ts`, add as the first key of `defineConfig({ ... })`, before `ssr`:

```ts
	/**
	 * Encrypt the page props Inertia keeps in browser history. The guest
	 * pages clear the key (GuestMiddleware), so after logout Back can't show
	 * the previous user's pages and asks the server instead (TAT-82).
	 */
	encryptHistory: true,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/platform/config/inertia.ts apps/platform/tests/functional/auth/page_history.spec.ts
git commit -m "feat(platform): encrypt Inertia page history"
```

---

### Task 2: No encryption over plain HTTP from another device (development)

**Files:**
- Create: `apps/platform/app/services/history_encryption.ts`
- Modify: `apps/platform/app/middleware/inertia_middleware.ts` (imports, `handle`)
- Test: `apps/platform/tests/unit/services/history_encryption.spec.ts` (create)
- Test: `apps/platform/tests/functional/auth/page_history.spec.ts` (add a test)

**Interfaces:**
- Consumes: Task 1's spec file (the new functional test sets its own hosts).
- Produces: `encryptsHistory(request: { protocol(): string; hostname(): string | null }, inProduction: boolean): boolean` from `#services/history_encryption`.

- [ ] **Step 1: Write the failing unit test**

Create `apps/platform/tests/unit/services/history_encryption.spec.ts`:

```ts
import { test } from "@japa/runner";
import { encryptsHistory } from "#services/history_encryption";

function request(protocol: string, hostname: string | null) {
	return { protocol: () => protocol, hostname: () => hostname };
}

test.group("encryptsHistory", () => {
	test("production always encrypts", ({ assert }) => {
		assert.isTrue(encryptsHistory(request("http", "192.168.1.20"), true));
		assert.isTrue(encryptsHistory(request("http", null), true));
	});

	test("development encrypts over HTTPS and on loopback hosts", ({
		assert,
	}) => {
		assert.isTrue(encryptsHistory(request("https", "192.168.1.20"), false));
		for (const host of [
			"localhost",
			"LOCALHOST",
			"app.localhost",
			"127.0.0.1",
			"127.1.2.3",
			"[::1]",
		]) {
			assert.isTrue(encryptsHistory(request("http", host), false), host);
		}
	});

	test("development skips it over plain HTTP from any other host", ({
		assert,
	}) => {
		for (const host of [
			"192.168.1.20",
			"0.0.0.0",
			"127.0.0.1.nip.io",
			"localhost.example.com",
			"mylocalhost",
			null,
		]) {
			assert.isFalse(
				encryptsHistory(request("http", host), false),
				String(host),
			);
		}
	});
});
```

- [ ] **Step 2: Write the failing functional test**

In `apps/platform/tests/functional/auth/page_history.spec.ts`, add inside the group, after the first test:

```ts
	test("in development, plain HTTP from another device isn't encrypted", async ({
		client,
		assert,
	}) => {
		const lan = await client
			.get("/login")
			.header("host", "192.168.1.20:3402")
			.withInertia();
		const loopback = await client
			.get("/login")
			.header("host", "127.0.0.1:3402")
			.withInertia();

		lan.assertInertiaComponent("auth/login");
		assert.notProperty(lan.body(), "encryptHistory");
		assert.isTrue(loopback.body().encryptHistory);
	});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test unit --files=history_encryption.spec.ts`
Expected: exit 124 with "Cannot find module" for `#services/history_encryption` (the expected RED for a missing module).

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts`
Expected: FAIL, 1 failing (the LAN page still has `encryptHistory: true`); the Task 1 test passes.

- [ ] **Step 4: Write the helper**

Create `apps/platform/app/services/history_encryption.ts`:

```ts
/**
 * Whether a response may encrypt Inertia's page history (TAT-82).
 *
 * The browser encrypts with crypto.subtle, which exists only in a secure
 * context: HTTPS, or a loopback host. Over plain HTTP from another device
 * (a phone opening the dev server at its LAN IP) Inertia's encryption
 * throws and every later visit hangs, so development skips it there.
 * Production always encrypts: it is HTTPS-only (secure cookies), and behind
 * a proxy the request's protocol can read "http" anyway.
 */
type RequestOrigin = { protocol(): string; hostname(): string | null };

const LOOPBACK_IPV4 = /^127(\.\d{1,3}){3}$/;

export function encryptsHistory(
	request: RequestOrigin,
	inProduction: boolean,
): boolean {
	if (inProduction || request.protocol() === "https") {
		return true;
	}

	const host = request.hostname()?.toLowerCase();
	if (!host) {
		return false;
	}

	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "[::1]" ||
		LOOPBACK_IPV4.test(host)
	);
}
```

- [ ] **Step 5: Use it in the Inertia middleware**

In `apps/platform/app/middleware/inertia_middleware.ts`, add the two imports in Biome's order:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import type { NextFn } from "@adonisjs/core/types/http";
import BaseInertiaMiddleware from "@adonisjs/inertia/inertia_middleware";
import type User from "#models/user";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { ensureDbContext } from "#services/db_context";
import { encryptsHistory } from "#services/history_encryption";
import UserTransformer from "#transformers/user_transformer";
```

and replace `handle` with:

```ts
	async handle(ctx: HttpContext, next: NextFn) {
		await this.init(ctx);

		// config/inertia.ts encrypts history; a plain-HTTP visit from another
		// device in development can't (see encryptsHistory).
		if (!encryptsHistory(ctx.request, app.inProduction)) {
			ctx.inertia.encryptHistory(false);
		}

		const output = await next();
		this.dispose(ctx);

		return output;
	}
```

- [ ] **Step 6: Run both to verify they pass**

Run: `PORT=3402 timeout 90 pnpm test unit --files=history_encryption.spec.ts`
Expected: PASS (3 tests).

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts`
Expected: PASS (2 tests).

Then `pnpm typecheck`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/platform/app/services/history_encryption.ts apps/platform/app/middleware/inertia_middleware.ts apps/platform/tests/unit/services/history_encryption.spec.ts apps/platform/tests/functional/auth/page_history.spec.ts
git commit -m "feat(platform): skip history encryption on plain HTTP in development"
```

---

### Task 3: The guest pages clear history

**Files:**
- Modify: `apps/platform/app/middleware/guest_middleware.ts` (`handle`)
- Modify: `apps/platform/docs/backend.md` ("Tenancy and route access")
- Test: `apps/platform/tests/functional/auth/page_history.spec.ts` (add three tests)

**Interfaces:**
- Consumes: `makeUser()` from Task 1's spec file.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/auth/page_history.spec.ts`, add inside the group, after the existing tests:

```ts
	test("the login and signup pages clear history", async ({
		client,
		assert,
	}) => {
		const login = await client.get("/login").withInertia();
		const signup = await client.get("/signup").withInertia();

		login.assertInertiaComponent("auth/login");
		assert.isTrue(login.body().clearHistory);
		signup.assertInertiaComponent("auth/signup");
		assert.isTrue(signup.body().clearHistory);
	});

	test("logging out lands on the login page, which clears history", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const logout = await client
			.post("/logout")
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		logout.assertStatus(302);
		logout.assertHeader("location", "/login");
		const login = await client.get("/login").withInertia();
		assert.isTrue(login.body().clearHistory);
	});

	test("signed-in pages don't clear history", async ({ client, assert }) => {
		const user = await makeUser();

		const onboarding = await client
			.get("/onboarding")
			.withInertia()
			.loginAs(user);

		onboarding.assertInertiaComponent("onboarding/create_tenant");
		assert.notProperty(onboarding.body(), "clearHistory");
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts`
Expected: FAIL, 2 failing ("the login and signup pages clear history" and "logging out lands on the login page…": `expected undefined to be true`). "signed-in pages don't clear history" already passes: it guards against clearing everywhere.

- [ ] **Step 3: Clear history in the guest middleware**

In `apps/platform/app/middleware/guest_middleware.ts`, replace the final `return next();` of `handle` with:

```ts
		/**
		 * Nobody is signed in here (login, signup), so clear the tab's page
		 * history: Back can't decrypt the previous user's pages and asks the
		 * server again (TAT-82). Logout and an expired session redirect here.
		 * Inertia sends the flag only with a rendered page, so logout itself,
		 * a redirect, can't clear it.
		 */
		ctx.inertia.clearHistory();
		return next();
```

- [ ] **Step 4: Run them to verify they pass**

Run: `PORT=3402 timeout 90 pnpm test functional --files=page_history.spec.ts --files=access.spec.ts`
Expected: PASS (5 + 4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/middleware/guest_middleware.ts apps/platform/tests/functional/auth/page_history.spec.ts
git commit -m "feat(platform): clear page history on the login and signup pages"
```

- [ ] **Step 6: Document it**

In `apps/platform/docs/backend.md`, add this bullet as the last bullet of "## Tenancy and route access" (just before `## Images`):

```
- Page history (TAT-82): Inertia encrypts the page props it keeps in browser history (`encryptHistory: true` in `config/inertia.ts`), and the guest middleware (the `guest` route group: login, signup) calls `ctx.inertia.clearHistory()`, which drops the tab's key. After logout, an expired session or a change of user, Back can't decrypt the old pages and asks the server again, which sends a guest to `/login`. The flag travels only with a rendered page, so `clearHistory()` before a redirect does nothing. A new page where someone new may start (password reset, invitations) goes in the `guest` group, and a flow that signs a user in without passing through a guest page must clear history on the first page it renders. In development, a plain-HTTP request from a non-loopback host (a phone on the LAN) is not encrypted (`encryptsHistory` in `#services/history_encryption`): browsers have no `crypto.subtle` there, and Inertia's visits would hang. Production always encrypts.
```

- [ ] **Step 7: Commit**

```bash
git add apps/platform/docs/backend.md
git commit -m "docs(platform): document encrypted page history"
```

---

### Task 4: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`, run `PORT=3402 node ace test` in the background and wait for the notification. Expected: all suites pass, with 8 new tests (3 unit, 5 functional) over the baseline.

From the root: `pnpm typecheck`, `pnpm check`, `pnpm build`. Expected: clean.

From `apps/platform`: `node ace codegen`, then `git status --short`. Expected: no changes. If the dev server regenerated `pages.d.ts`, run `git checkout -- <file>`.

- [ ] **Step 2: Reviews**

The run's review phase (whole-branch review, then `codex-review` on `main...HEAD`) checks the branch. Fix confirmed findings test-first and commit. Nothing is pushed and no PR is opened (run brief).

- [ ] **Step 3: Browser pass (the user, before merge)**

Record it as pending in the ledger and the PR text:

1. On `localhost`, open a project page, log out, press Back (several times): no client data appears and the login page shows.
2. Log in as a second user and press Back: the first user's pages never appear.
3. Open the dev server at its LAN IP (`http://<ip>:3401`, from a phone or the same machine): `window.isSecureContext` is false in the console, and links and forms navigate normally.
