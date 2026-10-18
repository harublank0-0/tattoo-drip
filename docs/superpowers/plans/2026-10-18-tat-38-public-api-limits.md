# Public API rate limits, storefront server key, pool and time bounds, multipart hardening (TAT-38) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No public API request can be flooded, held open, spoofed through a proxy or used to stop the process: every API request is counted per caller before its body (reads per studio too), the storefront's server proves itself with a key and gets per-visitor budgets, public writes hold at most 4 pooled connections for a bounded time, and no multipart body is parsed by the flawed auto-processing path.

**Architecture:** Three parts committed in order. Part 1 (Tasks 1-3) turns multipart auto-processing off and reads dashboard uploads through the existing safe `receiveUploads` in one `router.use` middleware after silent auth. Part 2 (Tasks 4-12) adds the settings (`STOREFRONT_SERVER_KEYS`, `TRUST_PROXY`), caller identification (key + `X-Visitor-IP`), a limit table, a gate first in `router.use` and a named `apiLimit` per studio, and the storefront's forwarding of its visitor's address. Part 3 (Tasks 13-17) sets the pool explicitly, adds `service_busy`/`request_timeout`, an upload deadline, write slots in the gate, and the production checklist.

**Tech Stack:** AdonisJS 7 (`router.use`, named middleware, exception handler), `@adonisjs/limiter` 3.0.1 (memory store in tests, Postgres elsewhere), `@adonisjs/bodyparser` 11.0.4, Lucid 22 / knex 3.3 (tarn pool), Node 24.3.0 (`node:net` `BlockList`, `node:crypto`), Japa (`@japa/api-client`, raw `net` sockets), TanStack Start storefront (`node:test` + `tsx`), OpenAPI 3.1 with `openapi-typescript`, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-38-public-api-limits-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- **No migration.** Never edit `apps/platform/database/schema.ts`, `packages/types/src/openapi.gen.ts`, `apps/storefront/src/routeTree.gen.ts` or `apps/platform/.adonisjs/` by hand: regenerate with `pnpm --filter @tattoo-drip/types generate` and `pnpm -C apps/platform exec node ace codegen`, and commit what they write.
- **No dependency change** in any `package.json` and no lockfile edit. `node:net`, `node:crypto` and the installed packages are enough.
- Numbers, verbatim: reads per caller 300 per `"5 mins"`; writes per caller 60 per `"1 hour"`; storefront without a visitor 3000 per `"5 mins"` (key `api_storefront_shared`); studio reads 6000 (storefront) and 1500 (anonymous) per `"5 mins"`; writes in flight 4 per process and 2 per address, `Retry-After: 10`; upload deadline 90 000 ms (API), 120 000 ms (dashboard); `http.requestTimeout` 120 000; `pg` pool `{ min: 2, max: 10, acquireTimeoutMillis: 10_000 }` (web, test), `{ min: 0, max: 6, acquireTimeoutMillis: 10_000 }` (console); `limiter` pool `{ min: 0, max: 4, acquireTimeoutMillis: 5_000 }`; warnings at most once per 10 minutes per process.
- Names, verbatim: settings `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY`; header `x-visitor-ip` (`X-Visitor-IP`); codes `service_busy` (503), `request_timeout` (408); named middleware `apiLimit`; limits `callerReads`, `callerWrites`, `tenantReads`.
- A server key, any part of it, or a visitor address never appears in a log line, an error message, a response or a stored key: `rate_limits` keys use `digest(clientAddress(ip))` or a tenant id.
- The key changes only which bucket counts a request and which address is trusted: never data, routes, fields, caching or authorization. The dashboard never reads it. CORS keeps refusing `Authorization` and `X-Visitor-IP`.
- `packages/sdk` and `packages/react` do not change. The storefront never imports the platform; the header name is duplicated there with a comment.
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26 (the multipart parser stalls on it). Commands run from the repository root. Platform tests use `PORT=3402` (3333 is taken). `<scratchpad>` is the session's scratchpad directory; logs go there, never `/tmp`. Never `sh -c`, never `pkill -f`.
- A spec that imports a missing module makes Japa hang: RED runs use `timeout 90` and a log file; exit 124 plus "Cannot find module" is that RED. Read the log's `Tests N passed` / `failed` line, not the wrapper's exit code.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.` (none of this plan's new classes inject anything).
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with an area scope (`platform`, `storefront`, `types`), header and body lines at most 100 characters, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line of your own session's reminder). Never push, never open a PR.
- New test slugs end in `-38` (the dev database keeps every slug ever used). An unknown slug is `no-such-studio-td38`.

## Review Focus

1. Two `X-Visitor-IP` headers (Node joins them into a list), a port, brackets or a zone must land in the storefront's shared budget, never in a fresh bucket per value. Tests: Task 5 "lists, ports, brackets, zones and junk are no visitor", Task 8 "a keyed call without a usable visitor spends the shared budget".
2. A 10 KB `Authorization` header or one with a non-token68 character must be an anonymous caller with no hashing beyond the length check, and never a 4xx or 5xx. Tests: Task 5 "either configured key matches; anything else does not", Task 8 "an unknown key is an anonymous caller".
3. A write refused before its body arrived (429, 503) must close the connection and leave no slot taken. Tests: Task 14 "an early refusal closes the connection", Task 16 "a slot frees when its client hangs up".
4. A signed-in dashboard upload that fails mid-body (too large, malformed, hung up) must leave no temp file. Test: Task 2 "a signed-in upload that fails mid-body leaves no temp file".
5. An IPv4-mapped private visitor (`::ffff:10.0.0.1`, `::ffff:a00:1`) must count as no visitor. Test: Task 5 "addresses that can't be a visitor's public address are no visitor".

## Files

| File | Part | Role |
|---|---|---|
| `apps/platform/config/bodyparser.ts` | 1 | `multipart.autoProcess: false`; `processManually` goes |
| `apps/platform/app/middleware/web_multipart_middleware.ts` (new) | 1, 3 | signed-in non-API multipart through `receiveUploads`; signed-out 415 |
| `apps/platform/start/kernel.ts` | 1, 2 | `router.use`: gate first, web multipart last; named `apiLimit` |
| `apps/platform/tests/functional/http/multipart.spec.ts` (new) | 1 | the crash regressions |
| `apps/platform/app/services/server_keys.ts` (new) | 2 | `checkServerKeys` (env) |
| `apps/platform/app/services/trust_proxy.ts` (new) | 2 | `checkTrustProxy` (env) |
| `apps/platform/start/env.ts`, `.env.example`, `.env.test`, `config/app.ts` | 2, 3 | the settings, `trustProxy`, `requestTimeout` |
| `apps/platform/app/services/api_caller.ts` (new) | 2 | `ServerKeys`, `visitorIp`, `isPublicAddress`, `callerOf`, `callerIp`, warnings |
| `apps/platform/app/services/api_limits.ts` (new) | 2 | `API_LIMITS`, `SHARED_STOREFRONT_BUDGET`, `apiLimitFor`, `consumeApiLimit` |
| `apps/platform/app/middleware/public_gate_middleware.ts` (new) | 2, 3 | per-caller count, then (Part 3) a write slot |
| `apps/platform/app/middleware/api_limit_middleware.ts` (new) | 2 | named `apiLimit({ name })` |
| `apps/platform/start/routes.ts` | 2 | tenant group gets `apiLimit({ name: "tenantReads" })` |
| `apps/platform/app/middleware/deposit_throttle_middleware.ts`, `intake_guard_middleware.ts` | 2 | `callerIp(ctx)` |
| `apps/storefront/src/tenancy/visitor.ts` (new), `config.ts`, `handle.ts`, `middleware.ts`, `src/api/context.ts`, `request.ts`, `scripts/check-page.mjs` | 2 | key required in production; `X-Visitor-IP` on keyed calls |
| `packages/types/openapi.yaml` | 2, 3 | rate-limit and key conventions; 429 on reads; 408/503 on uploads |
| `apps/platform/app/services/db_pool.ts` (new), `config/database.ts` | 3 | pool sizes and waits |
| `apps/platform/app/services/public_api.ts`, `public_api_errors.ts`, `app/exceptions/handler.ts` | 3 | codes, `retryLater`, pool timeout, `apiErrorIsReported`, `Connection: close` |
| `apps/platform/app/services/uploads.ts` | 1, 3 | comments; `deadlineMs` |
| `apps/platform/app/services/write_slots.ts` (new) | 3 | `WriteSlots`, `writeSlots`, `WRITE_CONCURRENCY` |
| `apps/platform/tests/helpers/raw_http.ts`, `tests/helpers/api_limits.ts` (new) | 2 | raw sockets; budgets and test keys |
| `apps/platform/tests/support/test_routes.ts` | 3 | `__test/upload` (tenant), `__test/hold` |
| `apps/platform/docs/deploy.md` (new) and the docs listed per part | 1-3 | docs |

---

## Task 0: Preconditions

**Files:** none changed.

- [ ] **Step 1: The base holds the built stack.** This branch was designed on fce4f2a (designs only). Run:

```bash
git log --oneline -1
git status --short
rg -n "export async function receiveUploads|export async function discardUploads|BUILT_IN_NAMES" apps/platform/app/services/uploads.ts
rg -n "export function isApiRequest|export const READ_METHODS|export const API_ERRORS" apps/platform/app/services/public_api.ts
rg -n "export class ApiException|export function apiErrorFor|export function renderApiError" apps/platform/app/services/public_api_errors.ts
rg -n "depositThrottle|publicTenant|publicCache" apps/platform/start/kernel.ts
rg -n "export function depositLimitKeys|export const DEPOSIT_LIMITS" apps/platform/app/modules/payments/deposit_limits.ts
rg -n "export default class IntakeGuardMiddleware|ctx.request.ip\(\)" apps/platform/app/middleware/intake_guard_middleware.ts
rg -n "export const INTAKE_LIMITS|export function intakeLimitKeys" apps/platform/app/modules/inquiries/intake_limits.ts
rg -n "export function checkChallengeSecret" apps/platform/app/services/challenge_secret.ts
rg -n "TURNSTILE_SECRET_KEY" apps/platform/.env.test apps/platform/start/env.ts
rg -n "processManually" apps/platform/config/bodyparser.ts
rg -n "export function clientAddress|export function digest" apps/platform/app/services/rate_limits.ts
rg -n "export function connectServer|serverKey" apps/storefront/src/api/context.ts
rg -n "function readServerKey|SERVER_KEY_SHAPE" apps/storefront/src/tenancy/config.ts
rg -n "export const tenantMiddleware|export const requestStudio" apps/storefront/src/tenancy/middleware.ts
rg -n "export async function handleTenantRequest" apps/storefront/src/tenancy/handle.ts
rg -n "CANARY|apiLog.push" apps/storefront/scripts/check-page.mjs
rg -n "TURNSTILE_SITE_KEY" apps/storefront/src/tenancy/config.ts
```

Expected: the tree is clean and every pattern is found except, possibly, the last one (`TURNSTILE_SITE_KEY` exists only if TAT-57 is built: note the answer, Task 11 uses it). If any other pattern is missing, STOP: the branch must first be rebased onto the newest built tip of the stack (it must hold the public API chain TAT-24/32/51/65/66, TAT-12, TAT-23, TAT-44, TAT-48 and TAT-55); that is the coordinator's call, and only the spec and plan commit sits on top. If a review renamed one of these, use the real name everywhere below.

- [ ] **Step 2: Node and a baseline.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` (expect `v24.3.0`). Then, in the background, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 600 pnpm -C apps/platform test > <scratchpad>/t38-baseline.log 2>&1` and note the `Tests N passed` count (every later full run must be N plus the new tests). Also `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/storefront test > <scratchpad>/t38-sf-baseline.log 2>&1` and note its pass count.

No commit.

---

# Part 1: multipart hardening (spec ruling 16)

### Task 1: The crash regressions, RED

**Files:**
- Create: `apps/platform/tests/functional/http/multipart.spec.ts`

**Interfaces:**
- Consumes: `studioWithOwner`, `inTenant` (`#tests/helpers/tenants`), `tempUploads`, `newTempUploads` (`#tests/helpers/uploads`), `testImages` (`#tests/helpers/images`), `postInquiry`, `intakeFields` (`#tests/helpers/intake`), `depositServices`, `depositReady`, `depositPath`, `OWNER` (`#tests/helpers/deposits`), `assertApiError` (`#tests/helpers/api`), `Artist` (`#modules/artists/models/artist`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests.** The test process registers its own `unhandledRejection` listener while each test runs, so the parser's crash fails the test instead of ending the run; every request gets a 5 s client timeout, because a crashed request is never answered.

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import { assertApiError } from "#tests/helpers/api";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { testImages } from "#tests/helpers/images";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

/**
 * TAT-38 ruling 16. @adonisjs/bodyparser 11.0.4 keeps its multipart handler
 * table in a plain object: a file part named like an Object.prototype
 * property finds a built-in there and throws inside an async listener, an
 * unhandled rejection that ends the process. Nothing may reach that path.
 */
const NAMES = ["constructor", "toString", "__proto__"] as const;
const SLUG = "multipart-38";
const services = depositServices();

const rejections: unknown[] = [];
const record = (reason: unknown) => {
	rejections.push(reason);
};

/** A moment for the parser's async listener (where the crash happens) and closing write streams. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test.group("Multipart part names from Object.prototype", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		rejections.length = 0;
		process.on("unhandledRejection", record);
		return () => {
			process.off("unhandledRejection", record);
		};
	});

	for (const path of ["/login", "/signup"]) {
		test(`a signed-out multipart body to ${path} is refused unread, and the server goes on`, async ({
			client,
			assert,
		}) => {
			const before = await tempUploads();
			for (const name of NAMES) {
				const response = await client
					.post(path)
					.field("email", "ink@example.com")
					.file(name, Buffer.from("x"), {
						filename: "a.png",
						contentType: "image/png",
					})
					.withCsrfToken()
					.redirects(0)
					.timeout(5000);
				await settle();
				response.assertStatus(415);
			}
			assert.deepEqual(rejections, []);
			assert.deepEqual(await newTempUploads(before), []);
			(await client.get(path)).assertStatus(200);
		});
	}

	test("a signed-in dashboard form with such parts gets its normal answer and leaves no temp file", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();
		for (const [index, name] of NAMES.entries()) {
			const response = await client
				.post(`/t/${SLUG}/artists`)
				.fields({ name: `Sita ${index}`, slug: `sita-${index}` })
				.file(name, await testImages.png(), { filename: "p.png" })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0)
				.timeout(5000);
			await settle();
			response.assertStatus(302);
		}
		assert.deepEqual(rejections, []);
		assert.deepEqual(await newTempUploads(before), []);
		assert.lengthOf(await inTenant(tenant, () => Artist.query()), 3);
		(await client.get(`/t/${SLUG}/artists`).loginAs(owner)).assertStatus(200);
	});

	test("the public upload routes answer such parts with their normal envelopes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG);
		const ready = await inTenant(tenant, () => depositReady(tenant));
		const { token } = await inTenant(tenant, () =>
			services.links.issue(tenant, OWNER, ready.project),
		);
		const before = await tempUploads();

		let phone = 9812345700;
		for (const name of NAMES) {
			const inquiry = await postInquiry(
				client,
				SLUG,
				intakeFields({ contactPhone: String(phone++) }),
			)
				.file(name, await testImages.png(), { filename: "a.png" })
				.timeout(5000);
			const proof = await client
				.post(depositPath(SLUG, token))
				.fields({ method: "esewa", expectedAmount: "300000" })
				.file(name, await testImages.png(), { filename: "a.png" })
				.timeout(5000);
			await settle();
			inquiry.assertStatus(201);
			// No `proof` part: the screenshot is missing.
			assertApiError(proof, 422, "validation_failed");
		}
		assert.deepEqual(rejections, []);
		assert.deepEqual(await newTempUploads(before), []);
	});
});
```

If `postInquiry` already returns a request that TAT-55's tests extend with `.header("x-challenge-token", …)`, keep it as is: `.env.test` sets `TURNSTILE_SECRET_KEY` empty, so the check is off.

- [ ] **Step 2: Run them to see them fail.**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=multipart.spec.ts > <scratchpad>/t38-t1.log 2>&1`
Expected: the login, signup and dashboard tests FAIL (a 5000 ms timeout, or a recorded rejection); the public-routes test PASSES (`receiveUploads` already covers them: it is the positive control). If the login test passes, the parser is not reached: check that the request really is multipart (`content-type: multipart/form-data` in a debug print) before going on.

- [ ] **Step 3: Commit the failing tests.**

```bash
git add apps/platform/tests/functional/http/multipart.spec.ts
git commit -m "test(platform): a multipart part named like an Object method must not crash the server" -m "Login, signup and dashboard forms reach the body parser's flawed handler lookup (TAT-38).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Nothing auto-processes multipart

**Files:**
- Create: `apps/platform/app/middleware/web_multipart_middleware.ts`
- Modify: `apps/platform/config/bodyparser.ts` (the `multipart` block), `apps/platform/start/kernel.ts` (`router.use`), `apps/platform/tests/functional/api/api_routes.spec.ts` (the `processManually` test), comments that name `processManually` (`rg -n processManually apps/platform`)
- Test: `apps/platform/tests/functional/http/multipart.spec.ts`, `apps/platform/tests/functional/api/api_routes.spec.ts`

**Interfaces:**
- Consumes: `receiveUploads(request)`, `discardUploads(request)` (`#services/uploads`), `isApiRequest(ctx)` (`#services/public_api`).
- Produces: `WebMultipartMiddleware` (default export of `#middleware/web_multipart_middleware`), last in `router.use`. Task 15 changes its `receiveUploads` call to pass `{ deadlineMs: WEB_UPLOAD_DEADLINE_MS }`.

- [ ] **Step 1: Add the failing tests for the cleanup and the guard.** Append to the group in `multipart.spec.ts`:

```ts
	test("a signed-in dashboard upload is stored and leaves no temp file", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const response = await client
			.post(`/t/${SLUG}/artists`)
			.fields({ name: "Sita Rai", slug: "sita" })
			.file("photo", await testImages.png(), { filename: "p.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		await settle();

		response.assertStatus(302);
		const [artist] = await inTenant(tenant, () => Artist.query());
		assert.isNotNull(artist.photoKey);
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("a signed-in upload that fails mid-body leaves no temp file", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner(SLUG);
		const before = await tempUploads();

		const truncated = await client
			.post(`/t/${SLUG}/artists`)
			.unsafeJson(
				'--td38\r\nContent-Disposition: form-data; name="photo"; filename="p.png"\r\nContent-Type: image/png\r\n\r\nAAAA\r\n--td38\r\nContent-Disposition: form-data; name="name"\r\n\r\nSita',
			)
			.type("multipart/form-data; boundary=td38")
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		await settle();

		truncated.assertStatus(400);
		assert.deepEqual(await newTempUploads(before), []);
		assert.deepEqual(rejections, []);
	});
```

In `tests/functional/api/api_routes.spec.ts`, replace the test "no API route lets the body parser write a multipart body before the tenant is known" with:

```ts
	test("the body parser reads no multipart body itself", ({ assert }) => {
		assert.isFalse(
			bodyParserConfig.multipart.autoProcess,
			"multipart.autoProcess must stay false (TAT-38 ruling 16): routes read uploads with receiveUploads (#services/uploads)",
		);
	});
```

- [ ] **Step 2: Run to see the new ones fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=multipart.spec.ts --files=api_routes.spec.ts > <scratchpad>/t38-t2.log 2>&1`. Expected: the guard FAILS (`autoProcess` is `true`); "fails mid-body" FAILS (the parser leaves the first part's temp file behind when a later part is cut off); "is stored and leaves no temp file" may already pass (`ImageService.store` deletes the temp file it reads), and it pins that the new path keeps doing so; Task 1's tests still FAIL.

- [ ] **Step 3: Write the middleware.**

`apps/platform/app/middleware/web_multipart_middleware.ts`:

```ts
import { Exception } from "@adonisjs/core/exceptions";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { isApiRequest } from "#services/public_api";
import { discardUploads, receiveUploads } from "#services/uploads";

/**
 * Reads the multipart body of a dashboard request (TAT-38 ruling 16). The
 * body parser reads no multipart body itself (config/bodyparser.ts): its
 * handler table is a plain object, and a file part named like an
 * Object.prototype property crashes the process. `receiveUploads` covers
 * those names. Last in router.use, after silent auth: a signed-out request
 * with a multipart body (nothing signed out takes files) is a 415 and its
 * body is never read; a signed-in one is read here, before any route
 * middleware opens a transaction, and every temp file it left goes at the
 * end of the request. The public API reads its own uploads after
 * publicTenant and its limits (receiveUploads in the handler).
 *
 * A multipart form sends its CSRF token in the X-XSRF-TOKEN header (Inertia
 * does): shield checks it before this reads the body.
 */
