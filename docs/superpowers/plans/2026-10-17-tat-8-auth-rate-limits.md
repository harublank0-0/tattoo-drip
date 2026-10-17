# Rate limits on login and signup (TAT-8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Login is limited per client address and per email, and signup per address. Counters live in Postgres and are keyed by HMAC digests. A refused form goes back with "Too many attempts. Try again in N minutes."

**Architecture:** `@adonisjs/limiter` 3.0.1 with its database store on the `pg` (app role) connection and a new `rate_limits` table; tests use its memory store. `throttleLogin` in the identity module takes both login counts before `User.verifyCredentials` runs and refunds them on a sign-in. Signup uses a `limiter.define` middleware from `start/limiter.ts`. The exception handler turns every `E_TOO_MANY_REQUESTS` on an HTML/Inertia request into a flash toast and a redirect back.

**Tech Stack:** AdonisJS 7 (`@adonisjs/core` 7.5.2, `@adonisjs/http-server` 9.3.1), `@adonisjs/limiter` 3.0.1 (`rate-limiter-flexible` 9.1.1), Lucid 22 / PostgreSQL 18, Japa (api client with the session, shield, auth and inertia plugins).

**Spec:** `docs/superpowers/specs/2026-10-17-tat-8-auth-rate-limits-design.md`

## Global Constraints

