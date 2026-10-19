# Wire the SDK: per-request client, TattooProvider, SSR prefetch (TAT-23) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every storefront router gets its own `QueryClient` and SDK client (per server request with the confirmed studio and the optional server key; per browser tab without a key), the root loader prefetches the studio through `tattooQueries`, the page hydrates without a second fetch, and `TattooProvider` makes the `@tattoo-drip/react` hooks work everywhere.

**Architecture:** Pure modules in `apps/storefront/src/api/` (query defaults, the per-router API context with a set-once client holder, the loader helpers) carry the logic and are unit-tested with `node:test` + `tsx`. A Start isomorphic function (`createRequestApi`) builds the context on the server from TAT-12's `requestStudio()` and `storefrontConfig()`, and unconnected in the browser; `getRouter()` passes it as router context and carries `{ apiUrl, tenant }` to the browser through the router's `dehydrate`/`hydrate`. TAT-12's settings parser gains the optional `STOREFRONT_SERVER_KEY`, which its lookup also sends.

**Tech Stack:** TanStack Start 1.168 (`createIsomorphicFn`), TanStack Router 1.170 (router context, `dehydrate`/`hydrate`, `notFound`), TanStack Query 5.104 (`queryClient.query`, `dehydrate`, `hydrate`, `QueryObserver`), `@tanstack/react-router-ssr-query`, `@tattoo-drip/sdk`, `@tattoo-drip/react`, `node:test` with `tsx`, TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-23-sdk-wiring-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- Storefront plus one line in `packages/react` (`tattooQueries.deposit` gets `staleTime: 0`, Task 3). No platform, contract or SDK change. The storefront never imports from `apps/platform`; `packages/*` never import `apps/*`.
- No new route file: never run `generate-routes`. `src/routeTree.gen.ts` is never hand-edited; it changes only if the Start plugin rewrites it on `build`.
- Settings, verbatim: `API_URL` and `STOREFRONT_URL` (TAT-12, unchanged) and `STOREFRONT_SERVER_KEY`: optional; when set (after trimming), 32 to 256 characters of `A-Z a-z 0-9 - . _ ~ + /`, then optional `=` padding (`/^[A-Za-z0-9._~+/-]{32,256}=*$/`); read only by `src/tenancy/config.ts` from `process.env`; never `VITE_`-prefixed, never in `src/env.ts`, never in Vite `define`. Error messages name the variable and its rule, never the value. `serverKey` is on the config object only when set. Never edit a real `.env`/`.env.local` file; only `apps/storefront/.env.local.example`.
- Constants, verbatim: `STALE_TIME_MS = 60_000`, `MAX_RETRIES = 2`, `MAX_RETRY_AFTER_SECONDS = 10`, `SERVER_TIMEOUT_MS = 5_000`; retry delay `Math.min(1000 * 2 ** failureCount, 8000)` ms, or `retryAfter * 1000` when the error has `retryAfter`.
- Messages, verbatim: not connected: `The Tattoo Drip client is not connected yet: getRouter() connects it on the server, the router's hydrate in the browser.`; twice: `The Tattoo Drip client is already connected.`; mismatch: `The client's tenant must be the connection's tenant.`; bad connection: `This page's API connection is missing or invalid. Reload the page.`
- Router context is exactly `{ queryClient, tattoo }` (`tattoo: TattooClientRef`). Never put a client, a config object or the key into loader data, a `beforeLoad` return value or query data: the router serializes those into the page.
- No `new QueryClient` or `createTattooClient` at module scope anywhere in `apps/storefront/src`.
- `src/api/query-client.ts`, `context.ts` and `loaders.ts` run in the browser too: they import only types from `src/tenancy/config.ts`. Only `src/api/request.ts` imports `storefrontConfig` and `requestStudio`. Modules and tests import each other by relative path with the `.ts` extension. Tests live in `apps/storefront/test/api/`; they reuse TAT-12's `test/tenancy/helpers.ts` (`fakeFetch`, `json`).
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root (this worktree). `<scratchpad>` is the session's scratchpad directory; temp files go there, never `/tmp`. Never `sh -c`. Ports: 3402 for the platform tests, 3403 for the fake API, 3404 for the built storefront (3333 is taken). Start servers in the background, stop them by their exact PID (never `pkill -f`).
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with the `storefront` (or `react`) scope and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line of your own session's reminder). Never push, never open a PR.

## Review Focus

1. A server read that fails must leave neither its error nor the key in the page, so the browser fetches it again with its own client. Test: Task 5 "nothing the page carries holds the server key".
2. A hydrated page must not fetch the studio again on mount (every visitor would double the API's reads). Test: Task 5 "the browser shows the server's studio without asking the API again" (with a stale-at-once control).
3. Two server requests for different studios at the same time must never see each other's client or cache. Test: Task 5 "never share a QueryClient, a client or cached data".
4. A page whose dehydrated connection is missing or malformed must fail loudly, never guess a tenant or an API. Test: Task 5 "parseConnection accepts an origin and a stored slug, nothing else" and "a page without a valid connection can't hydrate".
5. Cached studio data older than 60 s must still be served by the loader without a fetch (the loader is "cached, else fetch", not "fresh, else fetch"). Test: Task 6 "answers from the cache even when its data is stale".

---

## Task 0: Preconditions

- [ ] **Step 1: The base has TAT-12's built code and the built SDK chain.** This branch was designed on 1b24abb (TAT-12's design commit). Run:

```bash
rg -n "export const requestStudio" apps/storefront/src/tenancy/middleware.ts
rg -n "export function parseStorefrontConfig" apps/storefront/src/tenancy/config.ts
rg -n "export async function lookUpTenant" apps/storefront/src/tenancy/lookup.ts
rg -n "tenantMiddleware" apps/storefront/src/start.ts
rg -n "\"test\":|\"@tattoo-drip/sdk\"" apps/storefront/package.json
rg -n "export interface RequestOptions|submitProof:" packages/sdk/src/client.ts
rg -n "submitDepositProof:|deposit: \(client" packages/react/src/queries.ts
ls apps/storefront/test/tenancy/helpers.ts
```

Expected: every pattern found and the file listed. If anything is missing, STOP: the branch must first be rebased onto TAT-12's built tip (which sits on the public API chain's built tip); that is the coordinator's call, and only the spec and plan commit sits on top.

- [ ] **Step 2: Clean tree and Node.** `git status -sb` shows no changes; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`.

- [ ] **Step 3: Baselines.** Run and note each `# pass` count:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test
```

Expected: `# fail 0` in each.

- [ ] **Step 4: Read TAT-12's code you will edit.** Read `apps/storefront/src/tenancy/config.ts`, `lookup.ts`, `handle.ts` and their tests in `apps/storefront/test/tenancy/`. The edits below are written against TAT-12's plan; if its review changed these functions, apply the same change to the code as it is now.

---

### Task 1: The optional server key setting

**Files:**
- Modify: `apps/storefront/src/tenancy/config.ts`
- Modify: `apps/storefront/.env.local.example`
- Test: `apps/storefront/test/tenancy/config.test.ts`

**Interfaces:**
- Consumes: TAT-12's `parseStorefrontConfig(env)`, `StorefrontConfig`, `problem(name, value, rule)`.
- Produces: `StorefrontConfig.serverKey?: string` (present only when set); `parseStorefrontConfig` reports a bad `STOREFRONT_SERVER_KEY` with the other problems.

- [ ] **Step 1: Write the failing test**

Append to `apps/storefront/test/tenancy/config.test.ts` (it already has `PROD` and `failure`):