export default class WebMultipartMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (isApiRequest(ctx) || ctx.request.bodyType !== "multipart") {
			return next();
		}
		if (!ctx.auth.isAuthenticated) {
			ctx.response.header("Connection", "close");
			throw new Exception("Sign in to send files", {
				status: 415,
				code: "E_UNSUPPORTED_MEDIA_TYPE",
			});
		}
		try {
			await receiveUploads(ctx.request);
			return await next();
		} finally {
			await discardUploads(ctx.request);
		}
	}
}
```

- [ ] **Step 4: Turn auto-processing off.** In `apps/platform/config/bodyparser.ts`, replace the `autoProcess: true` entry and its comment, and delete the whole `processManually` entry with its comment, with:

```ts
		/**
		 * The parser reads no multipart body itself (TAT-38). Its handler
		 * table is a plain object, so a file part named like an
		 * Object.prototype property (`constructor`, `__proto__`) would throw
		 * inside an async listener and end the process. Every multipart body
		 * is read with receiveUploads (#services/uploads), which covers those
		 * names: by WebMultipartMiddleware for a signed-in dashboard request,
		 * and by a public API upload route's handler after publicTenant and
		 * the limits (TAT-32 ruling 16).
		 */
		autoProcess: false,
```

In `apps/platform/start/kernel.ts`, add the middleware as the LAST entry of `router.use`, after `#middleware/silent_auth_middleware`:

```ts
	// Reads a signed-in dashboard request's multipart body; the parser reads
	// none itself (TAT-38).
	() => import("#middleware/web_multipart_middleware"),
```

- [ ] **Step 5: Reword every comment that names `processManually`.** Run `rg -n "processManually" apps/platform --glob '!**/node_modules/**'`. In each hit outside docs (expected: `app/services/uploads.ts`, `app/middleware/deposit_throttle_middleware.ts`, `app/middleware/intake_guard_middleware.ts`, the two public controllers if they mention it), replace "the route is in `multipart.processManually`" (or "(multipart.processManually)") by "the body parser reads no multipart body itself (`multipart.autoProcess: false`)". In `uploads.ts`, also reword the `discardUploads` comment's "The body parser writes each uploaded file to a temp file and nothing else removes the ones that aren't stored" to "`receiveUploads` writes each uploaded file to a temp file, and nothing else removes the ones that aren't stored", and the `receiveUploads` comment's "as the body parser does for the dashboard, but only now" to "for a public API upload route (in its handler) and a signed-in dashboard request (WebMultipartMiddleware)". The docs are Task 3's.

- [ ] **Step 6: Run the tests.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=multipart.spec.ts --files=api_routes.spec.ts --files=artist_form.spec.ts --files=payment_method_form.spec.ts --files=rate_limits.spec.ts --files=inquiry_refusals.spec.ts --files=deposit_refusals.spec.ts > <scratchpad>/t38-t2b.log 2>&1`. Expected: all PASS. If a dashboard form test fails with a CSRF 403, it sent its token as a `_csrf` field: make it send the header (`.withCsrfToken()`) and note it in the PR text.

- [ ] **Step 7: Full suite and typecheck.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck > <scratchpad>/t38-tc2.log 2>&1` and, in the background, the full suite as in Task 0 into `<scratchpad>/t38-full2.log`. Expected: typecheck clean, baseline count + 6 tests, all passing.

- [ ] **Step 8: Commit.**

```bash
git add apps/platform/config/bodyparser.ts apps/platform/start/kernel.ts apps/platform/app/middleware/web_multipart_middleware.ts apps/platform/app/services/uploads.ts apps/platform/app/middleware apps/platform/app/controllers apps/platform/tests/functional/http/multipart.spec.ts apps/platform/tests/functional/api/api_routes.spec.ts
git commit -m "fix(platform): read multipart bodies only through receiveUploads" -m "The body parser auto-processes none: a signed-in dashboard request is read by one router.use
middleware after silent auth, a signed-out one is a 415 unread, and its temp files always go.
API upload routes keep reading their own body (TAT-38 ruling 16).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Docs for Part 1

**Files:**
- Modify: `apps/platform/docs/backend.md` (Public API "A new endpoint" bullet, Images bullet), `apps/platform/docs/testing.md` (Environment paragraph on uploads), `apps/platform/database/README.md` (the production-checklist bullet "The multipart parser crashes the process…")

- [ ] **Step 1: backend.md, Public API, "A new endpoint".** Replace the sentence "Every API route that takes a body is listed in `multipart.processManually` (`config/bodyparser.ts`; `api_routes.spec.ts` checks), so the body parser never reads a multipart body before `publicTenant` and the limits have answered: auto-processing streams every file to the temp directory (and the parser never removes them), even for an unknown slug." with "The body parser reads no multipart body itself (`multipart.autoProcess: false`, `api_routes.spec.ts` checks; TAT-38): auto-processing would stream every file to the temp directory before `publicTenant` and the limits answer, and its handler table crashes the process on a part named like an `Object.prototype` property." Replace the end of the bullet from "`receiveUploads` also registers its handler under every `Object.prototype` name" to the end of the bullet with "`receiveUploads` registers its handler under every `Object.prototype` name (`constructor`, `toString`, `__proto__`...), so no part name reaches the parser's flawed lookup (@adonisjs/bodyparser 11.0.4 keeps that table in a plain object; report it upstream before relying on a fix)."

- [ ] **Step 2: backend.md, Images.** Replace "Where the body parser auto-processes multipart (the dashboard forms), it writes every uploaded file to a temp file and nothing removes the ones that aren't stored; the artist-photo and payment-QR forms still leave a rejected upload's temp file in the OS temp folder (signed-in users only, not yet fixed)." with "Dashboard uploads are read by `WebMultipartMiddleware` (last in `router.use`, TAT-38): only for a signed-in user (a signed-out multipart body is a 415, never read), through `receiveUploads`, and every temp file goes at the end of the request. A multipart form sends its CSRF token in the `X-XSRF-TOKEN` header (Inertia does), never as a `_csrf` field: shield checks it before the body is read."

- [ ] **Step 3: testing.md.** In "Environment and test conventions", replace "the body parser and `receiveUploads` write them to `tmp/storage/uploads`" with "`receiveUploads` writes them to `tmp/storage/uploads`", and add after that paragraph's upload sentences: "`tests/functional/http/multipart.spec.ts` sends file parts named like `Object.prototype` properties to login, signup, a dashboard form and the public upload routes with an `unhandledRejection` listener and a client timeout: a crash there fails the test instead of ending the run."

- [ ] **Step 4: database/README.md.** Delete the production-checklist bullet that starts "The multipart parser crashes the process on a file part named like an `Object.prototype` property" (fixed by Task 2; the cause is now in backend.md).

- [ ] **Step 5: Check and commit.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check > <scratchpad>/t38-check3.log 2>&1` (expect no new warnings), then:

```bash
git add apps/platform/docs/backend.md apps/platform/docs/testing.md apps/platform/database/README.md
git commit -m "docs(platform): multipart bodies are read only through receiveUploads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part 2: limits and the server key (spec rulings 2 to 11, 17, 19)

### Task 4: The settings: `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY`

**Files:**
- Create: `apps/platform/app/services/server_keys.ts`, `apps/platform/app/services/trust_proxy.ts`, `apps/platform/tests/unit/services/server_keys.spec.ts`, `apps/platform/tests/unit/services/trust_proxy.spec.ts`
- Modify: `apps/platform/start/env.ts`, `apps/platform/.env.example`, `apps/platform/.env.test`, `apps/platform/config/app.ts` (`http`)

**Interfaces:**
- Produces: `checkServerKeys(key: string, value: string | undefined, production: boolean): Secret<readonly string[]> | undefined`, `SERVER_KEY_SHAPE`, `SERVER_KEY_RULE`, `MAX_SERVER_KEYS` (`#services/server_keys`); `checkTrustProxy(key: string, value: string | undefined, production: boolean): string | undefined` (`#services/trust_proxy`); `env.get("STOREFRONT_SERVER_KEYS")`, `env.get("TRUST_PROXY")`.

- [ ] **Step 1: Write the failing tests.**

`apps/platform/tests/unit/services/server_keys.spec.ts`:

```ts
import { test } from "@japa/runner";
import { checkServerKeys } from "#services/server_keys";
import env from "#start/env";

const KEY = "STOREFRONT_SERVER_KEYS";
const ONE = "a".repeat(43);
const TWO = `${"b".repeat(42)}=`;

test.group("STOREFRONT_SERVER_KEYS at boot", () => {
	test("one key or two, trimmed, as a Secret that never prints", ({ assert }) => {
		for (const production of [false, true]) {
			assert.deepEqual(checkServerKeys(KEY, ` ${ONE} `, production)?.release(), [ONE]);
			const both = checkServerKeys(KEY, `${ONE} , ${TWO}`, production);
			assert.deepEqual(both?.release(), [ONE, TWO]);
			assert.notInclude(String(both), ONE);
			assert.notInclude(JSON.stringify({ both }), ONE);
		}
	});

	test("each key follows the storefront's rule", ({ assert }) => {
		for (const key of [
			"a".repeat(32),
			"a".repeat(256),
			`${"a".repeat(256)}==`,
			"Az09-._~+/".repeat(4),
		]) {
			assert.deepEqual(checkServerKeys(KEY, key, true)?.release(), [key]);
		}
	});

	test("refuses a short, odd or third key and an empty entry, never echoing a value", ({
		assert,
	}) => {
		for (const value of [
			"a".repeat(31),
			"a".repeat(257),
			`${"a".repeat(32)}===`,
			`${"a".repeat(20)} ${"b".repeat(20)}`,
			`${"a".repeat(32)}é`,
			`${ONE},`,
			`,${ONE}`,
			`${ONE},,${TWO}`,
			`${ONE},${TWO},${"c".repeat(40)}`,
			`${ONE};${TWO}`,
		]) {
			let message = "";
			try {
				checkServerKeys(KEY, value, false);
			} catch (error) {
				message = (error as Error).message;
			}
			assert.match(message, /STOREFRONT_SERVER_KEYS is invalid: it must be one or two keys/, value);
			assert.notInclude(message, value);
		}
	});

	test("optional outside production, required in production", ({ assert }) => {
		for (const value of [undefined, "", "  "]) {
			assert.isUndefined(checkServerKeys(KEY, value, false));
			assert.throws(
				() => checkServerKeys(KEY, value, true),
				/STOREFRONT_SERVER_KEYS is required in production/,
			);
		}
	});

	test("the test environment has two keys (.env.test)", ({ assert }) => {
		assert.lengthOf(env.get("STOREFRONT_SERVER_KEYS")?.release() ?? [], 2);
	});
});
```

`apps/platform/tests/unit/services/trust_proxy.spec.ts`:

```ts
import { test } from "@japa/runner";
import { http } from "#config/app";
import { checkTrustProxy } from "#services/trust_proxy";

const KEY = "TRUST_PROXY";

test.group("TRUST_PROXY at boot", () => {
	test("names, addresses and ranges, normalized", ({ assert }) => {
		assert.equal(checkTrustProxy(KEY, "loopback", true), "loopback");
		assert.equal(
			checkTrustProxy(KEY, " loopback ,10.0.0.0/8, 2001:db8::/32 ,192.0.2.10 ", true),
			"loopback, 10.0.0.0/8, 2001:db8::/32, 192.0.2.10",
		);
		assert.equal(checkTrustProxy(KEY, "linklocal, uniquelocal", false), "linklocal, uniquelocal");
	});

	test("refuses trusting everyone and anything that isn't a proxy address", ({ assert }) => {
		for (const value of [
			"true",
			"*",
			"all",
			"0.0.0.0/0",
			"::/0",
			"10.0.0.0/33",
			"fe80::/129",
			"10.0.0.0/8/1",
			"10.0.0.0/x",
			"example.com",
			"loopback,",
			"10.0.0.1:80",
			"[::1]",
		]) {
			assert.throws(() => checkTrustProxy(KEY, value, false), /TRUST_PROXY must list/, value);
		}
	});

	test("optional outside production, required in production", ({ assert }) => {
		for (const value of [undefined, "", " "]) {
			assert.isUndefined(checkTrustProxy(KEY, value, false));
			assert.throws(() => checkTrustProxy(KEY, value, true), /TRUST_PROXY is required in production/);
		}
	});

	test("unset (as in tests), the app trusts loopback only", ({ assert }) => {
		assert.isTrue(http.trustProxy("127.0.0.1", 0));
		assert.isTrue(http.trustProxy("::1", 0));
		assert.isFalse(http.trustProxy("10.1.2.3", 0));
	});
});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=server_keys.spec.ts --files=trust_proxy.spec.ts > <scratchpad>/t38-t4.log 2>&1`. Expected: exit 124 with "Cannot find module '#services/server_keys'".

- [ ] **Step 3: Write the checks.**

`apps/platform/app/services/server_keys.ts`:

```ts
import { Secret } from "@adonisjs/core/helpers";

/**
 * STOREFRONT_SERVER_KEYS as start/env.ts reads it (TAT-38): the storefront
 * server's key (its STOREFRONT_SERVER_KEY), or two while rotating
 * (old,new). A valid key only makes the storefront's server-side calls
 * count per visitor; it grants nothing. Each key follows the storefront's
 * rule (RFC 7235 token68). This file imports nothing from the app, because
 * start/env.ts runs it while the environment is still being read; its
 * messages never contain a value.
 */
export const SERVER_KEY_SHAPE = /^[A-Za-z0-9._~+/-]{32,256}={0,2}$/;

export const MAX_SERVER_KEYS = 2;

export const SERVER_KEY_RULE =
	"one or two keys separated by a comma, each 32 to 256 letters, digits or -._~+/ characters, then at most two = of padding (make one with openssl rand -base64 32)";

export function checkServerKeys(
	key: string,
	value: string | undefined,
	production: boolean,
): Secret<readonly string[]> | undefined {
	const raw = value?.trim();
	if (!raw) {
		if (production) {
			throw new Error(
				`${key} is required in production: the storefront's STOREFRONT_SERVER_KEY, ${SERVER_KEY_RULE}`,
			);
		}
		return undefined;
	}
	const keys = raw.split(",").map((entry) => entry.trim());
	if (
		keys.length > MAX_SERVER_KEYS ||
		keys.some((entry) => !SERVER_KEY_SHAPE.test(entry))
	) {
		throw new Error(`${key} is invalid: it must be ${SERVER_KEY_RULE}`);
	}
	return new Secret(Object.freeze(keys));
}
```

`apps/platform/app/services/trust_proxy.ts`:

```ts
import { isIP } from "node:net";

/**
 * TRUST_PROXY as start/env.ts reads it (TAT-38): the reverse proxies whose
 * X-Forwarded-For the app believes (config/app.ts, http.trustProxy, read by
 * proxy-addr). A list of proxy-addr names (`loopback`, `linklocal`,
 * `uniquelocal`), IP addresses and CIDR ranges, comma-separated; never
 * every address. Required in production, where the default (loopback)
 * would make every visitor behind a load balancer share its address;
 * unset elsewhere it is loopback. Imports nothing from the app.
 */
const NAMES = new Set(["loopback", "linklocal", "uniquelocal"]);

const RULE =
	"loopback, linklocal, uniquelocal, IP addresses or CIDR ranges, separated by commas, e.g. loopback, 10.0.0.0/8 (never every address)";

export function checkTrustProxy(
	key: string,
	value: string | undefined,
	production: boolean,
): string | undefined {
	const raw = value?.trim();
	if (!raw) {
		if (production) {
			throw new Error(
				`${key} is required in production: the reverse proxy's addresses, ${RULE}`,
			);
		}
		return undefined;
	}
	const entries = raw.split(",").map((entry) => entry.trim());
	if (entries.some((entry) => !isProxyEntry(entry))) {
		throw new Error(`${key} must list ${RULE}`);
	}
	return entries.join(", ");
}

function isProxyEntry(entry: string): boolean {
	if (NAMES.has(entry)) return true;
	const [address, prefix, ...rest] = entry.split("/");
	const family = isIP(address);
	if (family === 0 || rest.length > 0) return false;
	if (prefix === undefined) return true;
	if (!/^\d{1,3}$/.test(prefix)) return false;
	const bits = Number(prefix);
	return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}
```

- [ ] **Step 4: Read them at boot.** In `apps/platform/start/env.ts`, import `checkServerKeys` from `#services/server_keys` and `checkTrustProxy` from `#services/trust_proxy` next to `checkStorefrontUrl`, and add after the `STOREFRONT_URL` entry:

```ts
	// The storefront server's key(s) (TAT-38): one, or two while rotating
	// (old,new). Only makes its server-side calls count per visitor.
	// Required in production; unset elsewhere, no key is accepted.
	STOREFRONT_SERVER_KEYS: (key: string, value?: string) =>
		checkServerKeys(key, value, process.env.NODE_ENV === "production"),
	// The reverse proxy whose X-Forwarded-For the app believes (TAT-38).
	// Required in production; unset elsewhere it is loopback.
	TRUST_PROXY: (key: string, value?: string) =>
		checkTrustProxy(key, value, process.env.NODE_ENV === "production"),
```

In `apps/platform/config/app.ts`, add to `defineConfig({...})` after `allowMethodSpoofing`:

```ts
	/**
	 * The proxies whose X-Forwarded-For request.ip() believes (TRUST_PROXY,
	 * required in production; loopback in development and tests). Never
	 * every address: any client could then choose its own (TAT-38).
	 */
	trustProxy: env.get("TRUST_PROXY") ?? "loopback",
```

Append to `apps/platform/.env.test`:

```
# Two server keys (TAT-38), sent by the HTTP tests as the storefront would.
STOREFRONT_SERVER_KEYS=test-key-one-0123456789abcdefghijklmnopqrstuv,test-key-two-0123456789abcdefghijklmnopqrstuv
```

