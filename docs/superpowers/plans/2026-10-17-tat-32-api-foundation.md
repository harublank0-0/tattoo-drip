# API foundation: /api/v1, tenant by path, error envelope, CORS, cache headers (TAT-32) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `/api/v1` group for every public endpoint: tenant from the path (old slugs read as aliases), handlers in that tenant's RLS context, no session or cookies, open CORS without credentials, the `{ data }` / `{ error }` envelopes from `openapi.yaml`, explicit cache headers, one real endpoint (`getStudio`, minimal), and the SDK pieces every later endpoint needs.

**Architecture:** `isApiRequest(ctx)` marks the public API; the session and shield middleware run through wrappers that skip it, and silent auth, Inertia and CORS key off it. The `/api/v1` route group runs `publicApi` (headers, `no-store`), its `/tenants/:tenant` group runs `publicTenant` (stored-shape pre-filter, the `tenant_for_slug()` SECURITY DEFINER function, then one request transaction with `app.tenant_id` and no user). The exception handler renders every `/api` error as the envelope. `publicCache` opts a GET route into `public, max-age=60, stale-while-revalidate=600` with an ETag.

**Tech Stack:** AdonisJS 7 (http-server 9.3, session 8.1, shield 9.0, cors 3.0, limiter 3.0), Lucid on PostgreSQL 18 with RLS, VineJS 4, Japa; `openapi-typescript`; the SDK on `fetch`, tested with `node:test` and `tsx`; TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-10-17-tat-32-api-foundation-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- `<repo>` is the checkout you build in (the coordinator names it; `/home/blank/Coding/tattoo-drip` for the main checkout). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls, so every command below uses `-C <repo>` or absolute paths.
- This branch must contain TAT-24's final tip, 009ee56, before Task 1 (the coordinator rebases it). Tasks 7 to 11 use TAT-24 code: `tenant_slugs`, `STORED_SLUG` from `#modules/tenancy/slugs`, `TenancyService.changeSlug`, and its doc text.
- Fixture slugs in new tests end in `-32` (`api-needle-32`, `api-red-32`, …): registry rows are permanent, and the tests share the dev database, where a slug someone once tried stays taken (TAT-24's note in `docs/testing.md`). "Unknown" slugs are ones no studio has (`no-such-studio-td32`). The grandfathered shapes (`12345`, `a--b`, `www`, `xn--80ak6aa92e`) can't take a suffix; the new rules refuse them, so no dev studio holds them unless it predates TAT-24 (none did when TAT-24 migrated).
- One migration: `apps/platform/database/migrations/1791640000000_create_tenant_for_slug_function.ts`. It adds a function only, so `database/schema.ts` should not change; if `pnpm migrate` rewrites it, keep the regenerated file.
- Shared error codes and messages, verbatim: `bad_request` 400 "The request could not be read."; `not_found` 404 "Not found."; `method_not_allowed` 405 "This method is not allowed here."; `payload_too_large` 413 "The request is too large."; `unsupported_media_type` 415 "This content type or encoding is not supported."; `validation_failed` 422 "Some fields are invalid."; `rate_limited` 429 "Too many requests. Try again later."; `internal_error` 500 "Something went wrong. Try again later."
- Headers on every API response: `Cache-Control: no-store` (unless `publicCache`), `Access-Control-Allow-Origin: *`, `X-Content-Type-Options: nosniff`; never `Set-Cookie`, never `Access-Control-Allow-Credentials`. Cacheable: `public, max-age=60, stale-while-revalidate=600` and an ETag. CORS: methods `GET,HEAD,POST`, request headers `accept,content-type`, exposed `retry-after`, max-age 600.
- Old slugs: GET and HEAD resolve to the same tenant; every other method under an old slug is the unknown-tenant 404. Path slugs are matched exactly, never case-folded; the pre-filter is `STORED_SLUG` (imported from `#modules/tenancy/slugs`, never copied), never `checkSlug`.
- SDK: default `timeoutMs` 10 000; codes `timeout` and `network_error` with status 0; `credentials: "omit"`; no AdonisJS or framework imports in `packages/sdk`.
- Contract first: edit `packages/types/openapi.yaml`, then `pnpm -C <repo> --filter @tattoo-drip/types generate`. Never hand-edit `openapi.gen.ts`, `database/schema.ts` or `.adonisjs/`. After route or controller changes run `pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- Tests: `PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module hangs Japa, so RED steps run as `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background). `pnpm typecheck` is the authority over editor diagnostics. The pre-commit hook runs Biome and may rewrite staged files: re-read a file before editing it again.
- Commits: Conventional Commits with the area scope (`types`, `sdk`, `react`, `platform`), ending with your session's attribution line (e.g. `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`). Never push, never open a PR.

## Review Focus

1. **An unknown tenant on a GET path must be a 404, never a 405.** The 405 lookup runs only for router misses (`!ctx.route`); `publicTenant` throws `ApiException`, not `E_ROUTE_NOT_FOUND`. Tests: Task 3 "ApiException.notFound is a 404 even when other methods match", Task 9 "an unknown tenant is a 404 and a POST a 405".
2. **A URL that only looks like the API keeps the dashboard stack.** `/apiary`, `/API/v1`, `/t/api`, and a dashboard pattern reached through `/api/../…` are not API requests. Test: Task 3 "isApiRequest".
3. **A signed-in dashboard user calling the API runs as no one.** With a user, `tenants_select` would show their other studios. Test: Task 8 "a signed-in owner of another studio still runs as no one".
4. **A write under an old slug with an invalid body is a 404, not a 422.** Nothing (bodyparser aside) runs before the tenant check. Test: Task 8 "a write under an old slug is a 404, even with an invalid body".
5. **The SDK's timeout also covers a body that stops streaming.** It must be `timeout`, not `invalid_response`. Test: Task 2 "a body that stops streaming is a timeout too".

---

## Before Task 1: preconditions

- [ ] **Branch and base.** `git -C <repo> status -sb` shows `harublank00/tat-32-api-foundation-apiv1-tenant-by-path-error-envelope-cors` and a clean tree. `git -C <repo> merge-base --is-ancestor 009ee56 HEAD; echo $?` prints `0` (TAT-24's final tip is in this branch). If not, stop and report.
- [ ] **TAT-24's stored-shape export.** `rg -n 'export const STORED_SLUG' <repo>/apps/platform/app/modules/tenancy/slugs.ts` prints `export const STORED_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;`. If it is gone or renamed, stop and report: TAT-32 must not copy the regex.
- [ ] **TAT-24 names this plan uses.** `rg -n 'async (changeSlug|createTenant)|import .*db_context' <repo>/apps/platform/app/modules/tenancy/services/tenancy_service.ts` shows `changeSlug(tenant, slug)`, `createTenant(owner, input)` and an import of `dbClient` from `#services/db_context`, and neither method calls `checkSlug` (`rg -n checkSlug` on that file prints nothing). Also `ls <repo>/apps/platform/database/migrations | tail -2` ends with `1791630000000_create_tenant_slugs_table.ts`.
- [ ] **Install and migrate.** `pnpm -C <repo> install` then `pnpm -C <repo>/apps/platform migrate` (applies TAT-24's migration if it isn't yet).
- [ ] **Baseline.** `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=catalog_guard.spec.ts --files=tenant_routes.spec.ts --files=old_slug_redirects.spec.ts --files=expired_quote_candidates.spec.ts` passes.

---

### Task 1: The contract

**Files:**
- Modify: `packages/types/openapi.yaml`
- Regenerate: `packages/types/src/openapi.gen.ts`

**Interfaces:**
- Produces: `Studio` with required `slug` and `name` (other properties optional); `components.headers` `CacheControl`, `ETag`, `RetryAfter`; `components.responses` `NotModified`, `NotFound`, `ValidationError`, `RateLimited`, `Error`; `ErrorResponse` closed to extra properties. `ApiError` in `@tattoo-drip/types` stays `ErrorResponse["error"]`.

- [ ] **Step 1: Replace the `info:` block** (from `info:` down to, not including, `servers:`) with:

```yaml
info:
  title: Tattoo Drip public API
  version: 1.0.0-draft
  description: |
    Public storefront API. This document is the source of truth for
    `@tattoo-drip/types` and `@tattoo-drip/sdk`. Changes within v1 must be additive.

    Conventions for every endpoint (TAT-32):

    - **Stateless and cookieless.** No session and no CSRF token; no
      response ever sets a cookie.
    - **CORS** is open to any origin without credentials:
      `Access-Control-Allow-Origin: *` on every response, for GET, HEAD and
      POST with the `Accept` and `Content-Type` request headers. `Retry-After`
      is readable.
    - **Tenant from the path.** Tenant endpoints live under
      `/tenants/{tenant}`; the slug is matched exactly, never case-folded.
    - **Envelopes.** A success body is `{ "data": … }`; an error body is
      `{ "error": { "code", "message", "fields"? } }` (`ErrorResponse`). A
      path that exists answers other methods with 405 and `Allow`.
    - **Caching.** Reads that say so send
      `Cache-Control: public, max-age=60, stale-while-revalidate=600` and an
      `ETag` (`If-None-Match` gets a 304). Everything else, errors included,
      is `Cache-Control: no-store`.
```

- [ ] **Step 2: Replace the `/tenants/{tenant}:` path item** (from `  /tenants/{tenant}:` down to, not including, `  /tenants/{tenant}/artists:`) with:

```yaml
  /tenants/{tenant}:
    parameters:
      - $ref: "#/components/parameters/Tenant"
    get:
      operationId: getStudio
      summary: Public profile of a tenant
      description: Cacheable. Under an old slug it answers like under the current one, and `slug` is the current slug.
      responses:
        "200":
          description: Studio
          headers:
            Cache-Control: { $ref: "#/components/headers/CacheControl" }
            ETag: { $ref: "#/components/headers/ETag" }
          content:
            application/json:
              schema:
                type: object
                required: [data]
                additionalProperties: false
                properties:
                  data: { $ref: "#/components/schemas/Studio" }
        "304": { $ref: "#/components/responses/NotModified" }
        "404": { $ref: "#/components/responses/NotFound" }
        default: { $ref: "#/components/responses/Error" }

```

- [ ] **Step 3: Replace the start of `components:`** (from `components:` down to, not including, `    TattooStyle:`) with:

```yaml
components:
  securitySchemes:
    serverKey:
      type: http
      scheme: bearer
      description: Secret server key. Only sets rate-limit identity; grants no extra data access. Never use in a browser.

  parameters:
    Tenant:
      name: tenant
      in: path
      required: true
      description: |
        Tenant slug (also its subdomain), matched exactly: never case-folded.
        A tenant's old slugs answer reads (GET, HEAD) like its current slug,
        and the tenant resource names the current one. Any other method under
        an old slug is a 404, so writes must use the current slug.
      schema:
        type: string
        minLength: 3
        maxLength: 63
        pattern: "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$"

  headers:
    CacheControl:
      description: "`public, max-age=60, stale-while-revalidate=600` on a cacheable read; `no-store` on everything else."
      schema: { type: string }
    ETag:
      description: Strong entity tag of the body. Send it back as `If-None-Match` to get a 304 while it still matches.
      schema: { type: string }
    RetryAfter:
      description: Seconds until another request may succeed.
      schema: { type: integer, minimum: 0 }

  responses:
    NotModified:
      description: The `If-None-Match` tag still matches; no body
      headers:
        Cache-Control: { $ref: "#/components/headers/CacheControl" }
        ETag: { $ref: "#/components/headers/ETag" }
    NotFound:
      description: Unknown tenant or resource, or a write under an old slug (`not_found`)
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }
    ValidationError:
      description: Invalid input (`validation_failed`, with `fields`)
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }
    RateLimited:
      description: Too many requests (`rate_limited`)
      headers:
        Retry-After: { $ref: "#/components/headers/RetryAfter" }
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }
    Error:
      description: Any other error, with one of the codes `ErrorResponse` lists
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorResponse" }

  schemas:
    ErrorResponse:
      type: object
      required: [error]
      additionalProperties: false
      properties:
        error:
          type: object
          required: [code, message]
          additionalProperties: false
          properties:
            code:
              type: string
              description: |
                Stable and machine-readable. Shared codes: `bad_request` (400,
                an unreadable body), `not_found` (404), `method_not_allowed`
                (405), `payload_too_large` (413), `unsupported_media_type`
                (415), `validation_failed` (422, with `fields`),
                `rate_limited` (429, with `Retry-After`), `internal_error`
                (500). An endpoint may add codes of its own and lists them.
                Treat an unknown code by its HTTP status.
              examples: [not_found, validation_failed, rate_limited, slot_unavailable]
            message:
              type: string
              description: A sentence for people. Never parse it.
            fields:
              type: object
              description: Field path (dot-separated, e.g. `client.phone` or `referenceImages.0`) → messages. Only on `validation_failed`.
              additionalProperties: { type: array, items: { type: string } }

```

- [ ] **Step 4: Replace the `Studio:` schema** (from `    Studio:` down to, not including, `    Artist:`) with:

```yaml
    Studio:
      type: object
      description: |
        A tenant's public profile. TAT-32 sends `slug` and `name`; the other
        properties are the draft that TAT-44 implements and makes required.
      required: [slug, name]
      properties:
        slug:
          type: string
          description: The current slug, also when the request used an old one
        name: { type: string }
        id: { type: string, format: uuid }
        type: { type: string, enum: [studio, independent] }
        description: { type: [string, "null"] }
        timezone: { type: string, description: IANA timezone, examples: [Asia/Kathmandu] }
        contact:
          type: object
          required: [email]
          properties:
            email: { type: string, format: email }
            phone: { type: [string, "null"] }
            address: { type: [string, "null"] }
        socialLinks:
          type: array
          items: { $ref: "#/components/schemas/SocialLink" }
        storefront: { $ref: "#/components/schemas/StorefrontConfiguration" }

```

- [ ] **Step 5: Regenerate and typecheck**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate`
Expected: `packages/types/src/openapi.gen.ts` changes (the new headers and responses; `Studio`'s optional fields; `getStudio`'s 304 and default responses).

Run: `pnpm -C <repo> --filter @tattoo-drip/types typecheck && pnpm -C <repo> --filter @tattoo-drip/sdk typecheck && pnpm -C <repo> --filter @tattoo-drip/react typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add packages/types/openapi.yaml packages/types/src/openapi.gen.ts
git -C <repo> commit -m "feat(types): describe the public API conventions and a minimal getStudio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: SDK timeout, cancellation, cookieless requests and its first tests

**Files:**
- Modify: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/src/client.ts`, `packages/sdk/src/errors.ts`, `packages/sdk/src/index.ts`, `packages/react/src/queries.ts`, `pnpm-lock.yaml`
- Create: `packages/sdk/tsconfig.test.json`
- Test: `packages/sdk/test/client.test.ts`

**Interfaces:**
- Consumes: `Studio`, `ApiError` from `@tattoo-drip/types` (Task 1).
- Produces: `TattooClientOptions.timeoutMs?: number`; `RequestOptions = { signal?: AbortSignal }` as the last optional argument of every read (`studio.get(call?)`, `artists.list(call?)`, `artists.get(slug, call?)`, `services.list(query?, call?)`, `portfolio.list(query?, call?)`, `availability.list(query, call?)`, `styles.list(call?)`, `placements.list(call?)`); `TattooApiError(status, error?, options?: { retryAfter?: number; cause?: unknown })` with `readonly retryAfter: number | undefined`; `pnpm --filter @tattoo-drip/sdk test`.

- [ ] **Step 1: Add the test runner**

In `packages/sdk/package.json`, set `scripts` and `devDependencies` to:

```json
	"scripts": {
		"build": "tsc",
		"typecheck": "tsc --noEmit && tsc -p tsconfig.test.json",
		"test": "node --import tsx --test \"test/**/*.test.ts\""
	},
```

```json
	"devDependencies": {
		"@types/node": "~26.6.2",
		"tsx": "^4.23.12",
		"typescript": "^6.0.2"
	}
```

Replace `packages/sdk/tsconfig.json` with (so `@types/node` never reaches the SDK source):

```json
{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"rootDir": "src",
		"outDir": "dist",
		"types": []
	},
	"include": ["src"]
}
```

Create `packages/sdk/tsconfig.test.json`:

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": {
		"rootDir": ".",
		"noEmit": true,
		"types": ["node"]
	},
	"include": ["src", "test"]
}
```