```ts
describe("STOREFRONT_SERVER_KEY", () => {
	const KEY = "test-server-key-0123456789abcdefghijklmnop";

	test("is optional: without one the config has no serverKey", () => {
		for (const value of [undefined, "", "   "]) {
			const config = parseStorefrontConfig({
				...PROD,
				STOREFRONT_SERVER_KEY: value,
			});
			assert.equal("serverKey" in config, false, JSON.stringify(value));
		}
	});

	test("reads a key of token68 characters, trimmed", () => {
		for (const key of [KEY, `${"q".repeat(43)}=`, "a".repeat(256)]) {
			assert.equal(
				parseStorefrontConfig({ ...PROD, STOREFRONT_SERVER_KEY: ` ${key}\n` })
					.serverKey,
				key,
			);
		}
	});

	test("refuses a short, spaced or odd key without echoing it", () => {
		for (const key of [
			"changeme",
			"a".repeat(31),
			"a".repeat(257),
			`${"a".repeat(20)} ${"b".repeat(20)}`,
			`${"a".repeat(32)}é`,
			`${"a".repeat(16)}=${"b".repeat(16)}`,
			`${"a".repeat(32)}"`,
		]) {
			const message = failure({ ...PROD, STOREFRONT_SERVER_KEY: key });
			assert.match(message, /STOREFRONT_SERVER_KEY is invalid/, key);
			assert.doesNotMatch(message, /API_URL is|STOREFRONT_URL is/, key);
			assert.ok(!message.includes(key), key);
		}
	});

	test("is reported with the other settings' problems", () => {
		const message = failure({ STOREFRONT_SERVER_KEY: "changeme" });
		assert.match(message, /API_URL is not set/);
		assert.match(message, /STOREFRONT_SERVER_KEY is invalid/);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL in "reads a key of token68 characters, trimmed" (`serverKey` is undefined) and "refuses a short, spaced or odd key" (no error thrown); TAT-12's tests still pass.

- [ ] **Step 3: Read the key in `config.ts`**

In `apps/storefront/src/tenancy/config.ts`:

Add to `interface StorefrontConfig`, after `port`:

```ts
	/**
	 * STOREFRONT_SERVER_KEY, only when set: the secret the server sends with
	 * its API calls (Authorization: Bearer), for rate limiting only. The
	 * platform checks it from TAT-38. Never sent to a browser.
	 */
	serverKey?: string;
```

After the `STOREFRONT_URL_RULE` constant, add:

```ts
const SERVER_KEY_RULE =
	"32 to 256 letters, digits or -._~+/ characters, then optional = padding, e.g. the output of openssl rand -base64 32";

/** RFC 7235 token68, the characters a Bearer token may hold, at least 32 of them. */
const SERVER_KEY_SHAPE = /^[A-Za-z0-9._~+/-]{32,256}=*$/;
```

In `parseStorefrontConfig`, replace the body from `const site = …` to the `return` with:

```ts
	const site = readStorefrontUrl(env.STOREFRONT_URL?.trim(), problems);
	const serverKey = readServerKey(env.STOREFRONT_SERVER_KEY?.trim(), problems);
	if (!apiUrl || !site || problems.length > 0) {
		const list = problems.map((problem) => `- ${problem}`).join("\n");
		throw new Error(
			`The storefront's settings are invalid (see apps/storefront/.env.local.example):\n${list}`,
		);
	}
	return { apiUrl, ...site, ...(serverKey ? { serverKey } : {}) };
```

and change its comment's first sentence to: "Reads API_URL and STOREFRONT_URL (the platform's setting of the same name and value, TAT-65), and STOREFRONT_SERVER_KEY when set (TAT-23)."

After `readStorefrontUrl`, add:

```ts
/** Optional until the platform checks it (TAT-38); refused when set but malformed. */
function readServerKey(
	value: string | undefined,
	problems: string[],
): string | undefined {
	if (!value) return undefined;
	if (!SERVER_KEY_SHAPE.test(value)) {
		problems.push(problem("STOREFRONT_SERVER_KEY", value, SERVER_KEY_RULE));
		return undefined;
	}
	return value;
}
```

- [ ] **Step 4: Document it in the example file**

In `apps/storefront/.env.local.example`, after the `STOREFRONT_URL=…` line and its blank line, add:

```bash
# Secret key the storefront's server sends with its API calls
# (Authorization: Bearer), for rate limiting only. Optional until the
# platform checks it (TAT-38). Never give it a VITE_ prefix: it must never
# reach a browser. Make one with: openssl rand -base64 32
# STOREFRONT_SERVER_KEY=

```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0` (TAT-12's `deepEqual` tests still pass: no `serverKey` property without a key).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/tenancy/config.ts apps/storefront/test/tenancy/config.test.ts apps/storefront/.env.local.example
git commit -m "feat(storefront): read an optional server key for the API"
```

---

### Task 2: The studio lookup sends the server key

**Files:**
- Modify: `apps/storefront/src/tenancy/lookup.ts`
- Modify: `apps/storefront/src/tenancy/handle.ts`
- Test: `apps/storefront/test/tenancy/lookup.test.ts`, `apps/storefront/test/tenancy/handle.test.ts`

**Interfaces:**
- Consumes: `StorefrontConfig.serverKey?` (Task 1); TAT-12's `lookUpTenant`, `handleTenantRequest`, test helpers `fakeFetch`, `json`, and `handle.test.ts`'s `api()`, `deps()`, `request()`, `CONFIG`.
- Produces: `LookupOptions.key?: string`; `handleTenantRequest` passes `deps.config.serverKey` to the lookup.

- [ ] **Step 1: Write the failing tests**

In `apps/storefront/test/tenancy/lookup.test.ts`, after the `notFound` constant add `const KEY = "test-server-key-0123456789abcdefghijklmnop";` and add inside `describe("lookUpTenant", …)`:

```ts
	test("sends the server key as a bearer token, and no Authorization without one", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: studio }));

		await lookUpTenant("blackneedle", { apiUrl: API, key: KEY, fetch });
		await lookUpTenant("blackneedle", { apiUrl: API, fetch });

		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			`Bearer ${KEY}`,
		);
		assert.equal(new Headers(calls[1].init.headers).get("authorization"), null);
	});