In `apps/platform/.env.example`, after the `STOREFRONT_URL` block:

```
# The storefront server's key (TAT-38): the same value as the storefront's
# STOREFRONT_SERVER_KEY, so its server-side API calls count per visitor
# instead of as one client. It grants no data. One key, or two separated by
# a comma while you rotate (old,new); each 32 to 256 letters, digits or
# -._~+/ characters, then at most two = (openssl rand -base64 32).
# REQUIRED when NODE_ENV=production; unset in development, no key is accepted.
# STOREFRONT_SERVER_KEYS=

# The reverse proxy in front of the app, whose X-Forwarded-For it believes
# (TAT-38): loopback, linklocal, uniquelocal, IP addresses or CIDR ranges,
# comma-separated, e.g. loopback, 10.0.0.0/8; never every address.
# REQUIRED when NODE_ENV=production; unset, only loopback is trusted.
# TRUST_PROXY=
```

- [ ] **Step 5: Run the tests.** Same command as Step 2. Expected: PASS (9 tests). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck > <scratchpad>/t38-tc4.log 2>&1`: clean.

- [ ] **Step 6: Commit.**

```bash
git add apps/platform/app/services/server_keys.ts apps/platform/app/services/trust_proxy.ts apps/platform/tests/unit/services/server_keys.spec.ts apps/platform/tests/unit/services/trust_proxy.spec.ts apps/platform/start/env.ts apps/platform/config/app.ts apps/platform/.env.example apps/platform/.env.test
git commit -m "feat(platform): STOREFRONT_SERVER_KEYS and TRUST_PROXY settings, required in production" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Who is calling: the key, the visitor, the caller

**Files:**
- Create: `apps/platform/app/services/api_caller.ts`, `apps/platform/tests/unit/services/api_caller.spec.ts`

**Interfaces:**
- Consumes: `env.get("STOREFRONT_SERVER_KEYS")` (Task 4).
- Produces (`#services/api_caller`): `VISITOR_IP_HEADER = "x-visitor-ip"`; `class ServerKeys { constructor(keys: readonly string[]); check(authorization: string | undefined): "match" | "unknown" | "none" }`; `isPublicAddress(ip: string): boolean`; `visitorIp(value: string | undefined): string | null`; `type ApiCaller = { kind: "anonymous"; ip: string } | { kind: "storefront"; ip: string | null }`; `callerOf(ctx: HttpContext): ApiCaller` (memoized on `ctx.apiCaller`); `callerIp(ctx: HttpContext): string`; `CALLER_WARNINGS` (`unknownKey`, `noVisitor`); `resetCallerWarnings(): void`.

- [ ] **Step 1: Write the failing tests.**

`apps/platform/tests/unit/services/api_caller.spec.ts`:

```ts
import crypto from "node:crypto";
import { mock } from "node:test";
import { test } from "@japa/runner";
import { isPublicAddress, ServerKeys, visitorIp } from "#services/api_caller";

const ONE = "test-key-one-0123456789abcdefghijklmnopqrstuv";
const TWO = "test-key-two-0123456789abcdefghijklmnopqrstuv";

test.group("ServerKeys", (group) => {
	group.each.teardown(() => mock.restoreAll());

	test("either configured key matches; anything else does not", ({ assert }) => {
		const keys = new ServerKeys([ONE, TWO]);
		assert.equal(keys.check(`Bearer ${ONE}`), "match");
		assert.equal(keys.check(`Bearer ${TWO}`), "match");
		assert.equal(keys.check(`bearer  ${TWO}`), "match");
		assert.equal(keys.check(`Bearer ${ONE}x`), "unknown");
		assert.equal(keys.check(`Bearer ${"z".repeat(43)}`), "unknown");
		for (const header of [
			undefined,
			"",
			"Bearer",
			"Bearer ",
			`Basic ${ONE}`,
			ONE,
			`Bearer ${ONE} extra`,
			`Bearer ${ONE},Bearer ${TWO}`,
			`Bearer ${ONE}é`,
			`Bearer ${"a".repeat(300)}`,
			`Bearer ${"a".repeat(10_000)}`,
		]) {
			assert.equal(keys.check(header), "none", String(header).slice(0, 40));
		}
	});

	test("rotation: a list holds exactly its keys", ({ assert }) => {
		assert.equal(new ServerKeys([TWO]).check(`Bearer ${ONE}`), "unknown");
		assert.equal(new ServerKeys([TWO]).check(`Bearer ${TWO}`), "match");
		assert.equal(new ServerKeys([]).check(`Bearer ${ONE}`), "unknown");
	});

	test("every configured key is compared in constant time, whichever matches", ({ assert }) => {
		const keys = new ServerKeys([ONE, TWO]);
		const compare = mock.method(crypto, "timingSafeEqual");
		for (const header of [`Bearer ${ONE}`, `Bearer ${TWO}`, `Bearer ${"z".repeat(43)}`]) {
			compare.mock.resetCalls();
			keys.check(header);
			assert.equal(compare.mock.callCount(), 2, header);
			for (const call of compare.mock.calls) {
				assert.lengthOf(call.arguments[0] as Buffer, 32);
				assert.lengthOf(call.arguments[1] as Buffer, 32);
			}
		}
		compare.mock.resetCalls();
		keys.check(`Basic ${ONE}`);
		assert.equal(compare.mock.callCount(), 0);
	});
});

test.group("visitorIp", () => {
	test("a single public IP literal is the visitor", ({ assert }) => {
		for (const [value, expected] of [
			["203.0.113.7", "203.0.113.7"],
			[" 203.0.113.7 ", "203.0.113.7"],
			["2001:db8::1", "2001:db8::1"],
			["8.8.8.8", "8.8.8.8"],
			["::ffff:203.0.113.7", "::ffff:203.0.113.7"],
		]) {
			assert.equal(visitorIp(value), expected, value);
		}
	});

	test("lists, ports, brackets, zones and junk are no visitor", ({ assert }) => {
		for (const value of [
			undefined,
			"",
			" ",
			"203.0.113.7, 198.51.100.1",
			"203.0.113.7 198.51.100.1",
			"203.0.113.7:443",
			"[2001:db8::1]",
			"fe80::1%eth0",
			"2001:db8::1%1",
			"localhost",
			"203.0.113",
			"x".repeat(46),
		]) {
			assert.isNull(visitorIp(value), String(value));
		}
	});

	test("addresses that can't be a visitor's public address are no visitor", ({ assert }) => {
		for (const value of [
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"127.0.0.1",
			"169.254.1.1",
			"100.64.0.1",
			"100.127.255.255",
			"0.0.0.0",
			"192.0.0.8",
			"198.18.0.1",
			"224.0.0.1",
			"255.255.255.255",
			"::1",
			"::",
			"fc00::1",
			"fd12:3456::1",
			"fe80::1",
			"ff02::1",
			"::ffff:10.0.0.1",
			"::ffff:127.0.0.1",
			"::ffff:a00:1",
		]) {
			assert.isFalse(isPublicAddress(value), value);
			assert.isNull(visitorIp(value), value);
		}
	});

	test("public neighbours of those ranges are visitors", ({ assert }) => {
		for (const value of ["100.128.0.1", "172.32.0.1", "11.0.0.1", "198.20.0.1", "2001:4860::8888"]) {
			assert.isTrue(isPublicAddress(value), value);
			assert.equal(visitorIp(value), value);
		}
	});
});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=api_caller.spec.ts > <scratchpad>/t38-t5.log 2>&1`. Expected: exit 124, "Cannot find module '#services/api_caller'".

- [ ] **Step 3: Write `api_caller.ts`.** `crypto` must be the module's default import, called as `crypto.timingSafeEqual`, so the test's spy sees the calls.

```ts
import crypto from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { HttpContext } from "@adonisjs/core/http";
import logger from "@adonisjs/core/services/logger";
import env from "#start/env";

/**
 * Who is calling the public API (TAT-38). A request with a valid server key
 * (Authorization: Bearer, STOREFRONT_SERVER_KEYS) is the hosted
 * storefront's server: it is counted by its visitor (X-Visitor-IP), each
 * kind in its own buckets. Anything else is an anonymous client, counted by
 * request.ip(). The key grants nothing else: no data, route, field, cache
 * variant or authorization. The dashboard never calls this.
 */
export const VISITOR_IP_HEADER = "x-visitor-ip";

/** Longer Authorization headers are never parsed or hashed. */
const MAX_AUTHORIZATION_LENGTH = 300;

/** RFC 7235: the scheme, at least one space, a token68. */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

const sha256 = (value: string) =>
	crypto.createHash("sha256").update(value, "utf8").digest();

/**
 * The configured keys, kept as SHA-256 digests. `check` compares the
 * presented token's digest with every one in constant time, without
 * stopping at a match, so the time doesn't say which key matched or how
 * close a guess was.
 */
export class ServerKeys {
	readonly #digests: Buffer[];

	constructor(keys: readonly string[]) {
		this.#digests = keys.map(sha256);
	}

	check(authorization: string | undefined): "match" | "unknown" | "none" {
		if (!authorization || authorization.length > MAX_AUTHORIZATION_LENGTH) {
			return "none";
		}
		const token = BEARER.exec(authorization)?.[1];
		if (!token) return "none";
		const presented = sha256(token);
		let matched = false;
		for (const digest of this.#digests) {
			matched = crypto.timingSafeEqual(presented, digest) || matched;
		}
		return matched ? "match" : "unknown";
	}
}

let configured: ServerKeys | undefined;

/** STOREFRONT_SERVER_KEYS, read once per process. */
function serverKeys(): ServerKeys {
	configured ??= new ServerKeys(env.get("STOREFRONT_SERVER_KEYS")?.release() ?? []);
	return configured;
}

/**
 * Ranges a visitor's public address is never in: private, loopback,
 * link-local, carrier-grade NAT, "this network", IETF and benchmarking
 * blocks, multicast and reserved. IPv4-mapped IPv6 addresses are checked
 * against the IPv4 rules (BlockList does this).
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
	const family = isIP(ip);
	if (family === 0) return false;
	return !NOT_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The X-Visitor-IP value as a visitor's address: one IP literal (no list,
 * port, brackets or zone) in a public range, else null.
 */
export function visitorIp(value: string | undefined): string | null {
	const ip = value?.trim() ?? "";
	if (ip.length === 0 || ip.length > 45 || ip.includes("%")) return null;
	return isPublicAddress(ip) ? ip : null;
}

/** A caller: an anonymous client by its address, or the storefront by its visitor (null: none usable). */
export type ApiCaller =
	| { kind: "anonymous"; ip: string }
	| { kind: "storefront"; ip: string | null };

declare module "@adonisjs/core/http" {
	interface HttpContext {
		/** The public API caller, set by callerOf (the gate runs it first). */
		apiCaller?: ApiCaller;
	}
}

const WARN_EVERY_MS = 10 * 60 * 1000;

/** Fixed texts: never a key, a part of one, or an address. */
export const CALLER_WARNINGS = {
	unknownKey:
		"A request presented a server key this API does not accept; it was counted as an anonymous client. Check STOREFRONT_SERVER_KEYS against the storefront's STOREFRONT_SERVER_KEY.",
	noVisitor:
		"A request with the storefront's server key had no usable X-Visitor-IP; it was counted in the storefront's shared budget. Check that the storefront forwards its visitors' addresses.",
} as const;

const lastWarned = new Map<keyof typeof CALLER_WARNINGS, number>();

function warnAtMostEvery(kind: keyof typeof CALLER_WARNINGS) {
	const now = Date.now();
	const last = lastWarned.get(kind);
	if (last !== undefined && now - last < WARN_EVERY_MS) return;
	lastWarned.set(kind, now);
	logger.warn(CALLER_WARNINGS[kind]);
}

/** For tests: the next warning of each kind is logged again. */
export function resetCallerWarnings() {
	lastWarned.clear();
}

/** The request's caller, worked out once (the gate, PublicGateMiddleware, asks first). */
export function callerOf(ctx: HttpContext): ApiCaller {
	if (ctx.apiCaller) return ctx.apiCaller;
	const key = serverKeys().check(ctx.request.header("authorization"));
	if (key === "unknown") warnAtMostEvery("unknownKey");
	let caller: ApiCaller;
	if (key === "match") {
		const ip = visitorIp(ctx.request.header(VISITOR_IP_HEADER));
		if (ip === null) warnAtMostEvery("noVisitor");
		caller = { kind: "storefront", ip };
	} else {
		caller = { kind: "anonymous", ip: ctx.request.ip() };
	}
	ctx.apiCaller = caller;
	return caller;
}

/**
 * The address a public throttle counts: the storefront's visitor, else
 * request.ip(). Later throttles use this, never request.ip().
 */
export function callerIp(ctx: HttpContext): string {
	return callerOf(ctx).ip ?? ctx.request.ip();
}
```

- [ ] **Step 4: Run the tests.** Same command as Step 2. Expected: PASS (7 tests). Typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/api_caller.ts apps/platform/tests/unit/services/api_caller.spec.ts
git commit -m "feat(platform): tell the storefront's server from anonymous callers by its key" -m "SHA-256 digests compared in constant time; X-Visitor-IP honoured only with a valid key and only as
one public IP literal (TAT-38 rulings 3, 5, 6).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The limit table

**Files:**
- Create: `apps/platform/app/services/api_limits.ts`, `apps/platform/tests/unit/services/api_limits.spec.ts`, `apps/platform/tests/helpers/api_limits.ts`

