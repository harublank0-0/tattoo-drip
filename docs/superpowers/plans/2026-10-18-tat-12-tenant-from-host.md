# Tenant from host: studio subdomains and `*.localhost` (TAT-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every server request to the storefront finds its studio from the `Host` header and the API before any route runs: a studio's current slug goes on with `serverContext.studio`, an old slug gets a 302 to the current subdomain, an unknown studio a static 404 page, an API failure a static 503 page, and the bare domain a static landing page.

**Architecture:** Pure, framework-free modules in `apps/storefront/src/tenancy/` (host parsing, settings, the API lookup through `@tattoo-drip/sdk`, the static responses, and the request handler that combines them) carry all the logic and are unit-tested with `node:test` + `tsx`. A thin TanStack Start request middleware (`tenantMiddleware`) calls the handler and either returns its `Response` or passes `{ studio }` on as request context; `src/start.ts` registers it after Start's CSRF middleware.

**Tech Stack:** TanStack Start 1.168 (request middleware, `createStart`, `getGlobalStartContext`, `createServerOnlyFn`), Vite 8, `@tattoo-drip/sdk` (`createTattooClient`, `isTattooApiError`), `node:test` with `tsx`, TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-12-tenant-from-host-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- Storefront only. No change to `apps/platform`, `packages/*` or `openapi.yaml`. The storefront never imports from `apps/platform`; it reaches the platform only through `@tattoo-drip/sdk`.
- No new route file, so never run `generate-routes` in this ticket. `src/routeTree.gen.ts` changes only through `pnpm --filter @tattoo-drip/storefront build` (the Start Vite plugin rewrites its Register footer once `src/start.ts` exists); never hand-edit it. `tsr generate` writes no Start footer.
- Settings, verbatim: `API_URL` (the API's origin, https, http only for `localhost`, `127.0.0.1`, `[::1]`; no path, query, fragment or credentials) and `STOREFRONT_URL` (`{tenant}` as the whole first label, e.g. `http://{tenant}.localhost:3000` in development, `https://{tenant}.tattoodrip.com` in production; https except for `localhost` and `*.localhost`; a default port is dropped). Both required, no defaults, read from `process.env`, never from `src/env.ts`. Error messages name the variable and its rule, never its value. Never edit a real `.env`/`.env.local` file; only `apps/storefront/.env.local.example`.
- Only the `Host` header names the studio. Never read `X-Forwarded-Host`, never use `request.url`'s host; `request.url` gives only the path and query.
- `STORED_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/` (copy of the platform's and of the database CHECK `tenant_slugs_slug_format`). Never copy the platform's reserved list. `www` is the only label the storefront keeps (landing page).
- Lookup timeout `STUDIO_LOOKUP_TIMEOUT_MS = 5_000`. Only a 404 with code `not_found` means "no such studio"; every other failure is "unavailable".
- Responses, verbatim: landing 200 and not-found 404 with `Cache-Control: public, max-age=0, s-maxage=60`; unavailable 503 with `Cache-Control: no-store` and `Retry-After: 30`; old-slug redirect 302 with `Cache-Control: no-store` and no body, GET/HEAD only (other methods get the 404 page). Pages: `Content-Type: text/html; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `<meta name="robots" content="noindex">`, no scripts, no request data.
- Copy, verbatim. Landing: title "Tattoo Drip", heading "Tattoo Drip", text "Studio pages for tattoo artists. Looking for a studio? Open the link it shared with you." Not found: title "Studio not found", heading "We couldn't find this studio", text "Check the address, or ask the studio for its current link." Unavailable: title "Please try again", heading "This page can't load right now", text "Please try again in a minute." Log line: `"Studio lookup failed"` with `{ slug, status, code }` only.
- `src/tenancy/*.ts` other than `middleware.ts` import no React and no TanStack package, so their tests run in plain Node. Modules and tests import each other by relative path with the `.ts` extension. Tests live in `apps/storefront/test/tenancy/`; shared fakes in `test/tenancy/helpers.ts` (not a `*.test.ts` file).
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root (this worktree). Temp files go in the session scratchpad, never `/tmp`. Never `sh -c`. If a dev server must run, start it in the background and stop it by its exact PID (never `pkill -f`).
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with the `storefront` scope and end with the Co-Authored-By line from the session's attribution reminder. Never push, never open a PR.

## Review Focus

1. A visitor who disconnects while the lookup runs must not produce a 503 page or a log line: the request's `AbortError` propagates. Tests: Task 3 "a cancelled request rejects with its AbortError"; Task 5 "a cancelled request rejects and logs nothing".
2. An `API_URL` that points at a server other than the API (its 404 has no `not_found` envelope) must show as a 503 and a log line, not as every studio missing. Tests: Task 3 "a 404 that isn't the API's own is unavailable"; Task 5 "an API_URL that points at another server is a 503".
3. A request path that looks like another host (`//evil.test/x`, `/\evil.test`) must redirect to a path on the studio's own origin, never off-site. Test: Task 4 "a path that looks like another host stays a path on the studio's origin".
4. An old slug requested with uppercase letters, a port and a forged `X-Forwarded-Host` must redirect to the lowercase current origin from `STOREFRONT_URL`, without the incoming port or forwarded host. Test: Task 5 "the redirect never uses the incoming Host or X-Forwarded-Host".
5. A `STOREFRONT_URL` with the scheme's default port (`:443`) must not break redirects (the origin check would otherwise reject its own `Location`). Test: Task 2 "drops the scheme's default port".

---

## Before Task 1: preconditions

- [ ] **The built SDK is in this branch.** This branch was designed on 9cbd445, which has only the designs of TAT-32/51/65/66. Check:

```bash
git merge-base --is-ancestor c25302a HEAD && echo "built TAT-51 present"
rg -n "export interface RequestOptions|timeoutMs\?: number" packages/sdk/src/client.ts
```

Expected: `built TAT-51 present`, and both patterns found. If not, STOP: the branch must first be rebased onto the built chain's tip (TAT-66's built tip, or at least TAT-51's reviewed tip c25302a); that is the coordinator's call, and only the spec and plan commit sits on top.

- [ ] Clean tree: `git status -sb`.
- [ ] Node: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`.
- [ ] Baseline (proves `tsx` and the SDK work here): `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/sdk test`. Expected: all pass. Note the count.

---

### Task 1: Test runner and `tenantFromHost`

**Files:**
- Modify: `apps/storefront/package.json` (a `test` script, `tsx` dev dependency)
- Modify: `apps/storefront/tsconfig.json` (`"node"` in `types`)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)
- Create: `apps/storefront/src/tenancy/host.ts`
- Test: `apps/storefront/test/tenancy/host.test.ts`

**Interfaces:**
- Produces, from `src/tenancy/host.ts`: `STORED_SLUG: RegExp`; `isDnsName(name: string): boolean` (expects lowercase); `type HostTarget = { kind: "tenant"; slug: string } | { kind: "landing" } | { kind: "none" } | { kind: "foreign"; hostname: string }`; `tenantFromHost(host: string | null | undefined, baseHost: string): HostTarget` (`baseHost` lowercase, no trailing dot).

- [ ] **Step 1: Add the runner**

In `apps/storefront/package.json`, add to `"scripts"` after `"typecheck"`:

```json
		"test": "node --import tsx --test \"test/**/*.test.ts\"",
```

and to `"devDependencies"`, between `"dotenv-cli"` and `"typescript"`:

```json
		"tsx": "^4.23.12",
```

In `apps/storefront/tsconfig.json`, change `"types": ["vite/client"],` to:

```json
		"types": ["vite/client", "node"],
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install`
Expected: completes; `pnpm-lock.yaml` gains `tsx` under `apps/storefront`.

- [ ] **Step 2: Write the failing test**

Create `apps/storefront/test/tenancy/host.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	isDnsName,
	STORED_SLUG,
	tenantFromHost,
} from "../../src/tenancy/host.ts";

const BASE = "tattoodrip.com";
const DEV = "localhost";
const long = (length: number) => "a".repeat(length);

describe("tenantFromHost", () => {
	const tenants: Array<[host: string, base: string, slug: string]> = [
		["blackneedle.tattoodrip.com", BASE, "blackneedle"],
		// Hosts are case-insensitive; the port and one trailing dot are ignored.
		["BlackNeedle.TattooDrip.COM", BASE, "blackneedle"],
		["blackneedle.tattoodrip.com:443", BASE, "blackneedle"],
		["blackneedle.tattoodrip.com.", BASE, "blackneedle"],
		["blackneedle.localhost:3000", DEV, "blackneedle"],
		["black-needle-2.tattoodrip.com", BASE, "black-needle-2"],
		// Grandfathered shapes, reserved words and punycode: the API decides.
		["12345.tattoodrip.com", BASE, "12345"],
		["a--b.tattoodrip.com", BASE, "a--b"],
		["admin.tattoodrip.com", BASE, "admin"],
		["xn--bcher-kva.tattoodrip.com", BASE, "xn--bcher-kva"],
		[`${long(63)}.tattoodrip.com`, BASE, long(63)],
	];
	for (const [host, base, slug] of tenants) {
		test(`${host} is the studio ${slug}`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "tenant", slug });
		});
	}

	const landings: Array<[host: string, base: string]> = [
		["tattoodrip.com", BASE],
		["TATTOODRIP.COM.", BASE],
		["tattoodrip.com:443", BASE],
		["www.tattoodrip.com", BASE],
		["WWW.TattooDrip.com", BASE],
		["localhost:3000", DEV],
		["www.localhost:3000", DEV],
	];
	for (const [host, base] of landings) {
		test(`${host} is the landing page`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "landing" });
		});
	}

	const nothing: Array<[host: string | null | undefined, base: string]> = [
		[null, BASE],
		[undefined, BASE],
		["", BASE],
		["ab.tattoodrip.com", BASE], // too short for a slug
		[`${long(64)}.tattoodrip.com`, BASE], // longer than a DNS label
		["-black.tattoodrip.com", BASE],
		["black-.tattoodrip.com", BASE],
		["black_needle.tattoodrip.com", BASE],
		["a.b.tattoodrip.com", BASE], // two labels under the base
		["www.blackneedle.tattoodrip.com", BASE],
		["blackneedle..tattoodrip.com", BASE],
		[".tattoodrip.com", BASE],
		["blackneedle.tattoodrip.com..", BASE],
		["127.0.0.1:3000", DEV],
		["10.0.0.1", BASE],
		["[::1]:3000", DEV],
		["blackneedle.tattoodrip.com:", BASE],
		["blackneedle.tattoodrip.com:http", BASE],
		["blackneedle.tattoodrip.com:123456", BASE],
		["user@blackneedle.tattoodrip.com", BASE],
		["blackneedle.tattoodrip.com/flash", BASE],
		[" blackneedle.tattoodrip.com", BASE],
		["bläckneedle.tattoodrip.com", BASE], // non-ASCII
		["Kelvin.tattoodrip.com", BASE], // the Kelvin sign lowercases to "k"
		[`${long(300)}.tattoodrip.com`, BASE],
	];
	for (const [host, base] of nothing) {
		test(`${JSON.stringify(host)} is no studio`, () => {
			assert.deepEqual(tenantFromHost(host, base), { kind: "none" });
		});
	}

	const foreign: Array<[host: string, base: string, hostname: string]> = [
		["blackneedle.example.com", BASE, "blackneedle.example.com"],
		["Studio.Example.COM.", BASE, "studio.example.com"],
		["tattoodrip.com.evil.test", BASE, "tattoodrip.com.evil.test"],
		[
			"blackneedle.tattoodrip.com.evil.test",
			BASE,
			"blackneedle.tattoodrip.com.evil.test",
		],
		["eviltattoodrip.com", BASE, "eviltattoodrip.com"],
		["blackneedle.tattoodrip.com", DEV, "blackneedle.tattoodrip.com"],
	];
	for (const [host, base, hostname] of foreign) {
		test(`${host} is outside ${base}`, () => {
			assert.deepEqual(tenantFromHost(host, base), {
				kind: "foreign",
				hostname,
			});
		});
	}
});