```

In `apps/storefront/test/tenancy/handle.test.ts`, after the `TENANTS` constant add `const KEY = "test-server-key-0123456789abcdefghijklmnop";` and add inside `describe("handleTenantRequest", …)`:

```ts
	test("the lookup carries the configured server key", async () => {
		const { calls, fetch } = api();

		await handleTenantRequest(
			request("blackneedle.tattoodrip.com"),
			deps(fetch, { config: { ...CONFIG, serverKey: KEY } }),
		);

		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			`Bearer ${KEY}`,
		);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL in both new tests (`authorization` is `null`: the key isn't passed on); the others pass.

- [ ] **Step 3: Pass the key on**

In `apps/storefront/src/tenancy/lookup.ts`, add to `interface LookupOptions` after `apiUrl`:

```ts
	/** STOREFRONT_SERVER_KEY, sent as the SDK's bearer key when set (TAT-23). */
	key?: string;
```

and in `lookUpTenant`'s `createTattooClient({ … })` add `key: options.key,` after `tenant: slug,`.

In `apps/storefront/src/tenancy/handle.ts`, in the `lookUpTenant(target.slug, { … })` call, add `key: deps.config.serverKey,` after `apiUrl: deps.config.apiUrl,`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/tenancy/lookup.ts apps/storefront/src/tenancy/handle.ts apps/storefront/test/tenancy/lookup.test.ts apps/storefront/test/tenancy/handle.test.ts
git commit -m "feat(storefront): send the server key with the studio lookup"
```

---

### Task 3: The deposit query stays stale whatever the app's default

**Files:**
- Modify: `packages/react/src/queries.ts`
- Test: `packages/react/test/deposit.test.ts`

**Interfaces:**
- Consumes: `tattooQueries.deposit(client, token)` (TAT-65).
- Produces: `tattooQueries.deposit(...).staleTime === 0`. Task 4's 60 s default needs it so TAT-65's focus refetch keeps working.

- [ ] **Step 1: Write the failing test**

In `packages/react/test/deposit.test.ts`, change the first `@tanstack/react-query` import to:

```ts
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
```

and add inside `describe("tattooQueries.deposit", …)`:

```ts
	test("it is stale at once whatever the app's staleTime, so a mount or focus refetches it", async () => {
		const { calls, client } = clientAnswering(200, { data: PAGE });
		const queryClient = new QueryClient({
			defaultOptions: { queries: { staleTime: 60_000 } },
		});
		const options = tattooQueries.deposit(client, TOKEN);
		await queryClient.query(options);

		const observer = new QueryObserver(queryClient, options);
		const unsubscribe = observer.subscribe(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));
		unsubscribe();

		assert.equal(options.staleTime, 0);
		assert.equal(calls.length, 2);
	});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test`
Expected: FAIL in the new test (`staleTime` is `undefined`, one call); the others pass.

- [ ] **Step 3: Set the deposit query's staleTime**

In `packages/react/src/queries.ts`, in `tattooQueries.deposit`'s `queryOptions({ … })`, add `staleTime: 0,` after the `queryFn` line, and replace the last sentence of its comment ("Refetched when the window regains focus, so coming back from the payment app shows the latest state.") with:

```ts
	 * Always stale (`staleTime: 0`, whatever the app's default), so it is
	 * refetched when the window regains focus: coming back from the payment
	 * app shows the latest state.
```

In the comment above `export const tattooQueries`, replace "Use them with `useQuery`, or with `queryClient.ensureQueryData` in route loaders to prefetch during SSR." with:

```ts
 * Use them with `useQuery`, or in route loaders to prefetch during SSR with
 * `queryClient.query({ ...options, staleTime: "static" })` (cached data, else
 * one fetch: TanStack Query 5.104's replacement for `ensureQueryData`).
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test`
Expected: PASS, `# fail 0`, one more test than the baseline.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/queries.ts packages/react/test/deposit.test.ts
git commit -m "fix(react): keep the deposit page stale whatever the app's staleTime"
```

---

### Task 4: The storefront's QueryClient defaults

**Files:**
- Create: `apps/storefront/src/api/query-client.ts`
- Test: `apps/storefront/test/api/query-client.test.ts`

**Interfaces:**
- Consumes: `isTattooApiError`, `TattooApiError` (`status`, `code`, `retryAfter`) from `@tattoo-drip/sdk`; `QueryClient`, `defaultShouldDehydrateQuery`, `Query`, `dehydrate` from `@tanstack/react-query`.
- Produces, from `src/api/query-client.ts`: `STALE_TIME_MS = 60_000`; `MAX_RETRIES = 2`; `MAX_RETRY_AFTER_SECONDS = 10`; `type QueryEnvironment = "server" | "browser"`; `shouldRetry(failureCount: number, error: unknown): boolean`; `retryDelay(failureCount: number, error: unknown): number`; `shouldDehydrateQuery(query: Query): boolean`; `createStorefrontQueryClient(environment: QueryEnvironment): QueryClient`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/api/query-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dehydrate } from "@tanstack/react-query";
import { TattooApiError } from "@tattoo-drip/sdk";
import {
	createStorefrontQueryClient,
	MAX_RETRIES,
	retryDelay,
	STALE_TIME_MS,
	shouldRetry,
} from "../../src/api/query-client.ts";

function apiError(status: number, code: string, retryAfter?: number) {
	return new TattooApiError(status, { code, message: "No." }, { retryAfter });
}

describe("shouldRetry", () => {
	test("retries a timeout, a network error or a 5xx twice", () => {
		for (const error of [
			apiError(0, "timeout"),
			apiError(0, "network_error"),
			apiError(500, "internal_error"),
			apiError(503, "unknown_error"),
		]) {
			assert.equal(shouldRetry(0, error), true, error.code);
			assert.equal(shouldRetry(MAX_RETRIES - 1, error), true, error.code);
			assert.equal(shouldRetry(MAX_RETRIES, error), false, error.code);
		}
		assert.equal(MAX_RETRIES, 2);
	});

	test("never retries a 4xx or an odd 2xx: asking again gets the same answer", () => {
		for (const error of [
			apiError(400, "bad_request"),
			apiError(404, "not_found"),
			apiError(409, "deposit_changed"),
			apiError(422, "validation_failed"),
			apiError(200, "invalid_response"),
		]) {
			assert.equal(shouldRetry(0, error), false, error.code);
		}
	});

	test("retries a 429 once, only after a short Retry-After", () => {
		assert.equal(shouldRetry(0, apiError(429, "rate_limited", 5)), true);
		assert.equal(shouldRetry(1, apiError(429, "rate_limited", 5)), false);
		assert.equal(shouldRetry(0, apiError(429, "rate_limited", 11)), false);
		assert.equal(shouldRetry(0, apiError(429, "rate_limited")), false);
	});

	test("doesn't wait out a long Retry-After on a 5xx either", () => {
		assert.equal(shouldRetry(0, apiError(503, "unknown_error", 10)), true);
		assert.equal(shouldRetry(0, apiError(503, "unknown_error", 30)), false);
	});

	test("never retries what isn't an API error: a bug or a cancellation", () => {
		assert.equal(shouldRetry(0, new TypeError("x is undefined")), false);
		assert.equal(
			shouldRetry(0, new DOMException("Aborted", "AbortError")),
			false,
		);
	});
});

describe("retryDelay", () => {
	test("waits 1 s, then 2 s, never more than 8 s", () => {
		const offline = apiError(0, "network_error");
		assert.equal(retryDelay(0, offline), 1_000);
		assert.equal(retryDelay(1, offline), 2_000);
		assert.equal(retryDelay(5, offline), 8_000);
	});

	test("waits the Retry-After the API sent", () => {
		assert.equal(retryDelay(0, apiError(429, "rate_limited", 3)), 3_000);
	});
});

describe("createStorefrontQueryClient", () => {
	test("keeps data fresh for the API's max-age, on both sides", () => {
		assert.equal(STALE_TIME_MS, 60_000);
		for (const environment of ["server", "browser"] as const) {
			const queries =
				createStorefrontQueryClient(environment).getDefaultOptions().queries;
			assert.equal(queries?.staleTime, STALE_TIME_MS, environment);
		}
	});

	test("retries in the browser only", () => {
		assert.equal(
			createStorefrontQueryClient("server").getDefaultOptions().queries?.retry,
			false,
		);
		const browser =
			createStorefrontQueryClient("browser").getDefaultOptions().queries;
		assert.equal(browser?.retry, shouldRetry);
		assert.equal(browser?.retryDelay, retryDelay);
	});

	test("is a new client each time", () => {
		assert.notEqual(
			createStorefrontQueryClient("server"),
			createStorefrontQueryClient("server"),
		);
	});
});

describe("what a page carries", () => {
	test("successful and pending queries, never a failed one", async () => {
		const queryClient = createStorefrontQueryClient("server");
		queryClient.setQueryData(["done"], { ok: true });
		await queryClient
			.query({
				queryKey: ["failed"],
				queryFn: () => Promise.reject(apiError(500, "internal_error")),
			})
			.catch(() => undefined);
		void queryClient.query({
			queryKey: ["waiting"],
			queryFn: () => new Promise(() => undefined),
		});

		assert.deepEqual(
			dehydrate(queryClient).queries.map((query) => query.queryKey),
			[["done"], ["waiting"]],
		);
	});

	test("a pending query that fails later sends no error message", async () => {
		const queryClient = createStorefrontQueryClient("server");
		let fail: (error: unknown) => void = () => undefined;
		void queryClient
			.query({
				queryKey: ["late"],
				queryFn: () =>
					new Promise((_, reject) => {
						fail = reject;
					}),
			})
			.catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const [late] = dehydrate(queryClient).queries;
		fail(apiError(500, "internal_error"));

		assert.ok(late?.promise);
		await assert.rejects(late.promise, { message: "redacted" });
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/api/query-client.ts`; the tenancy tests pass.

- [ ] **Step 3: Write `query-client.ts`**

Create `apps/storefront/src/api/query-client.ts`:

```ts
import {
	defaultShouldDehydrateQuery,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import { isTattooApiError } from "@tattoo-drip/sdk";

/**
 * How long fetched data counts as fresh: the API's own max-age (TAT-32), so
 * a query hydrated from the server isn't fetched again when its page mounts.
 */
export const STALE_TIME_MS = 60_000;

/** Retries after a first failed read, in the browser only. */
export const MAX_RETRIES = 2;

/** A Retry-After longer than this (seconds) isn't waited for: the error shows. */
export const MAX_RETRY_AFTER_SECONDS = 10;

export type QueryEnvironment = "server" | "browser";

/**
 * Retry a read only when asking again can help: a timeout, a network error
 * or a 5xx (twice), a 429 once after its Retry-After. Never a 4xx, never a
 * long Retry-After, never something that isn't an API error (a bug or a
 * cancellation).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	if (!isTattooApiError(error)) return false;
	if (
		error.retryAfter !== undefined &&
		error.retryAfter > MAX_RETRY_AFTER_SECONDS
	) {
		return false;
	}
	if (error.status === 429) {
		return error.retryAfter !== undefined && failureCount < 1;
	}
	const transient = error.status === 0 || error.status >= 500;
	return transient && failureCount < MAX_RETRIES;
}

/** The API's Retry-After when it sent one, else 1 s, 2 s, … at most 8 s. */
export function retryDelay(failureCount: number, error: unknown): number {
	if (isTattooApiError(error) && error.retryAfter !== undefined) {
		return error.retryAfter * 1000;
	}
	return Math.min(1000 * 2 ** failureCount, 8000);
}

/**
 * What a server render sends the browser: successful queries, and pending
 * ones (streamed when they settle; a rejection arrives redacted). A failed
 * read stays on the server and the browser asks again.
 */
export function shouldDehydrateQuery(query: Query): boolean {
	return defaultShouldDehydrateQuery(query) || query.state.status === "pending";
}

/**
 * A QueryClient for one server request or one browser tab (TAT-23). The
 * server never retries: a page shouldn't wait seconds, and TAT-12's 503 page
 * covers an API that is down.
 */
export function createStorefrontQueryClient(
	environment: QueryEnvironment,
): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: STALE_TIME_MS,
				retry: environment === "server" ? false : shouldRetry,
				retryDelay,
			},
			dehydrate: { shouldDehydrateQuery, shouldRedactErrors: () => true },
		},
	});
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`. (In development, TanStack Query logs "A query that was dehydrated as pending ended up rejecting" for the last test: expected.)

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/api/query-client.ts apps/storefront/test/api/query-client.test.ts
git commit -m "feat(storefront): give the storefront's QueryClient its defaults"
```

---

### Task 5: The per-router API context

**Files:**
- Modify: `apps/storefront/package.json` (`@tattoo-drip/react` dependency)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)
- Create: `apps/storefront/src/api/context.ts`
- Test: `apps/storefront/test/api/context.test.ts`, `apps/storefront/test/api/single-copy.test.ts`

**Interfaces:**
- Consumes: `createStorefrontQueryClient`, `type QueryEnvironment` (Task 4); `type StorefrontConfig` with `serverKey?` (Task 1); `STORED_SLUG` from `src/tenancy/host.ts` (TAT-12); `createTattooClient`, `type Studio`, `type TattooClient` from `@tattoo-drip/sdk`; `tattooQueries`, `tattooKeys` from `@tattoo-drip/react`; `fakeFetch`, `json` from `test/tenancy/helpers.ts`.
- Produces, from `src/api/context.ts`: `interface TattooConnection { readonly apiUrl: string; readonly tenant: string }`; `class TattooClientRef` (`connect(connection: TattooConnection, client: TattooClient): void`, getters `client: TattooClient`, `connection: TattooConnection`); `interface ApiContext { readonly queryClient: QueryClient; readonly tattoo: TattooClientRef }`; `interface DehydratedApi { tattoo: TattooConnection }`; `SERVER_TIMEOUT_MS = 5_000`; `createApiContext(environment: QueryEnvironment): ApiContext`; `connectServer(api: ApiContext, options: { config: Pick<StorefrontConfig, "apiUrl" | "serverKey">; studio: Studio; fetch?: typeof fetch }): void`; `seedStudio(api: ApiContext, studio: Studio): void`; `dehydrateApi(api: ApiContext): DehydratedApi`; `hydrateApi(api: ApiContext, dehydrated: { tattoo?: unknown } | undefined, options?: { fetch?: typeof fetch }): void`; `parseConnection(value: unknown): TattooConnection`.

- [ ] **Step 1: Add `@tattoo-drip/react`**

In `apps/storefront/package.json` `"dependencies"`, before `"@tattoo-drip/sdk"`, add:

```json
		"@tattoo-drip/react": "workspace:*",
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install`
Expected: completes without a peer-dependency warning for `@tattoo-drip/react`; the lockfile links it into `apps/storefront`.

- [ ] **Step 2: Guard the single copy**

Create `apps/storefront/test/api/single-copy.test.ts`:

```ts
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

/**
 * @tattoo-drip/react is consumed from source with its own node_modules. A
 * second copy of React or TanStack Query there would give its hooks a
 * context without the app's QueryClient ("No QueryClient set"). If this
 * fails, align the versions (pnpm why @tanstack/react-query); don't alias.
 */
test("@tattoo-drip/react resolves the storefront's React and TanStack Query", () => {
	for (const name of ["react", "@tanstack/react-query"]) {
		const app = realpathSync(new URL(`../../node_modules/${name}`, import.meta.url));
		const sdk = realpathSync(
			new URL(`../../../../packages/react/node_modules/${name}`, import.meta.url),
		);
		assert.equal(sdk, app, name);
	}
});
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS (a guard: it passes now and fails if a later install splits the copies). If it fails, stop and report both paths.

- [ ] **Step 3: Write the failing test**

Create `apps/storefront/test/api/context.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dehydrate, hydrate, QueryObserver } from "@tanstack/react-query";
import { tattooKeys, tattooQueries } from "@tattoo-drip/react";
import type { Studio } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	dehydrateApi,
	hydrateApi,
	parseConnection,
	seedStudio,
	TattooClientRef,
} from "../../src/api/context.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

const API = "http://api.test";
const KEY = "test-server-key-0123456789abcdefghijklmnop";
const STUDIO_A: Studio = { slug: "studio-a", name: "Studio A" };
const STUDIO_B: Studio = { slug: "studio-b", name: "Studio B" };
const CONFIG = { apiUrl: API, serverKey: KEY };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const authorization = (init: RequestInit) =>
	new Headers(init.headers).get("authorization");

/** A server render's API state for `studio`, connected as getRouter() does, not seeded. */
function serverApi(
	studio: Studio,
	fetch: typeof globalThis.fetch,
	config: { apiUrl: string; serverKey?: string } = CONFIG,
) {
	const api = createApiContext("server");
	connectServer(api, { config, studio, fetch });
	return api;
}

describe("the server's client", () => {
	test("asks for the confirmed studio with the server key, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);

		assert.deepEqual(await api.tattoo.client.studio.get(), STUDIO_A);
		assert.equal(calls[0].url, `${API}/api/v1/tenants/studio-a`);
		assert.equal(authorization(calls[0].init), `Bearer ${KEY}`);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("sends no Authorization when no key is set", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch, { apiUrl: API });

		await api.tattoo.client.studio.get();
		assert.equal(authorization(calls[0].init), null);
	});

	test("seeding puts the middleware's studio in the cache under its tenant", () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);
		seedStudio(api, STUDIO_A);

		assert.deepEqual(
			api.queryClient.getQueryData(tattooKeys.studio("studio-a")),
			STUDIO_A,
		);
		assert.equal(calls.length, 0);
	});
});

describe("TattooClientRef", () => {
	test("has no client or connection until it is connected", () => {
		const ref = new TattooClientRef();
		assert.throws(() => ref.client, /not connected yet/);
		assert.throws(() => ref.connection, /not connected yet/);
	});

	test("connects once, to a client of the connection's tenant", () => {
		const { fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		const api = serverApi(STUDIO_A, fetch);
		assert.throws(
			() =>
				api.tattoo.connect({ apiUrl: API, tenant: "studio-a" }, api.tattoo.client),
			/already connected/,
		);

		const other = createApiContext("server");
		assert.throws(
			() =>
				other.tattoo.connect(
					{ apiUrl: API, tenant: "studio-b" },
					api.tattoo.client,
				),
			/tenant must be the connection's tenant/,
		);
	});
});

describe("what the browser gets", () => {
	test("only the API's origin and the studio's slug", () => {
		const { fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		assert.deepEqual(dehydrateApi(serverApi(STUDIO_A, fetch)), {
			tattoo: { apiUrl: API, tenant: "studio-a" },
		});
	});

	test("nothing the page carries holds the server key", async () => {
		const { fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(500, {
						error: { code: "internal_error", message: "Something broke." },
					})
				: json(200, { data: STUDIO_A }),
		);
		const api = serverApi(STUDIO_A, fetch);
		seedStudio(api, STUDIO_A);
		const failure = await api.queryClient
			.query(tattooQueries.artists(api.tattoo.client))
			.catch((error: unknown) => error);

		const queries = dehydrate(api.queryClient);
		const carried = JSON.stringify({ router: dehydrateApi(api), queries });
		assert.ok(!carried.includes(KEY));
		// The failed read stays on the server: only the studio goes.
		assert.deepEqual(
			queries.queries.map((query) => query.queryKey),
			[tattooKeys.studio("studio-a")],
		);
		// Neither the ref, the client nor the error exposes the key.
		assert.equal(JSON.stringify(api.tattoo), "{}");
		assert.ok(!JSON.stringify(api.tattoo.client).includes(KEY));
		assert.ok(failure instanceof Error);
		assert.ok(!failure.message.includes(KEY));
	});

	test("parseConnection accepts an origin and a stored slug, nothing else", () => {
		assert.deepEqual(parseConnection({ apiUrl: API, tenant: "studio-a" }), {
			apiUrl: API,
			tenant: "studio-a",
		});
		assert.deepEqual(
			parseConnection({
				apiUrl: "https://api.tattoodrip.app",
				tenant: "studio-a",
				extra: 1,
			}),
			{ apiUrl: "https://api.tattoodrip.app", tenant: "studio-a" },
		);
		for (const value of [
			undefined,
			null,
			"studio-a",
			{ tenant: "studio-a" },
			{ apiUrl: API },
			{ apiUrl: `${API}/api`, tenant: "studio-a" },
			{ apiUrl: `${API}/`, tenant: "studio-a" },
			{ apiUrl: "javascript:alert(1)", tenant: "studio-a" },
			{ apiUrl: "ftp://api.test", tenant: "studio-a" },
			{ apiUrl: API, tenant: "Studio-A" },
			{ apiUrl: API, tenant: "a.b" },
			{ apiUrl: API, tenant: 42 },
		]) {
			assert.throws(
				() => parseConnection(value),
				/API connection is missing or invalid/,
				JSON.stringify(value),
			);
		}
	});

	test("the browser's client has no key and sends no cookies", async () => {
		const browser = createApiContext("browser");
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO_A }));
		hydrateApi(browser, { tattoo: { apiUrl: API, tenant: "studio-a" } }, { fetch });

		await browser.tattoo.client.studio.get();
		assert.equal(calls[0].url, `${API}/api/v1/tenants/studio-a`);
		assert.equal(authorization(calls[0].init), null);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("a page without a valid connection can't hydrate", () => {
		for (const dehydrated of [undefined, {}, { tattoo: { apiUrl: API } }]) {
			assert.throws(
				() => hydrateApi(createApiContext("browser"), dehydrated),
				/API connection is missing or invalid/,
			);
		}
	});
});

describe("hydration", () => {
	test("the browser shows the server's studio without asking the API again", async () => {
		const server = fakeFetch(() => json(200, { data: STUDIO_A }));
		const serverSide = serverApi(STUDIO_A, server.fetch);
		seedStudio(serverSide, STUDIO_A);
		// What the page carries, through JSON as the HTML does.
		const page = JSON.parse(
			JSON.stringify({
				router: dehydrateApi(serverSide),
				queries: dehydrate(serverSide.queryClient),
			}),
		);

		const browser = fakeFetch(() => json(200, { data: STUDIO_A }));
		const browserSide = createApiContext("browser");
		hydrateApi(browserSide, page.router, { fetch: browser.fetch });
		hydrate(browserSide.queryClient, page.queries);

		const observer = new QueryObserver(
			browserSide.queryClient,
			tattooQueries.studio(browserSide.tattoo.client),
		);
		const unsubscribe = observer.subscribe(() => undefined);
		await tick();
		unsubscribe();
		assert.deepEqual(observer.getCurrentResult().data, STUDIO_A);
		assert.equal(browser.calls.length, 0);
		assert.equal(server.calls.length, 0);

		// Control: the same query, stale at once, is fetched on mount, so the
		// 60 s default is what saved the call.
		const stale = new QueryObserver(browserSide.queryClient, {
			...tattooQueries.studio(browserSide.tattoo.client),
			staleTime: 0,
		});
		const unsubscribeStale = stale.subscribe(() => undefined);
		await tick();
		unsubscribeStale();
		assert.equal(browser.calls.length, 1);
	});
});

describe("two requests at once", () => {
	test("never share a QueryClient, a client or cached data", async () => {
		let releaseA: () => void = () => undefined;
		const aMayAnswer = new Promise<void>((resolve) => {
			releaseA = resolve;
		});
		const answered: string[] = [];
		const { calls, fetch } = fakeFetch(async ({ url }) => {
			const studio = url.endsWith("/studio-a") ? STUDIO_A : STUDIO_B;
			if (studio === STUDIO_A) await aMayAnswer;
			answered.push(studio.slug);
			return json(200, { data: studio });
		});
		const a = serverApi(STUDIO_A, fetch);
		const b = serverApi(STUDIO_B, fetch);

		const loadA = a.queryClient.query(tattooQueries.studio(a.tattoo.client));
		const loadB = b.queryClient.query(tattooQueries.studio(b.tattoo.client));
		assert.deepEqual(await loadB, STUDIO_B);
		releaseA();
		assert.deepEqual(await loadA, STUDIO_A);

		// B was answered while A still waited.
		assert.deepEqual(answered, ["studio-b", "studio-a"]);
		assert.notEqual(a.queryClient, b.queryClient);
		assert.notEqual(a.tattoo.client, b.tattoo.client);
		assert.deepEqual(
			a.queryClient.getQueryCache().getAll().map((query) => query.queryKey),
			[tattooKeys.studio("studio-a")],
		);
		assert.deepEqual(
			b.queryClient.getQueryCache().getAll().map((query) => query.queryKey),
			[tattooKeys.studio("studio-b")],
		);
		assert.deepEqual(
			calls.map((call) => authorization(call.init)),
			[`Bearer ${KEY}`, `Bearer ${KEY}`],
		);
	});
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/api/context.ts`; the other files pass. If instead the import of `@tattoo-drip/react` itself fails (its `provider.tsx`), stop and report the exact error: `tsx` must load the package's source.

- [ ] **Step 5: Write `context.ts`**

Create `apps/storefront/src/api/context.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { tattooQueries } from "@tattoo-drip/react";
import {
	createTattooClient,
	type Studio,
	type TattooClient,
} from "@tattoo-drip/sdk";
import type { StorefrontConfig } from "../tenancy/config.ts";
import { STORED_SLUG } from "../tenancy/host.ts";
import {
	createStorefrontQueryClient,
	type QueryEnvironment,
} from "./query-client.ts";

/**
 * All the browser learns about the API (TAT-23): its origin and the studio's
 * current slug, the one the server confirmed from the Host header (TAT-12).
 */
export interface TattooConnection {
	readonly apiUrl: string;
	readonly tenant: string;
}

/** What the router's dehydrated state carries for the API. */
export interface DehydratedApi {
	tattoo: TattooConnection;
}

/**
 * The router context (TAT-23): one QueryClient and one SDK client per server
 * request, and one of each per browser tab. Loaders read
 * `context.tattoo.client`. Nothing here goes into loader data or a
 * beforeLoad result: the router serializes those into the page.
 */
export interface ApiContext {
	readonly queryClient: QueryClient;
	readonly tattoo: TattooClientRef;
}

/** How long a server-side read waits for the API, like TAT-12's lookup. */
export const SERVER_TIMEOUT_MS = 5_000;

const NOT_CONNECTED =
	"The Tattoo Drip client is not connected yet: getRouter() connects it on the server, the router's hydrate in the browser.";
const INVALID_CONNECTION =
	"This page's API connection is missing or invalid. Reload the page.";

/**
 * The router's SDK client, set once: in getRouter() on the server, in the
 * router's hydrate in the browser (before the first route matches). Private
 * fields, so serializing the ref shows nothing.
 */
export class TattooClientRef {
	#client: TattooClient | undefined;
	#connection: TattooConnection | undefined;

	connect(connection: TattooConnection, client: TattooClient): void {
		if (this.#client) {
			throw new Error("The Tattoo Drip client is already connected.");
		}
		if (client.tenant !== connection.tenant) {
			throw new Error("The client's tenant must be the connection's tenant.");
		}
		this.#connection = { apiUrl: connection.apiUrl, tenant: connection.tenant };
		this.#client = client;
	}

	get client(): TattooClient {
		if (!this.#client) throw new Error(NOT_CONNECTED);
		return this.#client;
	}

	get connection(): TattooConnection {
		if (!this.#connection) throw new Error(NOT_CONNECTED);
		return this.#connection;
	}
}

export function createApiContext(environment: QueryEnvironment): ApiContext {
	return {
		queryClient: createStorefrontQueryClient(environment),
		tattoo: new TattooClientRef(),
	};
}

export interface ServerConnectOptions {
	config: Pick<StorefrontConfig, "apiUrl" | "serverKey">;
	/** The studio the tenant middleware confirmed (TAT-12's requestStudio()). */
	studio: Studio;
	/** For tests. */
	fetch?: typeof fetch;
}

/**
 * Connects a server render's client: API_URL, the confirmed studio's slug,
 * and the server key when set (sent as Authorization: Bearer).
 */
export function connectServer(
	api: ApiContext,
	{ config, studio, fetch }: ServerConnectOptions,
): void {
	const client = createTattooClient({
		baseUrl: config.apiUrl,
		tenant: studio.slug,
		key: config.serverKey,
		timeoutMs: SERVER_TIMEOUT_MS,
		fetch,
	});
	api.tattoo.connect({ apiUrl: config.apiUrl, tenant: studio.slug }, client);
}

/**
 * Puts the tenant middleware's studio in the cache, so a render asks the API
 * for it once per page (the lookup), not twice.
 */
export function seedStudio(api: ApiContext, studio: Studio): void {
	api.queryClient.setQueryData(
		tattooQueries.studio(api.tattoo.client).queryKey,
		studio,
	);
}

/** The router's dehydrate: the connection, and nothing else. */
export function dehydrateApi(api: ApiContext): DehydratedApi {
	const { apiUrl, tenant } = api.tattoo.connection;
	return { tattoo: { apiUrl, tenant } };
}

/**
 * The router's hydrate: connects the browser's client from the connection
 * the server sent. No key; the SDK never sends cookies.
 */
export function hydrateApi(
	api: ApiContext,
	dehydrated: { tattoo?: unknown } | undefined,
	options: { fetch?: typeof fetch } = {},
): void {
	const connection = parseConnection(dehydrated?.tattoo);
	api.tattoo.connect(
		connection,
		createTattooClient({
			baseUrl: connection.apiUrl,
			tenant: connection.tenant,
			fetch: options.fetch,
		}),
	);
}

/** An http(s) origin and a stored-shape slug, or a fixed error. */
export function parseConnection(value: unknown): TattooConnection {
	if (typeof value !== "object" || value === null) {
		throw new Error(INVALID_CONNECTION);
	}
	const { apiUrl, tenant } = value as Record<string, unknown>;
	if (
		typeof apiUrl !== "string" ||
		!isOrigin(apiUrl) ||
		typeof tenant !== "string" ||
		!STORED_SLUG.test(tenant)
	) {
		throw new Error(INVALID_CONNECTION);
	}
	return { apiUrl, tenant };
}

function isOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin === value
		);
	} catch {
		return false;
	}
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. (The storefront's `tsc` now also checks `packages/react/src` under the storefront's options. If it reports errors inside `packages/react/src`, stop and report them with their exact messages.)

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/package.json pnpm-lock.yaml apps/storefront/src/api/context.ts apps/storefront/test/api/context.test.ts apps/storefront/test/api/single-copy.test.ts
git commit -m "feat(storefront): connect a QueryClient and an SDK client per router"
```

---

### Task 6: Loading through the cache, 404s as not-found

**Files:**
- Create: `apps/storefront/src/api/loaders.ts`
- Test: `apps/storefront/test/api/loaders.test.ts`

**Interfaces:**
- Consumes: `type ApiContext`, `createApiContext`, `connectServer`, `seedStudio` (Task 5); `tattooQueries` from `@tattoo-drip/react`; `isTattooApiError`, `TattooApiError`, `type Studio` from `@tattoo-drip/sdk`; `notFound`, `isNotFound` from `@tanstack/react-router`.
- Produces, from `src/api/loaders.ts`: `rethrowAsNotFound(error: unknown): never`; `loadStudio(context: ApiContext): Promise<Studio>`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/api/loaders.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isNotFound } from "@tanstack/react-router";
import { tattooKeys } from "@tattoo-drip/react";
import { type Studio, TattooApiError } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { loadStudio, rethrowAsNotFound } from "../../src/api/loaders.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

const API = "http://api.test";
const STUDIO: Studio = { slug: "studio-a", name: "Studio A" };

function serverApi(fetch: typeof globalThis.fetch) {
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl: API }, studio: STUDIO, fetch });
	return api;
}