Run: `pnpm -C <repo> install`
Expected: `pnpm-lock.yaml` gains `tsx` and `@types/node` under `packages/sdk` (both are already in the store).

- [ ] **Step 2: Write the failing test**

Create `packages/sdk/test/client.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient, TattooApiError } from "../src/index.js";

type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

function json(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...headers },
	});
}

function client(
	fetch: typeof globalThis.fetch,
	options: { timeoutMs?: number } = {},
) {
	return createTattooClient({
		baseUrl: "https://api.example.com",
		tenant: "api-needle-32",
		fetch,
		...options,
	});
}

/** Rejects with the signal's reason once it aborts, as fetch does. */
function hangUntilAborted({ init }: Call): Promise<Response> {
	const signal = init.signal as AbortSignal;
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	assert.fail("expected the call to reject");
}

describe("createTattooClient", () => {
	test("calls the tenant's /api/v1 URL without cookies and unwraps { data }", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: { slug: "api-needle-32", name: "Black Needle" } }),
		);

		const studio = await client(fetch).studio.get();

		assert.deepEqual(studio, { slug: "api-needle-32", name: "Black Needle" });
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32",
		);
		assert.equal(calls[0].init.credentials, "omit");
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.get("accept"), "application/json");
		assert.equal(headers.has("authorization"), false);
	});

	test("trims the base URL's trailing slashes and encodes the tenant", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: {} }));

		await createTattooClient({
			baseUrl: "https://api.example.com//",
			tenant: "a b/c",
			fetch,
		}).studio.get();

		assert.equal(calls[0].url, "https://api.example.com/api/v1/tenants/a%20b%2Fc");
	});

	test("turns the error envelope into a TattooApiError with its fields", async () => {
		const { fetch } = fakeFetch(() =>
			json(422, {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: { "client.phone": ["Enter a phone number"] },
				},
			}),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 422);
		assert.equal(error.code, "validation_failed");
		assert.equal(error.message, "Some fields are invalid.");
		assert.deepEqual(error.fields, { "client.phone": ["Enter a phone number"] });
		assert.equal(error.retryAfter, undefined);
	});

	test("an error without fields has empty fields", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "not_found");
		assert.deepEqual(error.fields, {});
	});

	test("reads Retry-After from a 429", async () => {
		const { fetch } = fakeFetch(() =>
			json(
				429,
				{ error: { code: "rate_limited", message: "Too many requests. Try again later." } },
				{ "retry-after": "42" },
			),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "rate_limited");
		assert.equal(error.retryAfter, 42);
	});

	test("a non-JSON error keeps its status with unknown_error", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<html>Bad gateway</html>", {
					status: 502,
					headers: { "content-type": "text/html" },
				}),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 502);
		assert.equal(error.code, "unknown_error");
	});

	test("a 200 without data is an invalid_response", async () => {
		const { fetch } = fakeFetch(() => json(200, { ok: true }));

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "invalid_response");
	});

	test("a network failure is a network_error with status 0 and its cause", async () => {
		const failure = new TypeError("fetch failed");
		const { fetch } = fakeFetch(() => {
			throw failure;
		});

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 0);
		assert.equal(error.code, "network_error");
		assert.equal(error.cause, failure);
	});

	test("a call that takes too long is a timeout", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		const error = await rejection(client(fetch, { timeoutMs: 20 }).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 0);
		assert.equal(error.code, "timeout");
	});

	test("a body that stops streaming is a timeout too", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(({ init }) => {
			const signal = init.signal as AbortSignal;
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"data":'));
					signal.addEventListener("abort", () => controller.error(signal.reason), {
						once: true,
					});
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const error = await rejection(client(fetch, { timeoutMs: 20 }).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "timeout");
	});

	test("a call the caller cancels rejects with the AbortError", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const call = client(fetch).studio.get({ signal: controller.signal });
		controller.abort();
		const error = await rejection(call);

		assert.ok(!(error instanceof TattooApiError));
		assert.equal((error as Error).name, "AbortError");
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: FAIL. "calls the tenant's /api/v1 URL without cookies" (credentials undefined), "reads Retry-After", "a network failure", both timeout tests and "the caller cancels" fail; the URL, envelope, non-JSON and invalid_response tests pass (existing behaviour).

- [ ] **Step 4: Write the implementation**

Replace `packages/sdk/src/errors.ts` with:

```ts
import type { ApiError } from "@tattoo-drip/types";

export interface TattooApiErrorOptions {
	/** Seconds from the response's `Retry-After` header. */
	retryAfter?: number;
	/** The underlying failure, for a network error. */
	cause?: unknown;
}

/**
 * A failed call to the Tattoo Drip API: a non-2xx response (`status` is the
 * HTTP status, `code` the API's machine-readable code), or no usable
 * response at all (`status` 0, with `timeout` or `network_error`).
 */
export class TattooApiError extends Error {
	readonly status: number;
	/** Stable machine-readable code, e.g. `not_found`, `validation_failed` or `timeout`. */
	readonly code: string;
	/** Field path → messages, set for `validation_failed`. */
	readonly fields: Record<string, string[]>;
	/** Seconds to wait before trying again, when the API said so (429). */
	readonly retryAfter: number | undefined;

	constructor(
		status: number,
		error?: Partial<ApiError>,
		options: TattooApiErrorOptions = {},
	) {
		super(error?.message ?? `Request failed with status ${status}`, {
			cause: options.cause,
		});
		this.name = "TattooApiError";
		this.status = status;
		this.code = error?.code ?? "unknown_error";
		this.fields = error?.fields ?? {};
		this.retryAfter = options.retryAfter;
	}
}

export function isTattooApiError(error: unknown): error is TattooApiError {
	return error instanceof TattooApiError;
}
```

Replace `packages/sdk/src/client.ts` with:

```ts
import type {
	ApiError,
	Artist,
	BodyPlacement,
	BookingReceipt,
	BookingRequestInput,
	ListAvailabilityQuery,
	ListPortfolioQuery,
	ListServicesQuery,
	PortfolioPage,
	Service,
	Slot,
	Studio,
	TattooStyle,
} from "@tattoo-drip/types";
import { TattooApiError } from "./errors.js";

const API_VERSION = "v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface TattooClientOptions {
	/** API origin, e.g. `https://api.example.com`. The SDK appends `/api/v1`. */
	baseUrl: string;
	/** Tenant slug, e.g. `blackneedle`. Every tenant request is scoped to it. */
	tenant: string;
	/**
	 * Secret server key. Server-side only: it identifies the caller for rate
	 * limiting and grants no extra data access. Rejected in browsers.
	 */
	key?: string;
	/** Custom fetch for tests, edge runtimes or request forwarding. */
	fetch?: typeof fetch;
	/**
	 * Milliseconds before a call gives up with a `timeout` TattooApiError.
	 * Defaults to 10 000.
	 */
	timeoutMs?: number;
}

/** Options for one call. */
export interface RequestOptions {
	/** Cancels the call; it then rejects with the signal's reason (an `AbortError`). */
	signal?: AbortSignal;
}

export interface CreateBookingInput extends BookingRequestInput {
	/** Up to 5 images (JPEG, PNG, WebP or HEIC, 10 MB each). */
	referenceImages?: Blob[];
	/** Bot-challenge token, required for browser submissions. */
	challengeToken?: string;
}

type Query = Record<string, string | number | undefined>;

type ResponseBody = { data?: unknown; error?: Partial<ApiError> };

export type TattooClient = ReturnType<typeof createTattooClient>;

export function createTattooClient(options: TattooClientOptions) {
	if (options.key && "document" in globalThis) {
		throw new Error(
			"@tattoo-drip/sdk: secret keys must never be used in a browser.",
		);
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const apiRoot = `${options.baseUrl.replace(/\/+$/, "")}/api/${API_VERSION}`;
	const tenantRoot = `${apiRoot}/tenants/${encodeURIComponent(options.tenant)}`;

	async function request<T>(
		url: string,
		init: RequestInit = {},
		{ signal }: RequestOptions = {},
	): Promise<T> {
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		if (options.key) headers.set("Authorization", `Bearer ${options.key}`);

		const timeout = AbortSignal.timeout(timeoutMs);
		let response: Response;
		let body: ResponseBody | undefined;
		try {
			response = await fetchImpl(url, {
				...init,
				headers,
				// The API is stateless and cookieless: never send cookies to it.
				credentials: "omit",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});
			body = await readJson(response);
		} catch (error) {
			// The caller cancelled: let its AbortError through (TanStack Query
			// expects it).
			if (signal?.aborted) throw signal.reason;
			if (timeout.aborted) {
				throw new TattooApiError(0, {
					code: "timeout",
					message: "The Tattoo Drip API did not answer in time.",
				});
			}
			throw new TattooApiError(
				0,
				{
					code: "network_error",
					message: "The Tattoo Drip API could not be reached.",
				},
				{ cause: error },
			);
		}

		if (!response.ok) {
			throw new TattooApiError(response.status, body?.error, {
				retryAfter: retryAfterOf(response),
			});
		}
		if (!body || !("data" in body)) {
			throw new TattooApiError(response.status, {
				code: "invalid_response",
				message: "The API returned an unexpected response body.",
			});
		}
		return body as T;
	}

	async function getData<T>(url: string, call?: RequestOptions): Promise<T> {
		return (await request<{ data: T }>(url, {}, call)).data;
	}

	return {
		/** Tenant slug this client is scoped to. */
		tenant: options.tenant,

		studio: {
			get: (call?: RequestOptions) => getData<Studio>(tenantRoot, call),
		},
		artists: {
			list: (call?: RequestOptions) =>
				getData<Artist[]>(`${tenantRoot}/artists`, call),
			get: (slug: string, call?: RequestOptions) =>
				getData<Artist>(
					`${tenantRoot}/artists/${encodeURIComponent(slug)}`,
					call,
				),
		},
		services: {
			list: (query?: ListServicesQuery, call?: RequestOptions) =>
				getData<Service[]>(withQuery(`${tenantRoot}/services`, query), call),
		},
		portfolio: {
			list: (query?: ListPortfolioQuery, call?: RequestOptions) =>
				request<PortfolioPage>(
					withQuery(`${tenantRoot}/portfolio`, query),
					{},
					call,
				),
		},
		availability: {
			list: (query: ListAvailabilityQuery, call?: RequestOptions) =>
				getData<Slot[]>(withQuery(`${tenantRoot}/availability`, query), call),
		},
		bookings: {
			create: async (input: CreateBookingInput) => {
				const { referenceImages = [], challengeToken, ...booking } = input;
				const form = new FormData();
				form.set("booking", JSON.stringify(booking));
				for (const image of referenceImages) {
					form.append("referenceImages", image);
				}
				if (challengeToken) form.set("challengeToken", challengeToken);

				const body = await request<{ data: BookingReceipt }>(
					`${tenantRoot}/bookings`,
					{ method: "POST", body: form },
				);
				return body.data;
			},
		},

		/** Platform-wide reference lists (not tenant-scoped). */
		styles: {
			list: (call?: RequestOptions) =>
				getData<TattooStyle[]>(`${apiRoot}/styles`, call),
		},
		placements: {
			list: (call?: RequestOptions) =>
				getData<BodyPlacement[]>(`${apiRoot}/placements`, call),
		},
	};
}

function withQuery(url: string, query?: Query): string {
	if (!query) return url;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) params.set(key, String(value));
	}
	const search = params.toString();
	return search ? `${url}?${search}` : url;
}

/**
 * The JSON body, or undefined when there is none or it isn't JSON. Reading
 * the body can still fail (a timeout or a dropped connection): that throws.
 */