describe("isDnsName", () => {
	test("accepts lowercase DNS names", () => {
		for (const name of ["tattoodrip.com", "localhost", "a-b.example.co"]) {
			assert.ok(isDnsName(name), name);
		}
	});

	test("refuses IPv4 addresses, empty or bad labels and long names", () => {
		for (const name of [
			"127.0.0.1",
			"a..b",
			".a",
			"-a.com",
			"a-.com",
			"a_b.com",
			"",
			`${long(64)}.com`,
			`${long(60)}.`.repeat(5).slice(0, -1),
		]) {
			assert.ok(!isDnsName(name), name);
		}
	});
});

describe("STORED_SLUG", () => {
	test("is the platform's stored shape, the database CHECK tenant_slugs_slug_format", () => {
		assert.equal(STORED_SLUG.source, "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$");
		assert.equal(STORED_SLUG.flags, "");
	});

	test("accepts every stored slug, grandfathered ones too", () => {
		for (const slug of ["abc", "blackneedle", "12345", "a--b", "xn--abc", "www", long(63)]) {
			assert.ok(STORED_SLUG.test(slug), slug);
		}
	});

	test("refuses what no stored slug can be", () => {
		for (const value of ["", "ab", "-ab", "ab-", "Abc", "a_b", "a.b", "a b", long(64)]) {
			assert.ok(!STORED_SLUG.test(value), value);
		}
	});
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL (exit 1) with `ERR_MODULE_NOT_FOUND` / "Cannot find module" for `src/tenancy/host.ts`.

- [ ] **Step 4: Write `host.ts`**

Create `apps/storefront/src/tenancy/host.ts`:

```ts
/**
 * Which studio a request's host names (TAT-12). Pure: no I/O and no
 * framework, so the tests and the request middleware share it.
 */

/**
 * The shape of every stored tenant slug: a DNS label of 3 to 63 lowercase
 * letters, digits and hyphens, with no hyphen at either end. A copy of the
 * platform's STORED_SLUG (apps/platform/app/modules/tenancy/slugs.ts) and of
 * the database CHECK `tenant_slugs_slug_format`, because the storefront may
 * not import platform code; test/tenancy/host.test.ts pins it. Only the
 * shape: whether a slug exists, is reserved or is an old one is the API's
 * answer, so the platform's reserved list is never copied here.
 */
export const STORED_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The one label the storefront keeps: `www.` shows the landing page. */
const LANDING_LABEL = "www";

/**
 * What a Host header may hold. Checked before lowercasing, so Unicode never
 * folds into ASCII (the Kelvin sign U+212A lowercases to "k").
 */
const HOST_CHARACTERS = /^[A-Za-z0-9.:[\]-]+$/;

/** A lowercase hostname and an optional port. Brackets (IPv6) never match. */
const HOST_AND_PORT = /^([a-z0-9.-]+)(?::\d{1,5})?$/;

/** One DNS label: 1 to 63 characters, no hyphen at either end. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** No real Host is this long; a longer one is refused before any regex. */
const MAX_HOST_LENGTH = 260;

export type HostTarget =
	| { kind: "tenant"; slug: string }
	| { kind: "landing" }
	| { kind: "none" }
	| { kind: "foreign"; hostname: string };

/**
 * A lowercase DNS name: labels of 1 to 63 characters, at most 253 in all,
 * and not an IPv4 address (no top-level domain is all digits).
 */
export function isDnsName(name: string): boolean {
	const labels = name.split(".");
	return (
		name.length <= 253 &&
		labels.every((label) => LABEL.test(label)) &&
		!/^\d+$/.test(labels[labels.length - 1] ?? "")
	);
}

/**
 * What a Host header names under `baseHost` (lowercase, e.g. "tattoodrip.com"
 * or "localhost"): a studio's slug, the landing page (the base itself or
 * `www.`), nothing (a 404 without asking the API), or a name outside the base
 * (`foreign`: where custom domains, TAT-79, will be looked up; a 404 today).
 * The port is ignored: redirects take theirs from STOREFRONT_URL.
 */
export function tenantFromHost(
	host: string | null | undefined,
	baseHost: string,
): HostTarget {
	if (!host || host.length > MAX_HOST_LENGTH || !HOST_CHARACTERS.test(host)) {
		return { kind: "none" };
	}
	const match = HOST_AND_PORT.exec(host.toLowerCase());
	if (!match) return { kind: "none" };
	const name = match[1].endsWith(".") ? match[1].slice(0, -1) : match[1];
	if (!isDnsName(name)) return { kind: "none" };
	if (name === baseHost) return { kind: "landing" };
	if (!name.endsWith(`.${baseHost}`)) {
		return { kind: "foreign", hostname: name };
	}
	const label = name.slice(0, -(baseHost.length + 1));
	if (label === LANDING_LABEL) return { kind: "landing" };
	if (label.includes(".") || !STORED_SLUG.test(label)) return { kind: "none" };
	return { kind: "tenant", slug: label };
}
```

- [ ] **Step 5: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/package.json apps/storefront/tsconfig.json pnpm-lock.yaml apps/storefront/src/tenancy/host.ts apps/storefront/test/tenancy/host.test.ts
git commit -m "feat(storefront): map a request's host to a studio slug"
```

---

### Task 2: Settings: `API_URL` and `STOREFRONT_URL`

**Files:**
- Create: `apps/storefront/src/tenancy/config.ts`
- Modify: `apps/storefront/.env.local.example` (top of the file)
- Test: `apps/storefront/test/tenancy/config.test.ts`

**Interfaces:**
- Consumes: `isDnsName`, `STORED_SLUG` from `./host.ts` (Task 1).
- Produces, from `src/tenancy/config.ts`: `interface StorefrontConfig { apiUrl: string; protocol: "http:" | "https:"; baseHost: string; port: string }` (`port` is `""` or like `":3000"`); `parseStorefrontConfig(env: Readonly<Record<string, string | undefined>>): StorefrontConfig` (throws one `Error` listing every problem); `storefrontConfig(): StorefrontConfig` (memoized over `process.env`, server only); `tenantOrigin(config: StorefrontConfig, slug: string): string` (throws `"tenantOrigin() needs a stored tenant slug"` for anything but a stored slug).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/tenancy/config.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	parseStorefrontConfig,
	tenantOrigin,
} from "../../src/tenancy/config.ts";

const DEV = {
	API_URL: "http://localhost:3333",
	STOREFRONT_URL: "http://{tenant}.localhost:3000",
};
const PROD = {
	API_URL: "https://api.tattoodrip.app",
	STOREFRONT_URL: "https://{tenant}.tattoodrip.com",
};

/** The message parseStorefrontConfig throws for `env`. */
function failure(env: Record<string, string | undefined>): string {
	try {
		parseStorefrontConfig(env);
	} catch (error) {
		return (error as Error).message;
	}
	assert.fail("expected the settings to be refused");
}

describe("parseStorefrontConfig", () => {
	test("reads the development settings", () => {
		assert.deepEqual(parseStorefrontConfig(DEV), {
			apiUrl: "http://localhost:3333",
			protocol: "http:",
			baseHost: "localhost",
			port: ":3000",
		});
	});

	test("reads the production settings", () => {
		assert.deepEqual(parseStorefrontConfig(PROD), {
			apiUrl: "https://api.tattoodrip.app",
			protocol: "https:",
			baseHost: "tattoodrip.com",
			port: "",
		});
	});

	test("trims, lowercases and allows one trailing slash", () => {
		const config = parseStorefrontConfig({
			API_URL: " https://API.TattooDrip.app/ ",
			STOREFRONT_URL: " https://{tenant}.TattooDrip.com/ ",
		});
		assert.equal(config.apiUrl, "https://api.tattoodrip.app");
		assert.equal(config.baseHost, "tattoodrip.com");
	});

	test("drops the scheme's default port", () => {
		assert.equal(
			parseStorefrontConfig({
				...PROD,
				STOREFRONT_URL: "https://{tenant}.tattoodrip.com:443",
			}).port,
			"",
		);
		assert.equal(
			parseStorefrontConfig({
				...DEV,
				STOREFRONT_URL: "http://{tenant}.localhost:80",
			}).port,
			"",
		);
	});

	test("allows http for an API on this machine", () => {
		for (const apiUrl of ["http://127.0.0.1:3333", "http://[::1]:3333"]) {
			assert.equal(
				parseStorefrontConfig({ ...DEV, API_URL: apiUrl }).apiUrl,
				apiUrl,
			);
		}
	});

	test("names every variable that is not set", () => {
		for (const env of [{}, { API_URL: "", STOREFRONT_URL: "  " }]) {
			const message = failure(env);
			assert.match(message, /API_URL is not set/);
			assert.match(message, /STOREFRONT_URL is not set/);
			assert.match(message, /\.env\.local\.example/);
		}
	});

	test("refuses an API_URL that isn't an https origin, without echoing it", () => {
		for (const apiUrl of [
			"api.tattoodrip.app",
			"ftp://api.tattoodrip.app",
			"http://api.tattoodrip.app",
			"https://api.tattoodrip.app/api",
			"https://api.tattoodrip.app?x=1",
			"https://api.tattoodrip.app#x",
			"https://user:secret@api.tattoodrip.app",
		]) {
			const message = failure({ ...PROD, API_URL: apiUrl });
			assert.match(message, /API_URL is invalid/, apiUrl);
			assert.doesNotMatch(message, /STOREFRONT_URL/, apiUrl);
			assert.ok(!message.includes(apiUrl), apiUrl);
			assert.ok(!message.includes("secret"), apiUrl);
		}
	});

	test("refuses a STOREFRONT_URL without {tenant} as its first label, without echoing it", () => {
		for (const storefrontUrl of [
			"https://tattoodrip.com",
			"https://{tenant}tattoodrip.com",
			"https://www.{tenant}.tattoodrip.com",
			"https://{tenant}.tattoodrip.com/studio",
			"https://{tenant}.tattoodrip.com?x=1",
			"http://{tenant}.tattoodrip.com",
			"https://{tenant}.127.0.0.1",
			"https://{tenant}.tattoo_drip.com",
			"{tenant}.tattoodrip.com",
			"https://user@{tenant}.tattoodrip.com",
			"https://{tenant}.tattoodrip.com:0",
			"https://{tenant}.tattoodrip.com:99999",
		]) {
			const message = failure({ ...PROD, STOREFRONT_URL: storefrontUrl });
			assert.match(message, /STOREFRONT_URL is invalid/, storefrontUrl);
			assert.ok(!message.includes(storefrontUrl), storefrontUrl);
		}
	});
});

describe("tenantOrigin", () => {
	test("puts the slug in front of the base domain, with the scheme and port", () => {
		assert.equal(
			tenantOrigin(parseStorefrontConfig(DEV), "blackneedle"),
			"http://blackneedle.localhost:3000",
		);
		assert.equal(
			tenantOrigin(parseStorefrontConfig(PROD), "blackneedle"),
			"https://blackneedle.tattoodrip.com",
		);
	});

	test("refuses anything but a stored slug", () => {
		const config = parseStorefrontConfig(PROD);
		for (const slug of ["evil.test/", "Black", "a.b", "", "ab"]) {
			assert.throws(() => tenantOrigin(config, slug), /stored tenant slug/, slug);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/tenancy/config.ts`; the host tests still pass.

- [ ] **Step 3: Write `config.ts`**

Create `apps/storefront/src/tenancy/config.ts`:

```ts
import { isDnsName, STORED_SLUG } from "./host.ts";

/** The storefront's server-only settings (TAT-12), from process.env. */
export interface StorefrontConfig {
	/** The API's origin, e.g. https://api.example.com; the SDK appends /api/v1. */
	apiUrl: string;
	/** The studio pages' scheme. */
	protocol: "http:" | "https:";
	/** The domain studios are subdomains of, lowercase: "tattoodrip.com", "localhost". */
	baseHost: string;
	/** ":3000" when STOREFRONT_URL names a port other than its scheme's default, else "". */
	port: string;
}

type Env = Readonly<Record<string, string | undefined>>;

const API_URL_RULE =
	"the API's origin over https (http only on localhost), with no path, query or credentials, e.g. https://api.example.com";
const STOREFRONT_URL_RULE =
	"the studio pages' origin with {tenant} as its first label, over https (http only on localhost), e.g. https://{tenant}.example.com";

/** `{tenant}.`, a host, an optional port, and at most one "/" after it. */
const STOREFRONT_URL_SHAPE =
	/^(https?):\/\/\{tenant\}\.([^/?#:@]+)(?::(\d{1,5}))?\/?$/;

const DEFAULT_PORTS = { "http:": 80, "https:": 443 } as const;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Reads API_URL and STOREFRONT_URL (the platform's setting of the same name
 * and value, TAT-65). Throws one error naming every bad variable and its
 * rule, never a value, so a secret added later can't end up in a log.
 */
export function parseStorefrontConfig(env: Env): StorefrontConfig {
	const problems: string[] = [];
	const apiUrl = readApiUrl(env.API_URL?.trim(), problems);
	const site = readStorefrontUrl(env.STOREFRONT_URL?.trim(), problems);
	if (!apiUrl || !site) {
		const list = problems.map((problem) => `- ${problem}`).join("\n");
		throw new Error(
			`The storefront's settings are invalid (see apps/storefront/.env.local.example):\n${list}`,
		);
	}
	return { apiUrl, ...site };
}