**Interfaces:**
- Consumes: `ApiCaller` (Task 5), `clientAddress`, `digest` (`#services/rate_limits`), `limiter` (`@adonisjs/limiter/services/main`).
- Produces (`#services/api_limits`): `type Budget = { readonly requests: number; readonly duration: string }`; `API_LIMITS` (`callerReads`, `callerWrites`, `tenantReads`, each `{ scope: "caller" | "tenant"; methods: "reads" | "writes"; anonymous: Budget; storefront: Budget }`); `type ApiLimitName`; `SHARED_STOREFRONT_BUDGET`; `apiLimitFor(name: ApiLimitName, caller: ApiCaller, tenantId?: string): { key: string; budget: Budget }`; `consumeApiLimit(name: ApiLimitName, caller: ApiCaller, tenantId?: string): Promise<void>` (throws the limiter's `E_TOO_MANY_REQUESTS`). Test helpers (`#tests/helpers/api_limits`): `fillApiLimit(name, caller, tenantId?)`, `testServerKeys(): [string, string]`.

- [ ] **Step 1: Write the failing tests.**

`apps/platform/tests/unit/services/api_limits.spec.ts`:

```ts
import { mock } from "node:test";
import { errors as limiterErrors } from "@adonisjs/limiter";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import { INTAKE_LIMITS } from "#modules/inquiries/intake_limits";
import { DEPOSIT_LIMITS } from "#modules/payments/deposit_limits";
import type { ApiCaller } from "#services/api_caller";
import {
	API_LIMITS,
	apiLimitFor,
	consumeApiLimit,
	SHARED_STOREFRONT_BUDGET,
} from "#services/api_limits";

const ANON: ApiCaller = { kind: "anonymous", ip: "203.0.113.7" };
const STOREFRONT: ApiCaller = { kind: "storefront", ip: "203.0.113.7" };
const NO_VISITOR: ApiCaller = { kind: "storefront", ip: null };

test.group("API limits: keys", () => {
	test("caller keys are digests, apart by kind and by limit", ({ assert }) => {
		const anon = apiLimitFor("callerReads", ANON);
		const storefront = apiLimitFor("callerReads", STOREFRONT);
		assert.match(anon.key, /^api_callerReads_anon_[A-Za-z0-9_-]{43}$/);
		assert.match(storefront.key, /^api_callerReads_sf_[A-Za-z0-9_-]{43}$/);
		assert.notInclude(anon.key, "203.0.113");
		assert.notEqual(anon.key, storefront.key);
		assert.notEqual(apiLimitFor("callerWrites", ANON).key, anon.key);
		assert.equal(apiLimitFor("callerReads", { kind: "anonymous", ip: "::ffff:203.0.113.7" }).key, anon.key);
		assert.equal(
			apiLimitFor("callerReads", { kind: "anonymous", ip: "2001:db8:1:2::1" }).key,
			apiLimitFor("callerReads", { kind: "anonymous", ip: "2001:db8:1:2::9" }).key,
		);
		assert.deepEqual(anon.budget, API_LIMITS.callerReads.anonymous);
		assert.deepEqual(storefront.budget, API_LIMITS.callerReads.storefront);
	});

	test("a storefront call without a visitor spends one shared budget, reads and writes alike", ({ assert }) => {
		for (const name of ["callerReads", "callerWrites"] as const) {
			assert.deepEqual(apiLimitFor(name, NO_VISITOR), {
				key: "api_storefront_shared",
				budget: SHARED_STOREFRONT_BUDGET,
			});
		}
	});

	test("studio limits count per studio and per kind, and need the studio", ({ assert }) => {
		assert.equal(apiLimitFor("tenantReads", ANON, "t-a").key, "api_tenantReads_anon_t-a");
		assert.equal(apiLimitFor("tenantReads", STOREFRONT, "t-a").key, "api_tenantReads_sf_t-a");
		assert.equal(apiLimitFor("tenantReads", NO_VISITOR, "t-a").key, "api_tenantReads_sf_t-a");
		assert.notEqual(apiLimitFor("tenantReads", ANON, "t-b").key, "api_tenantReads_anon_t-a");
		assert.deepEqual(apiLimitFor("tenantReads", STOREFRONT, "t-a").budget, API_LIMITS.tenantReads.storefront);
		assert.throws(() => apiLimitFor("tenantReads", ANON), /per tenant/);
	});

	test("the numbers, and the generic limits never bind before a route's own", ({ assert }) => {
		assert.deepEqual(API_LIMITS.callerReads.anonymous, { requests: 300, duration: "5 mins" });
		assert.deepEqual(API_LIMITS.callerWrites.anonymous, { requests: 60, duration: "1 hour" });
		assert.deepEqual(API_LIMITS.tenantReads.storefront, { requests: 6000, duration: "5 mins" });
		assert.deepEqual(API_LIMITS.tenantReads.anonymous, { requests: 1500, duration: "5 mins" });
		assert.deepEqual(SHARED_STOREFRONT_BUDGET, { requests: 3000, duration: "5 mins" });
		assert.isAbove(API_LIMITS.callerWrites.anonymous.requests, DEPOSIT_LIMITS.submit.perAddress.requests);
		assert.isAbove(API_LIMITS.callerWrites.anonymous.requests, INTAKE_LIMITS.perAddress.requests);
		// 300 per 5 minutes is 600 per 10: above the deposit page's 120 per address.
		assert.isAbove(API_LIMITS.callerReads.anonymous.requests * 2, DEPOSIT_LIMITS.read.perAddress.requests);
	});
});

test.group("API limits: windows", (group) => {
	group.each.setup(() => limiter.clear(["memory"]));
	group.each.teardown(() => mock.timers.reset());

	for (const [name, tenantId, minutes] of [
		["callerReads", undefined, 6],
		["callerWrites", undefined, 61],
		["tenantReads", "tenant-38", 6],
	] as const) {
		test(`${name}: refused over its budget until the window ends`, async ({ assert }) => {
			mock.timers.enable({ apis: ["Date"], now: Date.now() });
			const { budget } = apiLimitFor(name, ANON, tenantId);
			for (let i = 0; i < budget.requests; i++) {
				await consumeApiLimit(name, ANON, tenantId);
			}
			await assert.rejects(
				() => consumeApiLimit(name, ANON, tenantId),
				limiterErrors.E_TOO_MANY_REQUESTS,
			);
			// Another caller and another kind are untouched.
			await consumeApiLimit(name, STOREFRONT, tenantId);
			await consumeApiLimit(name, { kind: "anonymous", ip: "198.51.100.9" }, tenantId);

			mock.timers.tick(minutes * 60 * 1000);
			await consumeApiLimit(name, ANON, tenantId);
		});
	}
});
```

If `INTAKE_LIMITS` names its address budget differently in the built TAT-55 code, use the real name (Task 0 found `export const INTAKE_LIMITS`).

`apps/platform/tests/helpers/api_limits.ts`:

```ts
import limiter from "@adonisjs/limiter/services/main";
import type { ApiCaller } from "#services/api_caller";
import { type ApiLimitName, apiLimitFor } from "#services/api_limits";
import env from "#start/env";

/** Spends a whole budget, so the caller's next request is refused (TAT-38). */
export async function fillApiLimit(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
) {
	const { key, budget } = apiLimitFor(name, caller, tenantId);
	await limiter.use({ ...budget }).increment(key, budget.requests);
}

/** The two STOREFRONT_SERVER_KEYS of .env.test. */
export function testServerKeys(): [string, string] {
	const keys = env.get("STOREFRONT_SERVER_KEYS")?.release() ?? [];
	if (keys.length !== 2) {
		throw new Error(".env.test must set two STOREFRONT_SERVER_KEYS");
	}
	return [keys[0], keys[1]];
}
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=api_limits.spec.ts > <scratchpad>/t38-t6.log 2>&1`. Expected: exit 124, "Cannot find module '#services/api_limits'".

- [ ] **Step 3: Write `api_limits.ts`.**

```ts
import limiter from "@adonisjs/limiter/services/main";
import type { ApiCaller } from "#services/api_caller";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The public API's generic limits (TAT-38): fixed windows on TAT-8's
 * limiter, every request counted, refused ones included. The gate
 * (PublicGateMiddleware) counts every API request per caller before its
 * body; `apiLimit({ name })` counts a studio's reads after publicTenant.
 * Each caller kind has its own budget and keys. A route's own limits
 * (DEPOSIT_LIMITS, INTAKE_LIMITS) stay below these, so they bind first. A
 * later ticket adds an entry and `.use(middleware.apiLimit({ name }))`.
 */
export type Budget = { readonly requests: number; readonly duration: string };

export type ApiLimit = {
	readonly scope: "caller" | "tenant";
	readonly methods: "reads" | "writes";
	readonly anonymous: Budget;
	readonly storefront: Budget;
};

export const API_LIMITS = {
	/** A page costs the storefront 2 keyed reads, a browser none; carrier NAT shares addresses. */
	callerReads: {
		scope: "caller",
		methods: "reads",
		anonymous: { requests: 300, duration: "5 mins" },
		storefront: { requests: 300, duration: "5 mins" },
	},
	/** Above the intake's and the deposit page's own per-address limits. */
	callerWrites: {
		scope: "caller",
		methods: "writes",
		anonymous: { requests: 60, duration: "1 hour" },
		storefront: { requests: 60, duration: "1 hour" },
	},
	/** Containment: a flood aimed at one studio can't take the platform; the pages' bucket is the storefront's. */
	tenantReads: {
		scope: "tenant",
		methods: "reads",
		anonymous: { requests: 1500, duration: "5 mins" },
		storefront: { requests: 6000, duration: "5 mins" },
	},
} as const satisfies Record<string, ApiLimit>;

export type ApiLimitName = keyof typeof API_LIMITS;

/** Storefront calls with no usable visitor address: one budget for all of them. */
export const SHARED_STOREFRONT_BUDGET: Budget = {
	requests: 3000,
	duration: "5 mins",
};

/** The limiter key and budget of one request: digests or a tenant id, never an address. */
export function apiLimitFor(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
): { key: string; budget: Budget } {
	const limit: ApiLimit = API_LIMITS[name];
	const kind = caller.kind === "storefront" ? "sf" : "anon";
	const budget = limit[caller.kind];
	if (limit.scope === "tenant") {
		if (!tenantId) {
			throw new Error(`The ${name} limit counts per tenant: pass the tenant id`);
		}
		return { key: `api_${name}_${kind}_${tenantId}`, budget };
	}
	if (caller.ip === null) {
		return { key: "api_storefront_shared", budget: SHARED_STOREFRONT_BUDGET };
	}
	return {
		key: `api_${name}_${kind}_${digest(clientAddress(caller.ip))}`,
		budget,
	};
}

/** Counts one request; over the budget it throws the limiter's E_TOO_MANY_REQUESTS (429 with Retry-After). */
export async function consumeApiLimit(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
): Promise<void> {
	const { key, budget } = apiLimitFor(name, caller, tenantId);
	// limiter.use() parses the duration in place: a copy.
	await limiter.use({ ...budget }).consume(key);
}
```

- [ ] **Step 4: Run the tests.** Same command as Step 2. Expected: PASS (7 tests). Typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/api_limits.ts apps/platform/tests/unit/services/api_limits.spec.ts apps/platform/tests/helpers/api_limits.ts
git commit -m "feat(platform): the public API's limit table, per caller and per studio" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The contract: rate-limit and key conventions

**Files:**
- Modify: `packages/types/openapi.yaml`; regenerated `packages/types/src/openapi.gen.ts`

- [ ] **Step 1: Edit `info.description`.** After the "Caching." bullet of the conventions list, add:

```yaml
    - **Rate limits (TAT-38).** Every request counts against its caller
      before its body is read, reads and writes apart; reads also count per
      studio. Over a limit the answer is 429 `rate_limited` with
      `Retry-After` (seconds). A response served from a cache is not
      counted. Never retry a write automatically.
    - **Server key.** The hosted storefront's server sends a secret key
      (`Authorization: Bearer`) and its visitor's address (`X-Visitor-IP`)
      so that its server-side calls count per visitor. The key grants no
      data and no access: every endpoint answers the same without it. It
      is an operational header, not an authentication scheme; never send it
      from a browser (CORS allows neither header).
```

- [ ] **Step 2: Remove the security scheme.** Delete the top-level block

```yaml
security:
  - {}
  - serverKey: []
```

and, under `components`, the whole `securitySchemes:` entry (`serverKey` with its `type`, `scheme` and `description`).

- [ ] **Step 3: 429 on the reads.** In `getStudio`, `listArtists` and `getArtist`, add after the `"404"` line:

```yaml
        "429": { $ref: "#/components/responses/RateLimited" }
```

- [ ] **Step 4: Regenerate and check.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate > <scratchpad>/t38-gen7.log 2>&1`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test > <scratchpad>/t38-sdk7.log 2>&1` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test > <scratchpad>/t38-react7.log 2>&1`. Expected: both pass with their Task 0 counts; `rg -n "serverKey|securitySchemes" packages/types` finds nothing.

- [ ] **Step 5: Commit.**

```bash
git add packages/types/openapi.yaml packages/types/src/openapi.gen.ts
git commit -m "feat(types): document the rate limits and the server key as operational, not a security scheme" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The gate, before the body

**Files:**
- Create: `apps/platform/app/middleware/public_gate_middleware.ts`, `apps/platform/tests/helpers/raw_http.ts`, `apps/platform/tests/functional/api/public_limits.spec.ts`
- Modify: `apps/platform/start/kernel.ts` (`router.use`, first entry)

**Interfaces:**
- Consumes: `callerOf`, `resetCallerWarnings`, `CALLER_WARNINGS` (Task 5), `consumeApiLimit`, `apiLimitFor` (Task 6), `fillApiLimit`, `testServerKeys` (Task 6), `isApiRequest`, `READ_METHODS`.
- Produces: `PublicGateMiddleware` (first in `router.use`); test helpers `rawRequest(lines: string[], body?: string): Promise<net.Socket>`, `readResponse(socket, timeoutMs?): Promise<{ status: number; headers: Record<string, string>; body: string }>`, `closedWithin(socket, ms): Promise<boolean>`, `waitFor(check: () => Promise<boolean> | boolean, what: string): Promise<void>` (`#tests/helpers/raw_http`). Task 16 adds the write slot to the gate.

- [ ] **Step 1: The raw HTTP helper.** `apps/platform/tests/helpers/raw_http.ts`:

```ts
import net from "node:net";
import env from "#start/env";

export type RawResponse = {
	status: number;
	headers: Record<string, string>;
	body: string;
};

/**
 * A raw connection to the test server (from loopback, so X-Forwarded-For
 * picks the client address): writes the request line and headers, then
 * `body`, and nothing more unless the test writes it.
 */
export function rawRequest(lines: string[], body = ""): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(
			{ host: env.get("HOST"), port: env.get("PORT") },
			() => {
				socket.write(
					`${[...lines, `Host: ${env.get("HOST")}`, "", ""].join("\r\n")}${body}`,
				);
				resolve(socket);
			},
		);
		socket.once("error", reject);
	});
}

/** The first response on `socket`, once its headers and Content-Length bytes arrived. */
export function readResponse(
	socket: net.Socket,
	timeoutMs = 3000,
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		let data = "";
		const timer = setTimeout(() => {
			socket.off("data", onData);
			reject(new Error(`No response within ${timeoutMs} ms`));
		}, timeoutMs);
		function onData(chunk: Buffer) {
			data += chunk.toString("latin1");
			const end = data.indexOf("\r\n\r\n");
			if (end === -1) return;
			const [statusLine, ...headerLines] = data.slice(0, end).split("\r\n");
			const headers = Object.fromEntries(
				headerLines.map((line) => {
					const colon = line.indexOf(":");
					return [
						line.slice(0, colon).trim().toLowerCase(),
						line.slice(colon + 1).trim(),
					];
				}),
			);
			const length = Number(headers["content-length"] ?? 0);
			const body = data.slice(end + 4);
			if (body.length < length) return;
			clearTimeout(timer);
			socket.off("data", onData);
			resolve({
				status: Number(statusLine.split(" ")[1]),
				headers,
				body: body.slice(0, length),
			});
		}
		socket.on("data", onData);
	});
}

/** Whether the server closed `socket` within `ms`. */
export function closedWithin(socket: net.Socket, ms: number): Promise<boolean> {
	if (socket.destroyed || socket.readableEnded) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		const done = () => {
			clearTimeout(timer);
			resolve(true);
		};
		socket.once("end", done);
		socket.once("close", done);
	});
}

/** Polls until `check` holds (something the server finishes after answering). */
export async function waitFor(
	check: () => Promise<boolean> | boolean,
	what: string,
): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	throw new Error(`Timed out waiting for ${what}`);
}
```

- [ ] **Step 2: Write the failing tests.** `apps/platform/tests/functional/api/public_limits.spec.ts`:

```ts
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import User from "#models/user";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { CALLER_WARNINGS, resetCallerWarnings } from "#services/api_caller";
import { apiLimitFor } from "#services/api_limits";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit, testServerKeys } from "#tests/helpers/api_limits";
import { intakeFields, png, postInquiry } from "#tests/helpers/intake";
import { rawRequest, readResponse } from "#tests/helpers/raw_http";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";

const SLUG = "limits-38";
const studio = `/api/v1/tenants/${SLUG}`;
const [ONE, TWO] = testServerKeys();
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

test.group("Public API limits: the gate", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => resetCallerWarnings());
	group.each.teardown(() => mock.restoreAll());

	test("an anonymous address over its read budget is a 429 envelope with Retry-After", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", { kind: "anonymous", ip: "203.0.113.40" });

		const refused = await client.get(studio).header("x-forwarded-for", "203.0.113.40");
		assertApiError(refused, 429, "rate_limited");
		assert.isAbove(Number(refused.header("retry-after")), 0);

		(await client.get(studio).header("x-forwarded-for", "203.0.113.41")).assertStatus(200);
	});

	test("reads and writes have budgets of their own; unknown slugs count too", async ({ client, assert }) => {
		await fillApiLimit("callerWrites", { kind: "anonymous", ip: "203.0.113.42" });
		assertApiError(
			await client.post("/api/v1/__test/echo").header("x-forwarded-for", "203.0.113.42").json({ label: "x" }),
			429,
			"rate_limited",
		);
		(await client.get("/api/v1/__test/ok").header("x-forwarded-for", "203.0.113.42")).assertStatus(200);

		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td38").header("x-forwarded-for", "203.0.113.43"),
			404,
			"not_found",
		);
		const { key, budget } = apiLimitFor("callerReads", { kind: "anonymous", ip: "203.0.113.43" });
		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 1);
	});

	test("a keyed call counts under its visitor, apart from anonymous calls, with either key", async ({ client }) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", { kind: "storefront", ip: "203.0.113.44" });
		const keyed = (key: string, visitor: string) =>
			client.get(studio).header("authorization", `Bearer ${key}`).header("x-visitor-ip", visitor);

		assertApiError(await keyed(ONE, "203.0.113.44"), 429, "rate_limited");
		assertApiError(await keyed(TWO, "203.0.113.44"), 429, "rate_limited");
		(await keyed(ONE, "203.0.113.45")).assertStatus(200);
		(await client.get(studio).header("x-forwarded-for", "203.0.113.44")).assertStatus(200);
	});

	test("X-Visitor-IP without a valid key changes nothing", async ({ client }) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerReads", { kind: "anonymous", ip: "203.0.113.46" });
		for (const authorization of [undefined, `Bearer ${"z".repeat(43)}`, `Basic ${ONE}`]) {
			const request = client.get(studio).header("x-forwarded-for", "203.0.113.46").header("x-visitor-ip", "198.51.100.77");
			if (authorization) request.header("authorization", authorization);
			assertApiError(await request, 429, "rate_limited");
		}
	});

	test("an unknown key is an anonymous caller, warned about once, never logged", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		const warn = mock.method(logger, "warn", () => {});
		const unknown = `Bearer ${"q".repeat(43)}`;

		(await client.get(studio).header("authorization", unknown)).assertStatus(200);
		(await client.get(studio).header("authorization", unknown)).assertStatus(200);
		(await client.get(studio).header("authorization", `Bearer ${"a".repeat(10_000)}`)).assertStatus(200);

		assert.deepEqual(
			warn.mock.calls.map((call) => call.arguments),
			[[CALLER_WARNINGS.unknownKey]],
		);
		const logged = JSON.stringify(warn.mock.calls.map((call) => call.arguments));
		assert.notInclude(logged, "qqqq");
	});

	test("a keyed call without a usable visitor spends the shared budget, and is warned about once", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		const warn = mock.method(logger, "warn", () => {});
		const { key, budget } = apiLimitFor("callerReads", { kind: "storefront", ip: null });
		await limiter.use({ ...budget }).increment(key, budget.requests);

		for (const visitor of [undefined, "10.0.0.1", "::ffff:10.0.0.1", "203.0.113.5, 198.51.100.1", "203.0.113.5:80", ["203.0.113.5", "198.51.100.1"]]) {
			const request = client.get(studio).header("authorization", `Bearer ${ONE}`);
			if (visitor) request.header("x-visitor-ip", visitor);
			assertApiError(await request, 429, "rate_limited");
		}
		(await client.get(studio).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", "203.0.113.47")).assertStatus(200);
		assert.deepEqual(
			warn.mock.calls.map((call) => call.arguments),
			[[CALLER_WARNINGS.noVisitor]],
		);
	});

	test("a cacheable 200 carries no per-caller header", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		const response = await client.get(studio).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", "203.0.113.48");

		response.assertStatus(200);
		assert.match(response.header("cache-control") ?? "", /^public, /);
		for (const name of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"]) {
			assert.isUndefined(response.header(name), name);
		}
	});

	test("an address over its write budget is refused before its body is sent", async ({ assert }) => {
		await fillApiLimit("callerWrites", { kind: "anonymous", ip: "203.0.113.49" });
		const socket = await rawRequest([
			"POST /api/v1/__test/echo HTTP/1.1",
			"Content-Type: application/json",
			"Content-Length: 100000",
			"X-Forwarded-For: 203.0.113.49",
		]);
		try {
			const response = await readResponse(socket, 2000);
			assert.equal(response.status, 429);
			assert.equal(JSON.parse(response.body).error.code, "rate_limited");
			assert.isAbove(Number(response.headers["retry-after"]), 0);
		} finally {
			socket.destroy();
		}
	});

	test("a body the parser refuses is counted first, and over the budget it is never parsed", async ({ client, assert }) => {
		const ip = "203.0.113.53";
		const echo = () => client.post("/api/v1/__test/echo").header("x-forwarded-for", ip);

		assertApiError(await echo().unsafeJson('{"label":'), 400, "bad_request");
		assertApiError(
			await echo().unsafeJson(`{"label":"${"x".repeat(1_100_000)}"}`),
			413,
			"payload_too_large",
		);
		const { key, budget } = apiLimitFor("callerWrites", { kind: "anonymous", ip });
		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 2);

		await fillApiLimit("callerWrites", { kind: "anonymous", ip });
		assertApiError(await echo().unsafeJson('{"label":'), 429, "rate_limited");
	});

	test("a refused upload writes no temp file", async ({ client, assert }) => {
		await studioWithOwner(SLUG);
		await fillApiLimit("callerWrites", { kind: "anonymous", ip: "203.0.113.50" });
		const before = await tempUploads();

		const response = await postInquiry(client, SLUG, intakeFields(), [await png()]).header("x-forwarded-for", "203.0.113.50");
		await settle();

		assertApiError(response, 429, "rate_limited");
		assert.deepEqual(await newTempUploads(before), []);
	});

	test("under its limits, a POST under an old slug is still the 404", async ({ client }) => {
		const { tenant } = await studioWithOwner(SLUG);
		await inTenant(tenant, () => new TenancyService().changeSlug(tenant, "limits-new-38"));

		assertApiError(await postInquiry(client, SLUG, intakeFields()), 404, "not_found");
	});

	test("the dashboard never reads the key: signup still counts the connection's address", async ({ client, assert }) => {
		const signup = (visitor: string, body: Record<string, string>) =>
			client
				.post("/signup")
				.header("x-forwarded-for", "203.0.113.51")
				.header("authorization", `Bearer ${ONE}`)
				.header("x-visitor-ip", visitor)
				.header("referer", "/signup")
				.form(body)
				.withCsrfToken()
				.redirects(0);
		for (let i = 0; i < 10; i++) {
			(await signup(`198.51.100.${i + 1}`, {})).assertHeader("location", "/signup");
		}
		const refused = await signup("198.51.100.99", {
			fullName: "Ada Ink",
			email: "ada38@example.com",
			password: "secret-password",
			passwordConfirmation: "secret-password",
		});
		refused.assertFlashMessage("error", "Too many attempts. Try again in 60 minutes.");
		assert.isNull(await User.findBy("email", "ada38@example.com"));
	});
});
```

- [ ] **Step 3: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=public_limits.spec.ts > <scratchpad>/t38-t8.log 2>&1`. Expected: every limit test FAILS (200 or a timeout instead of 429; the before-the-body test times out because nothing counts); "old slug" and "dashboard" PASS (they pin what must not change).

- [ ] **Step 4: Write the gate.** `apps/platform/app/middleware/public_gate_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { callerOf } from "#services/api_caller";
import { consumeApiLimit } from "#services/api_limits";
import { isApiRequest, READ_METHODS } from "#services/public_api";

/**
 * The public API's first check (TAT-38), FIRST in router.use: after
 * routing (a URL no route matches never reaches it), before the body
 * parser, the session and shield. Works out the caller (server key and
 * visitor, #services/api_caller) and counts it, reads and writes apart, so
 * an address over its budget is refused before a byte of its body is read
 * and before the tenant lookup (TAT-32 ruling 16). Other requests pass.
 */
export default class PublicGateMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!isApiRequest(ctx)) return next();
		const caller = callerOf(ctx);
		const reads = READ_METHODS.has(ctx.request.method());
		await consumeApiLimit(reads ? "callerReads" : "callerWrites", caller);
		return next();
	}
}
```

In `apps/platform/start/kernel.ts`, make it the FIRST entry of `router.use`, before `@adonisjs/core/bodyparser_middleware`:

```ts
	// The public API's per-caller limits, before any body is read (TAT-38).
	() => import("#middleware/public_gate_middleware"),