async function readJson(response: Response): Promise<ResponseBody | undefined> {
	if (!response.headers.get("content-type")?.includes("json")) return undefined;
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** `Retry-After` in seconds, when the API sent it as a number. */
function retryAfterOf(response: Response): number | undefined {
	const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
```

Replace `packages/sdk/src/index.ts` with:

```ts
export type * from "@tattoo-drip/types";
export {
	type CreateBookingInput,
	createTattooClient,
	type RequestOptions,
	type TattooClient,
	type TattooClientOptions,
} from "./client.js";
export {
	isTattooApiError,
	TattooApiError,
	type TattooApiErrorOptions,
} from "./errors.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: PASS, 11 tests.

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk typecheck`
Expected: no errors (the source with `types: []`, the tests with `@types/node`).

- [ ] **Step 6: Commit the SDK**

```bash
git -C <repo> add packages/sdk pnpm-lock.yaml
git -C <repo> commit -m "feat(sdk): add timeouts, cancellation and cookieless requests

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Forward TanStack Query's signal**

In `packages/react/src/queries.ts`, replace the `tattooQueries` object with:

```ts
/**
 * Query options for each resource. Use them with `useQuery`, or with
 * `queryClient.ensureQueryData` in route loaders to prefetch during SSR.
 * Each forwards TanStack Query's `signal`, so a query nobody needs any more
 * cancels its request.
 */
export const tattooQueries = {
	studio: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.studio(client.tenant),
			queryFn: ({ signal }) => client.studio.get({ signal }),
		}),
	artists: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.artists(client.tenant),
			queryFn: ({ signal }) => client.artists.list({ signal }),
		}),
	artist: (client: TattooClient, slug: string) =>
		queryOptions({
			queryKey: tattooKeys.artist(client.tenant, slug),
			queryFn: ({ signal }) => client.artists.get(slug, { signal }),
		}),
	services: (client: TattooClient, query?: ListServicesQuery) =>
		queryOptions({
			queryKey: tattooKeys.services(client.tenant, query),
			queryFn: ({ signal }) => client.services.list(query, { signal }),
		}),
	portfolio: (client: TattooClient, query?: ListPortfolioQuery) =>
		queryOptions({
			queryKey: tattooKeys.portfolio(client.tenant, query),
			queryFn: ({ signal }) => client.portfolio.list(query, { signal }),
		}),
	availability: (client: TattooClient, query: ListAvailabilityQuery | null) =>
		queryOptions({
			queryKey: tattooKeys.availability(client.tenant, query),
			queryFn: query
				? ({ signal }) => client.availability.list(query, { signal })
				: skipToken,
			staleTime: 30_000,
		}),
	styles: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.styles(),
			queryFn: ({ signal }) => client.styles.list({ signal }),
			staleTime: Number.POSITIVE_INFINITY,
		}),
	placements: (client: TattooClient) =>
		queryOptions({
			queryKey: tattooKeys.placements(),
			queryFn: ({ signal }) => client.placements.list({ signal }),
			staleTime: Number.POSITIVE_INFINITY,
		}),
};
```

Run: `pnpm -C <repo> --filter @tattoo-drip/react typecheck`
Expected: no errors. (Hook tests are TAT-11.)

- [ ] **Step 8: Commit React**

```bash
git -C <repo> add packages/react/src/queries.ts
git -C <repo> commit -m "feat(react): forward TanStack Query's signal to the SDK

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Public API helpers and the error mapping

**Files:**
- Create: `apps/platform/app/services/public_api.ts`, `apps/platform/app/services/public_api_errors.ts`
- Test: `apps/platform/tests/unit/services/public_api.spec.ts`, `apps/platform/tests/unit/services/public_api_errors.spec.ts`

**Interfaces:**
- Produces, from `#services/public_api` (type imports only): `API_PREFIX = "/api"`; `READ_METHODS: ReadonlySet<string>` (GET, HEAD); `isApiRequest(ctx: HttpContext): boolean`; `setApiHeaders(response: HttpContext["response"]): void`; `type PublicCacheOptions = { maxAge?: number; staleWhileRevalidate?: number }`; `PUBLIC_CACHE = { maxAge: 60, staleWhileRevalidate: 600 }`; `publicCacheControl(options?: PublicCacheOptions): string`.
- Produces, from `#services/public_api_errors`: `type ApiErrorCode`; `API_ERRORS: Record<ApiErrorCode, { status; code; message }>`; `class ApiException extends Error` with `constructor(status: number, code: string, message: string, fields?: Record<string, string[]>)` and `static notFound(): ApiException`; `apiErrorFor(error: unknown, allow?: string[]): { status: number; body: { error: { code; message; fields? } }; headers: Record<string, string> }`; `renderApiError(error: unknown, ctx: HttpContext): void`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/services/public_api.spec.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import { test } from "@japa/runner";
import { isApiRequest, publicCacheControl } from "#services/public_api";

/** Just what isApiRequest reads: the URL, and the matched route if any. */
function ctxFor(url: string, pattern?: string) {
	return {
		request: { url: () => url },
		route: pattern ? { pattern } : undefined,
	} as unknown as HttpContext;
}

test.group("isApiRequest", () => {
	test("a URL under /api is the API until a route matched", ({ assert }) => {
		assert.isTrue(isApiRequest(ctxFor("/api")));
		assert.isTrue(isApiRequest(ctxFor("/api/v1/nope")));
		assert.isTrue(isApiRequest(ctxFor("/api/v1/tenants/x", "/api/v1/tenants/:tenant")));
	});

	test("URLs that only look like the API are not", ({ assert }) => {
		for (const url of ["/apiary", "/API/v1", "/t/api", "/", "/login"]) {
			assert.isFalse(isApiRequest(ctxFor(url)), url);
		}
	});

	test("once a route matched, its pattern decides, not the URL", ({ assert }) => {
		assert.isFalse(isApiRequest(ctxFor("/api/../t/api-needle-32", "/t/:tenant")));
	});
});

test.group("publicCacheControl", () => {
	test("defaults to a minute fresh and ten minutes stale-while-revalidate", ({ assert }) => {
		assert.equal(publicCacheControl(), "public, max-age=60, stale-while-revalidate=600");
	});

	test("takes other seconds", ({ assert }) => {
		assert.equal(
			publicCacheControl({ maxAge: 15, staleWhileRevalidate: 30 }),
			"public, max-age=15, stale-while-revalidate=30",
		);
	});
});
```

Create `apps/platform/tests/unit/services/public_api_errors.spec.ts`:

```ts
import { Exception } from "@adonisjs/core/exceptions";
import { errors as httpErrors } from "@adonisjs/core/http";
import { errors as limiterErrors, LimiterResponse } from "@adonisjs/limiter";
import { test } from "@japa/runner";
import { errors as vineErrors } from "@vinejs/vine";
import { ApiException, apiErrorFor } from "#services/public_api_errors";

const SECRET = "connection refused at 10.0.0.5:5432 for tattoo_drip_app";

const shared = (status: number, code: string, message: string) => ({
	status,
	body: { error: { code, message } },
	headers: {},
});

test.group("apiErrorFor", () => {
	test("a VineJS error is validation_failed with its messages by field", ({ assert }) => {
		const error = new vineErrors.E_VALIDATION_ERROR([
			{ field: "client.phone", message: "Enter a phone number", rule: "required" },
			{ field: "client.phone", message: "Use the +977 format", rule: "regex" },
			{ field: "referenceImages.0", message: "Use a JPEG, PNG or WebP image", rule: "file" },
		]);

		assert.deepEqual(apiErrorFor(error), {
			status: 422,
			body: {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: {
						"client.phone": ["Enter a phone number", "Use the +977 format"],
						"referenceImages.0": ["Use a JPEG, PNG or WebP image"],
					},
				},
			},
			headers: {},
		});
	});

	test("an ApiException keeps its status, code, message and fields", ({ assert }) => {
		const error = new ApiException(409, "too_many_open_inquiries", "This studio already has your request.", {
			"client.phone": ["Already open"],
		});

		assert.deepEqual(apiErrorFor(error), {
			status: 409,
			body: {
				error: {
					code: "too_many_open_inquiries",
					message: "This studio already has your request.",
					fields: { "client.phone": ["Already open"] },
				},
			},
			headers: {},
		});
	});

	test("ApiException.notFound is a 404 even when other methods match", ({ assert }) => {
		assert.deepEqual(apiErrorFor(ApiException.notFound(), ["GET", "HEAD"]), shared(404, "not_found", "Not found."));
	});

	test("a route miss is not_found, or method_not_allowed with Allow when another method matches", ({ assert }) => {
		const miss = new httpErrors.E_ROUTE_NOT_FOUND(["PUT", "/api/v1/x"]);

		assert.deepEqual(apiErrorFor(miss), shared(404, "not_found", "Not found."));
		assert.deepEqual(apiErrorFor(miss, ["GET", "HEAD"]), {
			...shared(405, "method_not_allowed", "This method is not allowed here."),
			headers: { Allow: "GET, HEAD" },
		});
	});

	test("framework errors map by status, with the shared message", ({ assert }) => {
		const cases: [unknown, number, string, string][] = [
			[Object.assign(new SyntaxError(`Unexpected token in ${SECRET}`), { status: 400 }), 400, "bad_request", "The request could not be read."],
			[new Exception(SECRET, { status: 404, code: "E_ROW_NOT_FOUND" }), 404, "not_found", "Not found."],
			[new Exception(SECRET, { status: 413, code: "E_REQUEST_ENTITY_TOO_LARGE" }), 413, "payload_too_large", "The request is too large."],
			[new Exception(SECRET, { status: 415, code: "E_ENCODING_UNSUPPORTED" }), 415, "unsupported_media_type", "This content type or encoding is not supported."],
		];

		for (const [error, status, code, message] of cases) {
			assert.deepEqual(apiErrorFor(error), shared(status, code, message), code);
		}
	});

	test("a 422 that is not a VineJS error is a 400 bad_request", ({ assert }) => {
		const strictJson = new Exception("Invalid JSON, only supports object and array", { status: 422 });

		assert.deepEqual(apiErrorFor(strictJson), shared(400, "bad_request", "The request could not be read."));
	});

	test("another 4xx keeps its status with bad_request", ({ assert }) => {
		assert.deepEqual(
			apiErrorFor(new Exception(SECRET, { status: 409 })),
			shared(409, "bad_request", "The request could not be read."),
		);
	});

	test("a rate limit is rate_limited with Retry-After and the limiter's headers", ({ assert }) => {
		const error = new limiterErrors.E_TOO_MANY_REQUESTS(
			new LimiterResponse({ limit: 10, remaining: 0, consumed: 11, availableIn: 42 }),
		);

		const { status, body, headers } = apiErrorFor(error);

		assert.equal(status, 429);
		assert.deepEqual(body, { error: { code: "rate_limited", message: "Too many requests. Try again later." } });
		assert.equal(headers["Retry-After"], "42");
		assert.equal(headers["X-RateLimit-Limit"], "10");
		assert.equal(headers["X-RateLimit-Remaining"], "0");
		assert.isString(headers["X-RateLimit-Reset"]);
	});

	test("anything else is internal_error and never shows its message", ({ assert }) => {
		for (const error of [new Error(SECRET), new Exception(SECRET, { status: 503 }), SECRET, null, undefined]) {
			const result = apiErrorFor(error);
			assert.deepEqual(result, shared(500, "internal_error", "Something went wrong. Try again later."));
			assert.notInclude(JSON.stringify(result), "10.0.0.5");
		}
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test unit --files=public_api.spec.ts --files=public_api_errors.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#services/public_api` in the log.

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/services/public_api.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";

/**
 * The public API (TAT-32). Everything under this prefix is stateless and
 * cookieless (the session, CSRF, auth and Inertia middleware skip it), has
 * CORS open without credentials, and answers with the { data } / { error }
 * envelopes. Type imports only: config/cors.ts loads this file at boot.
 */
export const API_PREFIX = "/api";

/** Methods that only read, so an old slug may serve them (TAT-24). */
export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * True for a public API request: the matched route's pattern, or before
 * routing (and for a URL no route matches) the URL path, is /api or below
 * it. Once a route matched, its pattern decides, so no URL can strip the
 * session from a dashboard route.
 */
export function isApiRequest(ctx: HttpContext): boolean {
	const path = ctx.route?.pattern ?? ctx.request.url();
	return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/** Headers every API response carries, errors included. */
export function setApiHeaders(response: HttpContext["response"]) {
	// Nothing is cacheable unless its route opts in (the publicCache middleware).
	response.header("Cache-Control", "no-store");
	// Also without an Origin header, so a CDN copy fetched server-side works in
	// a browser; the value never varies, so no Vary: Origin.
	response.header("Access-Control-Allow-Origin", "*");
	// Shield, which sets this on pages, does not run on the API.
	response.header("X-Content-Type-Options", "nosniff");
}

export type PublicCacheOptions = {
	maxAge?: number;
	staleWhileRevalidate?: number;
};

/**
 * Seconds for a cacheable public read: an owner's edit shows within a
 * minute, and a quiet studio page stays fast while one request refreshes it.
 */
export const PUBLIC_CACHE = { maxAge: 60, staleWhileRevalidate: 600 } as const;

/** The Cache-Control value of a cacheable public read. */
export function publicCacheControl({
	maxAge = PUBLIC_CACHE.maxAge,
	staleWhileRevalidate = PUBLIC_CACHE.staleWhileRevalidate,
}: PublicCacheOptions = {}) {
	return `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}
```

Create `apps/platform/app/services/public_api_errors.ts`:

```ts
import { errors as httpErrors, type HttpContext } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { errors as limiterErrors } from "@adonisjs/limiter";
import { errors as vineErrors } from "@vinejs/vine";
import { setApiHeaders } from "#services/public_api";

/** The codes every public endpoint shares (openapi.yaml, ErrorResponse). */
export type ApiErrorCode =
	| "bad_request"
	| "not_found"
	| "method_not_allowed"
	| "payload_too_large"
	| "unsupported_media_type"
	| "validation_failed"
	| "rate_limited"
	| "internal_error";

type ErrorKind = { status: number; code: string; message: string };

/** Each shared code with its status and its one message for people. */
export const API_ERRORS: Record<ApiErrorCode, ErrorKind> = {
	bad_request: { status: 400, code: "bad_request", message: "The request could not be read." },
	not_found: { status: 404, code: "not_found", message: "Not found." },
	method_not_allowed: { status: 405, code: "method_not_allowed", message: "This method is not allowed here." },
	payload_too_large: { status: 413, code: "payload_too_large", message: "The request is too large." },
	unsupported_media_type: { status: 415, code: "unsupported_media_type", message: "This content type or encoding is not supported." },
	validation_failed: { status: 422, code: "validation_failed", message: "Some fields are invalid." },
	rate_limited: { status: 429, code: "rate_limited", message: "Too many requests. Try again later." },
	internal_error: { status: 500, code: "internal_error", message: "Something went wrong. Try again later." },
};

/**
 * Shared codes for framework errors that carry a 4xx status. 422 is not
 * here: only a VineJS error is validation_failed.
 */
const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
	400: "bad_request",
	404: "not_found",
	405: "method_not_allowed",
	413: "payload_too_large",
	415: "unsupported_media_type",
	429: "rate_limited",
};

/**
 * An error a public endpoint answers with on purpose: a shared code, or the
 * endpoint's own (such as `too_many_open_inquiries`, listed in
 * openapi.yaml). Its message is shown to people: keep it plain and safe.
 */
export class ApiException extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly fields?: Record<string, string[]>,
	) {
		super(message);
		this.name = "ApiException";
	}

	/** The 404 of an unknown tenant or record: one answer for every reason. */
	static notFound() {
		return new ApiException(404, "not_found", API_ERRORS.not_found.message);
	}
}

export type ApiErrorBody = {
	error: { code: string; message: string; fields?: Record<string, string[]> };
};

export type ApiErrorResponse = {
	status: number;
	body: ApiErrorBody;
	headers: Record<string, string>;
};

/**
 * The response for an error on a public endpoint. `allow` lists the methods
 * the URL accepts when the router found no route for the request's method
 * (a 405); leave it empty otherwise. Never includes an error's own message,
 * stack or details, in any environment.
 */
export function apiErrorFor(error: unknown, allow: string[] = []): ApiErrorResponse {
	if (error instanceof ApiException) return respond(error, error.fields);
	if (error instanceof vineErrors.E_VALIDATION_ERROR) {
		return respond(API_ERRORS.validation_failed, fieldsOf(error.messages));
	}
	if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
		const headers = error.headers ?? error.getDefaultHeaders();
		return respond(API_ERRORS.rate_limited, undefined, stringValues(headers));
	}
	if (error instanceof httpErrors.E_ROUTE_NOT_FOUND && allow.length > 0) {
		return respond(API_ERRORS.method_not_allowed, undefined, { Allow: allow.join(", ") });
	}
	const status = statusOf(error);
	if (status !== undefined && status >= 400 && status < 500) {
		const code = CODE_BY_STATUS[status];
		if (code) return respond(API_ERRORS[code]);
		// A 422 that isn't a VineJS error is a body the parser refused (strict
		// JSON: a bare string or number). Any other 4xx keeps its status.
		return respond({ ...API_ERRORS.bad_request, status: status === 422 ? 400 : status });
	}
	return respond(API_ERRORS.internal_error);
}

/**
 * Answers a failed public API request with the error envelope; the
 * exception handler calls it for every /api request. A URL the router has
 * no route for under this method, but has one under another, is a 405.
 */
export function renderApiError(error: unknown, ctx: HttpContext) {
	const allow = isRouteMiss(error, ctx) ? allowedMethods(ctx.request.url()) : [];
	const { status, body, headers } = apiErrorFor(error, allow);
	setApiHeaders(ctx.response);
	for (const [name, value] of Object.entries(headers)) {
		ctx.response.header(name, value);
	}
	ctx.response.status(status).json(body);
}

function respond(
	kind: ErrorKind,
	fields?: Record<string, string[]>,
	headers: Record<string, string> = {},
): ApiErrorResponse {
	return {
		status: kind.status,
		body: { error: { code: kind.code, message: kind.message, ...(fields ? { fields } : {}) } },
		headers,
	};
}

/** VineJS messages grouped by field path. */
function fieldsOf(messages: { field: string; message: string }[]) {
	const fields: Record<string, string[]> = {};
	for (const { field, message } of messages) {
		fields[field] = [...(fields[field] ?? []), message];
	}
	return fields;
}

function stringValues(headers: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [name, String(value)]),
	);
}

function statusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}
	return typeof error.status === "number" ? error.status : undefined;
}

/**
 * The router found no route at all. A 404 thrown inside a matched route
 * (an unknown tenant) has ctx.route set and stays a 404.
 */
function isRouteMiss(error: unknown, ctx: HttpContext) {
	return error instanceof httpErrors.E_ROUTE_NOT_FOUND && !ctx.route;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** The methods some route accepts for this URL, HEAD along with GET. */
function allowedMethods(url: string): string[] {
	const allowed = METHODS.filter((method) => router.match(url, method, false) !== null);
	return allowed.includes("GET")
		? ["GET", "HEAD", ...allowed.filter((method) => method !== "GET")]
		: allowed;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=public_api.spec.ts --files=public_api_errors.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors. (If `error.messages` is typed in a way `fieldsOf` doesn't accept, keep the signature and cast at the call: `error.messages as { field: string; message: string }[]`.)

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/services/public_api.ts apps/platform/app/services/public_api_errors.ts apps/platform/tests/unit/services/public_api.spec.ts apps/platform/tests/unit/services/public_api_errors.spec.ts
git -C <repo> commit -m "feat(platform): add the public API's error codes and envelope mapping

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The exception handler answers /api with the envelope

**Files:**
- Modify: `apps/platform/app/exceptions/handler.ts`
- Create: `apps/platform/tests/helpers/api.ts`
- Test: `apps/platform/tests/functional/api/errors.spec.ts` (create)

**Interfaces:**
- Consumes: `isApiRequest` (`#services/public_api`), `apiErrorFor`, `renderApiError` (`#services/public_api_errors`) from Task 3.
- Produces: from `#tests/helpers/api`: `assertApiData(response, data, status = 200)`, `assertApiError(response, status, code)`, `assertApiHeaders(response)`, `assertNoCookies(response)`.

- [ ] **Step 1: Write the helpers and the failing test**

Create `apps/platform/tests/helpers/api.ts`:

```ts
import type { ApiResponse } from "@japa/api-client";

/**
 * Assertions for public API responses (TAT-32). TAT-47 validates the bodies
 * against openapi.yaml here, so every API test gets the contract check.
 */

/** `{ data }` and nothing else, with the status. */
export function assertApiData(response: ApiResponse, data: unknown, status = 200) {
	response.assertStatus(status);
	assertOf(response).deepEqual(response.body(), { data });
}

/**
 * The error envelope with this code and nothing else, `no-store`, and the
 * headers every API response has.
 */
export function assertApiError(response: ApiResponse, status: number, code: string) {
	const assert = assertOf(response);
	response.assertStatus(status);
	const body = response.body();
	assert.sameMembers(Object.keys(body), ["error"], "an error body has only `error`");
	assert.equal(body.error.code, code);
	assert.isString(body.error.message);
	assert.sameMembers(
		Object.keys(body.error),
		body.error.fields ? ["code", "message", "fields"] : ["code", "message"],
	);
	assert.equal(response.header("cache-control"), "no-store");
	assertApiHeaders(response);
}

/** Headers every API response has, and the cookie it never has. */
export function assertApiHeaders(response: ApiResponse) {
	const assert = assertOf(response);
	assert.equal(response.header("access-control-allow-origin"), "*");
	assert.isUndefined(response.header("access-control-allow-credentials"));
	assert.equal(response.header("x-content-type-options"), "nosniff");
	assertNoCookies(response);
}

export function assertNoCookies(response: ApiResponse) {
	assertOf(response).notProperty(response.headers(), "set-cookie");
}

function assertOf(response: ApiResponse) {
	if (!response.assert) {
		throw new Error("the API assertions need the @japa/assert plugin");
	}
	return response.assert;
}
```

Create `apps/platform/tests/functional/api/errors.spec.ts`:

```ts
import { test } from "@japa/runner";
import { assertApiError } from "#tests/helpers/api";

test.group("Public API: errors", () => {
	test("an unknown API path is not_found in the envelope", async ({ client, assert }) => {
		for (const url of ["/api", "/api/v1", "/api/v1/nope", "/api/v2/tenants/api-needle-32"]) {
			const response = await client.get(url);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), { error: { code: "not_found", message: "Not found." } }, url);
		}
	});

	test("a dashboard URL still gets the dashboard's 404, not the envelope", async ({ client, assert }) => {
		const response = await client.get("/no-such-page");

		response.assertStatus(404);
		assert.isUndefined(response.header("access-control-allow-origin"));
		assert.notDeepInclude(response.body() ?? {}, { error: { code: "not_found", message: "Not found." } });
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=errors.spec.ts`
Expected: "an unknown API path" FAILS (Adonis's default 404, no envelope or API headers); the dashboard test passes.

- [ ] **Step 3: Route API errors to the envelope**

In `apps/platform/app/exceptions/handler.ts`, add the imports:

```ts
import { isApiRequest } from "#services/public_api";
import { apiErrorFor, renderApiError } from "#services/public_api_errors";
```

and replace `handle` and `report` with:

```ts
	async handle(error: unknown, ctx: HttpContext) {
		// Any exception rolls the request back before anything renders, so
		// earlier writes never commit after a failure, and the error page
		// runs with no ambient transaction.
		await abortRequestTransaction();
		// The public API answers every error with its JSON envelope, never a
		// page, a redirect or a stack (TAT-32).
		if (isApiRequest(ctx)) return renderApiError(error, ctx);
		if (isPathTraversal(error)) {
			return super.handle(
				new errors.E_ROUTE_NOT_FOUND([ctx.request.method(), ctx.request.url()]),
				ctx,
			);
		}
		if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS && wantsPage(ctx)) {
			return backWithThrottleMessage(error, ctx);
		}
		return super.handle(error, ctx);
	}

	/**
	 * The method is used to report error to the logging service or
	 * the a third party error monitoring service.
	 *
	 * @note You should not attempt to send a response from this method.
	 */
	async report(error: unknown, ctx: HttpContext) {
		if (isPathTraversal(error)) return;
		// A client's mistake on the public API (an unknown slug, a bad body) is
		// not logged: slug probing would flood the log. Server errors are.
		if (isApiRequest(ctx) && apiErrorFor(error).status < 500) return;
		return super.report(error, ctx);
	}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=errors.spec.ts --files=tenant_routes.spec.ts --files=rate_limits.spec.ts`
Expected: PASS (the dashboard's 404s and TAT-8's 429 handling are unchanged).

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/app/exceptions/handler.ts apps/platform/tests/helpers/api.ts apps/platform/tests/functional/api/errors.spec.ts
git -C <repo> commit -m "feat(platform): answer public API errors with the error envelope

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A stateless, cookieless /api

**Files:**
- Create: `apps/platform/app/middleware/public_api_middleware.ts`, `apps/platform/app/middleware/web_session_middleware.ts`, `apps/platform/app/middleware/web_shield_middleware.ts`
- Modify: `apps/platform/app/middleware/silent_auth_middleware.ts`, `apps/platform/app/middleware/inertia_middleware.ts`, `apps/platform/start/kernel.ts`, `apps/platform/tests/support/test_routes.ts`
- Test: `apps/platform/tests/functional/api/stateless.spec.ts` (create), `apps/platform/tests/functional/api/errors.spec.ts` (append)

**Interfaces:**
- Consumes: `isApiRequest`, `setApiHeaders` (Task 3); the Task 4 helpers.
- Produces: named middleware `middleware.publicApi()`; test-only routes `GET /api/v1/__test/ok` (`{ data: { ok: true } }`), `POST /api/v1/__test/echo` (validates `{ label: string, 1 to 20 }`, answers `{ data: { label } }`), `GET /api/v1/__test/throws` (throws an `Error` whose message contains `10.0.0.5`), `GET /api/v1/__test/throttled` (throws a limiter error with `availableIn` 42); `echoValidator` in `tests/support/test_routes.ts` (Task 8 reuses it).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/api/stateless.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { assertApiData, assertApiHeaders, assertNoCookies } from "#tests/helpers/api";

const signedIn = () => User.create({ email: "owner@example.com", password: "secret-password" });

test.group("Public API: stateless and cookieless", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers with { data }, the API headers and no cookie, even with a dashboard session", async ({ client }) => {
		const response = await client.get("/api/v1/__test/ok").loginAs(await signedIn());

		assertApiData(response, { ok: true });
		assertApiHeaders(response);
		response.assertHeader("cache-control", "no-store");
	});

	test("a POST needs no CSRF token and sets no cookie", async ({ client }) => {
		const response = await client.post("/api/v1/__test/echo").json({ label: "Hello" }).loginAs(await signedIn());

		assertApiData(response, { label: "Hello" });
		assertApiHeaders(response);
	});

	test("HEAD answers without a body or a cookie", async ({ client }) => {
		const response = await client.head("/api/v1/__test/ok");

		response.assertStatus(200);
		assertNoCookies(response);
	});

	test("an Inertia header on an API request changes nothing", async ({ client }) => {
		const response = await client
			.get("/api/v1/__test/ok")
			.header("x-inertia", "true")
			.header("x-inertia-version", "stale");

		assertApiData(response, { ok: true });
		assertApiHeaders(response);
	});

	test("the dashboard still gets its session and CSRF cookies", async ({ client, assert }) => {
		const response = await client.get("/login");

		response.assertStatus(200);
		const cookies = String(response.headers()["set-cookie"]);
		assert.include(cookies, "adonis-session=");
		assert.include(cookies, "XSRF-TOKEN=");
	});
});
```

Append to `apps/platform/tests/functional/api/errors.spec.ts` (and add `import testUtils from "@adonisjs/core/services/test_utils";` and `import User from "#models/user";` at the top):

```ts
test.group("Public API: each error class over HTTP", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("invalid fields are validation_failed with fields", async ({ client, assert }) => {
		const user = await User.create({ email: "owner@example.com", password: "secret-password" });
		const response = await client.post("/api/v1/__test/echo").json({ label: "" }).loginAs(user);

		assertApiError(response, 422, "validation_failed");
		assert.properties(response.body().error.fields, ["label"]);
	});

	test("a body that isn't JSON, or a JSON string, is bad_request", async ({ client }) => {
		assertApiError(await client.post("/api/v1/__test/echo").unsafeJson('{"label":'), 400, "bad_request");
		assertApiError(await client.post("/api/v1/__test/echo").unsafeJson('"just a string"'), 400, "bad_request");
	});

	test("a body over the limit is payload_too_large", async ({ client }) => {
		const response = await client.post("/api/v1/__test/echo").json({ label: "x".repeat(1_100_000) });

		assertApiError(response, 413, "payload_too_large");
	});

	test("another method on a known path is method_not_allowed with Allow", async ({ client }) => {
		const put = await client.put("/api/v1/__test/ok");
		assertApiError(put, 405, "method_not_allowed");
		put.assertHeader("allow", "GET, HEAD");

		const remove = await client.delete("/api/v1/__test/echo");
		assertApiError(remove, 405, "method_not_allowed");
		remove.assertHeader("allow", "POST");
	});

	test("a rate limit is rate_limited with Retry-After", async ({ client }) => {
		const response = await client.get("/api/v1/__test/throttled");

		assertApiError(response, 429, "rate_limited");
		response.assertHeader("retry-after", "42");
	});

	test("a server error is internal_error with no message, stack or detail", async ({ client, assert }) => {
		const user = await User.create({ email: "owner@example.com", password: "secret-password" });
		const response = await client.get("/api/v1/__test/throws").loginAs(user);

		assertApiError(response, 500, "internal_error");
		assert.deepEqual(response.body(), {
			error: { code: "internal_error", message: "Something went wrong. Try again later." },
		});
		assert.notInclude(response.text(), "10.0.0.5");
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=stateless.spec.ts --files=errors.spec.ts`
Expected: FAIL: every `/api/v1/__test/*` request is a 404 (no such route yet); "the dashboard still gets its cookies" and the Task 4 tests pass.

- [ ] **Step 3: Write the middleware**

Create `apps/platform/app/middleware/public_api_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { setApiHeaders } from "#services/public_api";

/**
 * The first middleware of every /api route (TAT-32; a test checks). The
 * session, CSRF, auth and Inertia middleware already skipped the request
 * (isApiRequest); this sets the headers every API response has, including
 * Cache-Control: no-store, which only the publicCache middleware lifts.
 * TAT-38 adds its rate limits right after it.
 */
export default class PublicApiMiddleware {
	handle(ctx: HttpContext, next: NextFn) {
		setApiHeaders(ctx.response);
		return next();
	}
}
```

Create `apps/platform/app/middleware/web_session_middleware.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionMiddleware from "@adonisjs/session/session_middleware";
import { isApiRequest } from "#services/public_api";

/**
 * The session for every route but the public API, which is cookieless
 * (TAT-32): the session middleware sets its cookie on every request it
 * runs. In router.use in place of the package's middleware.
 */
@inject()
export default class WebSessionMiddleware {
	constructor(private session: SessionMiddleware) {}

	handle(ctx: HttpContext, next: NextFn) {
		return isApiRequest(ctx) ? next() : this.session.handle(ctx, next);
	}
}
```

Create `apps/platform/app/middleware/web_shield_middleware.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ShieldMiddleware from "@adonisjs/shield/shield_middleware";
import { isApiRequest } from "#services/public_api";

/**
 * Shield (CSRF and security headers) for every route but the public API
 * (TAT-32). Its CSRF guard reads the session and sets the XSRF-TOKEN cookie
 * on every request, even for `exceptRoutes`, so the API skips it whole; the
 * API sets nosniff itself (setApiHeaders) and needs no CSRF token because
 * it has no cookies to forge with. In router.use in place of the package's
 * middleware.
 */
@inject()
export default class WebShieldMiddleware {
	constructor(private shield: ShieldMiddleware) {}

	handle(ctx: HttpContext, next: NextFn) {
		return isApiRequest(ctx) ? next() : this.shield.handle(ctx, next);
	}
}
```

If the container can't build either wrapper ("Cannot inject" at boot), resolve the package middleware per request instead: `const session = await ctx.containerResolver.make(SessionMiddleware)` inside `handle`, and drop the constructor.

In `apps/platform/app/middleware/silent_auth_middleware.ts`, add `import { isApiRequest } from "#services/public_api";` and make `handle`:

```ts
	async handle(ctx: HttpContext, next: NextFn) {
		// The public API has no session to check (TAT-32).
		if (isApiRequest(ctx)) return next();
		await ctx.auth.check();

		return next();
	}
```

In `apps/platform/app/middleware/inertia_middleware.ts`, add `import { isApiRequest } from "#services/public_api";` and make the start of `handle`:

```ts
	async handle(ctx: HttpContext, next: NextFn) {
		// The public API renders no pages, and must not get Inertia's 409 or
		// headers (TAT-32).
		if (isApiRequest(ctx)) return next();
		await this.init(ctx);
```

(the rest of `handle` is unchanged).

In `apps/platform/start/kernel.ts`, replace the `router.use([...])` list with:

```ts
router.use([
	() => import("@adonisjs/core/bodyparser_middleware"),
	// The session and shield (CSRF) skip the public API, which is stateless
	// and cookieless (TAT-32).
	() => import("#middleware/web_session_middleware"),
	() => import("#middleware/web_shield_middleware"),
	() => import("@adonisjs/auth/initialize_auth_middleware"),
	() => import("#middleware/silent_auth_middleware"),
]);
```

and add to the `router.named({...})` object:

```ts
	publicApi: () => import("#middleware/public_api_middleware"),
```

- [ ] **Step 4: Add the test-only API routes**

In `apps/platform/tests/support/test_routes.ts`, add the imports `import { errors as limiterErrors, LimiterResponse } from "@adonisjs/limiter";` and change `import { errors } from "@vinejs/vine";` to `import vine, { errors } from "@vinejs/vine";`, then append:

```ts
/**
 * Public API routes for the API tests (TAT-32), outside any tenant: they
 * exercise the stateless stack and the error envelope before a real
 * endpoint needs them. Each answers with { data } or throws one kind of
 * error.
 */
export const echoValidator = vine.create({
	label: vine.string().trim().minLength(1).maxLength(20),
});

router
	.group(() => {
		router.get("ok", () => ({ data: { ok: true } }));
		router.post("echo", async ({ request }) => ({
			data: await request.validateUsing(echoValidator),
		}));
		router.get("throws", () => {
			throw new Error("connection refused at 10.0.0.5:5432 for tattoo_drip_app");
		});
		router.get("throttled", () => {
			throw new limiterErrors.E_TOO_MANY_REQUESTS(
				new LimiterResponse({ limit: 10, remaining: 0, consumed: 11, availableIn: 42 }),
			);
		});
	})
	.prefix("/api/v1/__test")
	.use(middleware.publicApi());
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=stateless.spec.ts --files=errors.spec.ts --files=tenant_routes.spec.ts --files=harness.spec.ts --files=rate_limits.spec.ts`
Expected: PASS. The dashboard suites still pass: sessions, CSRF and the throttle toast are unchanged off `/api`.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/middleware apps/platform/start/kernel.ts apps/platform/tests/support/test_routes.ts apps/platform/tests/functional/api
git -C <repo> commit -m "feat(platform): keep the public API stateless and cookieless

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CORS for the public API only

**Files:**
- Modify: `apps/platform/config/cors.ts`
- Test: `apps/platform/tests/functional/api/cors.spec.ts` (create)

**Interfaces:**
- Consumes: `isApiRequest` (Task 3); the Task 5 test routes; `assertApiError`, `assertNoCookies` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/api/cors.spec.ts`:

```ts
import { test } from "@japa/runner";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";

const ORIGIN = "https://api-needle-32.tattoodrip.com";

test.group("Public API: CORS", () => {
	test("a read from any origin is allowed, without credentials", async ({ client, assert }) => {
		const response = await client.get("/api/v1/__test/ok").header("origin", ORIGIN);

		response.assertStatus(200);
		response.assertHeader("access-control-allow-origin", "*");
		assert.isUndefined(response.header("access-control-allow-credentials"));
	});

	test("an error is readable cross-origin, and a 429 exposes Retry-After", async ({ client }) => {
		const response = await client.get("/api/v1/__test/throttled").header("origin", ORIGIN);

		assertApiError(response, 429, "rate_limited");
		response.assertHeader("access-control-expose-headers", "retry-after");
	});

	test("a JSON write's preflight is allowed for 10 minutes, without credentials", async ({ client, assert }) => {
		const response = await client
			.options("/api/v1/__test/echo")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST")
			.header("access-control-request-headers", "content-type");

		response.assertStatus(204);
		response.assertHeader("access-control-allow-origin", "*");
		response.assertHeader("access-control-allow-methods", "GET,HEAD,POST");
		response.assertHeader("access-control-allow-headers", "accept,content-type");
		response.assertHeader("access-control-max-age", "600");
		assert.isUndefined(response.header("access-control-allow-credentials"));
		assertNoCookies(response);
	});

	test("a preflight for another method or for Authorization is refused", async ({ client, assert }) => {
		for (const [method, headers] of [
			["PUT", "content-type"],
			["POST", "authorization"],
		]) {
			const response = await client
				.options("/api/v1/__test/echo")
				.header("origin", ORIGIN)
				.header("access-control-request-method", method)
				.header("access-control-request-headers", headers);

			response.assertStatus(204);
			assert.isUndefined(response.header("access-control-allow-origin"), `${method} ${headers}`);
		}
	});

	test("the dashboard answers no cross-origin request", async ({ client, assert }) => {
		const page = await client.get("/login").header("origin", ORIGIN);
		assert.isUndefined(page.header("access-control-allow-origin"));

		const preflight = await client
			.options("/login")
			.header("origin", ORIGIN)
			.header("access-control-request-method", "POST");
		assert.isUndefined(preflight.header("access-control-allow-origin"));
		assert.isUndefined(preflight.header("access-control-allow-credentials"));
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=cors.spec.ts`
Expected: FAIL: the preflight test (no headers: the test environment allows no origin today) and the Retry-After exposure. The read test already passes (`publicApi` sends `*`), and so do the refusals and the dashboard test.

- [ ] **Step 3: Configure CORS**

Replace `apps/platform/config/cors.ts` with:

```ts
import { defineConfig } from "@adonisjs/cors";
import { isApiRequest } from "#services/public_api";

/**
 * CORS for the public API only (TAT-32): any origin, never credentials, the
 * methods and request headers the SDK sends. The dashboard is same-origin
 * and answers no cross-origin request. The publicApi middleware also sends
 * Access-Control-Allow-Origin: * without an Origin header, for CDN copies.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
	enabled: (ctx) => isApiRequest(ctx),

	origin: "*",

	methods: ["GET", "HEAD", "POST"],

	/**
	 * JSON writes preflight for Content-Type. Authorization (the server key,
	 * TAT-38) is server-side only, so browsers may not send it.
	 */
	headers: ["accept", "content-type"],

	/** So the studio page can say when to try again after a 429. */
	exposeHeaders: ["retry-after"],

	credentials: false,

	/** Only JSON writes preflight; a CORS fix reaches browsers in 10 minutes. */
	maxAge: 600,
});

export default corsConfig;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=cors.spec.ts --files=stateless.spec.ts --files=errors.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/config/cors.ts apps/platform/tests/functional/api/cors.spec.ts
git -C <repo> commit -m "feat(platform): open CORS on the public API without credentials

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7 (needs TAT-24): The `tenant_for_slug()` lookup

**Files:**
- Create: `apps/platform/database/migrations/1791640000000_create_tenant_for_slug_function.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts`
- Test: `apps/platform/tests/functional/tenancy/tenant_for_slug.spec.ts` (create)

**Interfaces:**
- Consumes: TAT-24's `tenant_slugs` table and `TenancyService.changeSlug`.
- Produces: `public.tenant_for_slug(requested_slug text) returns uuid` (null for no live match), executable by the app role only. `DEFINER_FUNCTIONS` entries become `{ args, reason }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/tenancy/tenant_for_slug.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const tenancy = new TenancyService();

/**
 * What the function answers for `slug`, as the app role with no context.
 * It sees every tenant's committed rows (the dev database's too), so the
 * "unknown" slugs below are ones no dev studio has.
 */
async function lookup(slug: string | null) {
	const { rows } = await sql({}, "select public.tenant_for_slug(?) as id", [slug]);
	return rows[0].id as string | null;
}

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("tenant_for_slug()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("gives the tenant of its current slug, though the app role alone sees no tenant", async ({ assert }) => {
		const { tenant } = await studioWithOwner("api-needle-32");

		const { rows } = await sql({}, "select count(*)::int as n from tenants");
		assert.equal(rows[0].n, 0);
		assert.equal(await lookup("api-needle-32"), tenant.id);
	});

	test("gives the same tenant for each of its old slugs", async ({ assert }) => {
		const { tenant } = await studioWithOwner("api-first-32");
		await changeSlug(tenant, "api-second-32");
		await changeSlug(tenant, "api-third-32");

		for (const slug of ["api-first-32", "api-second-32", "api-third-32"]) {
			assert.equal(await lookup(slug), tenant.id, slug);
		}
	});

	test("resolves a grandfathered slug that the new rules refuse", async ({ assert }) => {
		const { tenant } = await studioWithOwner("api-legacy-32");
		// Old data has such slugs (TAT-24 ruling 4); the trigger registers it.
		await inTenant(tenant, () =>
			dbClient().rawQuery("update tenants set slug = 'a--b' where id = ?", [tenant.id]),
		);

		assert.equal(await lookup("a--b"), tenant.id);
	});

	test("gives null for an unknown slug, another case, a pattern, an empty string or null", async ({ assert }) => {
		await studioWithOwner("api-needle-32");

		for (const slug of [
			"no-such-studio-td32",
			"Api-Needle-32",
			"API-NEEDLE-32",
			"api-needle-3%",
			"api_needle_32",
			"api-needle-3_",
			"%",
			"",
			" api-needle-32",
			null,
		]) {
			assert.isNull(await lookup(slug), String(slug));
		}
	});

	test("gives null for a deleted tenant's current and old slugs", async ({ assert }) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");
		await inTenant(tenant, () => tenant.softDelete());

		assert.isNull(await lookup("api-red-32"));
		assert.isNull(await lookup("api-needle-32"));
	});

	test("only the app role may call it, with one text argument, as its owner with a pinned search_path", async ({ assert }) => {
		const { rows } = await sql(
			{},
			`select p.prosecdef as definer,
			        p.proisstrict as strict,
			        p.provolatile as volatility,
			        p.proretset as returns_set,
			        p.proconfig,
			        pg_get_function_identity_arguments(p.oid) as args,
			        pg_get_function_result(p.oid) as result,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run,
			        has_function_privilege(current_user, p.oid, 'execute') as app_can_run,
			        pg_get_userbyid(p.proowner) <> current_user as owned_by_another_role
			 from pg_proc p
			 where p.oid = 'public.tenant_for_slug(text)'::regprocedure`,
		);

		assert.deepEqual(rows, [
			{
				definer: true,
				strict: true,
				volatility: "s",
				returns_set: false,
				proconfig: ["search_path=pg_catalog, pg_temp"],
				args: "requested_slug text",
				result: "uuid",
				public_can_run: false,
				app_can_run: true,
				owned_by_another_role: true,
			},
		]);
	});
});
```

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, replace the `DEFINER_FUNCTIONS` constant with:

```ts
/**
 * SECURITY DEFINER functions, with their argument lists, and why. They run
 * as their owner, which bypasses row-level security, so each one is a
 * conscious edit: ids only, no arguments except one exact lookup key, a
 * pinned search_path and no EXECUTE for PUBLIC (database/README.md).
 */
const DEFINER_FUNCTIONS: Record<string, { args: string; reason: string }> = {
	"public.expired_quote_candidates": {
		args: "",
		reason:
			"lists (tenant_id, project_id, quote_id) of expired current quotes for the expiry sweep (TAT-83)",
	},
	"public.tenant_for_slug": {
		args: "requested_slug text",
		reason:
			"the id of the live tenant whose current or old slug is exactly the argument, for the public API (TAT-32)",
	},
};
```

In `definerFunctions()`, change the select list to

```ts
		`select n.nspname || '.' || p.proname as name, p.proconfig,
		        pg_get_function_identity_arguments(p.oid) as args,
		        has_function_privilege('public', p.oid, 'execute') as public_can_run
```

and its row type to `{ name: string; args: string; proconfig: string[] | null; public_can_run: boolean; }[]`. Replace the guard test with:

```ts
	test("every SECURITY DEFINER function is listed with its arguments, pins search_path and is closed to PUBLIC", async ({
		assert,
	}) => {
		assert.deepEqual(
			await definerFunctions(),
			Object.keys(DEFINER_FUNCTIONS)
				.sort()
				.map((name) => ({
					name,
					args: DEFINER_FUNCTIONS[name].args,
					proconfig: ["search_path=pg_catalog, pg_temp"],
					public_can_run: false,
				})),
		);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=tenant_for_slug.spec.ts --files=catalog_guard.spec.ts`
Expected: FAIL: the function specs with `function public.tenant_for_slug(...) does not exist`, and the definer guard (the listed function is missing). The other catalog guard tests pass.

- [ ] **Step 3: Write the migration**

Create `apps/platform/database/migrations/1791640000000_create_tenant_for_slug_function.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * The public API's tenant lookup (TAT-32). An unauthenticated request has
 * no tenant yet, and the app role sees no tenant without one, so the
 * publicTenant middleware resolves the path's slug through this SECURITY
 * DEFINER function. It runs as the owner (bypassing RLS) and answers one
 * question: the id of the live tenant whose current or old slug
 * (tenant_slugs, TAT-24) is exactly the argument, or null. It never lists
 * tenants.
 *
 * Hardened as database/README.md asks: one text argument compared with =
 * on a unique column, an SQL-standard body (bound when created, no dynamic
 * SQL), STRICT (null in, null out), a pinned search_path, schema-qualified
 * tables, and EXECUTE for the app role only (Postgres grants it to PUBLIC
 * by default). The argument isn't named `slug`: in an SQL function a column
 * of that name would win.
 */
export default class extends BaseSchema {
	async up() {
		// The app role (DB_USER, created by setup_roles.sql) as an SQL
		// identifier. A role that doesn't exist fails the migration.
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			`create function public.tenant_for_slug(requested_slug text)
returns uuid
language sql stable strict security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select s.tenant_id
  from public.tenant_slugs s
  join public.tenants t on t.id = s.tenant_id
  where s.slug = requested_slug
    and t.deleted_at is null;
end`,
			"revoke all on function public.tenant_for_slug(text) from public",
			`grant execute on function public.tenant_for_slug(text) to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.tenant_for_slug(text)");
	}
}
```

Run: `pnpm -C <repo>/apps/platform migrate`
Expected: the migration runs as the owner role. `git -C <repo> status --short apps/platform/database/schema.ts` shows no change (a function adds no table); if the generator rewrote it, run `pnpm -C <repo> exec biome check --write apps/platform/database/schema.ts` and keep the result.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=tenant_for_slug.spec.ts --files=catalog_guard.spec.ts --files=expired_quote_candidates.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/database/migrations/1791640000000_create_tenant_for_slug_function.ts apps/platform/tests/functional/tenancy/tenant_for_slug.spec.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> commit -m "feat(platform): add the tenant_for_slug lookup for the public API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8 (needs TAT-24): The tenant from the path

**Files:**
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts` (add `tenantIdForSlug`)
- Create: `apps/platform/app/middleware/public_tenant_middleware.ts`
- Modify: `apps/platform/start/kernel.ts`, `apps/platform/tests/support/test_routes.ts`
- Test: `apps/platform/tests/functional/api/public_tenant.spec.ts` (create)

**Interfaces:**
- Consumes: `tenant_for_slug()` (Task 7); `STORED_SLUG` from `#modules/tenancy/slugs` (TAT-24; see the preconditions for its real name); `READ_METHODS` (Task 3); `ApiException` (Task 3); `runInRequestTransaction`, `setRequestContext`, `dbClient` from `#services/db_context`; `echoValidator` (Task 5).
- Produces: `TenancyService.tenantIdForSlug(slug: string): Promise<string | null>`; named middleware `middleware.publicTenant()`; `publicTenantContext(ctx): { tenant: Tenant }` and `ctx.publicTenant?: Tenant` from `#middleware/public_tenant_middleware`; test-only routes `GET /api/v1/tenants/:tenant/__test/db` (`{ data: { user_id, tenant_id, visible_tenant_ids, tenantSlug } }`) and `POST /api/v1/tenants/:tenant/__test/echo` (`{ data: { slug, label } }`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/api/public_tenant.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiData, assertApiError, assertNoCookies } from "#tests/helpers/api";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const tenancy = new TenancyService();

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

/** What the db echo route answers when the request runs as `tenant`. */
function runsAs(tenant: { id: string }, slug: string) {
	return { user_id: "", tenant_id: tenant.id, visible_tenant_ids: [tenant.id], tenantSlug: slug };
}

test.group("Public API: the tenant from the path", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("runs the request as the tenant of the current slug, with no user", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-needle-32");

		const response = await client.get("/api/v1/tenants/api-needle-32/__test/db");

		assertApiData(response, runsAs(tenant, "api-needle-32"));
	});

	test("a signed-in owner of another studio still runs as no one, and sees only the path's tenant", async ({ client }) => {
		const a = await studioWithOwner("api-studio-a-32", "Studio A");
		const b = await studioWithOwner("api-studio-b-32", "Studio B");

		const response = await client.get("/api/v1/tenants/api-studio-a-32/__test/db").loginAs(b.owner);

		assertApiData(response, runsAs(a.tenant, "api-studio-a-32"));
		assertNoCookies(response);
	});

	test("grandfathered slugs that the new rules refuse still resolve", async ({ client }) => {
		for (const [index, slug] of ["12345", "a--b", "www", "xn--80ak6aa92e"].entries()) {
			const { tenant } = await studioWithOwner(`api-legacy-32-${index}`);
			// Old data has such slugs (TAT-24 ruling 4); the trigger registers it.
			await inTenant(tenant, () =>
				dbClient().rawQuery("update tenants set slug = ? where id = ?", [slug, tenant.id]),
			);

			assertApiData(await client.get(`/api/v1/tenants/${slug}/__test/db`), runsAs(tenant, slug));
		}
	});

	test("an old slug serves reads as the same tenant, GET and HEAD", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");

		assertApiData(await client.get("/api/v1/tenants/api-needle-32/__test/db"), runsAs(tenant, "api-red-32"));
		const head = await client.head("/api/v1/tenants/api-needle-32/__test/db");
		head.assertStatus(200);
	});

	test("a write under the current slug runs; under an old slug it is a 404, even with an invalid body", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-needle-32");
		await changeSlug(tenant, "api-red-32");

		assertApiData(await client.post("/api/v1/tenants/api-red-32/__test/echo").json({ label: "Hi" }), {
			slug: "api-red-32",
			label: "Hi",
		});
		for (const body of [{ label: "Hi" }, { label: "" }]) {
			const response = await client.post("/api/v1/tenants/api-needle-32/__test/echo").json(body);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), { error: { code: "not_found", message: "Not found." } });
		}
	});

	test("unknown, other-case, shapeless, too long and deleted slugs are the same 404", async ({ client, assert }) => {
		await studioWithOwner("api-needle-32");
		const gone = await studioWithOwner("api-gone-32", "Gone Ink");
		await changeSlug(gone.tenant, "api-gone-32-b");
		await inTenant(gone.tenant, () => gone.tenant.softDelete());

		for (const slug of [
			"no-such-studio-td32",
			"Api-Needle-32",
			"API-NEEDLE-32",
			"api_needle_32",
			"-api-needle-32",
			"ab",
			"a".repeat(64),
			"x".repeat(10_000),
			"%E2%84%AAat",
			"api-gone-32",
			"api-gone-32-b",
		]) {
			const response = await client.get(`/api/v1/tenants/${slug}/__test/db`);
			assertApiError(response, 404, "not_found");
			assert.deepEqual(response.body(), { error: { code: "not_found", message: "Not found." } }, slug.slice(0, 40));
		}
	});

	test("publicTenantContext fails loudly outside the tenant group", async ({ assert }) => {
		const ctx = await testUtils.createHttpContext();

		assert.throws(() => publicTenantContext(ctx), /api\/v1\/tenants/);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=public_tenant.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "Cannot find module" for `#middleware/public_tenant_middleware` in the log.

- [ ] **Step 3: Write the lookup and the middleware**

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts`, add after `currentSlugFor`:

```ts
	/**
	 * The id of the live tenant whose current or old slug is exactly `slug`,
	 * or null, for the public API (TAT-32). An unauthenticated request has
	 * no context in which RLS would show a tenant, so this asks the
	 * tenant_for_slug() SECURITY DEFINER function, which answers this one
	 * question and nothing else. Read the tenant itself in its own context.
	 */
	async tenantIdForSlug(slug: string): Promise<string | null> {
		const { rows } = await dbClient().rawQuery(
			"select public.tenant_for_slug(?) as id",
			[slug],
		);
		return rows[0]?.id ?? null;
	}
```

Create `apps/platform/app/middleware/public_tenant_middleware.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { STORED_SLUG } from "#modules/tenancy/slugs";
import { runInRequestTransaction, setRequestContext } from "#services/db_context";
import { READ_METHODS } from "#services/public_api";
import { ApiException } from "#services/public_api_errors";

declare module "@adonisjs/core/http" {
	interface HttpContext {
		/**
		 * The tenant from a public API path. Only set on /api/v1/tenants/:tenant
		 * routes; read it with publicTenantContext(ctx).
		 */
		publicTenant?: Tenant;
	}
}

/**
 * Resolves `:tenant` on the public API (TAT-32) and runs the rest of the
 * request in one transaction with that tenant's database context, so every
 * query is RLS-scoped to it. There is no user: app.user_id stays unset, also
 * when the request carries a dashboard session cookie.
 *
 * The slug is matched exactly. One without the shape of a stored slug (the
 * tenant_slugs CHECK, never checkSlug, so grandfathered slugs keep working)
 * is a 404 without a query. An old slug (TAT-24) serves reads like the
 * current one, and the tenant resource names the current slug; any other
 * method under an old slug is a 404, so a write never goes through an
 * alias. Unknown, deleted and shapeless slugs get the same 404.
 *
 * Use after publicApi on the /api/v1/tenants/:tenant group.
 */
@inject()
export default class PublicTenantMiddleware {
	constructor(private tenancy: TenancyService) {}

	async handle(ctx: HttpContext, next: NextFn) {
		const slug = ctx.params.tenant;
		if (typeof slug !== "string" || !STORED_SLUG.test(slug)) {
			throw ApiException.notFound();
		}

		return runInRequestTransaction({}, async () => {
			const tenantId = await this.tenancy.tenantIdForSlug(slug);
			if (!tenantId) throw ApiException.notFound();
			await setRequestContext({ tenantId });

			// RLS shows exactly this tenant's row now.
			const tenant = await Tenant.find(tenantId);
			if (!tenant) throw ApiException.notFound();
			if (tenant.slug !== slug && !READ_METHODS.has(ctx.request.method())) {
				throw ApiException.notFound();
			}

			ctx.publicTenant = tenant;
			return next();
		});
	}
}

/**
 * The tenant the publicTenant middleware resolved. Throws outside the
 * /api/v1/tenants/:tenant group, so an endpoint that forgot it fails
 * loudly instead of running without a tenant.
 */
export function publicTenantContext(ctx: HttpContext): { tenant: Tenant } {
	if (!ctx.publicTenant) {
		throw new Error(
			"No public tenant on this request: the route must be in the /api/v1/tenants/:tenant group with the publicTenant middleware",
		);
	}
	return { tenant: ctx.publicTenant };
}
```

In `apps/platform/start/kernel.ts`, add to `router.named({...})`:

```ts
	publicTenant: () => import("#middleware/public_tenant_middleware"),
```

- [ ] **Step 4: Add the tenant test routes**

In `apps/platform/tests/support/test_routes.ts`, add `import { publicTenantContext } from "#middleware/public_tenant_middleware";` and append:

```ts
/**
 * Public API routes under a tenant (TAT-32): `db` echoes what the request
 * runs as (its settings and the tenants RLS lets it see), `echo` is a write
 * that changes nothing, for old-slug writes.
 */
router
	.group(() => {
		router.get("db", async (ctx) => {
			const { rows } = await dbClient().rawQuery(
				`select current_setting('app.user_id', true) as user_id,
				        current_setting('app.tenant_id', true) as tenant_id,
				        coalesce((select json_agg(id order by id) from tenants), '[]'::json) as visible_tenant_ids`,
			);
			return { data: { ...rows[0], tenantSlug: publicTenantContext(ctx).tenant.slug } };
		});
		router.post("echo", async (ctx) => ({
			data: {
				slug: publicTenantContext(ctx).tenant.slug,
				...(await ctx.request.validateUsing(echoValidator)),
			},
		}));
	})
	.prefix("/api/v1/tenants/:tenant/__test")
	.use([middleware.publicApi(), middleware.publicTenant()]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=public_tenant.spec.ts --files=stateless.spec.ts --files=errors.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git -C <repo> add apps/platform/app/modules/tenancy/services/tenancy_service.ts apps/platform/app/middleware/public_tenant_middleware.ts apps/platform/start/kernel.ts apps/platform/tests/support/test_routes.ts apps/platform/tests/functional/api/public_tenant.spec.ts
git -C <repo> commit -m "feat(platform): resolve the public API's tenant from the path

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (needs TAT-24): Cache headers and `GET /api/v1/tenants/:tenant`

**Files:**
- Create: `apps/platform/app/middleware/public_cache_middleware.ts`, `apps/platform/app/transformers/public_studio_transformer.ts`, `apps/platform/app/controllers/public_studio_controller.ts`
- Modify: `apps/platform/start/kernel.ts`, `apps/platform/start/routes.ts`, `.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/api/public_studio.spec.ts` (create)

**Interfaces:**
- Consumes: `publicApi` (Task 5), `publicTenant` and `publicTenantContext` (Task 8), `READ_METHODS`, `publicCacheControl`, `PublicCacheOptions` (Task 3), `ctx.serialize` (`providers/api_provider.ts`).
- Produces: named middleware `middleware.publicCache(options?: PublicCacheOptions)`; route `GET /api/v1/tenants/:tenant` named `api.v1.studio` (`controllers.PublicStudio`, `show`), answering `{ data: { slug, name } }`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/api/public_studio.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiData, assertApiError, assertApiHeaders, assertNoCookies } from "#tests/helpers/api";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const tenancy = new TenancyService();

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("GET /api/v1/tenants/:tenant (getStudio)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers exactly the contract's minimal Studio", async ({ client }) => {
		await studioWithOwner("api-needle-32", "Black Needle");

		const response = await client.get("/api/v1/tenants/api-needle-32");

		assertApiData(response, { slug: "api-needle-32", name: "Black Needle" });
		assertApiHeaders(response);
	});

	test("under an old slug, answers with the current slug", async ({ client }) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		await changeSlug(tenant, "api-red-32");

		assertApiData(await client.get("/api/v1/tenants/api-needle-32"), { slug: "api-red-32", name: "Black Needle" });
	});

	test("is cacheable: public, stale-while-revalidate, an ETag, and a 304 for a matching If-None-Match", async ({ client, assert }) => {
		await studioWithOwner("api-needle-32");

		const first = await client.get("/api/v1/tenants/api-needle-32");
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client.get("/api/v1/tenants/api-needle-32").header("if-none-match", etag);
		again.assertStatus(304);
		again.assertHeader("cache-control", CACHED);
		again.assertHeader("etag", etag);
		assertNoCookies(again);
	});

	test("a changed studio gets a new ETag, and the old tag a full answer", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("api-needle-32", "Black Needle");
		const before = (await client.get("/api/v1/tenants/api-needle-32")).header("etag") ?? "";
		assert.isNotEmpty(before);

		await inTenant(tenant, () =>
			dbClient().rawQuery("update tenants set name = 'Red Needle' where id = ?", [tenant.id]),
		);
		const after = await client.get("/api/v1/tenants/api-needle-32").header("if-none-match", before);

		assertApiData(after, { slug: "api-needle-32", name: "Red Needle" });
		assert.notEqual(after.header("etag"), before);
	});

	test("HEAD has the same cache headers and no body", async ({ client }) => {
		await studioWithOwner("api-needle-32");
		const etag = (await client.get("/api/v1/tenants/api-needle-32")).header("etag");

		const head = await client.head("/api/v1/tenants/api-needle-32");

		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
		assertNoCookies(head);
	});

	test("an unknown tenant is a 404 and a POST a 405, both no-store", async ({ client }) => {
		await studioWithOwner("api-needle-32");

		assertApiError(await client.get("/api/v1/tenants/no-such-studio-td32"), 404, "not_found");
		const post = await client.post("/api/v1/tenants/api-needle-32").json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=public_studio.spec.ts`
Expected: FAIL: every request is the unknown-path 404 (no route yet; the POST is a 404 too, since no method matches).

- [ ] **Step 3: Write the cache middleware**

Create `apps/platform/app/middleware/public_cache_middleware.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import {
	type PublicCacheOptions,
	publicCacheControl,
	READ_METHODS,
} from "#services/public_api";

/**
 * Makes a public read cacheable (TAT-32): a 200 GET or HEAD gets
 * `Cache-Control: public, max-age=60, stale-while-revalidate=600` (or the
 * seconds given) and a strong ETag, and a request whose If-None-Match still
 * matches gets a 304. Errors and other methods keep publicApi's no-store.
 * Opt-in per route (a test makes every API GET route decide). Never use it
 * on a response that isn't the same for everyone, such as a deposit page
 * (TAT-65).
 *
 *   router.get("/", [controllers.PublicStudio, "show"]).use(middleware.publicCache())
 */
export default class PublicCacheMiddleware {
	async handle(ctx: HttpContext, next: NextFn, options: PublicCacheOptions = {}) {
		await next();
		const content = ctx.response.content;
		if (
			!READ_METHODS.has(ctx.request.method()) ||
			ctx.response.getStatus() !== 200 ||
			!content
		) {
			return;
		}
		ctx.response.header("Cache-Control", publicCacheControl(options));
		// The same body again, with an ETag: when Adonis writes it, a matching
		// If-None-Match becomes a 304.
		ctx.response.send(content[0], true);
	}
}
```

In `apps/platform/start/kernel.ts`, add to `router.named({...})`:

```ts
	publicCache: () => import("#middleware/public_cache_middleware"),
```

- [ ] **Step 4: Write the transformer and the controller**

Create `apps/platform/app/transformers/public_studio_transformer.ts`:

```ts
import { BaseTransformer } from "@adonisjs/core/transformers";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * A tenant as the public API shows it (openapi.yaml, Studio): only what the
 * studio page may show. TAT-32 sends the current slug (also for a request
 * made under an old one) and the name; TAT-44 adds the profile.
 */
export default class PublicStudioTransformer extends BaseTransformer<Tenant> {
	toObject() {
		return this.pick(this.resource, ["slug", "name"]);
	}
}
```

Create `apps/platform/app/controllers/public_studio_controller.ts`:

```ts
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import PublicStudioTransformer from "#transformers/public_studio_transformer";

/** The public API's tenant resource (getStudio in openapi.yaml). */
export default class PublicStudioController {
	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		return ctx.serialize(PublicStudioTransformer.transform(tenant));
	}
}
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/server/controllers.ts` gains `PublicStudio`.

- [ ] **Step 5: Add the API group**

Append to `apps/platform/start/routes.ts`:

```ts
/**
 * The public API (TAT-32): stateless and cookieless (the session, CSRF,
 * auth and Inertia middleware skip /api), CORS open without credentials,
 * { data } and { error } envelopes (#services/public_api_errors). Every /api
 * route goes in this group and runs publicApi first (a test checks). Cache
 * a read with middleware.publicCache(); everything else is no-store. TAT-38
 * adds its rate limits to these `use` lists.
 */
router
	.group(() => {
		/**
		 * One tenant's public data. The tenant is the path's slug, current or
		 * old, matched exactly; handlers run in its database context. Every
		 * route here needs a case in tests/isolation/public_cases.ts (a test
		 * checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.PublicStudio, "show"])
					.use(middleware.publicCache())
					.as("api.v1.studio");
			})
			.prefix("/tenants/:tenant")
			.use(middleware.publicTenant());
	})
	.prefix("/api/v1")
	.use(middleware.publicApi());
```

Run: `pnpm -C <repo>/apps/platform exec node ace codegen`
Expected: `.adonisjs/` route types gain `api.v1.studio`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=public_studio.spec.ts --files=public_tenant.spec.ts --files=tenant_routes.spec.ts`
Expected: PASS.

Run: `pnpm -C <repo>/apps/platform typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C <repo> add apps/platform/app/middleware/public_cache_middleware.ts apps/platform/app/transformers/public_studio_transformer.ts apps/platform/app/controllers/public_studio_controller.ts apps/platform/start/kernel.ts apps/platform/start/routes.ts apps/platform/.adonisjs apps/platform/tests/functional/api/public_studio.spec.ts
git -C <repo> commit -m "feat(platform): serve getStudio with public cache headers and ETags

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10 (needs TAT-24): Route guards and public isolation

**Files:**
- Create: `apps/platform/tests/isolation/public_cases.ts`, `apps/platform/tests/helpers/public_isolation.ts`
- Modify: `apps/platform/tests/support/test_routes.ts` (a leak route)
- Test: `apps/platform/tests/functional/isolation/public_api.spec.ts`, `apps/platform/tests/functional/api/api_routes.spec.ts` (create)

**Interfaces:**
- Consumes: `twoStudios()` and `Studio` (`#tests/helpers/tenants`); the Task 9 route; `middleware` (`#start/kernel`); `publicTenantContext` (Task 8).
- Produces: `PublicIsolationCase`, `publicIsolationCases` (`#tests/isolation/public_cases`); `publicMarkers(studio)`, `assertPublicIsolation(client, assert, studios, case)` (`#tests/helpers/public_isolation`); `publicLeaks` (test routes).

- [ ] **Step 1: Write the cases, the harness and the failing tests**

Create `apps/platform/tests/isolation/public_cases.ts`:

```ts
import Tenant from "#modules/tenancy/models/tenant";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /api/v1/tenants/:tenant route (TAT-32). public_api.spec.ts
 * requests each under studio A's slug and fails if the answer mentions
 * studio B (publicMarkers) or B's snapshot changes; the guard in
 * api_routes.spec.ts fails for a route without an entry. These are not in
 * cases.ts: the public API has no signed-in actor, and another studio's slug
 * is simply another tenant.
 */
export type PublicIsolationCase = {
	method: "GET" | "POST";
	/** The route as the router prints it, e.g. /api/v1/tenants/:tenant */
	pattern: string;
	/** A valid body for writes, built for the studio sending it. */
	body?: (own: Studio) => Record<string, unknown>;
	/** The status of A's own request: the positive control. */
	ownStatus: 200 | 201;
	/** Strings A's own answer must contain, so an empty answer can't pass. */
	ownMarkers: (own: Studio) => string[];
	/** Reads the state of the studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

export const publicIsolationCases: PublicIsolationCase[] = [
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant",
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.slug, own.tenant.name],
		snapshot: tenantRow,
	},
];
```

Create `apps/platform/tests/helpers/public_isolation.ts`:

```ts
import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import type { Studio } from "#tests/helpers/tenants";
import type { PublicIsolationCase } from "#tests/isolation/public_cases";

/**
 * Strings that identify `studio` in any public answer: its tenant's id,
 * slug and name, and the ids and names of what twoStudios() seeded (names
 * that both studios share, such as the artist slug "sita", are left out).
 * Studio B's must never appear in an answer to studio A's path.
 */
export function publicMarkers(studio: Studio): string[] {
	return [
		studio.tenant.id,
		studio.tenant.slug,
		studio.tenant.name,
		studio.artistProfile.id,
		studio.artistProfile.name,
		studio.paymentMethod.id,
		studio.client.id,
		studio.project.id,
		studio.newInquiry.id,
	];
}

/**
 * The case's URL under `studio`'s slug. Routes with more parameters than
 * :tenant need the harness to grow an attack with B's values under A's slug
 * (TAT-44's /artists/:artist will); until then they are refused.
 */
function urlFor({ pattern }: PublicIsolationCase, studio: Studio) {
	const url = pattern.replace(/:tenant(?=\/|$)/, studio.tenant.slug);
	if (/\/:/.test(url)) {
		throw new Error(`${pattern}: the public harness only handles :tenant so far`);
	}
	return url;
}

/**
 * Proves a public route under studio A's path never reads or writes studio
 * B. The positive control: A's own request gives ownStatus and mentions A
 * (ownMarkers), so an empty or failing answer can't pass. Then the answer
 * must mention none of B's markers, and B's snapshot must be unchanged.
 */
export async function assertPublicIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: PublicIsolationCase,
) {
	const before = await isolationCase.snapshot(b);

	const request = client.request(urlFor(isolationCase, a), isolationCase.method);
	const body = isolationCase.body?.(a);
	if (body) request.json(body);
	const response = await request.redirects(0);

	response.assertStatus(isolationCase.ownStatus);
	const text = JSON.stringify(response.body());
	for (const marker of isolationCase.ownMarkers(a)) {
		assert.include(text, marker, `the answer to A's path mentions A (${marker})`);
	}
	for (const marker of publicMarkers(b)) {
		assert.notInclude(text, marker, `the answer to A's path mentions studio B (${marker})`);
	}
	assert.deepEqual(
		await isolationCase.snapshot(b),
		before,
		`${isolationCase.method} ${isolationCase.pattern} changed studio B`,
	);
}
```

Create `apps/platform/tests/functional/isolation/public_api.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertPublicIsolation } from "#tests/helpers/public_isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { publicIsolationCases } from "#tests/isolation/public_cases";
import { publicLeaks } from "#tests/support/test_routes";

test.group("Public API isolation", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const isolationCase of publicIsolationCases) {
		test(`${isolationCase.method} ${isolationCase.pattern}`, async ({ client, assert }) => {
			await assertPublicIsolation(client, assert, await twoStudios(), isolationCase);
		});
	}
});