/**
 * A studio's origin, e.g. https://blackneedle.tattoodrip.com. Throws for
 * anything but a stored slug, so a redirect built on it stays on our domain.
 */
export function tenantOrigin(config: StorefrontConfig, slug: string): string {
	if (!STORED_SLUG.test(slug)) {
		throw new Error("tenantOrigin() needs a stored tenant slug");
	}
	return `${config.protocol}//${slug}.${config.baseHost}${config.port}`;
}

let cached: StorefrontConfig | undefined;

/** The settings from process.env, read once per server process. Server only. */
export function storefrontConfig(): StorefrontConfig {
	cached ??= parseStorefrontConfig(process.env);
	return cached;
}

function problem(name: string, value: string | undefined, rule: string): string {
	return value
		? `${name} is invalid: it must be ${rule}.`
		: `${name} is not set: set it to ${rule}.`;
}

function readApiUrl(
	value: string | undefined,
	problems: string[],
): string | undefined {
	const url = value ? parseUrl(value) : undefined;
	const loopback = url ? LOOPBACK_HOSTS.includes(url.hostname) : false;
	const scheme =
		url?.protocol === "https:" || (url?.protocol === "http:" && loopback);
	if (
		!url ||
		!scheme ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		problems.push(problem("API_URL", value, API_URL_RULE));
		return undefined;
	}
	return url.origin;
}