```

Insert it; never wrap or reorder the rest: the bodyparser, the session and shield wrappers, auth and silent auth stay as they are, in their order (TAT-32 pinned it: `public_tenant.spec.ts` "an unreadable body is the same 400 … the parser runs before the tenant check" must keep passing, and does, because the parser still runs before `publicTenant`). A body the parser refuses (unreadable JSON, over 1 MB, a bad urlencoded or text body) is therefore counted before it is refused: TAT-55 ruling 12's generic limit before the bodyparser.

- [ ] **Step 5: Run the tests.** Same command as Step 3. Expected: PASS (12 tests).

- [ ] **Step 6: The rest of the API suite still passes.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 300 pnpm -C apps/platform test functional --files=api_routes.spec.ts --files=cors.spec.ts --files=deposit_refusals.spec.ts --files=deposits.spec.ts --files=errors.spec.ts --files=inquiries.spec.ts --files=inquiry_isolation.spec.ts --files=inquiry_refusals.spec.ts --files=intake_guard.spec.ts --files=public_artists.spec.ts --files=public_cache.spec.ts --files=public_studio.spec.ts --files=public_tenant.spec.ts --files=stateless.spec.ts --files=studio_page_privacy.spec.ts --files=public_api.spec.ts > <scratchpad>/t38-t8b.log 2>&1`. Expected: all PASS. A test that sends more than 300 reads or 60 writes from one address in one test now gets a 429: give its requests distinct `x-forwarded-for` addresses (as the deposit tests do) rather than raising a budget, and note the file in the PR text.

- [ ] **Step 7: Commit.**

```bash
git add apps/platform/app/middleware/public_gate_middleware.ts apps/platform/start/kernel.ts apps/platform/tests/helpers/raw_http.ts apps/platform/tests/functional/api/public_limits.spec.ts
git commit -m "feat(platform): count every public API request per caller before its body" -m "First in router.use: a keyed storefront call counts per visitor, anything else per address, reads
and writes apart (TAT-38 rulings 2, 3, 8, 10).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If Step 6 changed other test files, add them to the commit.

### Task 9: Per-studio reads: the `apiLimit` slot

**Files:**
- Create: `apps/platform/app/middleware/api_limit_middleware.ts`, `apps/platform/tests/functional/api/tenant_limits.spec.ts`
- Modify: `apps/platform/start/kernel.ts` (named `apiLimit`), `apps/platform/start/routes.ts` (tenant group `use`), `apps/platform/tests/functional/api/api_routes.spec.ts` (guard)

**Interfaces:**
- Consumes: `callerOf` (Task 5), `API_LIMITS`, `consumeApiLimit`, `ApiLimitName` (Task 6), `publicTenantContext`, `READ_METHODS`.
- Produces: named middleware `apiLimit` with options `{ name: ApiLimitName }`; the tenant group runs `[publicTenant, apiLimit({ name: "tenantReads" })]`.

- [ ] **Step 1: Write the failing tests.** `apps/platform/tests/functional/api/tenant_limits.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { apiLimitFor } from "#services/api_limits";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit, testServerKeys } from "#tests/helpers/api_limits";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const A = "tenant-a-38";
const B = "tenant-b-38";
const [ONE] = testServerKeys();
const ANON = { kind: "anonymous", ip: "203.0.113.70" } as const;
const STOREFRONT = { kind: "storefront", ip: "203.0.113.71" } as const;

test.group("Public API limits: per studio", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("anonymous reads of one studio don't touch another's, or the pages' bucket", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		await studioWithOwner(B);
		await fillApiLimit("tenantReads", ANON, tenant.id);

		assertApiError(await client.get(`/api/v1/tenants/${A}/artists`).header("x-forwarded-for", "198.51.100.10"), 429, "rate_limited");
		(await client.get(`/api/v1/tenants/${B}/artists`).header("x-forwarded-for", "198.51.100.10")).assertStatus(200);
		(await client.get(`/api/v1/tenants/${A}/artists`).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", "198.51.100.11")).assertStatus(200);
	});

	test("the storefront's reads of one studio have their own bucket", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		await studioWithOwner(B);
		await fillApiLimit("tenantReads", STOREFRONT, tenant.id);
		const keyed = (slug: string) =>
			client.get(`/api/v1/tenants/${slug}`).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", "198.51.100.12");

		assertApiError(await keyed(A), 429, "rate_limited");
		(await keyed(B)).assertStatus(200);
		(await client.get(`/api/v1/tenants/${A}`).header("x-forwarded-for", "198.51.100.13")).assertStatus(200);
	});

	test("a read counts once under the studio, an old slug's too; an unknown slug counts under no studio", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner(A);
		await inTenant(tenant, () => new TenancyService().changeSlug(tenant, "tenant-a-new-38"));
		const { key, budget } = apiLimitFor("tenantReads", ANON, tenant.id);

		(await client.get(`/api/v1/tenants/${A}`).header("x-forwarded-for", ANON.ip)).assertStatus(200);
		(await client.get("/api/v1/tenants/tenant-a-new-38").header("x-forwarded-for", ANON.ip)).assertStatus(200);
		assertApiError(await client.get("/api/v1/tenants/no-such-studio-td38"), 404, "not_found");

		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 2);
	});

	test("writes don't spend the studio's read budget", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		await fillApiLimit("tenantReads", ANON, tenant.id);

		(await postInquiry(client, A, intakeFields()).header("x-forwarded-for", ANON.ip)).assertStatus(201);
	});
});
```

In `tests/functional/api/api_routes.spec.ts`, add `"apiLimit"` to `PUBLIC_ONLY`, and add after "every tenant route resolves the tenant after publicApi":

```ts
	test("every tenant route counts the studio's reads right after publicTenant", ({ assert }) => {
		const routes = allRoutes().filter(
			({ pattern }) => isTenantApi(pattern) && !isTestOnly(pattern),
		);
		assert.isNotEmpty(routes);

		for (const { pattern, named } of routes) {
			assert.equal(named[named.indexOf("publicTenant") + 1], "apiLimit", pattern);
		}
	});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=tenant_limits.spec.ts --files=api_routes.spec.ts > <scratchpad>/t38-t9.log 2>&1`. Expected: the 429 tests and the counting test FAIL, the guard FAILS; "writes don't spend" passes.

- [ ] **Step 3: Write the middleware and wire it.** `apps/platform/app/middleware/api_limit_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { callerOf } from "#services/api_caller";
import { API_LIMITS, type ApiLimitName, consumeApiLimit } from "#services/api_limits";
import { READ_METHODS } from "#services/public_api";

/**
 * One API_LIMITS entry on a route or group (TAT-38): counts the request by
 * caller, or by studio and caller kind, when its method is the entry's
 * (reads: GET and HEAD). The /api/v1/tenants/:tenant group runs
 * `apiLimit({ name: "tenantReads" })` right after publicTenant (a test
 * checks). A later ticket adds an entry and uses this on its route.
 */
export default class ApiLimitMiddleware {
	async handle(ctx: HttpContext, next: NextFn, options: { name: ApiLimitName }) {
		const limit = API_LIMITS[options.name];
		const reads = READ_METHODS.has(ctx.request.method());
		if ((limit.methods === "reads") !== reads) return next();
		const tenantId =
			limit.scope === "tenant" ? publicTenantContext(ctx).tenant.id : undefined;
		await consumeApiLimit(options.name, callerOf(ctx), tenantId);
		return next();
	}
}
```

In `start/kernel.ts`, add to `router.named({...})` after `depositThrottle`:

```ts
	apiLimit: () => import("#middleware/api_limit_middleware"),
```

In `start/routes.ts`, change the tenant group's `.use(middleware.publicTenant());` to:

```ts
			.use([
				middleware.publicTenant(),
				middleware.apiLimit({ name: "tenantReads" }),
			]);
```

and replace "TAT-38 adds its rate limits to these `use` lists." in the group comment with "Every request is counted per caller before its body (PublicGateMiddleware, router.use) and a studio's reads after publicTenant (apiLimit, TAT-38)."

- [ ] **Step 4: Run, codegen, typecheck.** Same command as Step 2: PASS. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen > <scratchpad>/t38-codegen9.log 2>&1` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform typecheck > <scratchpad>/t38-tc9.log 2>&1`: clean; commit whatever codegen changed.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/middleware/api_limit_middleware.ts apps/platform/start/kernel.ts apps/platform/start/routes.ts apps/platform/tests/functional/api/tenant_limits.spec.ts apps/platform/tests/functional/api/api_routes.spec.ts apps/platform/.adonisjs
git commit -m "feat(platform): count each studio's public reads, the storefront's apart" -m "A named apiLimit slot later tickets reuse; writes keep their own route limits (TAT-38 ruling 9).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: The route throttles count the caller's address

**Files:**
- Modify: `apps/platform/app/middleware/deposit_throttle_middleware.ts`, `apps/platform/app/middleware/intake_guard_middleware.ts`
- Test: `apps/platform/tests/functional/api/tenant_limits.spec.ts` (new group)

**Interfaces:**
- Consumes: `callerIp(ctx)` (Task 5), `depositLimitKeys`, `DEPOSIT_LIMITS`, `intakeLimitKeys`, `INTAKE_LIMITS`.

- [ ] **Step 1: Write the failing tests.** Append to `tenant_limits.spec.ts` (add the imports `DEPOSIT_LIMITS, depositLimitKeys` from `#modules/payments/deposit_limits`, `INTAKE_LIMITS, intakeLimitKeys` from `#modules/inquiries/intake_limits`, `depositPath, depositReady, depositServices, OWNER` from `#tests/helpers/deposits`):

```ts
test.group("Public API limits: route throttles count the caller's address", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	const services = depositServices();
	const VISITOR = "198.51.100.30";

	test("a keyed deposit read counts under its visitor", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		const ready = await inTenant(tenant, () => depositReady(tenant));
		const { token } = await inTenant(tenant, () => services.links.issue(tenant, OWNER, ready.project));
		const key = depositLimitKeys("read", VISITOR, token).perAddress;
		await limiter.use({ ...DEPOSIT_LIMITS.read.perAddress }).increment(key, DEPOSIT_LIMITS.read.perAddress.requests);
		const keyed = (visitor: string) =>
			client.get(depositPath(A, token)).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", visitor);

		assertApiError(await keyed(VISITOR), 429, "rate_limited");
		(await keyed("198.51.100.31")).assertStatus(200);
	});

	test("a keyed intake counts under its visitor", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		const key = intakeLimitKeys(tenant.id, VISITOR).perAddress;
		await limiter.use({ ...INTAKE_LIMITS.perAddress }).increment(key, INTAKE_LIMITS.perAddress.requests);
		const keyed = (visitor: string) =>
			postInquiry(client, A, intakeFields()).header("authorization", `Bearer ${ONE}`).header("x-visitor-ip", visitor);

		assertApiError(await keyed(VISITOR), 429, "rate_limited");
		(await keyed("198.51.100.32")).assertStatus(201);
	});
});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=tenant_limits.spec.ts > <scratchpad>/t38-t10.log 2>&1`. Expected: both new tests FAIL (200/201: the throttles count `request.ip()`, the loopback address).

- [ ] **Step 3: Use `callerIp`.** In `deposit_throttle_middleware.ts`, import `callerIp` from `#services/api_caller` and pass `callerIp(ctx)` instead of `ctx.request.ip()` to `depositLimitKeys`; add to its comment "Counted by the caller's address (`callerIp`: the storefront's visitor with a valid server key, TAT-38)." In `intake_guard_middleware.ts`, the same: `intakeLimitKeys(tenant.id, callerIp(ctx))`, with the same sentence in its comment.

- [ ] **Step 4: Run.** Same command as Step 2 plus `--files=deposit_refusals.spec.ts --files=intake_guard.spec.ts`: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/middleware/deposit_throttle_middleware.ts apps/platform/app/middleware/intake_guard_middleware.ts apps/platform/tests/functional/api/tenant_limits.spec.ts
git commit -m "feat(platform): the deposit and intake throttles count the caller's address" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: The storefront forwards its visitor; the key is required in production

**Files:**
- Create: `apps/storefront/src/tenancy/visitor.ts`, `apps/storefront/test/tenancy/visitor.test.ts`
- Modify: `apps/storefront/src/tenancy/config.ts` (`readServerKey`, `serverKey` doc), `apps/storefront/src/tenancy/handle.ts`, `apps/storefront/src/tenancy/middleware.ts`, `apps/storefront/src/api/context.ts` (`ServerConnectOptions`, `connectServer`), `apps/storefront/src/api/request.ts`, `apps/storefront/scripts/check-page.mjs`, `apps/storefront/.env.local.example`
- Test: `apps/storefront/test/tenancy/config.test.ts`, `test/tenancy/handle.test.ts`, `test/api/context.test.ts`

**Interfaces:**
- Produces (`src/tenancy/visitor.ts`, no imports): `VISITOR_IP_HEADER = "x-visitor-ip"`, `visitorAddress(request: Request): string | undefined`, `withVisitorAddress(base: typeof fetch | undefined, address: string | undefined): typeof fetch | undefined`. `TenantOutcome`'s studio case gains `visitorAddress: string | undefined`. `requestVisitorAddress()` (server-only, `src/tenancy/middleware.ts`). `ServerConnectOptions.visitorAddress?: string | undefined`.

- [ ] **Step 1: Write the failing tests.** `apps/storefront/test/tenancy/visitor.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	VISITOR_IP_HEADER,
	visitorAddress,
	withVisitorAddress,
} from "../../src/tenancy/visitor.ts";
import { fakeFetch, json } from "./helpers.ts";

const request = (headers: Record<string, string> = {}, ip?: string) =>
	Object.assign(new Request("http://internal.invalid/", { headers }), ip ? { ip } : {});

describe("visitorAddress", () => {
	test("is the first X-Forwarded-For value when it is an IP", () => {
		assert.equal(visitorAddress(request({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
		assert.equal(visitorAddress(request({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" })), "203.0.113.7");
		assert.equal(visitorAddress(request({ "x-forwarded-for": "2001:db8::1" })), "2001:db8::1");
	});

	test("falls back to the socket address, else none", () => {
		assert.equal(visitorAddress(request({}, "198.51.100.4")), "198.51.100.4");
		assert.equal(visitorAddress(request({ "x-forwarded-for": "unknown" }, "198.51.100.4")), "198.51.100.4");
		assert.equal(visitorAddress(request({ "x-forwarded-for": "999.1.1.1" })), undefined);
		assert.equal(visitorAddress(request({ "x-forwarded-for": "<script>" })), undefined);
		assert.equal(visitorAddress(request()), undefined);
	});
});

describe("withVisitorAddress", () => {
	test("adds X-Visitor-IP and keeps the other headers", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, {}));
		const wrapped = withVisitorAddress(fetch, "203.0.113.7");
		await wrapped?.("http://api.test/x", { headers: { authorization: "Bearer k" } });
		const headers = new Headers(calls[0].init.headers);
		assert.equal(VISITOR_IP_HEADER, "x-visitor-ip");
		assert.equal(headers.get("x-visitor-ip"), "203.0.113.7");
		assert.equal(headers.get("authorization"), "Bearer k");
	});

	test("without an address it is the fetch it was given", () => {
		const { fetch } = fakeFetch(() => json(200, {}));
		assert.equal(withVisitorAddress(fetch, undefined), fetch);
		assert.equal(withVisitorAddress(undefined, undefined), undefined);
	});
});
```

Append to the `STOREFRONT_SERVER_KEY` describe in `test/tenancy/config.test.ts` (if Task 0 found `TURNSTILE_SITE_KEY`, add `TURNSTILE_SITE_KEY: "1x00000000000000000000AA"` to the object of the positive production case):

```ts
	test("is required with NODE_ENV=production, without echoing anything", () => {
		const message = failure({ ...PROD, NODE_ENV: "production" });
		assert.match(message, /STOREFRONT_SERVER_KEY is not set: set it to 32 to 256 letters/);
		assert.equal(
			parseStorefrontConfig({ ...PROD, NODE_ENV: "production", STOREFRONT_SERVER_KEY: KEY }).serverKey,
			KEY,
		);
	});

	test("stays optional in development and tests", () => {
		for (const NODE_ENV of ["development", "test", undefined]) {
			assert.equal("serverKey" in parseStorefrontConfig({ ...PROD, NODE_ENV }), false, String(NODE_ENV));
		}
	});
```

Append to the `handleTenantRequest` describe in `test/tenancy/handle.test.ts`:

```ts
	test("with a key, the lookup carries the visitor's address, and the studio goes on with it", async () => {
		const { calls, fetch } = api();

		const outcome = await handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }),
			deps(fetch, { config: { ...CONFIG, serverKey: KEY } }),
		);

		assert.equal(new Headers(calls[0].init.headers).get("x-visitor-ip"), "203.0.113.7");
		assert.ok(outcome.type === "studio");
		assert.equal(outcome.visitorAddress, "203.0.113.7");
	});

	test("without a key, no visitor's address leaves the server", async () => {
		const { calls, fetch } = api();

		const outcome = await handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/", { headers: { "x-forwarded-for": "203.0.113.7" } }),
			deps(fetch),
		);

		assert.equal(new Headers(calls[0].init.headers).get("x-visitor-ip"), null);
		assert.ok(outcome.type === "studio");
		assert.equal(outcome.visitorAddress, undefined);
	});
```

Append to `describe("the server's client", …)` in `test/api/context.test.ts`:

```ts
	test("sends the visitor's address with the key, and never without it", async () => {
		for (const [config, expected] of [
			[CONFIG, "203.0.113.7"],
			[{ apiUrl: API }, null],
		] as const) {
			const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
			const api = createApiContext("server");
			connectServer(api, { config, studio: STUDIO_A, fetch, visitorAddress: "203.0.113.7" });
			await api.tattoo.client.studio.get();
			assert.equal(new Headers(calls[0].init.headers).get("x-visitor-ip"), expected);
		}
	});
```

and in "the browser's client has no key and sends no cookies", add after the `authorization` assertion:

```ts
		assert.equal(new Headers(calls[0].init.headers).get("x-visitor-ip"), null);
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/storefront test > <scratchpad>/t38-t11.log 2>&1`. Expected: `visitor.test.ts` fails to load (missing module); the production-key, handle and context tests FAIL; everything else passes.