test.group("Public isolation harness catches what it should", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => publicLeaks.clear());

	const leak = {
		method: "GET" as const,
		pattern: "/api/v1/tenants/:tenant/__test/leak",
		ownStatus: 200 as const,
		ownMarkers: (own: { tenant: { slug: string } }) => [own.tenant.slug],
		snapshot: async () => null,
	};

	test("a route that answers A's path with B's data is reported", async ({ client, assert }) => {
		const studios = await twoStudios();
		publicLeaks.set(studios.a.tenant.id, studios.b.tenant.name);

		await assert.rejects(
			() => assertPublicIsolation(client, assert, studios, leak),
			/mentions studio B/,
		);
	});

	test("a positive control that A's answer doesn't meet is reported", async ({ client, assert }) => {
		await assert.rejects(
			async () =>
				assertPublicIsolation(client, assert, await twoStudios(), {
					...leak,
					ownMarkers: () => ["not-in-the-answer"],
				}),
			/mentions A/,
		);
	});
});
```

Create `apps/platform/tests/functional/api/api_routes.spec.ts`:

```ts
import router from "@adonisjs/core/services/router";
import { test } from "@japa/runner";
import { middleware } from "#start/kernel";
import { publicIsolationCases } from "#tests/isolation/public_cases";

/** The named middleware (start/kernel.ts); global ones may carry names too. */
const NAMED = new Set(Object.keys(middleware));

