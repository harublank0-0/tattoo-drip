# SDK and React adapter unit tests (TAT-11): gaps only

> Instructions for the coding agent (opencode, deepseek-v4.1-flash-free). Do the tasks in order. Write each test first, run it, read the result, and only then go on. Read `docs/agent-environment.md` first.

**Goal:** close the gaps in the SDK and React adapter tests that TAT-11's checklist still lists. Most of the checklist is already tested; this plan covers only what is not. About 1 point.

**Scope:** tests only. You change files under `packages/sdk/test/` and `packages/react/test/` and nothing else. No source change, no new dependency, no database, no platform or storefront file.

**STOP rule:** if a new test fails because the source code is wrong (not because your test is wrong), do not change the source. Delete nothing, keep the failing test out of the commit, write a note under "Findings" at the bottom of this file (test name, expected, actual) and report it.

## What is already tested (do not repeat)

- `packages/sdk/test/client.test.ts`: URL building for the studio and artists (`/api/v1/tenants/:tenant`, tenant and slug encoding, trailing slashes), `{ data }` unwrapping, `TattooApiError` mapping (status, code, fields, Retry-After, non-JSON and non-object bodies, `invalid_response`, network error, timeouts, cancel), multipart for `inquiries.create` and `deposits.submitProof`, the deposit page reads.
- `packages/react/test/`: keys and loading for studio, artists and artist; the deposit query (always stale, retry rule) and its mutations; `createInquiry` never retries.

## What is missing (this plan)

1. The guard that rejects a secret key in a browser (`createTattooClient`, `packages/sdk/src/client.ts`).
2. Query-string building (`withQuery`) and the list methods that use it: `services.list`, `portfolio.list`, `availability.list`, plus `styles.list` and `placements.list` (not tenant-scoped).
3. React query keys and options for services, portfolio, availability, styles and placements, and that one `QueryClient` never serves one tenant's data for another.

## Task 0: Preconditions

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`.
- [ ] `git branch --show-current` prints `harublank00/tat-11-sdk-and-react-adapter-unit-tests`; `git status --short` prints nothing.
- [ ] Baseline: `pnpm --filter @tattoo-drip/sdk test` ends with `ℹ tests 32` and `ℹ pass 32`; `pnpm --filter @tattoo-drip/react test` ends with `ℹ tests 15` and `ℹ pass 15`. Write the two numbers down.

## Task 1: The browser guard (SDK)

File: `packages/sdk/test/client.test.ts`. Add a new `describe("secret key guard", ...)` at the end. Reuse the file's `fakeFetch`, `json` and `rejection` helpers (read them at the top of the file) and its `Studio` import if you need a response body; the studio body used by the existing "studio and artists" group works.

The guard is `if (options.key && "document" in globalThis) throw new Error("@tattoo-drip/sdk: secret keys must never be used in a browser.")`. A browser is simulated by defining a global `document`. Always restore the global afterwards, even when the test fails (use `try`/`finally`), or the other tests in the file break. Helper to write:

```ts
/** Runs `fn` as if in a browser (a global `document`), then puts the global back. */
function inBrowser<T>(fn: () => T): T {
	const had = Object.hasOwn(globalThis, "document");
	Object.defineProperty(globalThis, "document", {
		value: {},
		configurable: true,
		writable: true,
	});
	try {
		return fn();
	} finally {
		if (!had) delete (globalThis as { document?: unknown }).document;
	}
}
```

Tests to write (names are suggestions):

1. `a key in a browser is refused`: `assert.throws(() => inBrowser(() => createTattooClient({ baseUrl: "https://api.example.com", tenant: "guard-needle-11", key: "secret-key-11" })), /secret keys must never be used in a browser/)`.
2. `the refusal never carries the key`: catch the error from the same call and `assert.ok(!String(error).includes("secret-key-11"))`.
3. `a client without a key is fine in a browser, and sends no Authorization header`: build it inside `inBrowser` with a `fakeFetch`, call `studio.get()` OUTSIDE `inBrowser`, and assert that the recorded call's headers (`new Headers(call.init.headers)`) have no `authorization` and `accept` is `application/json`.
4. `on a server the key is sent as a bearer token`: no browser, `key: "secret-key-11"`, call `studio.get()`, assert `new Headers(call.init.headers).get("authorization")` equals `Bearer secret-key-11`.
5. `an empty key is no key`: `key: ""` inside `inBrowser` does not throw.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test`. Expected: 37 tests, all passing (32 + 5). Then `pnpm --filter @tattoo-drip/sdk typecheck`: clean.

Commit: `test(sdk): check that a secret key is refused in a browser (TAT-11)`.

## Task 2: Query strings and the list methods (SDK)