- [ ] **Step 3: Write `visitor.ts`.** It imports nothing (no `node:net`): `src/api/context.ts`, which the browser loads, imports `withVisitorAddress`.

```ts
/**
 * The visitor's address for the API's rate limits (TAT-38). Only the
 * server's keyed calls send it, as X-Visitor-IP; the API trusts it only
 * with a valid server key and uses it for nothing but counting. The
 * platform's name for this header is VISITOR_IP_HEADER in
 * #services/api_caller (the storefront may not import the platform).
 * Imports nothing: the browser loads src/api/context.ts, which imports
 * withVisitorAddress.
 */
export const VISITOR_IP_HEADER = "x-visitor-ip";

const IPV4 =
	/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** An IPv4 or IPv6 literal; the API checks the rest (one value, public). */
function isIpLiteral(value: string): boolean {
	return IPV4.test(value) || (value.includes(":") && IPV6.test(value));
}

/**
 * This request's visitor: the first X-Forwarded-For value (Vercel's edge
 * sets that header itself, overwriting what a client sent; TAT-13 confirms
 * it on the first deploy), else the socket address the server exposes
 * (srvx's `request.ip`), else none.
 */
export function visitorAddress(request: Request): string | undefined {
	const forwarded = request.headers
		.get("x-forwarded-for")
		?.split(",", 1)[0]
		?.trim();
	if (forwarded && isIpLiteral(forwarded)) return forwarded;
	const socket = (request as Request & { ip?: unknown }).ip;
	return typeof socket === "string" && isIpLiteral(socket) ? socket : undefined;
}

/** `base` (else the global fetch) with X-Visitor-IP on every call, when there is an address. */
export function withVisitorAddress(
	base: typeof fetch | undefined,
	address: string | undefined,
): typeof fetch | undefined {
	if (!address) return base;
	const wrapped = (input: RequestInfo | URL, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set(VISITOR_IP_HEADER, address);
		return (base ?? globalThis.fetch)(input, { ...init, headers });
	};
	return wrapped as typeof fetch;
}
```

- [ ] **Step 4: Wire it.**

`src/tenancy/config.ts`: pass production into the key reader and require it there:

```ts
	const serverKey = readServerKey(
		env.STOREFRONT_SERVER_KEY?.trim(),
		problems,
		env.NODE_ENV === "production",
	);
```

```ts
/** Required with NODE_ENV=production (TAT-38); refused when set but malformed. */
function readServerKey(
	value: string | undefined,
	problems: string[],
	production: boolean,
): string | undefined {
	if (!value) {
		if (production) {
			problems.push(problem("STOREFRONT_SERVER_KEY", value, SERVER_KEY_RULE));
		}
		return undefined;
	}
	if (!SERVER_KEY_SHAPE.test(value)) {
		problems.push(problem("STOREFRONT_SERVER_KEY", value, SERVER_KEY_RULE));
		return undefined;
	}
	return value;
}
```

If TAT-57 already computes `const production = env.NODE_ENV === "production"` in `parseStorefrontConfig`, pass that variable. Change the `serverKey` field's doc to "STOREFRONT_SERVER_KEY: the secret the server sends with its API calls (Authorization: Bearer), with its visitor's address (X-Visitor-IP), for rate limiting only (TAT-38). Required with NODE_ENV=production. Never sent to a browser."

`src/tenancy/handle.ts`: import `visitorAddress, withVisitorAddress` from `./visitor.ts`; change the studio case of `TenantOutcome` to `{ type: "studio"; studio: Studio; visitorAddress: string | undefined }`; before the lookup:

```ts
	// Only keyed calls carry the visitor's address (TAT-38).
	const visitor = deps.config.serverKey ? visitorAddress(request) : undefined;
	const lookup = await lookUpTenant(target.slug, {
		apiUrl: deps.config.apiUrl,
		key: deps.config.serverKey,
		signal: request.signal,
		timeoutMs: deps.timeoutMs,
		fetch: withVisitorAddress(deps.fetch, visitor),
	});
```

and `case "found": return { type: "studio", studio: lookup.studio, visitorAddress: visitor };`.

`src/tenancy/middleware.ts`: pass it on and read it back:

```ts
		return next({
			context: { studio: outcome.studio, visitorAddress: outcome.visitorAddress },
		});
```

```ts
/**
 * This request's visitor address, on the server only: TAT-23's per-request
 * client sends it with the key (TAT-38). Undefined without a key.
 */
export const requestVisitorAddress = createServerOnlyFn((): string | undefined => {
	const context = getGlobalStartContext() as NonNullable<
		ReturnType<typeof getGlobalStartContext>
	>;
	return context.visitorAddress;
});
```

`src/api/context.ts`: import `withVisitorAddress` from `../tenancy/visitor.ts`; add to `ServerConnectOptions`:

```ts
	/** The visitor's address (requestVisitorAddress()), sent as X-Visitor-IP with the key only (TAT-38). */
	visitorAddress?: string | undefined;
```

and in `connectServer`, destructure `visitorAddress` and pass `fetch: config.serverKey ? withVisitorAddress(fetch, visitorAddress) : fetch` to `createTattooClient`; extend its comment: "and, with the key, the visitor's address (X-Visitor-IP)".

`src/api/request.ts`: import `requestVisitorAddress` with `requestStudio` and call `connectServer(api, { config: storefrontConfig(), studio, visitorAddress: requestVisitorAddress() });`.

`.env.local.example`: replace the key comment's "Optional until the platform checks it (TAT-38)." with "Required when NODE_ENV=production (TAT-38): the same value as one of the platform's STOREFRONT_SERVER_KEYS. With it, the server's calls also send the visitor's address (X-Visitor-IP), so the API counts them per visitor."

- [ ] **Step 5: `check:page` asserts the header.** In `apps/storefront/scripts/check-page.mjs`: add `const VISITOR = "203.0.113.7";` next to `CANARY`; add `visitor: request.headers["x-visitor-ip"] ?? null,` to the `apiLog.push({...})` entry; add `"x-forwarded-for": VISITOR` to the headers of `get()`; and in every expectation that checks `call.authorization === \`Bearer ${CANARY}\``, also require `call.visitor === VISITOR`, adding "carrying the visitor's address" to its message.