function readStorefrontUrl(
	value: string | undefined,
	problems: string[],
): Omit<StorefrontConfig, "apiUrl"> | undefined {
	const match = value ? STOREFRONT_URL_SHAPE.exec(value) : null;
	const protocol = match?.[1] === "http" ? "http:" : "https:";
	const baseHost = match?.[2]?.toLowerCase() ?? "";
	const local = baseHost === "localhost" || baseHost.endsWith(".localhost");
	const portNumber = match?.[3] === undefined ? undefined : Number(match[3]);
	const badPort =
		portNumber !== undefined && (portNumber < 1 || portNumber > 65_535);
	if (
		!match ||
		!isDnsName(baseHost) ||
		(protocol === "http:" && !local) ||
		badPort
	) {
		problems.push(problem("STOREFRONT_URL", value, STOREFRONT_URL_RULE));
		return undefined;
	}
	const port =
		portNumber === undefined || portNumber === DEFAULT_PORTS[protocol]
			? ""
			: `:${portNumber}`;
	return { protocol, baseHost, port };
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
```

- [ ] **Step 4: Add the settings to the example file**

At the top of `apps/storefront/.env.local.example`, before the Sentry lines, add:

```bash
# Tattoo Drip API origin: the platform's address (its PORT, 3333 by default).
API_URL=http://localhost:3333

# The studio pages' origin, {tenant} where the slug goes: the same value as
# the platform's STOREFRONT_URL. In development, open http://<slug>.localhost:3000
# for a studio in the platform's database; http://localhost:3000 is the landing page.
STOREFRONT_URL=http://{tenant}.localhost:3000

```

- [ ] **Step 5: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/tenancy/config.ts apps/storefront/test/tenancy/config.test.ts apps/storefront/.env.local.example
git commit -m "feat(storefront): read the API and studio page origins from the environment"
```

---

### Task 3: Ask the API which studio a slug is

**Files:**
- Modify: `apps/storefront/package.json` (`@tattoo-drip/sdk` dependency)
- Modify: `pnpm-lock.yaml` (by `pnpm install`)
- Create: `apps/storefront/src/tenancy/lookup.ts`
- Create: `apps/storefront/test/tenancy/helpers.ts`
- Test: `apps/storefront/test/tenancy/lookup.test.ts`

**Interfaces:**
- Consumes: `STORED_SLUG` from `./host.ts` (Task 1); from `@tattoo-drip/sdk`: `createTattooClient({ baseUrl, tenant, fetch?, timeoutMs? })`, `client.studio.get({ signal? }): Promise<Studio>`, `isTattooApiError(error)`, `TattooApiError.status` (0 for no response) and `.code` (`not_found`, `timeout`, `network_error`, `invalid_response`, …), `type Studio` (`slug`, `name`).
- Produces, from `src/tenancy/lookup.ts`: `STUDIO_LOOKUP_TIMEOUT_MS = 5_000`; `type TenantLookup = { type: "found"; studio: Studio } | { type: "moved"; slug: string } | { type: "missing" } | { type: "unavailable"; status: number; code: string }`; `interface LookupOptions { apiUrl: string; signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch }`; `lookUpTenant(slug: string, options: LookupOptions): Promise<TenantLookup>` (rejects with the caller's `AbortError` when its signal aborts).
- Produces, from `test/tenancy/helpers.ts`: `type Call = { url: string; init: RequestInit }`; `fakeFetch(respond: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetch: typeof globalThis.fetch }`; `json(status: number, body: unknown): Response`; `hangUntilAborted(call: Call): Promise<Response>`.

- [ ] **Step 1: Add the SDK**

In `apps/storefront/package.json` `"dependencies"`, after `"@tanstack/store"`, add:

```json
		"@tattoo-drip/sdk": "workspace:*",
```

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install`
Expected: completes; the lockfile links `@tattoo-drip/sdk` into `apps/storefront`.

- [ ] **Step 2: Write the test helpers**

Create `apps/storefront/test/tenancy/helpers.ts`:

```ts
/** Fakes shared by the tenancy tests, in the style of the SDK's own tests. */

export type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with `respond`. */
export function fakeFetch(
	respond: (call: Call) => Response | Promise<Response>,
) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

export function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

/** Rejects with the signal's reason once it aborts, as fetch does. */
export function hangUntilAborted({ init }: Call): Promise<Response> {
	const signal = init.signal as AbortSignal;
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/storefront/test/tenancy/lookup.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lookUpTenant } from "../../src/tenancy/lookup.ts";
import { fakeFetch, hangUntilAborted, json } from "./helpers.ts";

const API = "http://api.test";
const studio = { slug: "blackneedle", name: "Black Needle" };
const notFound = { error: { code: "not_found", message: "Not found." } };

describe("lookUpTenant", () => {
	test("asks getStudio for the slug, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: studio }));

		assert.deepEqual(await lookUpTenant("blackneedle", { apiUrl: API, fetch }), {
			type: "found",
			studio,
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, "http://api.test/api/v1/tenants/blackneedle");
		assert.equal(calls[0].init.method, undefined);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("a different slug in the body means the studio moved", async () => {
		const { fetch } = fakeFetch(() =>
			json(200, { data: { slug: "inkhouse", name: "Ink House" } }),
		);

		assert.deepEqual(await lookUpTenant("old-ink", { apiUrl: API, fetch }), {
			type: "moved",
			slug: "inkhouse",
		});
	});

	test("the API's not_found is no such studio", async () => {
		const { fetch } = fakeFetch(() => json(404, notFound));

		assert.deepEqual(await lookUpTenant("nobody", { apiUrl: API, fetch }), {
			type: "missing",
		});
	});

	test("a 404 that isn't the API's own is unavailable, not missing", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		);

		assert.deepEqual(await lookUpTenant("blackneedle", { apiUrl: API, fetch }), {
			type: "unavailable",
			status: 404,
			code: "unknown_error",
		});
	});

	test("server errors and rate limits are unavailable", async () => {
		for (const [status, code] of [
			[500, "internal_error"],
			[429, "rate_limited"],
		] as const) {
			const { fetch } = fakeFetch(() =>
				json(status, { error: { code, message: "No." } }),
			);
			assert.deepEqual(
				await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
				{ type: "unavailable", status, code },
			);
		}
	});

	test("a body without data is unavailable", async () => {
		const { fetch } = fakeFetch(() => json(200, { studio }));

		assert.deepEqual(await lookUpTenant("blackneedle", { apiUrl: API, fetch }), {
			type: "unavailable",
			status: 200,
			code: "invalid_response",
		});
	});

	test("a current slug that isn't a stored slug is unavailable", async () => {
		for (const data of [
			{ slug: "evil.test/x", name: "X" },
			{ slug: "Inkhouse", name: "X" },
			{ slug: "", name: "X" },
			{ slug: 42, name: "X" },
			{ name: "X" },
			null,
		]) {
			const { fetch } = fakeFetch(() => json(200, { data }));
			assert.deepEqual(
				await lookUpTenant("blackneedle", { apiUrl: API, fetch }),
				{ type: "unavailable", status: 200, code: "invalid_slug" },
				JSON.stringify(data),
			);
		}
	});

	test("an API that doesn't answer in time is unavailable", async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		assert.deepEqual(
			await lookUpTenant("blackneedle", { apiUrl: API, fetch, timeoutMs: 20 }),
			{ type: "unavailable", status: 0, code: "timeout" },
		);
	});

	test("an API that can't be reached is unavailable", async () => {
		const { fetch } = fakeFetch(() => {
			throw new TypeError("fetch failed");
		});

		assert.deepEqual(await lookUpTenant("blackneedle", { apiUrl: API, fetch }), {
			type: "unavailable",
			status: 0,
			code: "network_error",
		});
	});

	test("a cancelled request rejects with its AbortError", async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const lookup = lookUpTenant("blackneedle", {
			apiUrl: API,
			fetch,
			signal: controller.signal,
		});
		controller.abort();

		await assert.rejects(lookup, { name: "AbortError" });
	});
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/tenancy/lookup.ts`; the other files pass.

- [ ] **Step 5: Write `lookup.ts`**

Create `apps/storefront/src/tenancy/lookup.ts`:

```ts
import {
	createTattooClient,
	isTattooApiError,
	type Studio,
} from "@tattoo-drip/sdk";
import { STORED_SLUG } from "./host.ts";

/** How long a page waits for the API to confirm its studio (the SDK's default is 10 s). */
export const STUDIO_LOOKUP_TIMEOUT_MS = 5_000;

export type TenantLookup =
	| { type: "found"; studio: Studio }
	| { type: "moved"; slug: string }
	| { type: "missing" }
	| { type: "unavailable"; status: number; code: string };

export interface LookupOptions {
	/** The API's origin (API_URL). */
	apiUrl: string;
	/** Cancels the lookup with the request; its AbortError is rethrown. */
	signal?: AbortSignal;
	timeoutMs?: number;
	/** For tests. */
	fetch?: typeof fetch;
}

/**
 * Asks the API whether `slug` is a studio (getStudio, TAT-32). The API answers
 * an old slug like the current one and names the current slug in the body,
 * so a different slug there means the studio moved.
 */
export async function lookUpTenant(
	slug: string,
	options: LookupOptions,
): Promise<TenantLookup> {
	const client = createTattooClient({
		baseUrl: options.apiUrl,
		tenant: slug,
		fetch: options.fetch,
		timeoutMs: options.timeoutMs ?? STUDIO_LOOKUP_TIMEOUT_MS,
	});
	let studio: Studio;
	try {
		studio = await client.studio.get({ signal: options.signal });
	} catch (error) {
		// The caller's AbortError (the visitor left), or a bug: not ours to hide.
		if (!isTattooApiError(error)) throw error;
		// Only the API's own not_found is "no such studio": a bare 404 means
		// API_URL points at another server, which must not look like that.
		if (error.status === 404 && error.code === "not_found") {
			return { type: "missing" };
		}
		return { type: "unavailable", status: error.status, code: error.code };
	}
	// The current slug goes into a redirect: it must have the stored shape.
	if (typeof studio?.slug !== "string" || !STORED_SLUG.test(studio.slug)) {
		return { type: "unavailable", status: 200, code: "invalid_slug" };
	}
	return studio.slug === slug
		? { type: "found", studio }
		: { type: "moved", slug: studio.slug };
}
```

- [ ] **Step 6: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. (The storefront's `tsc` now also checks the SDK's source under the storefront's options. If it reports errors inside `packages/sdk/src`, stop and report them: the SDK is out of scope here.)

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/package.json pnpm-lock.yaml apps/storefront/src/tenancy/lookup.ts apps/storefront/test/tenancy/helpers.ts apps/storefront/test/tenancy/lookup.test.ts
git commit -m "feat(storefront): ask the API which studio a slug is"
```

---

### Task 4: The landing, not-found and unavailable pages, and the old-slug redirect

**Files:**
- Create: `apps/storefront/src/tenancy/responses.ts`
- Test: `apps/storefront/test/tenancy/responses.test.ts`

**Interfaces:**
- Consumes: `type StorefrontConfig`, `tenantOrigin` from `./config.ts` (Task 2).
- Produces, from `src/tenancy/responses.ts`: `SHORT_PUBLIC_CACHE = "public, max-age=0, s-maxage=60"`, `NO_STORE = "no-store"`, `RETRY_AFTER_SECONDS = 30`; `landingResponse(): Response`; `notFoundResponse(): Response`; `unavailableResponse(): Response`; `redirectResponse(location: string): Response`; `aliasLocation(config: StorefrontConfig, slug: string, requestUrl: string): string` (throws for a non-stored slug, via `tenantOrigin`).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/tenancy/responses.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StorefrontConfig } from "../../src/tenancy/config.ts";
import {
	aliasLocation,
	landingResponse,
	notFoundResponse,
	redirectResponse,
	unavailableResponse,
} from "../../src/tenancy/responses.ts";

const PROD: StorefrontConfig = {
	apiUrl: "https://api.tattoodrip.app",
	protocol: "https:",
	baseHost: "tattoodrip.com",
	port: "",
};
const DEV: StorefrontConfig = {
	apiUrl: "http://localhost:3333",
	protocol: "http:",
	baseHost: "localhost",
	port: ":3000",
};
const SHORT = "public, max-age=0, s-maxage=60";

/** Checks what every page shares and returns its body. */
async function pageBody(
	response: Response,
	status: number,
	cacheControl: string,
): Promise<string> {
	assert.equal(response.status, status);
	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	assert.equal(response.headers.get("cache-control"), cacheControl);
	assert.equal(response.headers.get("x-content-type-options"), "nosniff");
	assert.equal(
		response.headers.get("content-security-policy"),
		"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	);
	const body = await response.text();
	assert.match(body, /^<!doctype html>/);
	assert.match(body, /<meta name="robots" content="noindex">/);
	assert.doesNotMatch(body, /<script|<link|src=/i);
	return body;
}

describe("pages", () => {
	test("the landing page is a 200 kept a minute at the CDN", async () => {
		const body = await pageBody(landingResponse(), 200, SHORT);
		assert.match(body, /<title>Tattoo Drip<\/title>/);
		assert.match(body, /<h1>Tattoo Drip<\/h1>/);
	});

	test("the not-found page is a 404 kept a minute at the CDN", async () => {
		const body = await pageBody(notFoundResponse(), 404, SHORT);
		assert.match(body, /<title>Studio not found<\/title>/);
		assert.match(body, /<h1>We couldn't find this studio<\/h1>/);
	});

	test("the unavailable page is a 503, never stored, that says when to retry", async () => {
		const response = unavailableResponse();
		const body = await pageBody(response, 503, "no-store");
		assert.equal(response.headers.get("retry-after"), "30");
		assert.match(body, /<h1>This page can't load right now<\/h1>/);
	});
});

describe("redirectResponse", () => {
	test("is a 302 that is never stored, with no body", async () => {
		const response = redirectResponse("https://inkhouse.tattoodrip.com/flash");
		assert.equal(response.status, 302);
		assert.equal(
			response.headers.get("location"),
			"https://inkhouse.tattoodrip.com/flash",
		);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(await response.text(), "");
	});
});

describe("aliasLocation", () => {
	test("keeps the path and query on the current slug's origin", () => {
		assert.equal(
			aliasLocation(
				DEV,
				"inkhouse",
				"http://old-ink.localhost:3000/flash?style=fine-line",
			),
			"http://inkhouse.localhost:3000/flash?style=fine-line",
		);
		assert.equal(
			aliasLocation(PROD, "inkhouse", "https://old-ink.tattoodrip.com/"),
			"https://inkhouse.tattoodrip.com/",
		);
	});

	test("takes the origin from the settings, never from the request", () => {
		assert.equal(
			aliasLocation(PROD, "inkhouse", "http://evil.test:8080/about?x=1"),
			"https://inkhouse.tattoodrip.com/about?x=1",
		);
	});

	test("a path that looks like another host stays a path on the studio's origin", () => {
		for (const url of [
			"http://old-ink.tattoodrip.com//evil.test/x",
			"http://old-ink.tattoodrip.com/\\evil.test",
			"http://old-ink.tattoodrip.com/%2F%2Fevil.test",
		]) {
			const location = aliasLocation(PROD, "inkhouse", url);
			assert.equal(new URL(location).origin, "https://inkhouse.tattoodrip.com", url);
		}
	});

	test("refuses anything but a stored slug", () => {
		for (const slug of ["evil.test/", "Inkhouse", "ink.house", "", "ab"]) {
			assert.throws(
				() => aliasLocation(PROD, slug, "https://old-ink.tattoodrip.com/"),
				/stored tenant slug/,
				slug,
			);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/tenancy/responses.ts`; the other files pass.

- [ ] **Step 3: Write `responses.ts`**

Create `apps/storefront/src/tenancy/responses.ts`:

```ts
import { type StorefrontConfig, tenantOrigin } from "./config.ts";

/**
 * What the storefront answers itself, before any route runs (TAT-12): three
 * fixed pages and the old-slug redirect. Nothing from the request goes into
 * a page, so nothing needs escaping and nothing leaks.
 */

/** A minute at the CDN, revalidated by browsers: a new studio shows up fast. */
export const SHORT_PUBLIC_CACHE = "public, max-age=0, s-maxage=60";
export const NO_STORE = "no-store";
export const RETRY_AFTER_SECONDS = 30;

const PAGE_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"x-content-type-options": "nosniff",
	"content-security-policy":
		"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

type Page = { title: string; heading: string; text: string };

const LANDING: Page = {
	title: "Tattoo Drip",
	heading: "Tattoo Drip",
	text: "Studio pages for tattoo artists. Looking for a studio? Open the link it shared with you.",
};

const NOT_FOUND: Page = {
	title: "Studio not found",
	heading: "We couldn't find this studio",
	text: "Check the address, or ask the studio for its current link.",
};

const UNAVAILABLE: Page = {
	title: "Please try again",
	heading: "This page can't load right now",
	text: "Please try again in a minute.",
};

/** The base domain's and `www.`'s front page. */
export function landingResponse(): Response {
	return page(200, SHORT_PUBLIC_CACHE, LANDING);
}

/** Every "no studio here", whatever the reason, so the reason never shows. */
export function notFoundResponse(): Response {
	return page(404, SHORT_PUBLIC_CACHE, NOT_FOUND);
}

/** The API failed or timed out: temporary, so never stored. */
export function unavailableResponse(): Response {
	return page(503, NO_STORE, UNAVAILABLE, {
		"retry-after": String(RETRY_AFTER_SECONDS),
	});
}

/**
 * An old slug's redirect. 302, not 301/308: a studio can switch back to an
 * old slug, and a cached permanent redirect would then loop (TAT-24).
 */
export function redirectResponse(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location, "cache-control": NO_STORE },
	});
}

/**
 * Where an old slug's request goes: the same path and query under the
 * current slug's origin, which comes from STOREFRONT_URL, never from the
 * request. The path is appended as text, not resolved, so `//evil.test`
 * stays a path; the origin is checked again anyway.
 */
export function aliasLocation(
	config: StorefrontConfig,
	slug: string,
	requestUrl: string,
): string {
	const origin = tenantOrigin(config, slug);
	const { pathname, search } = new URL(requestUrl);
	const location = `${origin}${pathname}${search}`;
	if (new URL(location).origin !== origin) {
		throw new Error("An old-slug redirect must stay on the studio's origin");
	}
	return location;
}

function page(
	status: number,
	cacheControl: string,
	content: Page,
	headers: Record<string, string> = {},
): Response {
	return new Response(html(content), {
		status,
		headers: { ...PAGE_HEADERS, "cache-control": cacheControl, ...headers },
	});
}

function html({ title, heading, text }: Page): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem; box-sizing: border-box; }
main { max-width: 32rem; text-align: center; }
h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
p { margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<main>
<h1>${heading}</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/tenancy/responses.ts apps/storefront/test/tenancy/responses.test.ts
git commit -m "feat(storefront): answer missing studios, API failures and old slugs with fixed responses"
```

---

### Task 5: The request handler

**Files:**
- Create: `apps/storefront/src/tenancy/handle.ts`
- Test: `apps/storefront/test/tenancy/handle.test.ts`

**Interfaces:**
- Consumes: `tenantFromHost` (Task 1); `type StorefrontConfig` (Task 2); `lookUpTenant` (Task 3); `aliasLocation`, `landingResponse`, `notFoundResponse`, `redirectResponse`, `unavailableResponse` (Task 4); `fakeFetch`, `hangUntilAborted`, `json` from `test/tenancy/helpers.ts` (Task 3).
- Produces, from `src/tenancy/handle.ts`: `type TenantOutcome = { type: "studio"; studio: Studio } | { type: "respond"; response: Response }`; `interface TenantDeps { config: StorefrontConfig; log?: (message: string, details: { slug: string; status: number; code: string }) => void; fetch?: typeof fetch; timeoutMs?: number }`; `handleTenantRequest(request: Request, deps: TenantDeps): Promise<TenantOutcome>`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/tenancy/handle.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StorefrontConfig } from "../../src/tenancy/config.ts";
import {
	handleTenantRequest,
	type TenantDeps,
	type TenantOutcome,
} from "../../src/tenancy/handle.ts";
import { fakeFetch, hangUntilAborted, json } from "./helpers.ts";

const CONFIG: StorefrontConfig = {
	apiUrl: "http://api.test",
	protocol: "https:",
	baseHost: "tattoodrip.com",
	port: "",
};
const SHORT = "public, max-age=0, s-maxage=60";
const TENANTS = "http://api.test/api/v1/tenants/";

/**
 * A request whose URL host differs from its Host header, to prove that only
 * the header names the studio and the URL gives only the path and query.
 */
function request(
	host: string | null,
	path = "/",
	init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Request {
	const headers = new Headers(init.headers);
	if (host !== null) headers.set("host", host);
	return new Request(`http://internal.invalid${path}`, {
		method: init.method,
		headers,
		signal: init.signal,
	});
}

/** The API knows blackneedle, and old-ink as Ink House's old slug. */
function api() {
	return fakeFetch(({ url }) => {
		const slug = url.slice(TENANTS.length);
		if (slug === "blackneedle") {
			return json(200, { data: { slug: "blackneedle", name: "Black Needle" } });
		}
		if (slug === "old-ink") {
			return json(200, { data: { slug: "inkhouse", name: "Ink House" } });
		}
		return json(404, { error: { code: "not_found", message: "Not found." } });
	});
}

function deps(
	fetch: typeof globalThis.fetch,
	extra: Partial<TenantDeps> = {},
): TenantDeps {
	return { config: CONFIG, fetch, log: () => undefined, ...extra };
}

function responseOf(outcome: TenantOutcome): Response {
	assert.ok(outcome.type === "respond", `expected a response, got ${outcome.type}`);
	return outcome.response;
}

describe("handleTenantRequest", () => {
	test("the base domain's front page is the landing page, without asking the API", async () => {
		const { calls, fetch } = api();
		for (const host of ["tattoodrip.com", "www.tattoodrip.com"]) {
			const response = responseOf(await handleTenantRequest(request(host), deps(fetch)));
			assert.equal(response.status, 200, host);
			assert.equal(response.headers.get("cache-control"), SHORT, host);
		}
		assert.equal(calls.length, 0);
	});

	test("other paths on the base domain are the 404 page", async () => {
		const { calls, fetch } = api();
		const response = responseOf(
			await handleTenantRequest(request("tattoodrip.com", "/flash"), deps(fetch)),
		);
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});

	test("a studio's current slug goes on with the studio", async () => {
		const { calls, fetch } = api();
		const outcome = await handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/flash"),
			deps(fetch),
		);
		assert.deepEqual(outcome, {
			type: "studio",
			studio: { slug: "blackneedle", name: "Black Needle" },
		});
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${TENANTS}blackneedle`],
		);
	});

	test("the host is case-insensitive and its port is ignored", async () => {
		const { calls, fetch } = api();
		const outcome = await handleTenantRequest(
			request("BlackNeedle.TattooDrip.com:443"),
			deps(fetch),
		);
		assert.equal(outcome.type, "studio");
		assert.equal(calls[0].url, `${TENANTS}blackneedle`);
	});

	test("an old slug redirects to the current slug, same path and query", async () => {
		const { fetch } = api();
		for (const method of ["GET", "HEAD"]) {
			const response = responseOf(
				await handleTenantRequest(
					request("old-ink.tattoodrip.com", "/flash?style=fine-line", { method }),
					deps(fetch),
				),
			);
			assert.equal(response.status, 302, method);
			assert.equal(
				response.headers.get("location"),
				"https://inkhouse.tattoodrip.com/flash?style=fine-line",
				method,
			);
			assert.equal(response.headers.get("cache-control"), "no-store", method);
		}
	});

	test("other methods under an old slug get the 404 page", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("old-ink.tattoodrip.com", "/_serverFn/x", { method: "POST" }),
				deps(fetch),
			),
		);
		assert.equal(response.status, 404);
	});

	test("the redirect never uses the incoming Host or X-Forwarded-Host", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(
				request("OLD-INK.TattooDrip.com:8443", "/about", {
					headers: { "x-forwarded-host": "evil.test" },
				}),
				deps(fetch),
			),
		);
		assert.equal(
			response.headers.get("location"),
			"https://inkhouse.tattoodrip.com/about",
		);
	});

	test("X-Forwarded-Host never picks the studio", async () => {
		const forwarded = { headers: { "x-forwarded-host": "blackneedle.tattoodrip.com" } };

		const landing = api();
		const atBase = responseOf(
			await handleTenantRequest(request("tattoodrip.com", "/", forwarded), deps(landing.fetch)),
		);
		assert.equal(atBase.status, 200);
		assert.equal(landing.calls.length, 0);

		const unknown = api();
		const atUnknown = responseOf(
			await handleTenantRequest(
				request("no-such-studio.tattoodrip.com", "/", forwarded),
				deps(unknown.fetch),
			),
		);
		assert.equal(atUnknown.status, 404);
		assert.deepEqual(
			unknown.calls.map((call) => call.url),
			[`${TENANTS}no-such-studio`],
		);
	});

	test("an unknown studio gets the 404 page, which doesn't name it", async () => {
		const { fetch } = api();
		const response = responseOf(
			await handleTenantRequest(request("no-such-studio.tattoodrip.com"), deps(fetch)),
		);
		assert.equal(response.status, 404);
		assert.equal(response.headers.get("cache-control"), SHORT);
		assert.ok(!(await response.text()).includes("no-such-studio"));
	});

	test("hosts that can't be a studio get the 404 page without asking the API", async () => {
		const { calls, fetch } = api();
		for (const host of [
			"ab.tattoodrip.com",
			"a.b.tattoodrip.com",
			"black_needle.tattoodrip.com",
			"203.0.113.7",
			"[2001:db8::1]:443",
			"blackneedle.example.com",
			"",
			null,
		]) {
			const response = responseOf(await handleTenantRequest(request(host), deps(fetch)));
			assert.equal(response.status, 404, String(host));
		}
		assert.equal(calls.length, 0);
	});

	test("an API failure is a 503 page and one log line", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "Boom." } }),
		);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch, { log: (...entry) => logged.push(entry) }),
			),
		);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(response.headers.get("retry-after"), "30");
		assert.deepEqual(logged, [
			["Studio lookup failed", { slug: "blackneedle", status: 500, code: "internal_error" }],
		]);
	});

	test("an API that doesn't answer in time is a 503 page", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(hangUntilAborted);
		const response = responseOf(
			await handleTenantRequest(
				request("blackneedle.tattoodrip.com"),
				deps(fetch, { timeoutMs: 20, log: (...entry) => logged.push(entry) }),
			),
		);
		assert.equal(response.status, 503);
		assert.deepEqual(logged, [
			["Studio lookup failed", { slug: "blackneedle", status: 0, code: "timeout" }],
		]);
	});

	test("an API_URL that points at another server is a 503, not a missing studio", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<h1>Not Found</h1>", {
					status: 404,
					headers: { "content-type": "text/html" },
				}),
		);
		const response = responseOf(
			await handleTenantRequest(request("blackneedle.tattoodrip.com"), deps(fetch)),
		);
		assert.equal(response.status, 503);
	});

	test("a cancelled request rejects and logs nothing", async () => {
		const logged: unknown[] = [];
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();
		const handled = handleTenantRequest(
			request("blackneedle.tattoodrip.com", "/", { signal: controller.signal }),
			deps(fetch, { log: (...entry) => logged.push(entry) }),
		);
		controller.abort();

		await assert.rejects(handled, { name: "AbortError" });
		assert.deepEqual(logged, []);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: FAIL with "Cannot find module" for `src/tenancy/handle.ts`; the other files pass.

- [ ] **Step 3: Write `handle.ts`**

Create `apps/storefront/src/tenancy/handle.ts`:

```ts
import type { Studio } from "@tattoo-drip/sdk";
import type { StorefrontConfig } from "./config.ts";
import { tenantFromHost } from "./host.ts";
import { lookUpTenant } from "./lookup.ts";
import {
	aliasLocation,
	landingResponse,
	notFoundResponse,
	redirectResponse,
	unavailableResponse,
} from "./responses.ts";

export type TenantOutcome =
	| { type: "studio"; studio: Studio }
	| { type: "respond"; response: Response };

export interface TenantDeps {
	config: StorefrontConfig;
	/** Where an API failure is reported; console.error by default. */
	log?: (
		message: string,
		details: { slug: string; status: number; code: string },
	) => void;
	/** For tests. */
	fetch?: typeof fetch;
	timeoutMs?: number;
}

/**
 * What a request to the storefront gets (TAT-12): its studio, or a response
 * the storefront answers itself. Only the Host header names the studio, never
 * X-Forwarded-Host: the CDN keys its cache by Host, so a page chosen by
 * another header could be cached for the wrong host. `request.url` gives only
 * the path and query.
 */
export async function handleTenantRequest(
	request: Request,
	deps: TenantDeps,
): Promise<TenantOutcome> {
	const target = tenantFromHost(request.headers.get("host"), deps.config.baseHost);
	if (target.kind === "landing") {
		const atRoot = new URL(request.url).pathname === "/";
		return respond(atRoot ? landingResponse() : notFoundResponse());
	}
	// `foreign` is where custom domains (TAT-79) will look the hostname up.
	if (target.kind !== "tenant") return respond(notFoundResponse());

	const lookup = await lookUpTenant(target.slug, {
		apiUrl: deps.config.apiUrl,
		signal: request.signal,
		timeoutMs: deps.timeoutMs,
		fetch: deps.fetch,
	});
	switch (lookup.type) {
		case "found":
			return { type: "studio", studio: lookup.studio };
		case "moved":
			// Writes need the current slug, as at the API (TAT-32).
			return respond(
				isRead(request)
					? redirectResponse(aliasLocation(deps.config, lookup.slug, request.url))
					: notFoundResponse(),
			);
		case "missing":
			return respond(notFoundResponse());
		case "unavailable": {
			const log = deps.log ?? console.error;
			log("Studio lookup failed", {
				slug: target.slug,
				status: lookup.status,
				code: lookup.code,
			});
			return respond(unavailableResponse());
		}
	}
}

function respond(response: Response): TenantOutcome {
	return { type: "respond", response };
}

function isRead(request: Request): boolean {
	return request.method === "GET" || request.method === "HEAD";
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/tenancy/handle.ts apps/storefront/test/tenancy/handle.test.ts
git commit -m "feat(storefront): decide each request's studio or answer from its host"
```

---

### Task 6: Run it on every request (Start middleware)

**Files:**
- Create: `apps/storefront/src/tenancy/middleware.ts`
- Create: `apps/storefront/src/start.ts`
- Modify: `apps/storefront/vite.config.ts`
- Modify (regenerated by the build, never by hand): `apps/storefront/src/routeTree.gen.ts`

**Interfaces:**
- Consumes: `handleTenantRequest` (Task 5); `storefrontConfig`, `parseStorefrontConfig` (Task 2); from `@tanstack/react-start`: `createMiddleware`, `createServerOnlyFn`, `getGlobalStartContext`, `createCsrfMiddleware`, `createStart`.
- Produces: `tenantMiddleware` and `requestStudio(): Studio` (server only) from `src/tenancy/middleware.ts`; `startInstance` from `src/start.ts`; server-side loaders and `beforeLoad` see `serverContext.studio: Studio`.

There is no unit test for this glue (the logic is in Task 5). Its failing check is the typecheck: `requestStudio()` reads `context.studio`, which only exists once the route tree's Register footer names `startInstance`.

- [ ] **Step 1: Write the middleware**

Create `apps/storefront/src/tenancy/middleware.ts`:

```ts
import {
	createMiddleware,
	createServerOnlyFn,
	getGlobalStartContext,
} from "@tanstack/react-start";
import type { Studio } from "@tattoo-drip/sdk";
import { storefrontConfig } from "./config.ts";
import { handleTenantRequest } from "./handle.ts";

/**
 * Every server request's studio, from its Host (TAT-12). A studio goes on as
 * the request context's `studio` (`serverContext.studio` in server-side
 * loaders and beforeLoad); the landing page, the 404 page, an old slug's
 * redirect and the API-down page are answered here, before any route runs.
 */
export const tenantMiddleware = createMiddleware().server(
	async ({ request, next }) => {
		const outcome = await handleTenantRequest(request, {
			config: storefrontConfig(),
		});
		if (outcome.type === "respond") return outcome.response;
		return next({ context: { studio: outcome.studio } });
	},
);

/**
 * This request's studio, on the server only: in getRouter(), loaders and
 * server functions. TAT-23 builds its per-request SDK client from it.
 */
export const requestStudio = createServerOnlyFn((): Studio => {
	const context = getGlobalStartContext();
	if (!context) throw new Error("requestStudio() runs on the server only");
	return context.studio;
});
```

- [ ] **Step 2: Register it**

Create `apps/storefront/src/start.ts`:

```ts
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { tenantMiddleware } from "./tenancy/middleware.ts";

/**
 * Declaring global request middleware replaces Start's default CSRF check on
 * server functions, so that check comes back first, exactly as Start's
 * default: a cross-site call is refused before any API lookup. Then every
 * server request resolves its studio from its host (TAT-12).
 */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, tenantMiddleware],
}));
```

- [ ] **Step 3: See the typecheck fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: FAIL in `src/tenancy/middleware.ts` with "Property 'studio' does not exist" (the route tree's footer doesn't register `startInstance` yet). Any other error: stop and report it with its exact message (do not cast to `any`).

- [ ] **Step 4: Check the settings when the dev server starts**

Replace `apps/storefront/vite.config.ts` with:

```ts
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { parseStorefrontConfig } from "./src/tenancy/config.ts";

const config = defineConfig(({ command }) => {
	// The dev server refuses to start without API_URL and STOREFRONT_URL
	// (TAT-12). Builds don't read them: they are runtime settings.
	if (command === "serve") parseStorefrontConfig(process.env);
	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			devtools(),
			nitro({ rollupConfig: { external: [/^@sentry\//] } }),
			tailwindcss(),
			tanstackStart(),
			viteReact(),
			babel({ presets: [reactCompilerPreset()] }),
		],
	};
});

export default config;
```

- [ ] **Step 5: Build, which rewrites the route tree's footer**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: the build succeeds without any `API_URL`/`STOREFRONT_URL` set.

Run: `git diff apps/storefront/src/routeTree.gen.ts`
Expected: only the footer changes, to:

```ts
import type { getRouter } from './router.tsx'
import type { startInstance } from './start.ts'
declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}
```

If the footer did not change, stop and report it (never hand-edit the file, never run `generate-routes` for this).

- [ ] **Step 6: Typecheck passes**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 7: No server code in the browser bundle**

Run: `rg -l "did not answer in time|STOREFRONT_URL|s-maxage=60" apps/storefront/.output/public; echo "exit $?"`
Expected: no file listed and `exit 1` (the SDK, the settings and the responses are not in the client assets).

Run: `rg -l "STOREFRONT_URL" apps/storefront/.output/server | head -3`
Expected: at least one file (the check above would have found them).

- [ ] **Step 8: The dev server refuses to start without the settings**

Run: `API_URL= STOREFRONT_URL= PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH timeout 60 pnpm --filter @tattoo-drip/storefront dev > <scratchpad>/tat12-devcheck.log 2>&1; echo "exit $?"`
Expected: a non-zero exit within seconds (not 124), and the log contains `API_URL is not set` and `STOREFRONT_URL is not set`. If it exits 124, a server started: find its PID with `pgrep -af "vite dev --port 3000"` and `kill` that exact PID, then report.

- [ ] **Step 9: Tests still pass, then commit**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0`.

```bash
git add apps/storefront/src/tenancy/middleware.ts apps/storefront/src/start.ts apps/storefront/vite.config.ts apps/storefront/src/routeTree.gen.ts
git commit -m "feat(storefront): resolve every request's studio from its host"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/storefront/docs/development.md` (new section)
- Modify: `apps/storefront/AGENTS.md`
- Modify: `docs/architecture.md`, `docs/sdk.md`, `docs/requirements.md`, `docs/README.md`, `docs/agent-workflow.md`, `README.md`

Edit by content (other tickets may have moved lines). Biome does not check Markdown: re-read each edit and check its links.

- [ ] **Step 1: Storefront development guide**

Append to `apps/storefront/docs/development.md`:

```md
## Tenants and hosts

Every server request finds its studio from its `Host` header before any route runs (TAT-12): `src/start.ts` registers Start's CSRF check for server functions, then `tenantMiddleware` (`src/tenancy/`).

- `<slug>.<base>` is a studio: the API confirms it with `studio.get()` (5 s timeout). The current slug goes on; an old slug gets a 302 to the same path and query on the current subdomain (GET and HEAD; other methods get the 404 page). The base domain and `www.` show a static landing page at `/`.
- An unknown studio, a label that can't be a slug, a deeper name, an IP or another domain gets a static 404 page (`Cache-Control: public, max-age=0, s-maxage=60`, so a new studio shows within a minute). An API failure is a static 503 page with `Retry-After: 30`, logged with the slug, status and code.
- Only `Host` counts, never `X-Forwarded-Host`. Labels are checked against the stored slug shape only (`STORED_SLUG`, a copy of the platform's, pinned by a test); reserved and old slugs are the API's answer, so never copy the platform's reserved list.
- Server code reads the studio as `serverContext.studio` in loaders and `beforeLoad`, or with `requestStudio()` (`getRouter()`, server functions). The browser doesn't have it yet (TAT-23).
- Settings, server only, from `process.env` (not `src/env.ts`, whose `import.meta.env` holds only `VITE_` variables): `API_URL`, the API's origin, and `STOREFRONT_URL`, `http://{tenant}.localhost:3000` in development and `https://{tenant}.<domain>` in production, the same value as the platform's setting of that name. Both use https except on localhost. `pnpm dev` refuses to start without them; a build doesn't need them.
- Local development: run the platform, set `API_URL` to its address, and open `http://<slug>.localhost:3000` for a studio in its database. Chrome, Firefox, Edge and curl send `*.localhost` to this machine (for Safari: `curl -H 'Host: <slug>.localhost:3000' http://127.0.0.1:3000/`), and Vite allows those hosts. `http://localhost:3000` is the landing page.
- `src/start.ts` puts `startInstance` in `routeTree.gen.ts`'s Register footer. The Start Vite plugin writes that footer (`pnpm dev`, `pnpm build`); `tsr generate` writes none, so after `pnpm generate-routes`, run `pnpm build` before committing the route tree.
- Tests: `pnpm test` runs `test/**/*.test.ts` with `node:test` and `tsx`. Keep `src/tenancy/` free of React and TanStack imports (except `middleware.ts`) so its tests run in plain Node; its files import each other with `.ts` extensions.
```

- [ ] **Step 2: Storefront AGENTS.md**

In `apps/storefront/AGENTS.md`, replace the paragraph that starts "Run from `apps/storefront`:" with:

```md
Run from `apps/storefront`: `pnpm dev` (port 3000, loads `.env.local`; needs `API_URL` and `STOREFRONT_URL`), `pnpm test` (`node:test` + `tsx`, `test/`), `pnpm typecheck`, `pnpm build`, `pnpm generate-routes`. `src/routeTree.gen.ts` is generated; its Register footer comes from `pnpm dev`/`pnpm build`, not `generate-routes`. Browser-check UI changes.

Every request's studio comes from its host (`src/start.ts`, `src/tenancy/`): read [tenants and hosts](docs/development.md#tenants-and-hosts) before changing them.
```

- [ ] **Step 3: Architecture**

In `docs/architecture.md`, "Tenant context" table, add a row after the REST API row:

```md
| Studio page | The host: `blackneedle.platform.com` | The API confirms the studio on each request; an old slug redirects (302) to the current subdomain; anything else is a 404 page |
```

Replace the line "The hosted storefront maps its subdomain to the slug." with:

```md
The studio page reads only the `Host` header, never `X-Forwarded-Host`, because the CDN keys its cache by host.
```

In "Files, scale, hosting", at the end of the **Caching** bullet, add: "The storefront's own 404 page is kept 60 s at the CDN; its old-slug redirects and API-down page are never stored."

- [ ] **Step 4: SDK guide**

In `docs/sdk.md`, "Studio page = external storefront": replace the bullet "The tenant comes from the subdomain on each request." with:

```md
- The tenant comes from the host on each request: the storefront's tenant middleware confirms it with `studio.get()` and redirects old slugs ([tenants and hosts](../apps/storefront/docs/development.md#tenants-and-hosts)).
```

and replace the server-side snippet (the one splitting `hostname`) with:

```ts
// apps/storefront, server side (TAT-23): the tenant middleware has already
// confirmed the studio and redirected old slugs
const { slug } = requestStudio();
const client = createTattooClient({ baseUrl: API_URL, tenant: slug, key: env.STOREFRONT_SERVER_KEY });
```

- [ ] **Step 5: Requirements, index, workflow, README**

`docs/requirements.md`, "Studio page rules": replace "- The tenant comes from the subdomain. An unknown subdomain shows a not-found page." with:

```md
- The tenant comes from the subdomain (`<slug>.localhost:3000` in development). An unknown subdomain shows a not-found page (404); an old slug redirects (302) to the current subdomain with the same path and query; the bare domain and `www.` show a landing page.
```

`docs/README.md`: in the storefront row, change "Storefront forms, routing, data fetching and monitoring" to "Storefront forms, routing, data fetching, monitoring, tenants and hosts".

`docs/agent-workflow.md`: replace "Root `pnpm test` currently runs platform only." with "Root `pnpm test` runs every package's test script (platform, SDK, React, storefront)."

`README.md`:
- In the setup block, change `cp apps/storefront/.env.local.example apps/storefront/.env.local` to `cp apps/storefront/.env.local.example apps/storefront/.env.local   # set API_URL to the platform's address`.
- Commands table, `pnpm test` row: "Run every package's tests: platform (Japa), SDK, React and storefront (`node:test`)".
- Replace "Storefront and public packages currently have no test scripts, so root tests do not validate their behavior." with "The SDK, React and storefront tests (`node:test` with `tsx`) need no database. To try a studio page, run the platform and open `http://<slug>.localhost:3000` for a studio in its database; `http://localhost:3000` is the landing page."
- Deployment, storefront bullet: "**Storefront:** Vercel, with the project's Root Directory set to `apps/storefront`, the apex and wildcard domains, and `API_URL` and `STOREFRONT_URL` (`https://{tenant}.<domain>`) set (TAT-13)."

- [ ] **Step 6: Check and commit**

Run: `rg -n "tenants-and-hosts" docs apps/storefront README.md`
Expected: the links from `apps/storefront/AGENTS.md` and `docs/sdk.md`, and the heading exists in `apps/storefront/docs/development.md` ("## Tenants and hosts").

```bash
git add apps/storefront/docs/development.md apps/storefront/AGENTS.md docs/architecture.md docs/sdk.md docs/requirements.md docs/README.md docs/agent-workflow.md README.md
git commit -m "docs(storefront): document tenants, hosts and the storefront's settings"
```

---

### Task 8: Final verification

- [ ] **Step 1: Root gates**

Run each, from the root:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: all pass. After the build, `git status -s` shows no change (in particular none in `apps/storefront/src/routeTree.gen.ts`).

- [ ] **Step 2: Every test suite**

Run in the background (about 2 minutes): `PORT=3402 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm test > <scratchpad>/tat12-suite.log 2>&1; echo "exit $?" >> <scratchpad>/tat12-suite.log`
Expected: exit 0; the storefront's `# fail 0`; the SDK and React counts unchanged from the baseline; the platform's "Tests N passed" equals its count on the base (this ticket changes no platform code). Read the log's counts, not only the exit code.

- [ ] **Step 3: Dev-server pass (curl)**

Needs Postgres and the platform's dev database. If either is unavailable, skip this step and say so in the report.

1. Find a studio slug and, if any, an old one: `PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d tattoo_drip -Atc "select t.slug, s.slug from tenant_slugs s join tenants t on t.id = s.tenant_id order by t.slug"` (rows whose two columns differ are old slugs; the credentials are `apps/platform/.env.example`'s defaults; never read `apps/platform/.env`). If no old slug exists, skip the alias check.
2. Start the platform in the background: `PORT=3401 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C apps/platform dev > <scratchpad>/tat12-platform.log 2>&1` and wait until the log shows it listening on 3401.
3. Start the storefront in the background: `API_URL=http://localhost:3401 STOREFRONT_URL='http://{tenant}.localhost:3000' PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront dev > <scratchpad>/tat12-storefront.log 2>&1` and wait for its URL. If it says port 3000 was taken and picked another, use that port in the curl commands below (the `Location` still says 3000: it comes from `STOREFRONT_URL`).
4. Check, reading status lines and headers (`curl -s -D - -o /dev/null …`):
   - `http://localhost:3000/` → `200`, `cache-control: public, max-age=0, s-maxage=60`.
   - `-H 'Host: <slug>.localhost:3000' http://127.0.0.1:3000/` → `200`, the (mock) studio page.
   - `-H 'Host: no-such-studio-tat12.localhost:3000' http://127.0.0.1:3000/` → `404`, the short cache.
   - `-H 'Host: ab.localhost:3000' http://127.0.0.1:3000/` → `404`.
   - `-H 'Host: <old-slug>.localhost:3000' 'http://127.0.0.1:3000/flash?x=1'` → `302`, `location: http://<slug>.localhost:3000/flash?x=1`, `cache-control: no-store`.
   - `-H 'Host: localhost:3000' -H 'X-Forwarded-Host: <slug>.localhost:3000' http://127.0.0.1:3000/` → `200` and the body's `<h1>Tattoo Drip</h1>` (the landing page, not the studio).
   - Stop the platform (its exact PID: `pgrep -af "ace serve"` or the PID you started), then `-H 'Host: <slug>.localhost:3000' http://127.0.0.1:3000/` → `503`, `retry-after: 30`, `cache-control: no-store`, and one "Studio lookup failed" line in the storefront log.
5. Stop the storefront by its exact PID (`pgrep -af "vite dev --port 3000"`, then `kill <pid>`). Never `pkill -f`.

- [ ] **Step 4: Report**

Commits on the branch since the design commit, test counts (storefront, SDK, React, platform), the curl results (or why skipped), any deviation from this plan with its reason, and what the user still owes: set `API_URL` and `STOREFRONT_URL` in `apps/storefront/.env.local` (copy them from `.env.local.example`) and in Vercel (TAT-13); the browser check of `http://<slug>.localhost:3000` in Chrome.