File: `packages/sdk/test/client.test.ts`. Add `describe("lists with query parameters", ...)`. All URLs below are for `baseUrl: "https://api.example.com"` and `tenant: "api-needle-32"` (what the file's `client()` helper builds); `T` stands for `https://api.example.com/api/v1/tenants/api-needle-32`.

Tests (assert the recorded `calls[0].url` exactly, and that `calls[0].init.credentials` is `"omit"`):

1. `services.list() with no query has no question mark`: URL is `T/services`; answer `json(200, { data: [] })`; the result is `[]`.
2. `services.list drops undefined values`: `services.list({ artistId: undefined })` calls `T/services` (no `?`).
3. `services.list sends artistId`: `services.list({ artistId: "a1" })` calls `T/services?artistId=a1`; answer with one service `{ id: "0199f000-0000-7000-8000-000000000011", name: "Fine line", durationMinutes: 90 }` and assert it is returned unwrapped.
4. `portfolio.list encodes the query like a form and returns the whole page`: `portfolio.list({ style: "fine line", limit: 12, cursor: "next page" })` calls `T/portfolio?style=fine+line&limit=12&cursor=next+page`; answer `json(200, { data: [], nextCursor: null })` and assert the result `deepEqual`s `{ data: [], nextCursor: null }` (this method returns the whole body, not only `data`).
5. `availability.list sends all four parameters in the given order`: `availability.list({ artistId: "a1", serviceId: "s1", from: "2026-11-01", to: "2026-11-07" })` calls `T/availability?artistId=a1&serviceId=s1&from=2026-11-01&to=2026-11-07`; answer `json(200, { data: [{ startsAt: "2026-11-02T04:00:00Z", endsAt: "2026-11-02T05:30:00Z" }] })` and assert the slot comes back.
6. `styles.list and placements.list are not tenant-scoped`: `styles.list()` calls `https://api.example.com/api/v1/styles`, `placements.list()` calls `https://api.example.com/api/v1/placements` (no `/tenants/...`). Answer `json(200, { data: [] })`.
7. `a 404 from a list is a TattooApiError`: answer `json(404, { error: { code: "not_found", message: "No such studio." } })` to `services.list()`, then `assert.ok(isTattooApiError(error))`, `error.status === 404`, `error.code === "not_found"` (read the existing "an artist that isn't there is a 404 TattooApiError" test for the exact shape and imports).

If a type from `../src/index.js` is missing for a query argument, use an inline object literal: TypeScript infers it.

Run the SDK tests (expected 44 passing) and the typecheck. Commit: `test(sdk): check the query strings and list methods (TAT-11)`.

## Task 3: React keys, options and tenant isolation

File: `packages/react/test/lists.test.ts` (new). Model it on `packages/react/test/studio.test.ts`: copy its `clientAnswering(status, body)` helper (it records `calls` as URL strings) and its imports. Use `const TENANT = "lists-needle-11"`.

Tests:

1. `their keys start with the tenant`: with `client = clientAnswering(200, { data: [] }).client`, assert `tattooQueries.services(client).queryKey` deep-equals `["tattoo-drip", "tenant", TENANT, "services", {}]`; with a query `{ artistId: "a1" }` it ends with that object. Same for `portfolio` (`"portfolio"`). For `availability(client, { artistId: "a1", serviceId: "s1" })` the key is `[..."tenant", TENANT, "availability", { artistId: "a1", serviceId: "s1" }]`, and for `availability(client, null)` it ends with `null`.
2. `styles and placements keys have no tenant: they are platform-wide`: `tattooQueries.styles(client).queryKey` deep-equals `["tattoo-drip", "styles"]`, `placements` the same with `"placements"`; and `staleTime` of both is `Number.POSITIVE_INFINITY`.
3. `availability without a query is skipped`: `import { skipToken } from "@tanstack/react-query"`; assert `tattooQueries.availability(client, null).queryFn === skipToken`; with a query, `staleTime` is `30_000` and `queryFn` is a function.
4. `they load through the SDK with the query`: use a `new QueryClient({ defaultOptions: { queries: { retry: false } } })`; `await queryClient.fetchQuery(tattooQueries.services(client, { artistId: "a1" }))`; assert the one recorded call URL ends with `/api/v1/tenants/lists-needle-11/services?artistId=a1`. Same for `portfolio` (answer `{ data: [], nextCursor: null }`; the result `deepEqual`s that) and `availability`.
5. `one QueryClient never serves one tenant's data for another`: create two clients with different tenants (`lists-a-11`, `lists-b-11`), each answering a different studio name (use the `STUDIO` object of `studio.test.ts`, with `name` changed); with ONE `QueryClient` call `fetchQuery(tattooQueries.studio(clientA))` then `fetchQuery(tattooQueries.studio(clientB))`; assert each result has its own name and that two fetches happened (one call per client).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/react test` (expected 20 passing: 15 + 5) and `pnpm --filter @tattoo-drip/react typecheck`.

Commit: `test(react): check the list query keys and that tenants never share a cache entry (TAT-11)`.

Note on rendered hooks: the repo has no DOM test library, and this ticket adds no dependency. The hooks are thin wrappers over `tattooQueries`, so the options and keys are what these tests cover.

## Task 4: Gates and finish

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check` from the repo root: no new findings (the repository has 2 warnings and 1 info in other files; leave them).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck` from the root: clean.
- [ ] `git status --short` prints nothing; `git log --oneline -4` shows your three test commits on top of the setup and plan commits.
- [ ] Do NOT push and do NOT open a pull request. Write the result (test counts before and after, the three commit hashes, anything you could not do) as your final message.

## Findings

(none yet)