- [ ] **Step 6: Run everything the storefront has.** Run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/storefront test > <scratchpad>/t38-t11b.log 2>&1` (all pass: Task 0's count + 9), then the same with `NODE_ENV=production` in front (`PATH=… NODE_ENV=production pnpm -C apps/storefront test`): a test that reads `process.env` through `storefrontConfig()` without a key would fail here; give it a key in its env, do not weaken the rule. Then `PATH=… pnpm -C apps/storefront typecheck`, `PATH=… pnpm -C apps/storefront build` (it ends with the client-bundle check) and `PATH=… pnpm -C apps/storefront check:page`, each into its own `<scratchpad>/t38-sf-*.log`. Expected: all pass; `check:page` reports the visitor on every keyed call.

- [ ] **Step 7: Commit.**

```bash
git add apps/storefront/src/tenancy/visitor.ts apps/storefront/src/tenancy/config.ts apps/storefront/src/tenancy/handle.ts apps/storefront/src/tenancy/middleware.ts apps/storefront/src/api/context.ts apps/storefront/src/api/request.ts apps/storefront/scripts/check-page.mjs apps/storefront/.env.local.example apps/storefront/test
git commit -m "feat(storefront): send the visitor's address with keyed API calls; the key is required in production" -m "Both server calls (the tenant lookup and the per-request client) send X-Visitor-IP with the key,
never from the browser (TAT-38 ruling 7).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Docs for Part 2

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/testing.md`, `docs/architecture.md`, `docs/sdk.md`, `README.md`, `apps/storefront/docs/development.md`

- [ ] **Step 1: backend.md, Public API, "A new endpoint".** Replace "TAT-38 adds its rate limits to the group's `use` lists (per IP before `publicTenant`, per tenant after) and must keep per-caller headers off cacheable responses. Those lists run after the bodyparser, so a limit that must refuse a request before its body is read has to sit in `server.use` or `router.use`, guarded by `isApiRequest(ctx)`." with "Limits (TAT-38) need nothing per endpoint: `PublicGateMiddleware` (first in `router.use`) counts every API request per caller before its body, and the tenant group's `apiLimit({ name: \"tenantReads\" })` counts a studio's reads after `publicTenant`. A route that needs its own limit adds an `API_LIMITS` entry (`#services/api_limits`) and `.use(middleware.apiLimit({ name }))`, or a throttle of its own that counts `callerIp(ctx)` (`#services/api_caller`), never `request.ip()`. Limits call `consume()`, never `limiter.define` middleware, which puts `X-RateLimit-*` on every success: a cacheable response carries no per-caller header."

- [ ] **Step 2: backend.md, Rate limits.** Add a bullet after the deposit one:

"- The public API (TAT-38): `PublicGateMiddleware` (first in `router.use`, API requests only) works out the caller with `callerOf(ctx)` (`#services/api_caller`): a request with a valid server key (`Authorization: Bearer`, one of `STOREFRONT_SERVER_KEYS`, compared as SHA-256 digests in constant time) is the hosted storefront's server and counts by its visitor (`X-Visitor-IP`: one public IP literal, else the storefront's one shared budget, with a warning at most every 10 minutes); anything else, an unknown key included (also warned about, never a 401), is anonymous and counts by `request.ip()`. The key grants nothing else; the dashboard never reads it. Budgets (`API_LIMITS`): 300 reads per 5 minutes and 60 writes per hour per caller, each kind apart; 3000 per 5 minutes shared by keyed calls without a visitor; per studio 6000 storefront reads and 1500 anonymous reads per 5 minutes (`apiLimit`). `request.ip()` believes `X-Forwarded-For` only from `TRUST_PROXY` (required in production). Keys are `digest(clientAddress(ip))` or a tenant id."

(The first Rate limits bullet's pointer to the production checklist changes in Task 17, which creates `deploy.md`.)

- [ ] **Step 3: testing.md.** In "Environment and test conventions", after the rate-limits paragraph, add: "The public API counts every request per caller (TAT-38): 300 reads per 5 minutes and 60 writes per hour per address. A test that sends more from one address gives its requests distinct `x-forwarded-for` values. `fillApiLimit(name, caller, tenantId?)` (`#tests/helpers/api_limits`) spends a budget so the next request is refused, and `testServerKeys()` gives the two `STOREFRONT_SERVER_KEYS` of `.env.test` for keyed requests (`authorization: Bearer …` and `x-visitor-ip`). `#tests/helpers/raw_http` (`rawRequest`, `readResponse`, `closedWithin`, `waitFor`) drives a raw socket, for answers that must come before a body is sent. A variable exported in your shell or CI wins over `.env.test`: an exported `STOREFRONT_SERVER_KEYS` or `TRUST_PROXY` (like `TURNSTILE_SECRET_KEY`) changes what the tests see, so unset them before a run."

- [ ] **Step 4: architecture.md.** Replace the "Rate limits" bullet of "Files, scale, hosting" with: "**Rate limits** apply per caller, before any body is read, and per studio on reads (TAT-38). The storefront's server-side rendering calls the API with a secret **server key** (`STOREFRONT_SERVER_KEY`, as `Authorization: Bearer`, from the server only) and its visitor's address (`X-Visitor-IP`): with a valid key the platform counts those calls per visitor instead of as one client. The key grants no extra data."

- [ ] **Step 5: sdk.md.** Replace "used only for rate limiting; the platform checks it from TAT-38." with "used only for rate limiting (TAT-38): with a valid key the platform counts the call by the visitor's address the storefront sends as `X-Visitor-IP` (added with the SDK's `fetch` option, `src/tenancy/visitor.ts`); without one, every call counts against the storefront server's own address." In the error-codes list, add after `rate_limited`: "Every endpoint can answer 429 `rate_limited` (per caller and, for reads, per studio)."

- [ ] **Step 6: README.md, Deployment.** In the Storefront line replace "plus `STOREFRONT_SERVER_KEY` once TAT-38 checks it (TAT-13)" with "and `STOREFRONT_SERVER_KEY` (required in production: one of the platform's `STOREFRONT_SERVER_KEYS`) (TAT-13)". Add a line after the Platform line: "- **Platform settings in production:** `STOREFRONT_SERVER_KEYS` (the storefront's key, two while rotating) and `TRUST_PROXY` (the reverse proxy's addresses) are required with `NODE_ENV=production`, as are `STOREFRONT_URL` and `TURNSTILE_SECRET_KEY`."

- [ ] **Step 7: storefront development.md.** In "Tenants and hosts", replace the sentence "`STOREFRONT_SERVER_KEY` (optional until TAT-38; …) is the secret the server sends with its API calls (`Authorization: Bearer`); a malformed one stops `pnpm dev` too." with "`STOREFRONT_SERVER_KEY` (required with `NODE_ENV=production`, optional in development; 32 to 256 letters, digits or `-._~+/`, then at most two `=` of padding, e.g. `openssl rand -base64 32`; one of the platform's `STOREFRONT_SERVER_KEYS`) is the secret the server sends with its API calls (`Authorization: Bearer`); a malformed one stops `pnpm dev` too." In "API and data", after the server-client sentence, add: "With the key, both server calls (the tenant lookup and this client) also send the visitor's address as `X-Visitor-IP` (`src/tenancy/visitor.ts`: the first `X-Forwarded-For` value, which Vercel's edge sets, else the socket address), so the API counts them per visitor (TAT-38); the browser's client never sends either. `pnpm check:page` checks it."

- [ ] **Step 8: Check and commit.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check > <scratchpad>/t38-check12.log 2>&1` (no new warnings), then:

```bash
git add apps/platform/docs/backend.md apps/platform/docs/testing.md docs/architecture.md docs/sdk.md README.md apps/storefront/docs/development.md
git commit -m "docs: public API limits per caller and studio, and the storefront's server key" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Part 3: pool and time bounds (spec rulings 12 to 15, 18)

### Task 13: An explicit pool, a short wait, Node's request timeout

**Files:**
- Create: `apps/platform/app/services/db_pool.ts`, `apps/platform/tests/unit/services/db_pool.spec.ts`
- Modify: `apps/platform/config/database.ts` (`pg.pool`, `limiter.pool`), `apps/platform/config/app.ts` (`requestTimeout`)

**Interfaces:**
- Produces (`#services/db_pool`, imports nothing from the app): `pgPoolFor(environment: string): { min: number; max: number; acquireTimeoutMillis: number }`, `LIMITER_POOL`. `http.requestTimeout === 120_000`.

- [ ] **Step 1: Write the failing test.** `apps/platform/tests/unit/services/db_pool.spec.ts`:

```ts
import { test } from "@japa/runner";
import { http } from "#config/app";
import dbConfig from "#config/database";
import { LIMITER_POOL, pgPoolFor } from "#services/db_pool";

test.group("Database pools (TAT-38)", () => {
	test("the web server's pool is explicit, with a short wait; ace's is smaller", ({ assert }) => {
		assert.deepEqual(pgPoolFor("web"), { min: 2, max: 10, acquireTimeoutMillis: 10_000 });
		assert.deepEqual(pgPoolFor("test"), pgPoolFor("web"));
		// The worker (an ace command) runs 5 jobs at once (config/queue.ts).
		assert.deepEqual(pgPoolFor("console"), { min: 0, max: 6, acquireTimeoutMillis: 10_000 });
	});

	test("config/database.ts uses them, and the limiter waits less", ({ assert }) => {
		assert.deepEqual(dbConfig.connections.pg.pool, pgPoolFor("test"));
		assert.deepEqual(dbConfig.connections.limiter.pool, LIMITER_POOL);
		assert.deepEqual(LIMITER_POOL, { min: 0, max: 4, acquireTimeoutMillis: 5_000 });
	});

	test("Node's own request timeout is the backstop: 120 s", ({ assert }) => {
		assert.equal(http.requestTimeout, 120_000);
	});
});
```

- [ ] **Step 2: Run to see it fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=db_pool.spec.ts > <scratchpad>/t38-t13.log 2>&1`. Expected: exit 124, "Cannot find module '#services/db_pool'".

- [ ] **Step 3: Write `db_pool.ts` and use it.**

```ts
/**
 * Connection pools (TAT-38), sized for the process. Every authenticated
 * request and every public tenant request holds one `pg` connection for its
 * whole length (its transaction), so the web server's pool is explicit:
 * public API writes take at most 4 of its 10 (#services/write_slots), the
 * dashboard and reads keep the rest. A request that waits 10 s for a
 * connection fails (knex's default is 60 s: requests would pile up for a
 * minute); on the API that is 503 service_busy. Ace commands (the worker
 * runs 5 jobs at once) need fewer. Count every process's pools in the
 * database's max_connections (docs/deploy.md). Imports nothing from the app:
 * config/database.ts reads it at boot.
 */
export function pgPoolFor(environment: string) {
	return environment === "console"
		? { min: 0, max: 6, acquireTimeoutMillis: 10_000 }
		: { min: 2, max: 10, acquireTimeoutMillis: 10_000 };
}

/** The limiter's own small pool (TAT-65): it counts while a request holds a `pg` connection. */
export const LIMITER_POOL = {
	min: 0,
	max: 4,
	acquireTimeoutMillis: 5_000,
} as const;
```

In `config/database.ts`: import `{ LIMITER_POOL, pgPoolFor }` from `#services/db_pool`; add `pool: pgPoolFor(app.getEnvironment()),` to the `pg` connection (after `connection`), and replace the limiter's `pool: { min: 0, max: 4 },` with `pool: { ...LIMITER_POOL },`. Add to the `pg` connection's comment: "Its pool is sized per process (#services/db_pool, TAT-38)."

In `config/app.ts`, add to `defineConfig({...})` after `trustProxy`:

```ts
	/**
	 * Node drops a request whose whole body hasn't arrived within 120 s
	 * (its default is 300 s): the backstop behind the reverse proxy's
	 * timeouts and the uploads' own deadline (TAT-38).
	 */
	requestTimeout: 120_000,
```

- [ ] **Step 4: Run.** Same command as Step 2, then `--files=rate_limit_store.spec.ts` in the functional suite (`PATH=… PORT=3402 timeout 120 pnpm -C apps/platform test functional --files=rate_limit_store.spec.ts > <scratchpad>/t38-t13b.log 2>&1`). Expected: PASS (the store test holds `pool.max` connections and still counts). Typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/db_pool.ts apps/platform/tests/unit/services/db_pool.spec.ts apps/platform/config/database.ts apps/platform/config/app.ts
git commit -m "feat(platform): explicit database pools with a 10 s wait, and a 120 s request timeout" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: `service_busy`, `request_timeout`, and closing early refusals

**Files:**
- Modify: `apps/platform/app/services/public_api.ts` (`ApiErrorCode`, `API_ERRORS`, `RETRY_AFTER_BUSY_SECONDS`), `apps/platform/app/services/public_api_errors.ts` (`CODE_BY_STATUS`, `ApiException.retryLater`, `apiErrorFor`, `apiErrorIsReported`, `renderApiError`), `apps/platform/app/exceptions/handler.ts` (`report`), `packages/types/openapi.yaml`
- Test: `apps/platform/tests/unit/services/public_api_errors.spec.ts`, `apps/platform/tests/functional/api/public_limits.spec.ts`

**Interfaces:**
- Produces: codes `request_timeout` (408) and `service_busy` (503) in `API_ERRORS`; `RETRY_AFTER_BUSY_SECONDS = 10` (`#services/public_api`); `ApiException.retryLater(code: "rate_limited" | "service_busy", seconds: number): ApiException` and its `retryAfter?: number`; `apiErrorIsReported(error: unknown): boolean` (`#services/public_api_errors`).

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/services/public_api_errors.spec.ts` (import `apiErrorIsReported` with `ApiException, apiErrorFor`):

```ts
test.group("Busy and slow (TAT-38)", () => {
	test("a pool with no free connection in time is service_busy, retried after 10 s, and reported", ({ assert }) => {
		const error = Object.assign(
			new Error("Knex: Timeout acquiring a connection. The pool is probably full."),
			{ name: "KnexTimeoutError" },
		);
		const { status, body, headers } = apiErrorFor(error);
		assert.equal(status, 503);
		assert.equal(body.error.code, "service_busy");
		assert.notInclude(body.error.message, "Knex");
		assert.equal(headers["Retry-After"], "10");
		assert.isTrue(apiErrorIsReported(error));
	});

	test("retryLater carries Retry-After; a busy refusal is not reported", ({ assert }) => {
		const limited = apiErrorFor(ApiException.retryLater("rate_limited", 10));
		assert.equal(limited.status, 429);
		assert.equal(limited.body.error.code, "rate_limited");
		assert.equal(limited.headers["Retry-After"], "10");

		const busy = ApiException.retryLater("service_busy", 10);
		assert.equal(apiErrorFor(busy).status, 503);
		assert.equal(apiErrorFor(busy).headers["Retry-After"], "10");
		assert.isFalse(apiErrorIsReported(busy));
		assert.isFalse(apiErrorIsReported(ApiException.notFound()));
		assert.isTrue(apiErrorIsReported(ApiException.of("challenge_unavailable")));
		assert.isTrue(apiErrorIsReported(new Error(SECRET)));
		assert.deepEqual(apiErrorFor(ApiException.of("service_busy")).headers, {});
	});

	test("a 408 is request_timeout", ({ assert }) => {
		const { status, body } = apiErrorFor(
			new Exception("Request timeout", { status: 408, code: "E_REQUEST_TIMEOUT" }),
		);
		assert.equal(status, 408);
		assert.equal(body.error.code, "request_timeout");
	});
});
```

Append to the group in `tests/functional/api/public_limits.spec.ts` (import `closedWithin` with `rawRequest, readResponse`):

```ts
	test("an early refusal closes the connection instead of reading the rest", async ({ assert }) => {
		await fillApiLimit("callerWrites", { kind: "anonymous", ip: "203.0.113.52" });
		const socket = await rawRequest([
			"POST /api/v1/__test/echo HTTP/1.1",
			"Content-Type: application/json",
			"Content-Length: 100000",
			"X-Forwarded-For: 203.0.113.52",
		]);
		try {
			const response = await readResponse(socket, 2000);
			assert.equal(response.status, 429);
			assert.equal(response.headers.connection, "close");
			assert.isTrue(await closedWithin(socket, 1000));
		} finally {
			socket.destroy();
		}
	});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=public_api_errors.spec.ts > <scratchpad>/t38-t14.log 2>&1` (expect a type/runtime failure: `retryLater` and `apiErrorIsReported` don't exist), and `PATH=… PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=public_limits.spec.ts > <scratchpad>/t38-t14b.log 2>&1` (expect the new test to FAIL: keep-alive, no `Connection: close`).

- [ ] **Step 3: The codes.** In `public_api.ts`, add `| "request_timeout"` and `| "service_busy"` to `ApiErrorCode` after `"internal_error"`, and to `API_ERRORS` after `internal_error`:

```ts
	request_timeout: {
		status: 408,
		code: "request_timeout",
		message: "The upload took too long. Try again on a faster connection.",
	},
	service_busy: {
		status: 503,
		code: "service_busy",
		message: "We're busy right now. Try again in a moment.",
	},
```

and after `API_ERRORS`:

```ts
/** Seconds a busy answer (service_busy, a write already in flight) asks a client to wait (TAT-38). */
export const RETRY_AFTER_BUSY_SECONDS = 10;
```

- [ ] **Step 4: The errors.** In `public_api_errors.ts`: import `RETRY_AFTER_BUSY_SECONDS` with the others from `#services/public_api`; add `408: "request_timeout",` to `CODE_BY_STATUS`; inside `class ApiException`, add the field and the factory:

```ts
	/** Seconds for Retry-After, for a refusal a client should retry later. */
	retryAfter?: number;

	/** A refusal to retry after `seconds` (TAT-38: write slots). */
	static retryLater(code: "rate_limited" | "service_busy", seconds: number) {
		const error = ApiException.of(code);
		error.retryAfter = seconds;
		return error;
	}
```

In `apiErrorFor`, replace the first line with:

```ts
	if (error instanceof ApiException) {
		return respond(
			error,
			error.fields,
			error.retryAfter === undefined
				? {}
				: { "Retry-After": String(error.retryAfter) },
		);
	}
```

and add before `const status = statusOf(error);`:

```ts
	// No pooled connection within the pool's wait (#services/db_pool).
	if (error instanceof Error && error.name === "KnexTimeoutError") {
		return respond(API_ERRORS.service_busy, undefined, {
			"Retry-After": String(RETRY_AFTER_BUSY_SECONDS),
		});
	}
```

Add after `apiErrorFor`:

```ts
/**
 * Whether an API error goes to the log: server errors do, a client's
 * mistakes (4xx) don't, and neither does a deliberate busy refusal (a write
 * slot, TAT-38). A pool timeout is a server error: it is logged.
 */
export function apiErrorIsReported(error: unknown): boolean {
	if (error instanceof ApiException && error.code === "service_busy") {
		return false;
	}
	return apiErrorFor(error).status >= 500;
}
```

In `renderApiError`, after the loop that sets the headers:

```ts
	// Answered before its body arrived (a refusal, a deadline): close the
	// connection rather than let Node read the rest of a slow body (TAT-38).
	if (ctx.request.hasBody() && !ctx.request.request.complete) {
		ctx.response.header("Connection", "close");
	}
```

In `app/exceptions/handler.ts`, `report()`: import `apiErrorIsReported` with `apiErrorFor, renderApiError` and replace `if (isApiRequest(ctx) && apiErrorFor(error).status < 500) return;` with `if (isApiRequest(ctx) && !apiErrorIsReported(error)) return;` (drop `apiErrorFor` from the import if it is no longer used), and its comment with "A client's mistake on the public API (an unknown slug, a bad body) and a deliberate busy refusal are not logged: slug probing would flood the log. Server errors are, a pool timeout included."

- [ ] **Step 5: The contract.** In `packages/types/openapi.yaml`: in `ErrorResponse.error.code`'s description, add after "`internal_error` (500)": ", `request_timeout` (408, an upload that took too long) and `service_busy` (503, with `Retry-After`: too many uploads in progress, or no database connection free)", and add `service_busy` to `examples`. Add to the conventions list in `info.description`, after the "Rate limits" bullet:

```yaml
    - **Busy and slow uploads (TAT-38).** A write may be 503
      `service_busy` with `Retry-After` while too many uploads are in
      progress (429 `rate_limited` for one address); an upload whose body
      takes longer than 90 seconds is 408 `request_timeout`.
```

In `createInquiry` and `submitDepositProof` responses add `"408": { $ref: "#/components/responses/Error" }`; in `createInquiry` change the `"503"` description to "The bot challenge could not be checked (`challenge_unavailable`), or the API is busy (`service_busy`, with `Retry-After`). Try again in a minute."; in `submitDepositProof` add:

```yaml
        "503":
          description: The API is busy (`service_busy`, with `Retry-After`). Try again in a moment.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
```

Regenerate: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate > <scratchpad>/t38-gen14.log 2>&1`.

- [ ] **Step 6: Run.** Both commands of Step 2, plus `--files=errors.spec.ts --files=stateless.spec.ts` in the functional run: all PASS. Typecheck clean.

- [ ] **Step 7: Commit.**

```bash
git add apps/platform/app/services/public_api.ts apps/platform/app/services/public_api_errors.ts apps/platform/app/exceptions/handler.ts apps/platform/tests/unit/services/public_api_errors.spec.ts apps/platform/tests/functional/api/public_limits.spec.ts packages/types/openapi.yaml packages/types/src/openapi.gen.ts
git commit -m "feat(platform): service_busy and request_timeout; an early refusal closes the connection" -m "A pool timeout on the API is a logged 503 with Retry-After; a deliberate busy refusal is not
logged (TAT-38 rulings 12 to 14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: The upload deadline

**Files:**
- Modify: `apps/platform/app/services/uploads.ts` (`receiveUploads`), `apps/platform/app/middleware/web_multipart_middleware.ts`, `apps/platform/tests/support/test_routes.ts` (tenant `__test` group: `upload`)
- Create: `apps/platform/tests/functional/api/upload_deadline.spec.ts`
- Test: `apps/platform/tests/unit/services/uploads.spec.ts`

**Interfaces:**
- Consumes: `request_timeout` (Task 14), `rawRequest`, `readResponse`, `closedWithin`, `waitFor` (Task 8), `hooks` (`#tests/support/test_routes`), `http.requestTimeout` (Task 13).
- Produces: `receiveUploads(request, options?: { deadlineMs?: number })`, `UPLOAD_DEADLINE_MS = 90_000`, `WEB_UPLOAD_DEADLINE_MS = 120_000` (`#services/uploads`); test route `POST /api/v1/tenants/:tenant/__test/upload` (deadline 300 ms, registers `afterRollback(() => hooks.push("upload-rollback"))`).

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/services/uploads.spec.ts` (import `UPLOAD_DEADLINE_MS, WEB_UPLOAD_DEADLINE_MS` from `#services/uploads` and `{ http }` from `#config/app`):

```ts
test.group("Upload deadlines (TAT-38)", () => {
	test("90 s on the API, 120 s on the dashboard, within Node's request timeout", ({ assert }) => {
		assert.equal(UPLOAD_DEADLINE_MS, 90_000);
		assert.equal(WEB_UPLOAD_DEADLINE_MS, 120_000);
		assert.isAtMost(WEB_UPLOAD_DEADLINE_MS, http.requestTimeout ?? 0);
	});
});
```

In `tests/support/test_routes.ts`, inside the `/api/v1/tenants/:tenant/__test` group (add the import of `receiveUploads, discardUploads` from `#services/uploads`):

```ts
		// Reads an upload with a 300 ms deadline (TAT-38's deadline test).
		router.post("upload", async (ctx) => {
			afterRollback(() => {
				hooks.push("upload-rollback");
			});
			try {
				await receiveUploads(ctx.request, { deadlineMs: 300 });
				return { data: { files: Object.keys(ctx.request.allFiles()).length } };
			} finally {
				await discardUploads(ctx.request);
			}
		});
```

`apps/platform/tests/functional/api/upload_deadline.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { closedWithin, rawRequest, readResponse, waitFor } from "#tests/helpers/raw_http";
import { studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";
import { hooks } from "#tests/support/test_routes";

const SLUG = "deadline-38";

test.group("Public API: the upload deadline", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		hooks.length = 0;
	});

	test("an upload that trickles past its deadline is a 408, rolls back, frees its file and closes", async ({ assert }) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();
		const socket = await rawRequest(
			[
				`POST /api/v1/tenants/${SLUG}/__test/upload HTTP/1.1`,
				"Content-Type: multipart/form-data; boundary=td38",
				"Content-Length: 1000000",
			],
			'--td38\r\nContent-Disposition: form-data; name="photo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nAAAA',
		);
		const trickle = setInterval(() => {
			if (!socket.destroyed) socket.write("A");
		}, 100);
		try {
			const started = Date.now();
			const response = await readResponse(socket, 3000);

			assert.equal(response.status, 408);
			assert.equal(JSON.parse(response.body).error.code, "request_timeout");
			assert.isBelow(Date.now() - started, 2000);
			assert.equal(response.headers.connection, "close");
			assert.isTrue(await closedWithin(socket, 1000));
			assert.include(hooks, "upload-rollback");
			await waitFor(
				async () => (await newTempUploads(before)).length === 0,
				"the trickled upload's temp file to go",
			);
		} finally {
			clearInterval(trickle);
			socket.destroy();
		}
	});

	test("an upload within its deadline is read", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client
			.post(`/api/v1/tenants/${SLUG}/__test/upload`)
			.file("photo", Buffer.from("AAAA"), { filename: "a.png", contentType: "image/png" });

		response.assertStatus(200);
		response.assertBody({ data: { files: 1 } });
	});
});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test functional --files=upload_deadline.spec.ts > <scratchpad>/t38-t15.log 2>&1`. Expected: a type error or FAIL (`deadlineMs` is not an option yet: the trickle test gets no response within 3 s). The unit test fails on the missing exports.

- [ ] **Step 3: The deadline in `receiveUploads`.** In `app/services/uploads.ts`: import `type Readable` from `node:stream`; extend `Received` with `parts: Set<Readable>`; add the constants and the option:

```ts
/** How long a public API upload may take to arrive (TAT-38): TAT-57 sends at most about 5 MB. */
export const UPLOAD_DEADLINE_MS = 90_000;

/** A dashboard upload's: it holds no database connection while it arrives. */
export const WEB_UPLOAD_DEADLINE_MS = 120_000;
```

Change the signature to `export async function receiveUploads(request: Request, { deadlineMs = UPLOAD_DEADLINE_MS }: { deadlineMs?: number } = {}): Promise<void>`, create the state as `{ paths: new Set(), running: new Set(), parts: new Set() }`, and in the handler add `state.parts.add(part);` before `part.pause()` and `state.parts.delete(part);` in a `finally` of the inner `try`. Replace the `try { await request.multipart.process(); } catch …` block with:

```ts
	// The whole body must arrive within the deadline: a client that trickles
	// it would otherwise hold the request, and on the API its pooled
	// connection, for as long as it likes. Destroying the parts lets their
	// file handlers settle at once, so discardUploads doesn't wait for them.
	let timedOut = false;
	const timeout = new Exception("Request timeout", {
		status: 408,
		code: "E_REQUEST_TIMEOUT",
	});
	const timer = setTimeout(() => {
		timedOut = true;
		for (const part of state.parts) part.destroy(timeout);
		request.multipart.abort(timeout);
	}, deadlineMs);
	try {
		await request.multipart.process();
	} catch (error) {
		if (timedOut) throw timeout;
		throw clientHungUp(error)
			? new Exception("Request aborted", {
					status: 400,
					code: "E_REQUEST_ABORTED",
				})
			: error;
	} finally {
		clearTimeout(timer);
	}
```

Add to the function's comment: "The body must arrive within `deadlineMs` (90 s by default), or the call rejects with a 408 `E_REQUEST_TIMEOUT` (TAT-38)."

In `web_multipart_middleware.ts`, import `WEB_UPLOAD_DEADLINE_MS` and call `await receiveUploads(ctx.request, { deadlineMs: WEB_UPLOAD_DEADLINE_MS });`. The two public controllers keep `receiveUploads(request)`: they get the 90 s default.

- [ ] **Step 4: Run.** Step 2's command plus `--files=inquiry_refusals.spec.ts --files=deposit_refusals.spec.ts --files=multipart.spec.ts`, and `PATH=… PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=uploads.spec.ts > <scratchpad>/t38-t15b.log 2>&1`. Expected: all PASS. Typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/uploads.ts apps/platform/app/middleware/web_multipart_middleware.ts apps/platform/tests/support/test_routes.ts apps/platform/tests/functional/api/upload_deadline.spec.ts apps/platform/tests/unit/services/uploads.spec.ts
git commit -m "feat(platform): an upload must arrive within 90 s on the API, 120 s on the dashboard" -m "Past it the parts are destroyed and the request is a 408 request_timeout that rolls back and
closes the connection (TAT-38 ruling 14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Write slots in the gate

**Files:**
- Create: `apps/platform/app/services/write_slots.ts`, `apps/platform/tests/unit/services/write_slots.spec.ts`, `apps/platform/tests/functional/api/write_slots.spec.ts`
- Modify: `apps/platform/app/middleware/public_gate_middleware.ts`, `apps/platform/tests/support/test_routes.ts` (`/api/v1/__test` group: `hold`), `apps/platform/tests/unit/services/db_pool.spec.ts`

**Interfaces:**
- Consumes: `callerIp` (Task 5), `clientAddress`, `ApiException.retryLater`, `RETRY_AFTER_BUSY_SECONDS` (Task 14), `receiveUploads` with `deadlineMs` (Task 15), raw HTTP helpers (Task 8), `pgPoolFor` (Task 13).
- Produces (`#services/write_slots`): `WRITE_CONCURRENCY = { perProcess: 4, perAddress: 2 }`; `type Slot = { release(): void }`; `class WriteSlots { take(address: string): Slot | "address" | "process"; get inFlight(): number }`; `writeSlots` (the process's one). Test route `POST /api/v1/__test/hold`.

- [ ] **Step 1: Write the failing tests.** `apps/platform/tests/unit/services/write_slots.spec.ts`:

```ts
import { test } from "@japa/runner";
import { WRITE_CONCURRENCY, WriteSlots } from "#services/write_slots";

test.group("WriteSlots", () => {
	test("two per address and four per process; a release frees its slot once", ({ assert }) => {
		const slots = new WriteSlots({ perProcess: 4, perAddress: 2 });
		const a1 = slots.take("a");
		const a2 = slots.take("a");
		assert.equal(slots.take("a"), "address");
		const b1 = slots.take("b");
		const b2 = slots.take("b");
		assert.equal(slots.inFlight, 4);
		assert.equal(slots.take("c"), "process");

		assert.notTypeOf(a1, "string");
		if (typeof a1 === "string") return;
		a1.release();
		a1.release();
		assert.equal(slots.inFlight, 3);
		assert.notTypeOf(slots.take("c"), "string");
		assert.equal(slots.take("a"), "process");

		for (const slot of [a2, b1, b2]) if (typeof slot !== "string") slot.release();
		assert.equal(slots.inFlight, 1);
		assert.notTypeOf(slots.take("a"), "string");
	});

	test("the numbers", ({ assert }) => {
		assert.deepEqual(WRITE_CONCURRENCY, { perProcess: 4, perAddress: 2 });
	});
});
```

Append to `tests/unit/services/db_pool.spec.ts` (import `WRITE_CONCURRENCY` from `#services/write_slots`):

```ts
test.group("Database pools and write slots", () => {
	test("public writes leave at least 4 connections to everything else", ({ assert }) => {
		assert.isAtLeast(pgPoolFor("web").max - WRITE_CONCURRENCY.perProcess, 4);
	});
});
```

In `tests/support/test_routes.ts`, inside the `/api/v1/__test` group (import `receiveUploads, discardUploads` if not yet):

```ts
		// Holds a write slot while its body arrives (TAT-38's slot tests).
		router.post("hold", async ({ request }) => {
			try {
				await receiveUploads(request, { deadlineMs: 10_000 });
				return { data: { ok: true } };
			} finally {
				await discardUploads(request);
			}
		});
```

`apps/platform/tests/functional/api/write_slots.spec.ts`:

```ts
import type net from "node:net";
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import { apiLimitFor } from "#services/api_limits";
import { writeSlots } from "#services/write_slots";
import { assertApiData, assertApiError } from "#tests/helpers/api";
import { rawRequest, waitFor } from "#tests/helpers/raw_http";
import { studioWithOwner } from "#tests/helpers/tenants";

/** A write that takes a slot and keeps it: its body never finishes. */
const holdUpload = (ip: string) =>
	rawRequest(
		[
			"POST /api/v1/__test/hold HTTP/1.1",
			"Content-Type: multipart/form-data; boundary=td38",
			"Content-Length: 1000000",
			`X-Forwarded-For: ${ip}`,
		],
		'--td38\r\nContent-Disposition: form-data; name="a"\r\n\r\npartial',
	);

test.group("Public API: write slots", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("two writes per address and four per process at once; a slot frees when its client hangs up", async ({ client, assert }) => {
		const sockets: net.Socket[] = [];
		const write = (ip: string) =>
			client.post("/api/v1/__test/hold").header("x-forwarded-for", ip).field("a", "b");
		try {
			sockets.push(await holdUpload("203.0.113.60"), await holdUpload("203.0.113.60"));
			await waitFor(() => writeSlots.inFlight === 2, "two held writes");

			const third = await write("203.0.113.60");
			assertApiError(third, 429, "rate_limited");
			assert.equal(third.header("retry-after"), "10");

			sockets.push(await holdUpload("203.0.113.61"), await holdUpload("203.0.113.61"));
			await waitFor(() => writeSlots.inFlight === 4, "four held writes");

			const busy = await write("203.0.113.62");
			assertApiError(busy, 503, "service_busy");
			assert.equal(busy.header("retry-after"), "10");

			sockets.shift()?.destroy();
			await waitFor(() => writeSlots.inFlight === 3, "a slot freed by a client that hung up");
			assertApiData(await write("203.0.113.62"), { ok: true });
		} finally {
			for (const socket of sockets) socket.destroy();
			await waitFor(() => writeSlots.inFlight === 0, "every slot freed");
		}
	});

	test("reads never take a slot; a refused write still counts", async ({ client, assert }) => {
		await studioWithOwner("slots-38");
		const sockets: net.Socket[] = [];
		try {
			for (const ip of ["203.0.113.63", "203.0.113.63", "203.0.113.64", "203.0.113.64"]) {
				sockets.push(await holdUpload(ip));
			}
			await waitFor(() => writeSlots.inFlight === 4, "four held writes");

			(await client.get("/api/v1/tenants/slots-38").header("x-forwarded-for", "203.0.113.65")).assertStatus(200);
			assertApiError(
				await client.post("/api/v1/__test/hold").header("x-forwarded-for", "203.0.113.65").field("a", "b"),
				503,
				"service_busy",
			);
			const { key, budget } = apiLimitFor("callerWrites", { kind: "anonymous", ip: "203.0.113.65" });
			assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 1);
		} finally {
			for (const socket of sockets) socket.destroy();
			await waitFor(() => writeSlots.inFlight === 0, "every slot freed");
		}
	});
});
```

- [ ] **Step 2: Run to see them fail.** Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 90 pnpm -C apps/platform test unit --files=write_slots.spec.ts --files=db_pool.spec.ts > <scratchpad>/t38-t16.log 2>&1` (exit 124, missing module) and the functional `--files=write_slots.spec.ts` into `<scratchpad>/t38-t16b.log` (exit 124 too).

- [ ] **Step 3: Write the slots and use them in the gate.** `apps/platform/app/services/write_slots.ts`:

```ts
/**
 * Public API writes in flight in this process (TAT-38 ruling 13). Every
 * API request that isn't GET or HEAD takes a slot in the gate, before its
 * body, and holds it until its response closes: at most 4 at once, 2 per
 * client address, so slow uploads can hold at most 4 of the web server's
 * 10 pooled connections (#services/db_pool), however slowly they arrive.
 * In memory: each web process counts its own.
 */
export const WRITE_CONCURRENCY = { perProcess: 4, perAddress: 2 } as const;

export type Slot = { release(): void };

export class WriteSlots {
	#total = 0;
	readonly #byAddress = new Map<string, number>();

	constructor(
		private readonly limits: { perProcess: number; perAddress: number } = WRITE_CONCURRENCY,
	) {}

	get inFlight(): number {
		return this.#total;
	}

	/** A slot for `address`, or which limit refused it. */
	take(address: string): Slot | "address" | "process" {
		const mine = this.#byAddress.get(address) ?? 0;
		if (mine >= this.limits.perAddress) return "address";
		if (this.#total >= this.limits.perProcess) return "process";
		this.#total++;
		this.#byAddress.set(address, mine + 1);
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				this.#total--;
				const left = (this.#byAddress.get(address) ?? 1) - 1;
				if (left === 0) this.#byAddress.delete(address);
				else this.#byAddress.set(address, left);
			},
		};
	}
}

/** The web process's slots. */
export const writeSlots = new WriteSlots();
```

In `public_gate_middleware.ts`, import `callerIp` (with `callerOf`), `clientAddress` (`#services/rate_limits`), `ApiException` (`#services/public_api_errors`), `RETRY_AFTER_BUSY_SECONDS` (with `isApiRequest, READ_METHODS`) and `writeSlots` (`#services/write_slots`), and replace `return next();` at the end of `handle` with:

```ts
		if (reads) return next();
		// Writes in flight: a slot until the response closes (TAT-38 ruling 13).
		const slot = writeSlots.take(clientAddress(callerIp(ctx)));
		if (slot === "address") {
			throw ApiException.retryLater("rate_limited", RETRY_AFTER_BUSY_SECONDS);
		}
		if (slot === "process") {
			throw ApiException.retryLater("service_busy", RETRY_AFTER_BUSY_SECONDS);
		}
		ctx.response.response.once("close", slot.release);
		return next();
```

Add to its comment: "A write then takes one of the process's write slots (#services/write_slots) until its response closes."

- [ ] **Step 4: Run.** Both commands of Step 2: PASS. Then the API files of Task 8 Step 6 again (`<scratchpad>/t38-t16c.log`): all PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/platform/app/services/write_slots.ts apps/platform/app/middleware/public_gate_middleware.ts apps/platform/tests/support/test_routes.ts apps/platform/tests/unit/services/write_slots.spec.ts apps/platform/tests/unit/services/db_pool.spec.ts apps/platform/tests/functional/api/write_slots.spec.ts
git commit -m "feat(platform): at most 4 public API writes at once per process, 2 per address" -m "Taken in the gate before the body, held until the response closes: 503 service_busy or 429 with
Retry-After 10 (TAT-38 ruling 13).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: The production checklist and the rest of the docs

**Files:**
- Create: `apps/platform/docs/deploy.md`
- Modify: `apps/platform/database/README.md` (production checklist), `apps/platform/docs/backend.md` (Rate limits first bullet; Public API intake bullet's "TAT-38's limits must land" sentence; the bullet you added in Task 12), `apps/platform/AGENTS.md`, `docs/README.md`, `docs/sdk.md` (codes), `README.md` (Deployment)

- [ ] **Step 1: Write `apps/platform/docs/deploy.md`.**

```markdown
# Deploying the platform

Read before a deploy or when changing production settings. The hosting itself is TAT-14's; this page is what the platform needs from it. Nothing here is covered by the test suite: check it against your deploy.

## Public API production checklist

### Platform settings

- `NODE_ENV=production`. With it, the web server, the worker and every `ace` command refuse to start without `STOREFRONT_URL`, `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY` (`start/env.ts`).
- `APP_KEY` (`node ace generate:key`; rotating it ends every session, deposit link and rate-limit count). `APP_URL`: the platform's public https origin (public upload URLs and emails use it).
- `STOREFRONT_URL`: the studio pages' origin with `{tenant}` for the slug, e.g. `https://{tenant}.example.com` (deposit links).
- `TURNSTILE_SECRET_KEY` (the bot challenge, TAT-55), with outbound HTTPS to `challenges.cloudflare.com` allowed.
- `STOREFRONT_SERVER_KEYS`: the storefront's key ([below](#the-storefronts-server-key)).
- `TRUST_PROXY`: the addresses of the reverse proxy in front of the app, as a list: `loopback` when it runs on the same host, its address or CIDR when it is a load balancer, plus Cloudflare's ranges if Cloudflare fronts the API. Never every address. Wrong, every visitor shares the proxy's address, and one person's attempts lock everyone out of login, signup, the intake and the deposit page.
- `DB_USER` / `DB_PASSWORD` are the app role. `DB_MIGRATION_PASSWORD` belongs only in the migration step's environment.

### Storefront settings (Vercel, TAT-13)

- `API_URL`: the API's public https origin (browsers call it too). `STOREFRONT_URL`, `TURNSTILE_SITE_KEY`, and `STOREFRONT_SERVER_KEY`: one of the platform's keys. With `NODE_ENV=production` a missing key makes every page a 500 that names the variable.

### Processes

- Node 24.3.0 (`.nvmrc`) in the container: on Node 26.9 the multipart parser stalls on large text fields. Re-run `inquiry_refusals.spec.ts` before any Node upgrade.
- Before each release: `node build/ace.js migration:run --connection=owner --force` ([database conventions](../database/README.md#row-level-security)).
- One web server (`node bin/server.js` in `build/`): it upserts the recurring schedules when it boots.
- At least one worker (`node ace.js queue:work` in `build/`, with the same environment): alerts, quote expiry and the expiry sweep run only there.

### Reverse proxy

Values for nginx; set the equivalent on the host's proxy.

- Keep request buffering on (`proxy_request_buffering on`, nginx's default): the proxy then receives a slow upload whole before the app holds anything for it.
- `client_max_body_size 21m` (the parser's 20 MB plus multipart overhead), `client_header_timeout 15s`, `client_body_timeout 30s` (between two reads), `send_timeout 30s`, `proxy_read_timeout 130s` (above the app's 120 s request timeout), and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`.
- Keep-alive: the app closes an idle connection after 5 s (Node's default). Keep the proxy's upstream keep-alive below that, or raise `keepAliveTimeout` in `config/app.ts` above the proxy's.
- No access log for `/api/v1/tenants/*/deposits/*` (`access_log off;` in that location) and no APM URL capture there: the path holds a deposit link's token for 30 days. Keep `/files` request URLs (signed) out of logs too.
- What the app does itself (TAT-38): every API request counts per caller before its body is read, reads per studio too; at most 4 API writes at once per process (2 per address); an upload must arrive within 90 s (120 s on the dashboard); Node drops any request not received within 120 s.

### Database

- Connections: a web server's pool holds up to 10 (`pgPoolFor`, `#services/db_pool`) plus the limiter's 4; a worker's up to 6. One web server and one worker need about 20, plus migrations and your own `psql`: keep `max_connections` above that with headroom, and add 14 for each extra web server.
- `ALTER ROLE tattoo_drip_app SET idle_in_transaction_session_timeout = '3min';` (`setup_roles.sql` doesn't set it): above the slowest request, since an upload holds its transaction for up to about 100 s.
- A request that waits 10 s for a connection fails; on the API it answers 503 `service_busy` and is logged. If that shows in the log, raise the pool and `max_connections` together.
- Roles, migrations and seeders: [database conventions](../database/README.md#row-level-security).

### The storefront's server key

- Make one with `openssl rand -base64 32`, and set it as the storefront's `STOREFRONT_SERVER_KEY` and the platform's `STOREFRONT_SERVER_KEYS`.
- It only lets the storefront's server-side calls count per visitor (`X-Visitor-IP`) instead of as one client; it opens no data. Never put it in a `VITE_` variable, a log or a browser.
- Rotate without downtime: (1) set the platform's `STOREFRONT_SERVER_KEYS=old,new` and restart it; (2) set the storefront's `STOREFRONT_SERVER_KEY=new` and redeploy; (3) when no "server key this API does not accept" warning has shown for 10 minutes, set `STOREFRONT_SERVER_KEYS=new` and restart. A slip takes no page down: an unknown key counts as an anonymous client and logs that warning, so at worst the pages slow down under load.

### Recommended, not required

- Cloudflare in front of the API: add its IP ranges (cloudflare.com/ips) to `TRUST_PROXY`, let only Cloudflare reach the origin, and add a coarse rate-limiting rule as an outer layer. Without that `TRUST_PROXY` entry every visitor shares a Cloudflare address.
- Vercel's firewall rate limiting for the storefront: each random studio subdomain or query string costs a function run before the API sees it.

### Accepted denial costs

Known and accepted for the pilot. The owner gets no signal for any of them (429s and busy 503s are not logged on purpose; alerts are TAT-52), so look here first when a studio says its form "stopped working".

- 60 solved bot challenges in an hour, from 3 or more addresses, close one studio's intake form for the rest of that hour (TAT-55's per-studio limit).
- 10 solved challenges with a victim's phone number lock that number out of that studio's form for up to 24 hours (TAT-55's per-phone limit).
- A few slow uploads (4 per web process, from 2 or more addresses) make every upload answer 503 `service_busy` for up to about 100 s at a time; the pages and the dashboard keep working.
- A flood of one studio's pages from many addresses can spend its read budget (6000 storefront reads per 5 minutes) and show its pages' "try again" page for the rest of the window; other studios are untouched.
- One carrier-NAT address shared by many customers shares 60 writes an hour across the platform, and the intake's 20 per studio per hour, which counts before Cloudflare is asked. All of these count the right address only when `TRUST_PROXY` is right.

### After the first deploy

- Open a studio page, then check the API log: no "server key this API does not accept" and no "no usable X-Visitor-IP" warning (either means the key or the visitor's address isn't reaching the API).
- `curl -sI https://<api>/api/v1/tenants/<slug>` answers 200 with `Cache-Control: public…` and no `X-RateLimit-*` header.
- Run the storefront's `pnpm check:page` against the production build before the first deploy (TAT-13).
- Still required before any public deploy: object storage (TAT-27: the local disks must never deploy), the storefront deposit page (TAT-65b) and the intake form (TAT-57).
```

- [ ] **Step 2: database/README.md.** In "Production checklist", delete the bullets that start "Set `STOREFRONT_URL`", "Set the pool size explicitly", "Consider `ALTER ROLE tattoo_drip_app SET idle_in_transaction_session_timeout`", "Run production and CI on the Node version in `.nvmrc`", "Uploads hold a pooled database connection", "A deposit link's token is in the API path" and "Behind a proxy that isn't on loopback", and add as the checklist's first bullet: "The API process's settings, reverse proxy, pool sizes and `idle_in_transaction_session_timeout`, logs and the server key are in the [public API production checklist](../docs/deploy.md#public-api-production-checklist)."

- [ ] **Step 3: backend.md.** In Rate limits' first bullet, replace "Read the production checklist in [database conventions](../database/README.md) before deploying behind another proxy." with "Behind another proxy, set `TRUST_PROXY` ([deploy](deploy.md#public-api-production-checklist))." In the Intake bullet, replace the last sentence ("The request keeps its pooled database connection … so TAT-38's limits must land before any public deploy.") with "The request keeps its pooled database connection while the upload streams and while an image waits for a decode slot (`publicTenant` opens the transaction first, TAT-38 ruling 15): it holds one of the process's 4 write slots and its body must arrive within 90 s." In the TAT-65 Rate limits bullet, replace "TAT-38 may move the per-address part ahead of the tenant lookup." with "The gate's per-caller count runs ahead of the tenant lookup (TAT-38); these per-address and per-token counts stay here." Append to the Rate limits bullet "The public API (TAT-38): …" that Task 12 added: "Writes also take one of 4 write slots per process (2 per address) before their body (`#services/write_slots`): over is 503 `service_busy` or 429, `Retry-After: 10`. Upload bodies must arrive within 90 s (`receiveUploads`, 408 `request_timeout`; 120 s on the dashboard). A pool timeout (10 s, `#services/db_pool`) on the API is a logged 503 `service_busy`."

- [ ] **Step 4: Index and pointers.** `apps/platform/AGENTS.md`, "Read before changing the matching area": add "- Production settings, the reverse proxy, pools or the server key: [deploy](docs/deploy.md)." `docs/README.md` table: add the row "| Deploying the platform, production settings, the public API checklist | [Platform deploy](../apps/platform/docs/deploy.md) |" after the Platform testing row. `README.md`, Deployment, Platform line: append " Follow the [public API production checklist](apps/platform/docs/deploy.md#public-api-production-checklist)." `docs/sdk.md`, the error codes: add "`request_timeout` (408, an upload that took longer than 90 s) and `service_busy` (503 with `Retry-After`: too many uploads in progress)."

- [ ] **Step 5: Check and commit.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check > <scratchpad>/t38-check17.log 2>&1` (no new warnings); `rg -n "production checklist" apps/platform docs README.md` shows only links that resolve. Then:

```bash
git add apps/platform/docs/deploy.md apps/platform/database/README.md apps/platform/docs/backend.md apps/platform/AGENTS.md docs/README.md docs/sdk.md README.md
git commit -m "docs(platform): one public API production checklist for TAT-14" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Verification

**Files:** none changed (fix what fails in the task that owns it).

- [ ] **Step 1: Generated files.** `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/types generate` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform exec node ace codegen`, then `git status --short`: no diff.

- [ ] **Step 2: Gates.** Each into its own `<scratchpad>/t38-final-*.log`: `pnpm check`, `pnpm typecheck`, `pnpm build`, the full platform suite (background, as in Task 0: Task 0's count plus every new test, all passing), `pnpm -C apps/storefront test` (also with `NODE_ENV=production`), `pnpm --filter @tattoo-drip/sdk test`, `pnpm --filter @tattoo-drip/react test`, `pnpm -C apps/storefront check:page`. All with the Node 24.3.0 PATH prefix. `git status --short` is clean after the build.

- [ ] **Step 3: Mutation checks (revert each).** (a) In `ServerKeys.check`, return as soon as a digest matches (`if (crypto.timingSafeEqual(...)) return "match";`): Task 5's constant-time test must fail. (b) Move the gate after the bodyparser in `router.use`: Task 8's "refused before its body is sent" must fail. (c) Set `multipart.autoProcess: true`: Task 1's tests and the guard must fail. (d) Comment out `ctx.response.response.once("close", slot.release)`: Task 16's test must fail. (e) Remove the `X-Visitor-IP` line from `withVisitorAddress`: the storefront's visitor and context tests and `check:page` must fail. Record each result in the PR text.

- [ ] **Step 4: Leak checks.** `rg -n "test-key-one|test-key-two" apps/platform/app apps/platform/config apps/storefront/src` finds nothing; `rg -n "release\(\)" apps/platform/app/services/api_caller.ts` shows the key used only to build digests; no new `logger.*` call takes a header, a key or an address (`rg -n "logger\.(warn|info|error)" apps/platform/app/services/api_caller.ts apps/platform/app/middleware`).

- [ ] **Step 5: PR text.** Write `<scratchpad>/pr3-tat-38.md`: what and why per part (a few bullets each), the rulings in one line each, the numbers, the new settings (`STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` on the platform, required in production; `STOREFRONT_SERVER_KEY` now required in production on the storefront), the deploy checklist link, test counts, mutation results, any test that needed distinct addresses (Task 8 Step 6), and "Before any public deploy" (TAT-27, TAT-65b, TAT-57, the checklist). No commit.