- Limits (the spec's "Limits"): login per address: 10 attempts that don't sign in per 15 min. Login per email: 25 failures per 15 min, from any address. Signup per address: 10 requests per hour. Fixed windows, no `blockFor`.
- Refusal copy, exactly: `Too many attempts. Try again in N minute.` for N = 1, else `Too many attempts. Try again in N minutes.` N is whole minutes rounded up, at least 1.
- Keys: `login_ip_<digest>`, `login_email_<digest>`, `signup_<digest>`. `digest` is HMAC-SHA256 with `APP_KEY`, base64url (43 characters). An email or IP address is never stored in clear.
- `rate_limits` columns, exactly and in this order: `key varchar(255) primary key`, `points integer not null default 0`, `expire bigint`. The store inserts positional `VALUES (key, points, expire)`.
- No new env var, no OpenAPI/SDK change, no page change, no route-name change. Install by hand: never run `node ace add @adonisjs/limiter` (it writes `.env` and a sample global throttle).
- Always pass `limiter.use()` a copy (`{ ...AUTH_LIMITS.loginPerIp }`): it parses the durations in the object it is given.
- Never call `limiter.clear()` without `["memory"]`: on the database store it runs `TRUNCATE`, which the app role can't do. Never call `limiter.use("database", …)` inside `wrapInGlobalTransaction`: the store keeps the client it was first created with.
- Commands run from `apps/platform` unless stated. Tests use `PORT=3402`. A spec that imports a missing module or package hangs Japa after the error, so RED steps run as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts > <log> 2>&1; echo "exit $?"`, with logs in `/tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/`. Exit 124 plus "Cannot find …" in the log is the expected RED for a missing module. Don't wrap commands in `sh -c`, and don't read `.env`. `pnpm typecheck` is the authority over editor diagnostics.
- Biome formats (tabs, double quotes, trailing commas, sorted imports). The pre-commit hook may rewrite staged files, so re-Read a file before the next Edit.
- Commits are Conventional Commits with the `platform` scope. Each ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line from the builder's session reminder). Never push or open a PR (run brief).

## Review Focus

1. Parallel wrong-password requests from one address. Expected: exactly 10 reach the password check and the rest are refused, because counts are taken before checking. (Task 3, "parallel guesses" test.)
2. A client behind a trusted proxy puts a fake address in front of the real one in `X-Forwarded-For`. Expected: the real (rightmost untrusted) address still counts. (Task 3, IP-limit test.)
3. Addresses in one IPv6 /64, and an IPv4 address written IPv4-mapped. Expected: one count each. (Task 2 `clientAddress` tests, Task 3 key unit test.)
4. The same email in another case or with surrounding spaces. Expected: the same count. (Task 3 key unit test; the per-email functional test uses an upper-cased variant.)
5. A 254-character email. Expected: its key still fits `varchar(255)`. (Task 2 `digest` test: fixed 43 characters.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-8-rate-limit-login-signup-and-password-reset` (stacked on TAT-82 at c47fb88, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Postgres is up and migrated. Baseline: `PORT=3402 timeout 180 pnpm test functional --files=onboarding.spec.ts --files=tenant_routes.spec.ts --files=catalog_guard.spec.ts`. Expected: PASS.

---

### Task 1: The Postgres rate-limit store

**Files:**
- Modify: `apps/platform/package.json`, `pnpm-lock.yaml` (via pnpm)
- Modify: `apps/platform/adonisrc.ts` (providers)
- Create: `apps/platform/config/limiter.ts`
- Create: `apps/platform/database/migrations/1791610000000_create_rate_limits_table.ts`
- Regenerated: `apps/platform/database/schema.ts` (by `pnpm migrate`; never edit)
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`EXEMPT`)
- Test: `apps/platform/tests/functional/auth/rate_limit_store.spec.ts` (create)

**Interfaces:**
- Produces: the `limiter` service (`import limiter from "@adonisjs/limiter/services/main"`) with stores `"database"` and `"memory"`, default `"memory"` under test and `"database"` otherwise. `errors.E_TOO_MANY_REQUESTS` from `@adonisjs/limiter`, whose instances carry `response.availableIn` (seconds).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/auth/rate_limit_store.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { errors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import { dbClient } from "#services/db_context";

/**
 * The Postgres store that development and production use (the test run
 * defaults to the memory store, config/limiter.ts). No global transaction
 * here: the store keeps the database client it was created with, and a
 * test's transaction is gone after that test. The key is unique to this run
 * and removed afterwards.
 */
test.group("Rate limit store", (group) => {
	const key = `store_spec_${randomUUID()}`;
	const store = () =>
		limiter.use("database", { requests: 2, duration: "1 minute" });
	group.teardown(() => store().delete(key));

	test("counts, refuses and resets a key in rate_limits as the app role", async ({
		assert,
	}) => {
		await store().consume(key);
		await store().consume(key);
		await assert.rejects(
			() => store().consume(key),
			errors.E_TOO_MANY_REQUESTS,
		);

		const rows = await dbClient()
			.from("rate_limits")
			.where("key", "like", `%${key}`);
		assert.lengthOf(rows, 1);
		const state = await store().get(key);
		assert.equal(state?.remaining, 0);
		assert.isAbove(state?.availableIn ?? 0, 0);
		assert.isAtMost(state?.availableIn ?? 0, 60);

		await store().delete(key);
		assert.isNull(await store().get(key));
		await store().consume(key);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=rate_limit_store.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat8-t1-red.log 2>&1; echo "exit $?"`
Expected: `exit 124`, and the log contains `Cannot find package '@adonisjs/limiter'`.

- [ ] **Step 3: Install the package**

From the repo root: `pnpm --filter @tattoo-drip/platform add @adonisjs/limiter@^3.0.1`
Expected: `apps/platform/package.json` has `"@adonisjs/limiter": "^3.0.1"` in `dependencies`. `pnpm --filter @tattoo-drip/platform list @adonisjs/limiter rate-limiter-flexible` shows 3.0.x and 9.x.

- [ ] **Step 4: Register the provider**

In `apps/platform/adonisrc.ts`, in `providers`, add this line right after `() => import("@adonisjs/drive/drive_provider"),`:

```ts
		() => import("@adonisjs/limiter/limiter_provider"),
```

- [ ] **Step 5: Write the config**

Create `apps/platform/config/limiter.ts`:

```ts
import app from "@adonisjs/core/services/app";
import { defineConfig, stores } from "@adonisjs/limiter";

/**
 * Rate-limit counters (TAT-8). Development and production keep them in
 * Postgres (`rate_limits`), shared by every web process; no Redis in V1.
 * The store writes on its own pooled connection as the app role, outside
 * the request transaction, so a failed login still counts after the
 * request rolls back. Tests use the memory store, which tests/bootstrap.ts
 * empties before each test.
 */
const limiterConfig = defineConfig({
	default: app.inTest ? "memory" : "database",
	stores: {
		database: stores.database({
			connectionName: "pg",
			tableName: "rate_limits",
			// Every 5 minutes, delete rows that expired over an hour ago.
			clearExpiredByTimeout: true,
		}),
		memory: stores.memory({}),
	},
});

export default limiterConfig;

declare module "@adonisjs/limiter/types" {
	export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
```

- [ ] **Step 6: Write the migration and run it**

Create `apps/platform/database/migrations/1791610000000_create_rate_limits_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Rate-limit counters (TAT-8) for @adonisjs/limiter's Postgres store
 * (rate-limiter-flexible's RateLimiterPostgres). Its SQL fixes the shape, so
 * this table skips the uuid and timestamptz conventions: it inserts
 * positional VALUES (key, points, expire), and `expire` is epoch
 * milliseconds. Keys are HMAC digests, never an email or IP address. Not
 * tenant-owned, so no row-level security (exempt in catalog_guard.spec.ts).
 * The app role's SELECT, INSERT, UPDATE and DELETE come from the default
 * privileges in setup_roles.sql.
 */
export default class extends BaseSchema {
	protected tableName = "rate_limits";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.string("key", 255).notNullable().primary();
			table.integer("points").notNullable().defaultTo(0);
			table.bigint("expire");
		});
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
```

Run: `pnpm migrate`
Expected: `migrated database/migrations/1791610000000_create_rate_limits_table`, and `git status --short` shows `database/schema.ts` modified (a new `RateLimit…Schema` class). Keep it; never hand-edit it.

- [ ] **Step 7: Run the store test to verify it passes**

Run: `PORT=3402 timeout 120 pnpm test functional --files=rate_limit_store.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Watch the catalog guard fail**

Run: `PORT=3402 timeout 120 pnpm test functional --files=catalog_guard.spec.ts`
Expected: FAIL, 1 failing ("every table has RLS and a policy, or is on the exemption list"): `use enableTenantRls() in the migration, or add a reasoned exemption`, actual `[ 'rate_limits' ]`.

- [ ] **Step 9: Exempt the table**

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, in `EXEMPT`, add after the `queue_schedules` entry:

```ts
	rate_limits:
		"rate-limit counters keyed by HMAC digests (TAT-8), not tenant-owned",
```

Run: `PORT=3402 timeout 120 pnpm test functional --files=catalog_guard.spec.ts --files=rate_limit_store.spec.ts`
Expected: PASS.

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If `limiter.use("database", …)` is a type error, the `LimitersList` augmentation in `config/limiter.ts` is missing or misspelled.

- [ ] **Step 11: Commit**

```bash
git add apps/platform/package.json pnpm-lock.yaml apps/platform/adonisrc.ts apps/platform/config/limiter.ts apps/platform/database/migrations/1791610000000_create_rate_limits_table.ts apps/platform/database/schema.ts apps/platform/tests/functional/auth/rate_limit_store.spec.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts
git commit -m "feat(platform): add the Postgres rate-limit store"
```

---

### Task 2: Key and message helpers

**Files:**
- Create: `apps/platform/app/services/rate_limits.ts`
- Test: `apps/platform/tests/unit/services/rate_limits.spec.ts` (create)

**Interfaces:**
- Produces, from `#services/rate_limits`: `digest(value: string): string` (43 base64url characters), `clientAddress(ip: string): string` (IPv4 as is; IPv4-mapped IPv6 → the IPv4; other IPv6 → `"<first four groups>::/64"`, lower-case, no leading zeros; anything else unchanged), `tryAgainMessage(seconds: number): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/services/rate_limits.spec.ts`:

```ts
import { createHash } from "node:crypto";
import { test } from "@japa/runner";
import { http } from "#config/app";
import {
	clientAddress,
	digest,
	tryAgainMessage,
} from "#services/rate_limits";

test.group("clientAddress", () => {
	test("keeps an IPv4 address, also written IPv4-mapped", ({ assert }) => {
		assert.equal(clientAddress("203.0.113.7"), "203.0.113.7");
		assert.equal(clientAddress("::ffff:203.0.113.7"), "203.0.113.7");
		assert.equal(clientAddress("::FFFF:cb00:7107"), "203.0.113.7");
	});

	test("counts an IPv6 address by its /64", ({ assert }) => {
		for (const ip of [
			"2001:db8:1:2::9",
			"2001:db8:1:2:3:4:5:6",
			"2001:DB8:1:2::1",
			"2001:0db8:0001:0002::1",
		]) {
			assert.equal(clientAddress(ip), "2001:db8:1:2::/64", ip);
		}
		assert.equal(clientAddress("2001:db8:1:3::1"), "2001:db8:1:3::/64");
		assert.equal(clientAddress("2001:db8::"), "2001:db8:0:0::/64");
		assert.equal(clientAddress("fe80::1%eth0"), "fe80:0:0:0::/64");
	});

	test("returns anything else as it is", ({ assert }) => {
		assert.equal(clientAddress("unknown"), "unknown");
		assert.equal(clientAddress(""), "");
	});
});

test.group("digest", () => {
	test("is a keyed, fixed-length digest that hides its input", ({
		assert,
	}) => {
		const value = digest("ink@example.com");

		assert.match(value, /^[A-Za-z0-9_-]{43}$/);
		assert.equal(digest("ink@example.com"), value);
		assert.notEqual(digest("ink2@example.com"), value);
		assert.notEqual(
			value,
			createHash("sha256").update("ink@example.com").digest("base64url"),
		);
		assert.lengthOf(digest(`${"a".repeat(242)}@example.com`), 43);
	});
});

test.group("tryAgainMessage", () => {
	test("rounds up to whole minutes, at least one", ({ assert }) => {
		assert.equal(tryAgainMessage(0), "Too many attempts. Try again in 1 minute.");
		assert.equal(tryAgainMessage(60), "Too many attempts. Try again in 1 minute.");
		assert.equal(tryAgainMessage(61), "Too many attempts. Try again in 2 minutes.");
		assert.equal(tryAgainMessage(899), "Too many attempts. Try again in 15 minutes.");
		assert.equal(tryAgainMessage(3600), "Too many attempts. Try again in 60 minutes.");
	});
});

test.group("Client address trust", () => {
	test("X-Forwarded-For counts only from a loopback proxy", ({ assert }) => {
		assert.isTrue(http.trustProxy("127.0.0.1", 0));
		assert.isTrue(http.trustProxy("::1", 0));
		for (const peer of ["203.0.113.9", "10.0.0.2", "192.168.1.20"]) {
			assert.isFalse(http.trustProxy(peer, 0), peer);
		}
	});
});
```

The last test passes as soon as the file loads. It pins the framework default (`proxyAddr.compile("loopback")`) that the per-address limits rely on (spec Ruling 8).

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=rate_limits.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat8-t2-red.log 2>&1; echo "exit $?"`
Expected: `exit 124`, and the log contains `Cannot find module` for `#services/rate_limits` (`app/services/rate_limits.js`).

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/services/rate_limits.ts`:

```ts
import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import env from "#start/env";

/**
 * HMAC-SHA256 of `value` with APP_KEY, base64url (43 characters), for
 * rate-limit keys (TAT-8). Keyed, so the stored keys can't be reversed by
 * hashing guessed emails or the small IPv4 space; fixed length, so a long
 * email still fits the 255-character key column. Rotating APP_KEY resets
 * every count.
 */
export function digest(value: string) {
	return createHmac("sha256", env.get("APP_KEY").release())
		.update(value)
		.digest("base64url");
}

/**
 * The client address a limit counts by: IPv4 as is (also written
 * IPv4-mapped, `::ffff:203.0.113.7`), and IPv6 by its /64, the block one
 * subscriber gets, so cycling through it buys no fresh attempts. Anything
 * that isn't an IPv6 address is returned as it is.
 */
export function clientAddress(ip: string) {
	const address = ip.split("%")[0].toLowerCase();
	if (!isIPv6(address)) return address;

	const groups = ipv6Groups(address);
	const mapped =
		groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
	if (mapped) {
		return [groups[6], groups[7]]
			.flatMap((group) => [Math.floor(group / 256), group % 256])
			.join(".");
	}
	const prefix = groups.slice(0, 4).map((group) => group.toString(16));
	return `${prefix.join(":")}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address. */
function ipv6Groups(address: string) {
	const [head, tail] = address.split("::");
	if (tail === undefined) return groupsOf(head);
	const left = groupsOf(head);
	const right = groupsOf(tail);
	const zeros = new Array<number>(8 - left.length - right.length).fill(0);
	return [...left, ...zeros, ...right];
}

/** Hex groups as numbers; a trailing dotted IPv4 part fills two groups. */
function groupsOf(part: string): number[] {
	if (!part) return [];
	return part.split(":").flatMap((group) => {
		if (!group.includes(".")) return [Number.parseInt(group, 16)];
		const [a, b, c, d] = group.split(".").map(Number);
		return [a * 256 + b, c * 256 + d];
	});
}

/** What a refused form shows: whole minutes, rounded up, at least one. */
export function tryAgainMessage(seconds: number) {
	const minutes = Math.max(1, Math.ceil(seconds / 60));
	const unit = minutes === 1 ? "minute" : "minutes";
	return `Too many attempts. Try again in ${minutes} ${unit}.`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `PORT=3402 timeout 90 pnpm test unit --files=rate_limits.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/platform/app/services/rate_limits.ts apps/platform/tests/unit/services/rate_limits.spec.ts
git commit -m "feat(platform): add rate-limit key and message helpers"
```

---

### Task 3: Login limits per address and per email, with the friendly refusal

**Files:**
- Create: `apps/platform/app/modules/identity/services/auth_limits.ts`
- Modify: `apps/platform/app/controllers/session_controller.ts` (`store`)
- Modify: `apps/platform/app/exceptions/handler.ts` (imports, `handle`, two new functions)
- Modify: `apps/platform/tests/bootstrap.ts` (import, a reset function, `configureSuite`)
- Test: `apps/platform/tests/unit/modules/identity/auth_limits.spec.ts` (create)
- Test: `apps/platform/tests/functional/auth/rate_limits.spec.ts` (create)

**Interfaces:**
- Consumes: `limiter` and `errors.E_TOO_MANY_REQUESTS` (Task 1). `digest`, `clientAddress`, `tryAgainMessage` (Task 2).
- Produces, from `#modules/identity/services/auth_limits`:
  - `AUTH_LIMITS`: `{ loginPerIp: { requests: 10, duration: "15 mins" }, loginPerEmail: { requests: 25, duration: "15 mins" }, signup: { requests: 10, duration: "1 hour" } }` (`as const`).
  - `loginIpKey(ip: string): string`, `loginEmailKey(email: string): string`.
  - `throttleLogin<T>(ip: string, email: string, verify: () => Promise<T>): Promise<T>`.
- Produces: the functional spec file with `PASSWORD` and `makeUser()`, which Task 4 adds a group to.

- [ ] **Step 1: Write the failing unit test**

Create `apps/platform/tests/unit/modules/identity/auth_limits.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	AUTH_LIMITS,
	loginEmailKey,
	loginIpKey,
} from "#modules/identity/services/auth_limits";

test.group("Auth limits", () => {
	test("one address can't lock an account on its own", ({ assert }) => {
		// With equal fixed windows, one email window overlaps at most two
		// windows of one address, so that address adds at most 2 × 10 failures.
		assert.equal(
			AUTH_LIMITS.loginPerEmail.duration,
			AUTH_LIMITS.loginPerIp.duration,
		);
		assert.isAbove(
			AUTH_LIMITS.loginPerEmail.requests,
			2 * AUTH_LIMITS.loginPerIp.requests,
		);
	});

	test("keys hold digests, never the email or address", ({ assert }) => {
		const email = loginEmailKey(" Ink@Example.com ");
		const ip = loginIpKey("203.0.113.7");

		assert.match(email, /^login_email_[A-Za-z0-9_-]{43}$/);
		assert.match(ip, /^login_ip_[A-Za-z0-9_-]{43}$/);
		assert.notInclude(email, "example");
		assert.notInclude(ip, "203.0.113");
		assert.equal(email, loginEmailKey("ink@example.com"));
		assert.equal(ip, loginIpKey("::ffff:203.0.113.7"));
		assert.equal(loginIpKey("2001:db8:1:2::1"), loginIpKey("2001:db8:1:2::2"));
		assert.notEqual(loginIpKey("2001:db8:1:2::1"), loginIpKey("2001:db8:1:3::1"));
	});
});
```

- [ ] **Step 2: Write the failing functional test**

Create `apps/platform/tests/functional/auth/rate_limits.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	AUTH_LIMITS,
	loginEmailKey,
	loginIpKey,
} from "#modules/identity/services/auth_limits";

/**
 * Login and signup rate limits (TAT-8). Test requests come from loopback,
 * which config/app.ts trusts as a proxy, so X-Forwarded-For sets the client
 * address. The memory store starts empty in every test (tests/bootstrap.ts).
 */
const EMAIL = "ink@example.com";
const PASSWORD = "secret-password";
const WRONG = "Invalid user credentials";
const LOCKED = "Too many attempts. Try again in 15 minutes.";

function makeUser(email = EMAIL) {
	return User.create({ email, password: PASSWORD });
}

function login(
	client: ApiClient,
	forwardedFor: string,
	password: string,
	email = EMAIL,
) {
	return client
		.post("/login")
		.header("x-forwarded-for", forwardedFor)
		.header("referer", "/login")
		.form({ email, password })
		.withCsrfToken()
		.redirects(0);
}

const perIp = () => limiter.use({ ...AUTH_LIMITS.loginPerIp });
const perEmail = () => limiter.use({ ...AUTH_LIMITS.loginPerEmail });

test.group("Login rate limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("refuses an address after 10 failed logins, even with the right password", async ({
		client,
		assert,
	}) => {
		await makeUser();
		for (let i = 0; i < 10; i++) {
			const failed = await login(client, "203.0.113.1", "wrong-password");
			failed.assertFlashMessage("error", WRONG);
		}

		const refused = await login(client, "203.0.113.1", PASSWORD);
		refused.assertStatus(302);
		refused.assertHeader("location", "/login");
		refused.assertFlashMessage("error", LOCKED);

		// Through the trusted proxy, the rightmost untrusted entry counts, so a
		// made-up address in front buys nothing.
		const spoofed = await login(client, "198.51.100.1, 203.0.113.1", PASSWORD);
		spoofed.assertFlashMessage("error", LOCKED);

		const json = await login(client, "203.0.113.1", PASSWORD).header(
			"accept",
			"application/json",
		);
		json.assertStatus(429);
		assert.isAbove(Number(json.header("retry-after")), 0);

		const elsewhere = await login(client, "203.0.113.2", PASSWORD);
		elsewhere.assertHeader("location", "/dashboard");
	});

	test("parallel guesses from one address can't slip past the limit", async ({
		client,
		assert,
	}) => {
		await makeUser();

		const responses = await Promise.all(
			Array.from({ length: 15 }, () =>
				login(client, "203.0.113.5", "wrong-password"),
			),
		);
		const messages = responses.map((response) => response.flashMessage("error"));

		assert.lengthOf(
			messages.filter((message) => message === WRONG),
			10,
		);
		assert.lengthOf(
			messages.filter((message) => message === LOCKED),
			5,
		);
	});

	test("locks an email after 25 failed logins from any mix of addresses", async ({
		client,
	}) => {
		await makeUser();
		const attempts: [string, string, number][] = [
			["203.0.113.11", EMAIL, 10],
			["203.0.113.12", EMAIL, 10],
			["203.0.113.13", EMAIL.toUpperCase(), 5],
		];
		for (const [ip, email, count] of attempts) {
			for (let i = 0; i < count; i++) {
				const failed = await login(client, ip, "wrong-password", email);
				failed.assertFlashMessage("error", WRONG);
			}
		}

		const refused = await login(client, "203.0.113.14", PASSWORD);
		refused.assertHeader("location", "/login");
		refused.assertFlashMessage("error", LOCKED);

		await makeUser("other@example.com");
		const otherAccount = await login(
			client,
			"203.0.113.14",
			PASSWORD,
			"other@example.com",
		);
		otherAccount.assertHeader("location", "/dashboard");
	});

	test("a sign-in gives the address its attempt back and clears the email's failures", async ({
		client,
		assert,
	}) => {
		await makeUser();
		for (let i = 0; i < 3; i++) {
			await login(client, "203.0.113.21", "wrong-password");
		}

		const signedIn = await login(client, "203.0.113.21", PASSWORD);
		signedIn.assertHeader("location", "/dashboard");

		const address = await perIp().get(loginIpKey("203.0.113.21"));
		assert.equal(address?.consumed, 3);
		assert.isNull(await perEmail().get(loginEmailKey(EMAIL)));
	});

	test("an unknown email is counted like a registered one", async ({
		client,
		assert,
	}) => {
		await makeUser();

		const known = await login(client, "203.0.113.31", "wrong-password");
		const unknown = await login(
			client,
			"203.0.113.32",
			"wrong-password",
			"nobody@example.com",
		);

		known.assertFlashMessage("error", WRONG);
		unknown.assertFlashMessage("error", WRONG);
		const knownCount = await perEmail().get(loginEmailKey(EMAIL));
		const unknownCount = await perEmail().get(
			loginEmailKey("nobody@example.com"),
		);
		assert.equal(knownCount?.consumed, 1);
		assert.equal(unknownCount?.consumed, 1);
	});
});

test.group("Rate limits between tests", () => {
	test("leaves a count behind", async () => {
		await perIp().consume(loginIpKey("203.0.113.41"));
	});

	test("starts with every count empty (tests/bootstrap.ts)", async ({
		assert,
	}) => {
		assert.isNull(await perIp().get(loginIpKey("203.0.113.41")));
	});
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `PORT=3402 timeout 90 pnpm test unit --files=auth_limits.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat8-t3-red-unit.log 2>&1; echo "exit $?"`
Run: `PORT=3402 timeout 90 pnpm test functional --files=rate_limits.spec.ts > /tmp/claude-1000/-home-blank-Coding-tattoo-drip/74ec243f-db56-47b2-96f8-9ee84d3c41f7/scratchpad/tat8-t3-red-functional.log 2>&1; echo "exit $?"`
Expected: both `exit 124`, and each log contains `Cannot find module` for `#modules/identity/services/auth_limits`.

- [ ] **Step 4: Write the limits module**

Create `apps/platform/app/modules/identity/services/auth_limits.ts`:

```ts
import limiter from "@adonisjs/limiter/services/main";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The auth rate limits (TAT-8), by name. Each window is fixed: it starts
 * with the first counted attempt, and a lockout ends when it does (no extra
 * block). Password reset (TAT-18) adds its own entries here and a named
 * middleware in start/limiter.ts.
 */
export const AUTH_LIMITS = {
	/** Login attempts from one client address that didn't sign in. */
	loginPerIp: { requests: 10, duration: "15 mins" },
	/**
	 * Failed logins for one email, from any address. More than twice
	 * loginPerIp over the same window, so one address alone can never lock an
	 * account: it fits at most two of its windows into one of these.
	 */
	loginPerEmail: { requests: 25, duration: "15 mins" },
	/** Every signup request from one client address. */
	signup: { requests: 10, duration: "1 hour" },
} as const;

export function loginIpKey(ip: string) {
	return `login_ip_${digest(clientAddress(ip))}`;
}

/** Case and surrounding spaces don't make a separate count. */
export function loginEmailKey(email: string) {
	return `login_email_${digest(email.trim().toLowerCase())}`;
}

/**
 * Runs `verify` (the credential check) unless this address or this email is
 * over its login limit. Over the limit, it throws E_TOO_MANY_REQUESTS
 * without checking the password. The address is counted first, so a refused
 * address never adds to the email's count. Both counts are taken before
 * `verify` runs, so parallel guesses can't all pass a check first. A sign-in
 * gives the address its attempt back and clears the email's failures. Any
 * email is counted, registered or not, so a lockout reveals nothing about
 * accounts.
 */
export async function throttleLogin<T>(
	ip: string,
	email: string,
	verify: () => Promise<T>,
) {
	// use() parses the durations in the object it gets, so give it copies.
	const perIp = limiter.use({ ...AUTH_LIMITS.loginPerIp });
	const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
	const ipKey = loginIpKey(ip);
	const emailKey = loginEmailKey(email);

	await perIp.consume(ipKey);
	await perEmail.consume(emailKey);
	const result = await verify();
	await Promise.all([perIp.decrement(ipKey), perEmail.delete(emailKey)]);
	return result;
}
```

- [ ] **Step 5: Run them again**

Run: `PORT=3402 timeout 90 pnpm test unit --files=auth_limits.spec.ts`
Expected: PASS (2 tests).

Run: `PORT=3402 timeout 120 pnpm test functional --files=rate_limits.spec.ts`
Expected: FAIL, 6 failing, 1 passing ("leaves a count behind"). Nothing calls `throttleLogin` yet, and nothing empties the store between tests.

- [ ] **Step 6: Throttle the login**

In `apps/platform/app/controllers/session_controller.ts`, add the import (Biome sorts it after `#middleware/tenant_middleware`):

```ts
import { throttleLogin } from "#modules/identity/services/auth_limits";
```

and replace the docblock and first two lines of `store`:

```ts
	/**
	 * /dashboard picks where the user lands. Login and logout forget the
	 * last tenant, so a shared browser never carries one user's choice over
	 * to the next.
	 */
	async store({ request, auth, session, response }: HttpContext) {
		const { email, password } = await request.validateUsing(loginValidator);
		const user = await User.verifyCredentials(email, password);
```

with:

```ts
	/**
	 * /dashboard picks where the user lands. Login and logout forget the
	 * last tenant, so a shared browser never carries one user's choice over
	 * to the next. Too many failures from this address or for this email
	 * refuse the attempt before the password is checked (TAT-8).
	 */
	async store({ request, auth, session, response }: HttpContext) {
		const { email, password } = await request.validateUsing(loginValidator);
		const user = await throttleLogin(request.ip(), email, () =>
			User.verifyCredentials(email, password),
		);
```

- [ ] **Step 7: Answer a refused form with the toast**

In `apps/platform/app/exceptions/handler.ts`, add the imports (Biome sorts them):

```ts
import { errors as limiterErrors } from "@adonisjs/limiter";
import { tryAgainMessage } from "#services/rate_limits";
```

In `handle`, after the `if (isPathTraversal(error)) { … }` block and before `return super.handle(error, ctx);`, add:

```ts
		if (
			error instanceof limiterErrors.E_TOO_MANY_REQUESTS &&
			wantsPage(ctx)
		) {
			return backWithThrottleMessage(error, ctx);
		}
```

At the end of the file, after `isPathTraversal`, add:

```ts
/**
 * A browser or Inertia request (HTML, or no Accept header) with a session,
 * as opposed to a JSON client.
 */
function wantsPage(ctx: HttpContext) {
	const type = ctx.request.accepts([
		"html",
		"application/vnd.api+json",
		"json",
	]);
	return (type === "html" || type === null) && Boolean(ctx.session);
}

/**
 * A form that hit a rate limit (TAT-8) goes back to its page with the error
 * toast, like a wrong password does, keeping what was typed except
 * passwords. JSON clients keep the limiter's own 429 with Retry-After.
 */
function backWithThrottleMessage(
	error: InstanceType<typeof limiterErrors.E_TOO_MANY_REQUESTS>,
	ctx: HttpContext,
) {
	ctx.session.flashExcept([
		"_csrf",
		"_method",
		"password",
		"passwordConfirmation",
	]);
	ctx.session.flash("error", tryAgainMessage(error.response.availableIn));
	ctx.response.redirect().back();
}
```

- [ ] **Step 8: Empty the memory store before every test**

In `apps/platform/tests/bootstrap.ts`, add the import (Biome sorts it between `@adonisjs/inertia/…` and `@adonisjs/lucid/…`):

```ts
import limiter from "@adonisjs/limiter/services/main";
```

Add right before `export const runnerHooks`:

```ts
/**
 * Rate limits use the memory store in tests (config/limiter.ts). It is
 * emptied before every test, so one test's attempts never refuse another's.
 * Only the memory store: clearing the database store would TRUNCATE
 * rate_limits, which the app role may not do.
 */
const resetRateLimits = () => limiter.clear(["memory"]);
```

Replace `configureSuite` with:

```ts
export const configureSuite: Config["configureSuite"] = (suite) => {
	if (["browser", "functional", "e2e"].includes(suite.name)) {
		suite.onGroup((group) =>
			group.tap((groupTest) => groupTest.setup(resetRateLimits)),
		);
		suite.onTest((suiteTest) => suiteTest.setup(resetRateLimits));
		return suite.setup(async () => {
			await import("#tests/support/test_routes");
			return testUtils.httpServer().start();
		});
	}
};
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm test functional --files=rate_limits.spec.ts --files=onboarding.spec.ts --files=tenant_routes.spec.ts --files=access.spec.ts --files=page_history.spec.ts`
Expected: PASS (7 new tests, and the existing login, signup and guest-page tests unchanged).

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/platform/app/modules/identity/services/auth_limits.ts apps/platform/app/controllers/session_controller.ts apps/platform/app/exceptions/handler.ts apps/platform/tests/bootstrap.ts apps/platform/tests/unit/modules/identity/auth_limits.spec.ts apps/platform/tests/functional/auth/rate_limits.spec.ts
git commit -m "feat(platform): rate-limit login per address and per email"
```

---

### Task 4: Signup limit per address

**Files:**
- Create: `apps/platform/start/limiter.ts`
- Modify: `apps/platform/start/routes.ts` (import; the `POST signup` route)
- Test: `apps/platform/tests/functional/auth/rate_limits.spec.ts` (add a group)

**Interfaces:**
- Consumes: `AUTH_LIMITS.signup` (Task 3); `digest`, `clientAddress` (Task 2); `PASSWORD` and `testUtils` already in the spec file (Task 3).
- Produces: `throttleSignup` (route middleware) from `#start/limiter`.

- [ ] **Step 1: Write the failing test**

At the end of `apps/platform/tests/functional/auth/rate_limits.spec.ts`, add:

```ts
test.group("Signup rate limit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("refuses an address after 10 signup attempts", async ({
		client,
		assert,
	}) => {
		const signup = (ip: string, body: Record<string, string>) =>
			client
				.post("/signup")
				.header("x-forwarded-for", ip)
				.header("referer", "/signup")
				.form(body)
				.withCsrfToken()
				.redirects(0);
		const valid = {
			fullName: "Ada Ink",
			email: "ada@example.com",
			password: PASSWORD,
			passwordConfirmation: PASSWORD,
		};

		// Invalid bodies count too: every request does.
		for (let i = 0; i < 10; i++) {
			const invalid = await signup("203.0.113.51", {});
			invalid.assertHeader("location", "/signup");
		}

		const refused = await signup("203.0.113.51", valid);
		refused.assertHeader("location", "/signup");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		assert.isNull(await User.findBy("email", "ada@example.com"));

		const elsewhere = await signup("203.0.113.52", valid);
		elsewhere.assertHeader("location", "/onboarding");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm test functional --files=rate_limits.spec.ts`
Expected: FAIL, 1 failing ("refuses an address after 10 signup attempts"): the 11th request signs up, so `location` is `/onboarding`, not `/signup`.

- [ ] **Step 3: Define the signup limiter**

Create `apps/platform/start/limiter.ts`:

```ts
/*
|--------------------------------------------------------------------------
| Named HTTP limiters
|--------------------------------------------------------------------------
|
| Each counts every request to the routes it guards, per client address
| (TAT-8). A refused request goes back to its form with "Too many attempts"
| (app/exceptions/handler.ts). The numbers live in AUTH_LIMITS; password
| reset (TAT-18) adds its limiters here.
|
*/

import limiter from "@adonisjs/limiter/services/main";
import { AUTH_LIMITS } from "#modules/identity/services/auth_limits";
import { clientAddress, digest } from "#services/rate_limits";

export const throttleSignup = limiter.define("signup", (ctx) =>
	limiter
		.allowRequests(AUTH_LIMITS.signup.requests)
		.every(AUTH_LIMITS.signup.duration)
		.usingKey(digest(clientAddress(ctx.request.ip()))),
);
```

- [ ] **Step 4: Attach it to the signup route**

In `apps/platform/start/routes.ts`, add after `import { middleware } from "#start/kernel";`:

```ts
import { throttleSignup } from "#start/limiter";
```

and replace:

```ts
		router.post("signup", [controllers.NewAccount, "store"]);
```

with:

```ts
		router
			.post("signup", [controllers.NewAccount, "store"])
			.use(throttleSignup);
```

The guest middleware still runs first (group middleware runs before route middleware), so a signed-in user's request isn't counted.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm test functional --files=rate_limits.spec.ts --files=onboarding.spec.ts`
Expected: PASS (8 tests in `rate_limits.spec.ts`; the existing signup test is unchanged).

Run: `node ace codegen`, then `git status --short`
Expected: only the files of this task changed; if codegen regenerated anything under `.adonisjs/`, keep it in the commit.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/platform/start/limiter.ts apps/platform/start/routes.ts apps/platform/tests/functional/auth/rate_limits.spec.ts
git commit -m "feat(platform): rate-limit signup per address"
```

(Add any `.adonisjs/` files from Step 5 to the same commit.)

---

### Task 5: Documentation

**Files:**
- Modify: `apps/platform/docs/backend.md` (a new section before `## Images`)
- Modify: `apps/platform/docs/testing.md` ("Environment and test conventions")
- Modify: `apps/platform/database/README.md` (conventions list; production checklist)

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`, insert this section right before the `## Images` heading:

```markdown
## Rate limits

- Login and signup are rate-limited (TAT-8) with `@adonisjs/limiter`, whose counts live in Postgres (`rate_limits`; no Redis in V1; `config/limiter.ts`). Login: per client address, 10 attempts that don't sign in per 15 minutes; per email, from any address, 25 failures per 15 minutes (`throttleLogin` in `#modules/identity/services/auth_limits`, around `User.verifyCredentials`). Signup: 10 requests per address per hour (the `throttleSignup` middleware from `start/limiter.ts`). Windows are fixed, and a lockout ends with its window: no extra block, nothing stored on the user, and the right password is refused too until then. A sign-in clears the email's failures and gives the address its attempt back. The email limit is above twice the address limit, so one address can't lock an account. Any email is counted, registered or not, so a lockout reveals nothing about accounts.
- Keys are `digest(…)` (HMAC-SHA256 with `APP_KEY`) of the lower-cased email or of `clientAddress(ip)` (IPv4, or the IPv6 /64), from `#services/rate_limits`, so the table holds no email or IP address. `request.ip()` trusts `X-Forwarded-For` only from a loopback peer (the framework default). Read the production checklist in [database conventions](../database/README.md) before deploying behind another proxy. The store writes on its own pooled connection, outside the request transaction, so a failed request's count survives the rollback.
- A refused dashboard form goes back with the error toast "Too many attempts. Try again in N minutes." (`app/exceptions/handler.ts`, for every `E_TOO_MANY_REQUESTS`); a JSON request gets the limiter's 429 with `Retry-After`. Adding a limit (password reset, TAT-18): put its numbers in `AUTH_LIMITS`, then use either a `limiter.define` middleware in `start/limiter.ts` (counts every request; a reset request must count unknown emails too) or a wrapper like `throttleLogin` (counts failures). Give `limiter.use()` a copy of the limits object, because it parses the durations in place. Never call `limiter.clear()` in app code: on Postgres it truncates the table, which the app role may not do.
```

- [ ] **Step 2: Testing guide**

In `apps/platform/docs/testing.md`, insert this paragraph right before the paragraph that starts `Storage written to \`tmp/storage/\``:

```markdown
Rate limits (TAT-8) use the memory store under test (`config/limiter.ts`). `tests/bootstrap.ts` empties it before every functional and browser test, so counts never carry over. Test requests come from loopback, which is trusted as a proxy, so `.header("x-forwarded-for", "203.0.113.1")` picks the client address. `rate_limit_store.spec.ts` covers the Postgres store outside a global transaction. The store keeps the client it was created with, so never call `limiter.use("database", …)` inside `wrapInGlobalTransaction`.
```

- [ ] **Step 3: Database conventions**

In `apps/platform/database/README.md`, insert this bullet right after the `- **Business records are soft-deleted.** …` bullet and its code block (before the line starting `` `database/schema.ts` is generated``):

```markdown
- **Exception: `rate_limits`.** `@adonisjs/limiter`'s Postgres store fixes its shape: a string `key` primary key, integer `points` and `expire` in epoch milliseconds, in that column order (the store inserts positional values). It holds short-lived counts keyed by HMAC digests, isn't tenant-owned and is exempt from row-level security. The store deletes rows that expired over an hour ago every 5 minutes.
```

At the end of the "**Production checklist.**" list (after the `idle_in_transaction_session_timeout` item), add:

```markdown
  - Behind a proxy that isn't on loopback (a platform load balancer), set `trustProxy` in the `http` config of `config/app.ts` to that proxy's addresses as a proxy-addr string (for example `trustProxy: "loopback, 10.0.0.0/8"`), never `true`. Without it every visitor shares the proxy's address, so one person's failed logins refuse login and signup to everyone for up to an hour (TAT-8). With `true`, any client picks its own address through `X-Forwarded-For`.
```

- [ ] **Step 4: Commit**

```bash
git add apps/platform/docs/backend.md apps/platform/docs/testing.md apps/platform/database/README.md
git commit -m "docs(platform): document the auth rate limits"
```

---

### Task 6: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`, run `PORT=3402 node ace test` in the background and wait for the notification. Expected: all suites pass, with 17 new tests (8 unit, 9 functional) over the 734 baseline: 751.

From the root: `pnpm typecheck`, `pnpm check`, `pnpm build`. Expected: clean (`pnpm check` has 2 known warnings in `inertia/ssr.tsx` and `inertia/types.ts`).

From `apps/platform`: `node ace codegen`, then `git status --short`. Expected: no changes. If the dev server regenerated `pages.d.ts`, run `git checkout -- <file>`.

- [ ] **Step 2: Reviews**

The run's review phase (whole-branch review, then `codex-review` on `main...HEAD` or the stack base) checks the branch. Fix confirmed findings test-first and commit. Nothing is pushed and no PR is opened (run brief).

- [ ] **Step 3: Browser pass (the user, before merge)**

Record it as pending in the ledger and the PR text:

1. With `pnpm dev`, enter a wrong password 10 times on `/login`, then the right one: the toast reads "Too many attempts. Try again in 15 minutes." and the form stays.
2. As the owner (`psql`), `select key, points from rate_limits`: keys look like `rlflx:login_ip_…` and `rlflx:login_email_…` with 43-character digests, and no email or IP. `delete from rate_limits` unlocks.