/** Session-dependent middleware that no API route may run. */
const WEB_ONLY = ["auth", "guest", "dbContext", "tenant", "role"];

/** Middleware only API routes may run. */
const PUBLIC_ONLY = ["publicApi", "publicTenant", "publicCache"];

/**
 * API GET routes that are not cacheable, and why. A new GET route either
 * uses middleware.publicCache() or is listed here: a conscious edit (the
 * deposit page, TAT-65, belongs here).
 */
const UNCACHED_GET_ROUTES: Record<string, string> = {};

const isApi = (pattern: string) => pattern === "/api" || pattern.startsWith("/api/");
const isTenantApi = (pattern: string) => /^\/api\/v1\/tenants\/:tenant(\/|$)/.test(pattern);
/** Test-only routes (tests/support/test_routes.ts) follow the stack rules but need no case or cache decision. */
const isTestOnly = (pattern: string) => pattern.includes("/__test");

function allRoutes() {
	return Object.values(router.toJSON())
		.flat()
		.map((route) => ({
			pattern: route.pattern,
			methods: route.methods.filter((method) => method !== "HEAD"),
			named: [...route.middleware.all()].flatMap((entry) =>
				typeof entry !== "function" && entry.name && NAMED.has(entry.name) ? [entry.name] : [],
			),
		}));
}