describe("loadStudio", () => {
	test("asks the API once, then answers from the cache", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${API}/api/v1/tenants/studio-a`],
		);
	});

	test("never asks for a studio the tenant middleware already brought", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);
		seedStudio(api, STUDIO);

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.equal(calls.length, 0);
	});

	test("answers from the cache even when its data is stale", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const api = serverApi(fetch);
		api.queryClient.setQueryData(tattooKeys.studio("studio-a"), STUDIO, {
			updatedAt: Date.now() - 10 * 60_000,
		});

		assert.deepEqual(await loadStudio(api), STUDIO);
		assert.equal(calls.length, 0);
	});

	test("the API's not_found is the router's not-found", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		await assert.rejects(loadStudio(serverApi(fetch)), (error: unknown) =>
			isNotFound(error),
		);
	});

	test("any other failure stays the API's error, asked once on the server", async () => {
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		]) {
			const { calls, fetch } = fakeFetch(respond);

			await assert.rejects(
				loadStudio(serverApi(fetch)),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
			assert.equal(calls.length, 1);
		}
	});
});

describe("rethrowAsNotFound", () => {
	test("rethrows anything else as it is", () => {
		const bug = new TypeError("x is undefined");
		assert.throws(() => rethrowAsNotFound(bug), (error: unknown) => error === bug);

		const conflict = new TattooApiError(409, {
			code: "deposit_changed",
			message: "Changed.",
		});
		assert.throws(
			() => rethrowAsNotFound(conflict),
			(error: unknown) => error === conflict,
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/api/loaders.ts`; the other files pass. If the import of `@tanstack/react-router` fails in Node instead, stop and report the exact error.

- [ ] **Step 3: Write `loaders.ts`**

Create `apps/storefront/src/api/loaders.ts`:

```ts
import { notFound } from "@tanstack/react-router";
import { tattooQueries } from "@tattoo-drip/react";
import { isTattooApiError, type Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "./context.ts";

/**
 * For a loader's catch: the API's own 404 (a studio or record that no longer
 * exists) becomes the router's not-found, so the route's notFoundComponent
 * shows; anything else is rethrown as it is, for the error component.
 */
export function rethrowAsNotFound(error: unknown): never {
	if (
		isTattooApiError(error) &&
		error.status === 404 &&
		error.code === "not_found"
	) {
		throw notFound();
	}
	throw error;
}

/**
 * The root route's loader: the studio, from the cache when it has it (on the
 * server the tenant middleware's answer is already there), else from the
 * API. `query()` with staleTime "static" is cached data, else one fetch:
 * TanStack Query 5.104's replacement for the deprecated ensureQueryData.
 */
export async function loadStudio({
	queryClient,
	tattoo,
}: ApiContext): Promise<Studio> {
	try {
		return await queryClient.query({
			...tattooQueries.studio(tattoo.client),
			staleTime: "static",
		});
	} catch (error) {
		return rethrowAsNotFound(error);
	}
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/api/loaders.ts apps/storefront/test/api/loaders.test.ts
git commit -m "feat(storefront): load the studio through the cache, 404s as not-found"
```

---

### Task 7: Wire it into the router, the root route and `TattooProvider`

**Files:**
- Create: `apps/storefront/src/api/request.ts`
- Modify: `apps/storefront/src/router.tsx`
- Modify: `apps/storefront/src/routes/__root.tsx`
- Delete: `apps/storefront/src/integrations/tanstack-query/root-provider.tsx`
- Possibly modified by the build (never by hand): `apps/storefront/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `createApiContext`, `connectServer`, `seedStudio`, `dehydrateApi`, `hydrateApi`, `type ApiContext`, `type DehydratedApi` (Task 5); `loadStudio` (Task 6); `storefrontConfig()` (TAT-12, now with `serverKey`); `requestStudio()` (TAT-12); `createIsomorphicFn` from `@tanstack/react-start`; `TattooProvider` from `@tattoo-drip/react`.
- Produces: `createRequestApi(): ApiContext` from `src/api/request.ts`; router context `{ queryClient, tattoo }`; the root route's loader (`Studio`) and `<title>`.

There is no unit test for this glue (its logic is in Tasks 4 to 6): typecheck, build, the bundle check and Task 8's production run cover it.

- [ ] **Step 1: Build the API state per router**

Create `apps/storefront/src/api/request.ts`:

```ts
import { createIsomorphicFn } from "@tanstack/react-start";
import { storefrontConfig } from "../tenancy/config.ts";
import { requestStudio } from "../tenancy/middleware.ts";
import {
	type ApiContext,
	connectServer,
	createApiContext,
	seedStudio,
} from "./context.ts";

/**
 * A new router's API state (TAT-23). On the server: a client for the studio
 * the tenant middleware confirmed (TAT-12), with the server key when set,
 * and that studio already cached. In the browser: unconnected until the
 * router hydrates (hydrateApi). Start strips the server part, and with it
 * the settings and the key, from the browser bundle.
 */
export const createRequestApi = createIsomorphicFn()
	.server((): ApiContext => {
		const studio = requestStudio();
		const api = createApiContext("server");
		connectServer(api, { config: storefrontConfig(), studio });
		seedStudio(api, studio);
		return api;
	})
	.client((): ApiContext => createApiContext("browser"));
```

- [ ] **Step 2: Replace `src/router.tsx`**

```tsx
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { type DehydratedApi, dehydrateApi, hydrateApi } from "./api/context.ts";
import { createRequestApi } from "./api/request.ts";
import { routeTree } from "./routeTree.gen";

/**
 * One router per server request and one per browser tab (Start calls this
 * for each), each with its own QueryClient and SDK client (TAT-23,
 * src/api/). The server sends the browser only the API's origin and the
 * studio's slug, in the router's dehydrated state; the browser connects its
 * own client, without the server key, before the first route loads.
 */
export function getRouter() {
	const api = createRequestApi();

	const router = createTanStackRouter({
		routeTree,
		context: { queryClient: api.queryClient, tattoo: api.tattoo },
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		dehydrate: (): DehydratedApi => dehydrateApi(api),
		hydrate: (dehydrated: DehydratedApi) => hydrateApi(api, dehydrated),
	});

	// Wraps the router in the QueryClientProvider and streams the cache.
	setupRouterSsrQueryIntegration({ router, queryClient: api.queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
```

- [ ] **Step 3: Replace `src/routes/__root.tsx`**

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TattooProvider } from "@tattoo-drip/react";

import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import PostHogProvider from "../integrations/posthog/provider";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<ApiContext>()({
	// Every page needs its studio: on the server from the cache the tenant
	// middleware filled, after that from the API (TAT-23).
	loader: ({ context }) => loadStudio(context),
	head: ({ loaderData }) => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: loaderData?.name ?? "Tattoo Drip",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// This request's (server) or this tab's (browser) SDK client, for the
	// @tattoo-drip/react hooks. The QueryClientProvider around the whole
	// router comes from setupRouterSsrQueryIntegration (src/router.tsx).
	const { tattoo } = Route.useRouteContext();

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<TattooProvider client={tattoo.client}>
					<PostHogProvider>
						{children}
						{import.meta.env.DEV ? (
							<TanStackDevtools
								config={{
									position: "bottom-right",
								}}
								plugins={[
									{
										name: "Tanstack Router",
										render: <TanStackRouterDevtoolsPanel />,
									},
									TanStackQueryDevtools,
								]}
							/>
						) : null}
					</PostHogProvider>
				</TattooProvider>
				<Scripts />
			</body>
		</html>
	);
}
```

- [ ] **Step 4: Remove the old module-level QueryClient factory**

Run: `git rm apps/storefront/src/integrations/tanstack-query/root-provider.tsx`
Then: `rg -n "root-provider|getContext\(" apps/storefront/src`
Expected: no match.

- [ ] **Step 5: Typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. Any error: stop and report it with its exact message (do not cast to `any`). If TypeScript reports a circular type through `Register` on `dehydrate`, report it rather than removing the annotations.

- [ ] **Step 6: Tests still pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

- [ ] **Step 7: Build**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: succeeds without any `API_URL`, `STOREFRONT_URL` or `STOREFRONT_SERVER_KEY` set.

Run: `git status --short apps/storefront/src/routeTree.gen.ts`
Expected: no output (no route changed). If the file changed, show `git diff` of it in the report and commit it with this task (it is generator output; never hand-edit it).

- [ ] **Step 8: The key, the settings and the server-only code stay out of the browser bundle**

Run: `rg -l "STOREFRONT_SERVER_KEY|STOREFRONT_URL|s-maxage=60|Studio lookup failed" apps/storefront/.output/public; echo "exit $?"`
Expected: no file listed and `exit 1`.

Run: `rg -l "STOREFRONT_SERVER_KEY" apps/storefront/.output/server | head -3`
Expected: at least one file (proves the first check looks at real output).

Run: `rg -l "did not answer in time" apps/storefront/.output/public | head -3`
Expected: at least one file: the SDK now ships to the browser by design (the browser client). TAT-12's own check listed this string as "must not be in the client"; that part of TAT-12's check no longer applies.

Run: `rg -n "new QueryClient|createTattooClient\(" apps/storefront/src`
Expected: only inside functions in `src/api/query-client.ts`, `src/api/context.ts` and `src/tenancy/lookup.ts` (nothing at module scope).

- [ ] **Step 9: Commit**

```bash
git add apps/storefront/src/api/request.ts apps/storefront/src/router.tsx apps/storefront/src/routes/__root.tsx
git commit -m "feat(storefront): wire the SDK into the router, the root route and TattooProvider"
```

(The `git rm` from Step 4 is already staged; add `apps/storefront/src/routeTree.gen.ts` only if Step 7 changed it.)

---

### Task 8: Docs

**Files:**
- Modify: `apps/storefront/docs/development.md`, `apps/storefront/AGENTS.md`
- Modify: `docs/sdk.md`, `docs/architecture.md`, `docs/README.md`, `README.md`

Edit by content (TAT-12 and other tickets moved lines). Biome does not check Markdown: re-read each edit and check its links.

- [ ] **Step 1: Storefront development guide**

In `apps/storefront/docs/development.md`, section "Tenants and hosts":
- Replace the sentence "The browser doesn't have it yet (TAT-23)." with: "The browser never reads it: it gets the slug through the router's dehydrated state ([API and data](#api-and-data))."
- At the end of the settings bullet (the one that starts "Settings, server only, from `process.env`"), add: "`STOREFRONT_SERVER_KEY` (optional until TAT-38; 32 or more characters, e.g. `openssl rand -base64 32`) is the secret the server sends with its API calls (`Authorization: Bearer`); a malformed one stops `pnpm dev` too."

Then append this section after "Tenants and hosts":

```md
## API and data

Pages read the API only through `@tattoo-drip/react` and `@tattoo-drip/sdk` (TAT-23, `src/api/`).

- `getRouter()` makes one `QueryClient` and one SDK client per server request and one of each per browser tab; never create either at module scope. The router context is `{ queryClient, tattoo }`, and `tattoo.client` is the SDK client. `TattooProvider` wraps the root shell (`src/routes/__root.tsx`), inside the `QueryClientProvider` that `setupRouterSsrQueryIntegration` adds, so the hooks work in any component.
- Server: the client uses `API_URL`, the slug the tenant middleware confirmed and `STOREFRONT_SERVER_KEY` when set; it waits 5 s and never retries. The middleware's studio is already in the cache, so a render asks the API once. Browser: the router's dehydrated state carries only `{ apiUrl, tenant }`, and the browser's client has no key and sends no cookies. Never parse the host in the browser.
- Loaders prefetch with `context.queryClient.query({ ...tattooQueries.<name>(context.tattoo.client), staleTime: "static" })` (cached data, else one fetch: TanStack Query 5.104's replacement for the deprecated `ensureQueryData`) and pass errors to `rethrowAsNotFound`, so the API's 404 shows the route's not-found component. `loadStudio` in `src/api/loaders.ts` is the example: the root route runs it and titles the page with the studio's name.
- Defaults (`src/api/query-client.ts`): data stays fresh 60 s (the API's `max-age`), so hydrated queries aren't fetched again on mount. The browser retries timeouts, network errors and 5xx twice and a 429 once after a `Retry-After` of 10 s or less, never a 4xx. Only successful and pending queries are dehydrated: a failed server read is fetched again by the browser.
- Secrets: only `src/tenancy/config.ts` reads `STOREFRONT_SERVER_KEY`, from `process.env`. Never give it a `VITE_` prefix, add it to `src/env.ts`, or put a client, a config object or the key in loader data, a `beforeLoad` return value or query data: the router serializes those into the page. `API_URL` is sent to browsers, so it must be the API's public origin.
- `@tattoo-drip/react` is used from source and must share the storefront's React and TanStack Query (`test/api/single-copy.test.ts`); if that test fails, align the versions (`pnpm why @tanstack/react-query`) instead of aliasing them.
```

- [ ] **Step 2: Storefront AGENTS.md**

In `apps/storefront/AGENTS.md`, replace "Pages currently use `src/data/mock` pending API integration; do not introduce a storefront auth/database layer." with:

```md
Pages still use `src/data/mock` until TAT-48 builds the studio page; real data comes only through `@tattoo-drip/react` and the router context's `tattoo.client` ([API and data](docs/development.md#api-and-data)). Do not introduce a storefront auth/database layer.
```

- [ ] **Step 3: SDK guide**

In `docs/sdk.md`:
- React adapter: replace the sentence that starts "For SSR prefetching in route loaders, use `tattooQueries.*` with `queryClient.ensureQueryData(" (keep the sentence about `signal` after it) with: "For SSR prefetching in route loaders, use `tattooQueries.*` with `queryClient.query({ ...tattooQueries.artists(client), staleTime: "static" })`: cached data, else one fetch (TanStack Query 5.104 deprecates `ensureQueryData` for this)." After the `signal` sentence add: "The options set no `staleTime` except where a resource needs one: the deposit page is always stale (`staleTime: 0`), so a focus refetches it whatever the app's default."
- "Studio page = external storefront": replace the bullet "Server-side rendering sends a secret server key, used only for rate limiting." with "Server-side rendering sends a secret server key (`STOREFRONT_SERVER_KEY`, as `Authorization: Bearer`), used only for rate limiting; the platform checks it from TAT-38."
- Replace that section's code block (TAT-12's `requestStudio()` snippet) with:

```ts
// apps/storefront (TAT-23, src/api/): a QueryClient and a client per server request and per tab
// Server: the studio the tenant middleware confirmed, and the server key when set
const serverClient = createTattooClient({ baseUrl: API_URL, tenant: requestStudio().slug, key: STOREFRONT_SERVER_KEY, timeoutMs: 5_000 });
// Browser: only { apiUrl, tenant } crosses, in the router's dehydrated state; no key
const browserClient = createTattooClient({ baseUrl: connection.apiUrl, tenant: connection.tenant });
```

- [ ] **Step 4: Architecture, index, README**

`docs/architecture.md`, "Files, scale, hosting", **Rate limits** bullet: replace "calls the API with a secret **server key**." with "calls the API with a secret **server key** (`STOREFRONT_SERVER_KEY`, sent as `Authorization: Bearer` from the server only; the platform checks it from TAT-38)."

`docs/README.md`: in the storefront row, change "data fetching" to "API data and prefetching" (the row reads "Storefront forms, routing, API data and prefetching, monitoring, tenants and hosts").

`README.md`, Deployment, storefront bullet: replace "`API_URL` and `STOREFRONT_URL` (`https://{tenant}.<domain>`) set (TAT-13)." with "`API_URL` (the API's public origin: browsers call it too) and `STOREFRONT_URL` (`https://{tenant}.<domain>`) set, plus `STOREFRONT_SERVER_KEY` once TAT-38 checks it (TAT-13)."

- [ ] **Step 5: Check and commit**

Run: `rg -n "api-and-data" apps/storefront docs/README.md docs/sdk.md`
Expected: the links from `apps/storefront/AGENTS.md` and from the "Tenants and hosts" section, and `## API and data` exists in `apps/storefront/docs/development.md`.

Run: `rg -n "ensureQueryData" docs/sdk.md docs/architecture.md apps/storefront/docs apps/storefront/src packages/react/src`
Expected: only the "deprecates `ensureQueryData`" / "replacement for" mentions, no call.

```bash
git add apps/storefront/docs/development.md apps/storefront/AGENTS.md docs/sdk.md docs/architecture.md docs/README.md README.md
git commit -m "docs(storefront): document the API wiring, the server key and the query defaults"
```

---

### Task 9: Final verification

- [ ] **Step 1: Root gates**

Run each, from the root:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: all pass. After the build, `git status -s` shows no change (in particular none in `apps/storefront/src/routeTree.gen.ts`).

- [ ] **Step 2: Every test suite**

Run in the background (about 2 minutes; needs PostgreSQL for the platform): `PORT=3402 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm test > <scratchpad>/tat23-suite.log 2>&1; echo "exit $?" >> <scratchpad>/tat23-suite.log`
Expected: exit 0; the storefront's `# fail 0` with more tests than the baseline; the SDK count unchanged; the React count one more; the platform's "Tests N passed" equal to its count on the base (no platform code changed). Read the counts in the log, not only the exit code.

- [ ] **Step 3: Production server with a canary key and a fake API**

1. Create `<scratchpad>/tat23-fake-api.mjs`:

```js
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const [port, logFile] = process.argv.slice(2);
const studio = { slug: "demo-studio", name: "Demo Studio" };

createServer((request, response) => {
	appendFileSync(
		logFile,
		`${request.method} ${request.url} authorization=${request.headers.authorization ?? "-"}\n`,
	);
	response.setHeader("content-type", "application/json; charset=utf-8");
	response.setHeader("access-control-allow-origin", "*");
	if (request.url === `/api/v1/tenants/${studio.slug}`) {
		response.end(JSON.stringify({ data: studio }));
		return;
	}
	response.statusCode = 404;
	response.end(JSON.stringify({ error: { code: "not_found", message: "Not found." } }));
}).listen(Number(port), "127.0.0.1");
```

2. Start it in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node <scratchpad>/tat23-fake-api.mjs 3403 <scratchpad>/tat23-fake-api.log`. Note its PID.
3. Start the built storefront (Step 1 built it) in the background: `API_URL=http://127.0.0.1:3403 STOREFRONT_URL='http://{tenant}.localhost:3000' STOREFRONT_SERVER_KEY=tat23-canary-0123456789abcdefghijklmnopqrstuv PORT=3404 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront start > <scratchpad>/tat23-start.log 2>&1`, and wait until its log shows it listening on 3404. Note the PID of the `node … .output/server/index.mjs` process (`pgrep -af "output/server/index.mjs"`).
4. Check:
   - `curl -s -o <scratchpad>/tat23-page.html -w '%{http_code}\n' -H 'Host: demo-studio.localhost:3404' http://127.0.0.1:3404/` → `200`.
   - `rg -o '<title>[^<]*</title>' <scratchpad>/tat23-page.html` → `<title>Demo Studio</title>` (the root loader's studio).
   - `rg -c "127.0.0.1:3403" <scratchpad>/tat23-page.html` → at least 1, and `rg -c "demo-studio" <scratchpad>/tat23-page.html` → at least 1 (the connection was dehydrated).
   - `rg -c "tat23-canary" <scratchpad>/tat23-page.html <scratchpad>/tat23-start.log; echo "exit $?"` → `exit 1` (the key is in neither the page nor the server's log).
   - Read `<scratchpad>/tat23-fake-api.log`: exactly one line, `GET /api/v1/tenants/demo-studio authorization=Bearer tat23-canary-0123456789abcdefghijklmnopqrstuv` (the lookup sent the key; the root loader used the seeded studio, so no second call).
   - `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: nobody-tat23.localhost:3404' http://127.0.0.1:3404/` → `404` (TAT-12 still answers before the router).
5. Optional, if a browser tool is available: open `http://demo-studio.localhost:3404/`; the tab title is "Demo Studio", the console shows no hydration error, and following a header link to another mock page makes no request to `127.0.0.1:3403`.
6. Stop the storefront and the fake API by their exact PIDs (`kill <pid>`). Never `pkill -f`.

- [ ] **Step 4: Report**

Commits (hashes and subjects); test counts (storefront, SDK, React, platform) against the baselines; the bundle-check and canary results; whether `routeTree.gen.ts` changed; anything skipped (for example the browser pass) and why.