test.group("Public API routes", () => {
	test("every /api route runs publicApi first and none of the web middleware", ({ assert }) => {
		const routes = allRoutes().filter(({ pattern }) => isApi(pattern));
		assert.isNotEmpty(routes);

		for (const { pattern, named } of routes) {
			assert.equal(named[0], "publicApi", pattern);
			for (const name of WEB_ONLY) assert.notInclude(named, name, pattern);
		}
	});

	test("every tenant route resolves the tenant after publicApi", ({ assert }) => {
		const routes = allRoutes().filter(({ pattern }) => isTenantApi(pattern));
		assert.isNotEmpty(routes);

		for (const { pattern, named } of routes) {
			assert.isAbove(named.indexOf("publicTenant"), named.indexOf("publicApi"), pattern);
		}
	});

	test("no route outside /api runs the public API middleware", ({ assert }) => {
		for (const { pattern, named } of allRoutes().filter(({ pattern }) => !isApi(pattern))) {
			for (const name of PUBLIC_ONLY) assert.notInclude(named, name, pattern);
		}
	});

	test("every API GET route is cacheable or says why not", ({ assert }) => {
		const gets = allRoutes().filter(
			({ pattern, methods }) => isApi(pattern) && !isTestOnly(pattern) && methods.includes("GET"),
		);
		assert.isNotEmpty(gets);

		assert.deepEqual(
			gets
				.filter(({ pattern, named }) => !named.includes("publicCache") && !(pattern in UNCACHED_GET_ROUTES))
				.map(({ pattern }) => pattern),
			[],
			"use middleware.publicCache(), or list the route in UNCACHED_GET_ROUTES with a reason",
		);
		assert.deepEqual(
			Object.keys(UNCACHED_GET_ROUTES).filter((pattern) => !gets.some((route) => route.pattern === pattern)),
			[],
			"UNCACHED_GET_ROUTES lists routes that no longer exist",
		);
	});

	test("every /api/v1/tenants/:tenant route has a public isolation case", ({ assert }) => {
		const keys = new Set(
			allRoutes()
				.filter(({ pattern }) => isTenantApi(pattern) && !isTestOnly(pattern))
				.flatMap(({ pattern, methods }) => methods.map((method) => `${method} ${pattern}`)),
		);
		const covered = new Set(publicIsolationCases.map(({ method, pattern }) => `${method} ${pattern}`));

		assert.deepEqual([...keys].filter((key) => !covered.has(key)), [], "add a case to tests/isolation/public_cases.ts");
		assert.deepEqual([...covered].filter((key) => !keys.has(key)), [], "cases for routes that no longer exist");
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `PORT=3402 timeout 90 pnpm -C <repo>/apps/platform test functional --files=public_api.spec.ts --files=api_routes.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: exit 124 (or a failure) and "does not provide an export named 'publicLeaks'" in the log. (Once the leak route exists, the route guards and the getStudio case already pass: they pin Tasks 5 to 9.)

- [ ] **Step 3: Add the leak route**

In `apps/platform/tests/support/test_routes.ts`, append:

```ts
/**
 * Tenant id -> another studio's name, filled by the public isolation
 * self-test: a public route that answers one studio's path with another
 * studio's data, the leak the public harness must report.
 */
export const publicLeaks = new Map<string, string>();

router
	.get("/api/v1/tenants/:tenant/__test/leak", (ctx) => {
		const { tenant } = publicTenantContext(ctx);
		return { data: { slug: tenant.slug, other: publicLeaks.get(tenant.id) ?? null } };
	})
	.use([middleware.publicApi(), middleware.publicTenant()]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `PORT=3402 timeout 300 pnpm -C <repo>/apps/platform test functional --files=public_api.spec.ts --files=api_routes.spec.ts --files=tenant_routes.spec.ts --files=harness.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/tests/isolation/public_cases.ts apps/platform/tests/helpers/public_isolation.ts apps/platform/tests/support/test_routes.ts apps/platform/tests/functional/isolation/public_api.spec.ts apps/platform/tests/functional/api/api_routes.spec.ts
git -C <repo> commit -m "test(platform): guard public API routes and prove tenant isolation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11 (needs TAT-24's docs): Docs

**Files:**
- Modify: `apps/platform/docs/backend.md`, `apps/platform/database/README.md`, `apps/platform/docs/testing.md`, `docs/sdk.md`, `docs/architecture.md`, `docs/README.md`

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`, in the "Slugs (TAT-24)" bullet, replace "Never copy the reserved list; the public API (TAT-32) imports it." with "Never copy the reserved list or `STORED_SLUG`.", and replace the sentence "The public API must resolve a slug through `tenant_slugs` too (pre-filter with `STORED_SLUG`, then an exact lookup), with the contract in `docs/superpowers/specs/2026-10-17-tat-24-slugs-design.md` ("For TAT-32")." with "The public API resolves slugs through `tenant_slugs` too: `STORED_SLUG` pre-filters a path slug (never `checkSlug`), then an exact lookup (see [Public API](#public-api))."

Replace the "Cross-tenant reads" bullet with:

```markdown
- Cross-tenant reads: the app role sees one tenant at a time, and nothing in a request ever needs more. Two SECURITY DEFINER functions look across tenants, and both return ids only: the expiry sweep (TAT-83) reads `expired_quote_candidates()` and acts on each row through a `TenantJob` in that row's tenant, never directly; the public API (TAT-32) turns a path slug into one tenant id with `tenant_for_slug()` and runs the request in that tenant. Rules for such functions: [database conventions](../database/README.md#row-level-security).
```

Insert this section before `## Rate limits`:

```markdown
## Public API

- **One group, no session.** Every public endpoint lives in the `/api/v1` group at the end of `start/routes.ts`, whose `publicApi` middleware runs first (TAT-32; `api_routes.spec.ts` checks). `isApiRequest(ctx)` (`#services/public_api`) is true for a route under `/api`, or before routing for a URL under it. The session and shield wrappers in `router.use` (`#middleware/web_session_middleware`, `#middleware/web_shield_middleware`), silent auth and Inertia skip such requests, so the API reads no session, needs no CSRF token and never sets a cookie. Never add `auth`, `guest`, `dbContext`, `tenant` or `role` to an API route. Platform-wide endpoints go in the outer group, tenant endpoints in the inner `/tenants/:tenant` group.
- **Tenant from the path.** `publicTenant` gives a slug that fails `STORED_SLUG` (`#modules/tenancy/slugs`, the registry CHECK's shape; never `checkSlug`, so grandfathered slugs such as `12345` or `www` keep working) a 404 without a query, then asks `TenancyService.tenantIdForSlug`, the only caller of the `tenant_for_slug()` SECURITY DEFINER function, and runs the rest of the request in one transaction with `app.tenant_id` set and no `app.user_id`: every model query is RLS-scoped to that tenant. Read it with `publicTenantContext(ctx)`. An old slug serves GET and HEAD as the same tenant; any other method under it is the same 404 as an unknown slug. RLS scoping is not authorization: a public endpoint returns only studio-page data, through a transformer that picks public fields ([requirements](../../../docs/requirements.md#tenant-isolation), rule 6).
- **Responses.** Return `ctx.serialize(SomeTransformer.transform(record))` for `{ data }`. To fail, throw `ApiException.notFound()`, or `new ApiException(status, code, message, fields?)` (`#services/public_api_errors`) for a code of the endpoint's own, listed in `openapi.yaml`. The exception handler turns every error on an `/api` request into `{ error: { code, message, fields? } }` (`renderApiError`): VineJS errors are `validation_failed` with `fields`, a known path with another method is a 405 with `Allow`, bodyparser and limiter errors get their codes, anything else is `internal_error`. Shared codes have fixed messages: an error's own message, stack or details never reach a response. API 4xx are not logged.
- **CORS and caching.** `config/cors.ts` only serves `/api`: any origin, no credentials, GET, HEAD and POST, the `Accept` and `Content-Type` request headers, `Retry-After` exposed, preflights cached for 10 minutes. `publicApi` also sends `Access-Control-Allow-Origin: *` without an `Origin`, for CDN copies. Every API response is `Cache-Control: no-store` unless its route uses `middleware.publicCache()`: a 200 GET or HEAD then gets `public, max-age=60, stale-while-revalidate=600` and an ETag, and a matching `If-None-Match` a 304 (pass `{ maxAge, staleWhileRevalidate }` for other seconds). Never cache a response that isn't the same for everyone (the deposit page, TAT-65); a test makes every API GET route choose.
- **A new endpoint.** Contract first (`openapi.yaml`, then `pnpm --filter @tattoo-drip/types generate`), then a case in `tests/isolation/public_cases.ts`, the caching decision, and tests with `assertApiData` / `assertApiError` (`#tests/helpers/api`). TAT-38 adds its rate limits to the group's `use` lists (per IP before `publicTenant`, per tenant after) and must keep per-caller headers off cacheable responses.
```

- [ ] **Step 2: Database conventions**

In `apps/platform/database/README.md`, in the "SECURITY DEFINER functions" bullet:
- replace "There is one: `expired_quote_candidates()` (TAT-83, the expiry sweep)." with "There are two: `expired_quote_candidates()` (TAT-83, the expiry sweep) and `tenant_for_slug(requested_slug)` (TAT-32, the public API's tenant lookup).";
- replace "returns ids only, takes no arguments," with "returns ids only, takes no arguments (the one exception is an exact lookup: one text argument compared with `=` against a unique column, returning at most one id, as `tenant_for_slug` does; name the argument so no column shadows it),";
- replace "Callers act on the rows only through tenant-scoped code (a `TenantJob`)." with "Callers act on the rows only through tenant-scoped code (a `TenantJob`, or the public API's request transaction).";
- replace "missing from `DEFINER_FUNCTIONS` (keys are `schema.name`)," with "missing from `DEFINER_FUNCTIONS` (keys are `schema.name`, with the expected argument list),";
- append to the bullet: "`tenant_for_slug` reads `tenant_slugs.slug`, `tenant_slugs.tenant_id`, `tenants.id` and `tenants.deleted_at`; a migration that drops or retypes one of them must replace it in the same migration."

- [ ] **Step 3: Testing**

In `apps/platform/docs/testing.md`, under "Tenant isolation tests", after the bullet that starts "Every `/t/:tenant` route needs an entry", add:

```markdown
- Public API routes (TAT-32) are not in `cases.ts`: there is no signed-in actor, and another studio's slug is simply another tenant. Each `/api/v1/tenants/:tenant` route needs an entry in `tests/isolation/public_cases.ts` (method, pattern, valid body, own status, `ownMarkers`, snapshot); `public_api.spec.ts` requests it under studio A's slug and fails if the answer mentions studio B (`publicMarkers`: ids, slug and names) or B changed. `api_routes.spec.ts` fails for a route without a case, for an API route without `publicApi` first or with web middleware, and for an API GET route without `publicCache()` or a written reason. Assert API responses with `assertApiData`, `assertApiError` and `assertNoCookies` from `#tests/helpers/api` (TAT-47's schema check goes there). Test-only API routes live under `/api/v1/__test` and `/api/v1/tenants/:tenant/__test`; the guards skip `__test` patterns.
```

and in the SECURITY DEFINER bullet, after "sees every tenant's committed rows, the dev database's included", add "(so does `tenant_for_slug()`: an 'unknown slug' test must use a slug no dev studio has)".

- [ ] **Step 4: SDK, architecture, index**

In `docs/sdk.md`, replace the paragraph "The core SDK targets one API version (`v1`) and one tenant per client. It has typed inputs and outputs, typed errors (`TattooApiError` with `status`, `code` and `fields`), no caching or UI state, and no business rules." with:

```markdown
The core SDK targets one API version (`v1`) and one tenant per client. It has typed inputs and outputs, typed errors (`TattooApiError` with `status`, `code`, `message`, `fields` and `retryAfter`), no caching or UI state, and no business rules. Every call sends `Accept: application/json` and no cookies (`credentials: "omit"`), gives up after `timeoutMs` (10 seconds by default) with code `timeout`, and takes `{ signal }` to cancel, after which it rejects with the signal's `AbortError`. A response that never arrived is status 0 with `timeout` or `network_error`; a 2xx without `{ data }` is `invalid_response`.
```

After the sentence "For SSR prefetching in route loaders, use …" add: "The query options forward TanStack Query's `signal`, so a query nobody needs any more cancels its request."

In the "Contract, keys, stability" list, after the **Contract** bullet, add:

```markdown
- **Envelopes and codes:** `{ data }` on success; `{ error: { code, message, fields? } }` on failure. Shared codes: `bad_request`, `not_found`, `method_not_allowed`, `payload_too_large`, `unsupported_media_type`, `validation_failed` (with `fields`), `rate_limited` (with `Retry-After`), `internal_error`; an endpoint may add its own, listed in `openapi.yaml`. Branch on `code`, never on `message`.
- **Tenants and old slugs:** the path slug is matched exactly. An old slug answers reads like the current one, and `studio.get()` returns the current `slug` (the studio page redirects with it); a write under an old slug is a 404.
- **Stateless, CORS, caching:** no cookies or sessions; CORS allows any origin without credentials. Cacheable reads send `Cache-Control: public, max-age=60, stale-while-revalidate=600` and an `ETag`; everything else is `no-store`.
```

In `docs/architecture.md`, change the REST API row of the tenant table to `| REST API | `/api/v1/tenants/blackneedle/…` | The tenant exists; old slugs answer reads as aliases, writes need the current slug |` and replace the **Caching** bullet with:

```markdown
- **Caching:** public reads that opt in send `Cache-Control: public, max-age=60, stale-while-revalidate=600` with an ETag behind a CDN; storefront pages use short TTLs too, and slots will have the shortest. Errors and writes are `no-store`.
```

In `docs/README.md`, change "Platform services, controllers, tenancy, database conventions" to "Platform services, controllers, tenancy, public API, database conventions".

- [ ] **Step 5: Check and commit**

Run: `pnpm -C <repo> exec biome check docs apps/platform/docs apps/platform/database/README.md`
Expected: no errors (Markdown is not linted; this confirms nothing else changed).

```bash
git -C <repo> add apps/platform/docs/backend.md apps/platform/database/README.md apps/platform/docs/testing.md docs/sdk.md docs/architecture.md docs/README.md
git -C <repo> commit -m "docs(platform): document the public API foundation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification

- [ ] **Step 1: Generated files are current**

Run: `pnpm -C <repo> --filter @tattoo-drip/types generate && git -C <repo> diff --exit-code packages/types/src/openapi.gen.ts`
Run: `pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> diff --exit-code apps/platform/.adonisjs`
Expected: no diff for either.

- [ ] **Step 2: The migration round-trips**

Run: `pnpm -C <repo>/apps/platform exec node ace migration:rollback --connection=owner` then `pnpm -C <repo>/apps/platform migrate`
Expected: only `1791640000000_create_tenant_for_slug_function` rolls back and re-applies; `git -C <repo> status --short apps/platform/database/schema.ts` is clean (after `pnpm -C <repo> exec biome check --write apps/platform/database/schema.ts` if the generator reformatted it).

- [ ] **Step 3: All suites**

Run in the background: `PORT=3402 timeout 600 pnpm -C <repo>/apps/platform test > <scratchpad>/full.log 2>&1`
Expected: the log's `Tests` line shows every test passed (TAT-24 ended at 930; this adds about 60).

Run: `pnpm -C <repo> --filter @tattoo-drip/sdk test`
Expected: PASS, 11 tests.

- [ ] **Step 4: Root gates**

Run: `pnpm -C <repo> check`, `pnpm -C <repo> typecheck`, `pnpm -C <repo> build`
Expected: all clean.

- [ ] **Step 5 (optional): See it**

Start a dev server on 3401 (`PORT=3401 pnpm -C <repo>/apps/platform dev`, in the background), then `curl -si http://localhost:3401/api/v1/tenants/<a dev studio's slug>` (200, `{ data }`, the cache headers, `access-control-allow-origin: *`, no `set-cookie`) and `curl -si -X POST http://localhost:3401/api/v1/tenants/<slug>` (405). Stop the server by its exact PID (`pgrep -af "ace serve"`, then `kill <pid>`).

- [ ] **Step 6: PR text**

Write `<scratchpad>/pr2-tat-32.md` (not committed): a few "what and why" bullets per change (contract, SDK, stateless stack, CORS, envelope, tenant lookup and its migration, cache headers, guards and isolation, docs), the rulings the user may want to overrule (spec "Rulings" 1, 5, 6, 11), deviations from this plan, and: "Before any public deploy: TAT-38 (rate limits; each API request holds a pooled connection) and TAT-55 (bot challenge)."
