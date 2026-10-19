# Storefront deposit page (TAT-65b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve `/deposit#<token>` on the studio's host: the server renders a shell (the studio's name, a loading state, its chat links); the browser reads the token from the fragment, loads the deposit with `useDeposit(token)`, shows the amount, the pay-by day, the reference code, the studio's QR codes and details and its deposit policy, and sends one screenshot, re-encoded by TAT-57's image pipeline, with `useSubmitDepositProof(token)`; every state and refusal has fixed, kind copy.

**Architecture:** Pure modules in `apps/storefront/src/deposit/` (token, copy, view model, screenshot state and profile, refusal mapping, head and headers, the shell's loader) carry every decision and are tested with `node:test`. Props-only components in `src/deposit/components/` render the blocks and are tested with `react-dom/server`; `ProofForm` wires TanStack Form, the picker and the mutation; `DepositScreen` reads the fragment after hydration and picks the block. The route `src/routes/deposit.tsx` sets the loader, head and headers. TAT-57's `prepareReference` becomes `prepareImage` with a profile, shared with the screenshot.

**Tech Stack:** TanStack Start 1.168, Router 1.170 (`createFileRoute`, `headers`, `getScrollRestorationKey`), TanStack Form 1.33 (`useAppForm`, `revalidateLogic`, `ChoiceField`), TanStack Query 5.104 via `@tattoo-drip/react` (`useDeposit`, `useSubmitDepositProof`), `@tattoo-drip/sdk` (`DepositPage`, `TattooApiError`), React 19 (`useSyncExternalStore`, refs as props), `createImageBitmap` and canvas (TAT-57's codec), Tailwind CSS v4, `node:test` with `tsx`, TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-19-tat-65b-storefront-deposit-page-design.md` (read its Rulings first: they decide every open question). The TAT-65 spec's "Storefront page (TAT-65b)" section is the source of the page's words.

## Global Constraints

- **Storefront and docs only.** No change to `apps/platform` (its `docs/deploy.md` is the one platform file this plan edits), `packages/*` or `openapi.yaml`. The storefront never imports from `apps/platform` (tests may read contract files as text). Never edit a real `.env`/`.env.local` or `.env.local.example`: there is no new setting.
- **No dependency change: never run `pnpm add`, `pnpm remove` or a non-frozen `pnpm install`** (they re-resolve every `latest` specifier of the storefront in `pnpm-lock.yaml`). `apps/storefront/package.json` and `pnpm-lock.yaml` stay byte-for-byte as on the base. Everything used is installed: `@tanstack/react-form`, `@tanstack/react-router`, `@tattoo-drip/react`, `@tattoo-drip/sdk`, `lucide-react`. If `node_modules` is missing, `pnpm install --frozen-lockfile` (Task 0) is the only install allowed.
- **One new route, `src/routes/deposit.tsx`.** `src/routeTree.gen.ts` changes only by `pnpm --filter @tattoo-drip/storefront build` (Start's Vite plugin writes the tree and its Register footer; `pnpm generate-routes` writes no footer) and is committed with the route in Task 9. Never edit it by hand.
- **The token, verbatim:** `DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/`; read only in `src/deposit/components/deposit-screen.tsx`, from `window.location.hash`, after hydration; it goes only into `useDeposit(token)` / `useSubmitDepositProof(token)`. Never in a query string, storage, a log, loader data, the page's HTML or an analytics call; no `href` starting with `#` anywhere in `src/deposit/` (following one would replace the token).
- **Headers, verbatim:** `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`; meta `robots` `noindex, nofollow` and `referrer` `no-referrer`; QR images `referrerPolicy="no-referrer"`.
- **The screenshot, verbatim:** `PROOF_PROFILE` = steps `2048 px @ 0.85`, `2048 px @ 0.72`, `1600 px @ 0.72`, `targetBytes` 1.5 MiB, `maxBytes` 4 MiB, `name` `payment.jpg`; TAT-57's bounds unchanged (`ACCEPT`, 50 MiB, 100 MP, 20 s timeouts, `#ffffff`, `image/jpeg`).
- **Wire names, verbatim:** `submitProof` input `{ proof, method, expectedAmount }` (`expectedAmount` = the latest `deposit.due`); method kinds `fonepay`, `esewa`, `khalti`, `bank`; states `due`, `submitted`, `paid`, `updating`, `expired`, `cancelled`.
- Every string the page shows comes from `src/deposit/copy.ts` (Task 2 has the whole file); TAT-65's sentences in it are word for word. Names inside sentences render in `<bdi>` through `<Fill>` (`src/intake/components/fill.tsx`).
- TAT-48's markup rules: no `dangerouslySetInnerHTML`, no `style` props, no `target`; every `href` passes `isAllowedHref`; web links get `rel` from `linkRel`; API text goes through `cleanText`/`cleanLine` and renders as text; user text has `dir="auto"`. No `localStorage`, `sessionStorage`, IndexedDB, cookies, `console.*`, analytics or third-party script in `src/deposit/`.
- `src/deposit/{token,copy,view-model,proof,problems,seo}.ts` import no React or TanStack package and touch no DOM global; `loader.ts` is router glue like `src/studio/loaders.ts`. Only `browser.ts` and `components/` touch the DOM, inside handlers and effects. Modules and tests import each other by relative path with the `.ts`/`.tsx` extension.
- Tests live in `apps/storefront/test/deposit/`, named `*.test.ts` (the runner's glob is `test/**/*.test.ts`); helpers there are plain `.ts`. Test files are typechecked too (`tsconfig.json` includes `**/*.ts`).
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root (this worktree). `<scratchpad>` is the session's scratchpad directory; temp files go there, never `/tmp`. Never `sh -c`. Ports: 3403 fake API, 3404 built storefront (3333 is taken; 3401 and 3402 are the platform's). Start servers in the background and stop them by exact PID (never `pkill -f`).
- This plan uses no `\u` escapes. The `…`, `·` and Devanagari characters in code and tests are meant raw. (TAT-48's builder found its tool turning typed `\uXXXX` escapes into raw characters: if you add one, write it through a script and grep for it.)
- commitlint caps a commit's header and body lines at 100 characters; the messages below fit. The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with the `storefront` scope (the docs task: `docs(storefront)`) and end with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never open a PR, never touch the remote.

## Review Focus

1. The token reaches nothing but the API: no storage, no log, no Referer, no server, no `#` link that replaces it. Tests: Task 1 (strict parse, the scroll key), Task 9 guard and server-rendered shell, Task 11 `check:page` (`/deposit` asks the API for the lookup only), Task 12's network and storage checks.
2. A link that dies while the page is open stops showing payment details. Test: Task 5 "a link that stopped working replaces the page, even over data already shown".
3. A send whose answer got lost never leads the client to pay or send twice: the page is read again and shows `submitted` if the upload landed. Tests: Task 5 "a timeout, a network error and a 408 read the page again"; Task 12's `hang` mode.
4. The screenshot keeps TAT-57's safety bounds with its own size. Tests: Task 3 "keeps TAT-57's bounds", "refuses one that stays over 4 MiB", the pinned profiles.
5. Copy buttons' accessible names start with their visible words. Test: Task 7 "the code and every number have a copy button named after what it copies".

---

## Task 0: Preconditions

- [ ] **Step 1: The base holds what this plan uses.** This branch was designed on f2c48ee (the whole built chain). Run:

```bash
rg -n "export function useDeposit|export function useSubmitDepositProof" packages/react/src/hooks.ts
rg -n "useDeposit|useSubmitDepositProof" packages/react/src/index.ts
rg -n "deposit: \(client: TattooClient, token: string\)|staleTime: 0|submitDepositProof: \(|cancelQueries" packages/react/src/queries.ts
rg -n "export interface SubmitDepositProofInput|submitProof: async" packages/sdk/src/client.ts
rg -n "export type Deposit(Page|State|PaymentMethod) " packages/types/src/index.ts
rg -n "DepositToken:|deposit_not_due|deposit_changed" packages/types/openapi.yaml
rg -n 'exposeHeaders: \["retry-after"\]' apps/platform/config/cors.ts
rg -n "MAX_DIMENSION = 2048" apps/platform/app/modules/media/services/image_processor.ts
rg -n "export async function prepareReference|export const ACCEPT|export const MAX_SOURCE_PIXELS|export const ENCODE_STEPS|export const PREPARED_NAME|export interface PrepareOptions|export type PreparedReference" apps/storefront/src/intake/images.ts
rg -n "export const browserCodec" apps/storefront/src/intake/browser-codec.ts
rg -n "export function fill|export function fillParts|export const PHOTO_PROBLEMS|export type PhotoProblem" apps/storefront/src/intake/copy.ts
rg -n "export function Fill" apps/storefront/src/intake/components/fill.tsx
rg -n "function ChoiceField|export \{ useAppForm" apps/storefront/src/components/ui/form.tsx
rg -n 'networkMode: "always"' apps/storefront/src/api/query-client.ts
rg -n "export async function loadStudio" apps/storefront/src/api/loaders.ts
rg -n "export function (connectServer|createApiContext|seedStudio)" apps/storefront/src/api/context.ts
rg -n "export function studioViewModel" apps/storefront/src/studio/view-model.ts
rg -n "export function (whatsappLink|viberLink|safeImageUrl|linkRel|isAllowedHref)" apps/storefront/src/studio/links.ts
rg -n "export function (cleanText|cleanLine)" apps/storefront/src/studio/text.ts
rg -n "export type HeadMeta|export interface HeadTags" apps/storefront/src/studio/seo.ts
rg -n "scrollRestoration: true" apps/storefront/src/router.tsx
rg -n "export function renderWithProviders" apps/storefront/test/intake/providers.tsx
rg -n "export function (fakeFetch|json)" apps/storefront/test/tenancy/helpers.ts
rg -n "export const STUDIO" apps/storefront/test/studio/fixtures.ts
rg -n 'routes/__root.tsx", "routes/artists/\$slug.tsx", "routes/index.tsx' apps/storefront/test/studio/prototype-removed.test.ts
rg -n "An artist's page asked the API for more than the lookup and the list" apps/storefront/scripts/check-page.mjs
ls apps/storefront/src/routes/deposit.tsx apps/storefront/src/deposit 2>&1 | head -2
```

Expected: every pattern found; the last command says "No such file or directory" twice. If anything is missing, STOP: the branch must first be rebased onto the newest built tip that holds TAT-65, TAT-57, TAT-48, TAT-38, TAT-23 and TAT-12; that is the coordinator's call, and only the spec and plan commit sits on top. If a review renamed one of these, use the real name everywhere below and say so in the report.

- [ ] **Step 2: Dependencies are installed, unchanged.** If `apps/storefront/node_modules` is missing, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm install --frozen-lockfile --offline` (without `--offline` if the store lacks a package), then `git status --short`: expected empty (no lockfile or `package.json` change). Then check the router option this plan sets exists in the installed router:

```bash
rg -l "getScrollRestorationKey" node_modules/.pnpm/@tanstack+router-core@*/node_modules/@tanstack/router-core/dist/esm/router.d.ts
```

Expected: at least one file. If none, STOP and report (ruling 4 relies on it).

- [ ] **Step 3: Clean tree and Node.** `git status -sb` shows no changes; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`.

- [ ] **Step 4: Baselines.** Run and note the `# pass` count:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck
```

Expected: `# fail 0`; typecheck passes. Note `git rev-parse HEAD` as `<base>` (Task 11 checks what must not change since).

- [ ] **Step 5: Read the code you will edit or use.** `apps/storefront/src/intake/images.ts`, `src/intake/copy.ts` (only `fill`, `fillParts`, `PHOTO_PROBLEMS`), `src/intake/components/fill.tsx`, `src/intake/components/intake-form.tsx` (how TanStack Form, refs, effects and focus are wired), `src/intake/components/reference-picker.tsx`, `src/components/ui/form.tsx`, `src/router.tsx`, `src/routes/index.tsx`, `src/routes/__root.tsx`, `src/api/loaders.ts`, `src/studio/seo.ts`, `src/studio/links.ts`, `src/studio/text.ts`, `src/styles.css`, `scripts/check-page.mjs`, `test/intake/images.test.ts`, `test/intake/providers.tsx`, `test/studio/prototype-removed.test.ts`, `packages/react/src/queries.ts` (`deposit`, `submitDepositProof`), `packages/sdk/src/client.ts` (`deposits`).

---

### Task 1: The token, read in the browser only, and a scroll key that is never the href

**Files:**
- Create: `apps/storefront/src/deposit/token.ts`
- Create: `apps/storefront/test/deposit/fixtures.ts`
- Test: `apps/storefront/test/deposit/token.test.ts`
- Modify: `apps/storefront/src/router.tsx`

**Interfaces:**
- Produces: `DEPOSIT_TOKEN: RegExp`, `readDepositToken(hash: string): string | null`, `scrollRestorationKey(location: { pathname: string; state: { __TSR_key?: string } }): string`; test fixture `TOKEN` (43 characters).

- [ ] **Step 1: Write the fixture and the failing test**

Create `apps/storefront/test/deposit/fixtures.ts`:

```ts
/** Shared by the deposit page's tests (TAT-65b). Later tasks add the page and the shell. */

/** A deposit link's token: 43 base64url characters. */
export const TOKEN = "tat65b-browser-pass-token-0123456789abcdefg";
```

Create `apps/storefront/test/deposit/token.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	DEPOSIT_TOKEN,
	readDepositToken,
	scrollRestorationKey,
} from "../../src/deposit/token.ts";
import { TOKEN } from "./fixtures.ts";

const CONTRACT = new URL(
	"../../../../packages/types/openapi.yaml",
	import.meta.url,
);

describe("readDepositToken", () => {
	test("reads the 43 base64url characters of the link's fragment", () => {
		assert.equal(TOKEN.length, 43);
		assert.equal(readDepositToken(`#${TOKEN}`), TOKEN);
		assert.equal(readDepositToken(TOKEN), TOKEN);
		const every = `${"AZaz09_-".repeat(5)}abc`;
		assert.equal(every.length, 43);
		assert.equal(readDepositToken(`#${every}`), every);
	});

	test("refuses anything else, so a broken link asks the API for nothing", () => {
		for (const hash of [
			"",
			"#",
			`#${TOKEN.slice(1)}`,
			`#${TOKEN}A`,
			`#${TOKEN.slice(0, 42)}=`,
			`#${TOKEN.slice(0, 42)}+`,
			`#${TOKEN.slice(0, 42)}/`,
			`#${TOKEN.slice(0, 42)}.`,
			`# ${TOKEN.slice(1)}`,
			`#${TOKEN} `,
			`#${TOKEN}&utm_source=whatsapp`,
			`#${TOKEN.slice(0, 40)}%2D`,
			"#inquiry",
		]) {
			assert.equal(readDepositToken(hash), null, JSON.stringify(hash));
		}
	});

	test("is the contract's DepositToken pattern", () => {
		const yaml = readFileSync(CONTRACT, "utf8");
		const pattern = /DepositToken:[\s\S]*?pattern: "([^"]+)"/.exec(yaml)?.[1];
		assert.equal(pattern, DEPOSIT_TOKEN.source);
	});
});

describe("scrollRestorationKey", () => {
	test("is the history entry's own key", () => {
		assert.equal(
			scrollRestorationKey({
				pathname: "/deposit",
				state: { __TSR_key: "k3j2x" },
			}),
			"k3j2x",
		);
	});

	test("falls back to the path, never the href with its fragment", () => {
		assert.equal(
			scrollRestorationKey({ pathname: "/deposit", state: {} }),
			"/deposit",
		);
		assert.equal(
			scrollRestorationKey({ pathname: "/deposit", state: { __TSR_key: "" } }),
			"/deposit",
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/token.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/token.ts`.

- [ ] **Step 3: Write `token.ts`**

Create `apps/storefront/src/deposit/token.ts`:

```ts
/*
 * The deposit link's token (TAT-65 ruling 9, TAT-65b ruling 3). The studio
 * sends https://<studio>/deposit#<token>: the token rides in the URL's
 * fragment, which a browser never sends to the storefront's server, its logs
 * or a Referer. Only the browser reads it (components/deposit-screen.tsx,
 * after hydration), and only to call the API. It never goes in a query
 * string, storage, a log, the page's HTML or an in-page link.
 */

/** The contract's DepositToken (openapi.yaml): exactly 43 base64url characters. */
export const DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token in a URL fragment (with or without its "#"), or null when this
 * link can't work: then the page says so without asking the API. Nothing is
 * trimmed or decoded: a real token never needs it.
 */
export function readDepositToken(hash: string): string | null {
	const value = hash.startsWith("#") ? hash.slice(1) : hash;
	return DEPOSIT_TOKEN.test(value) ? value : null;
}

/**
 * The router's scroll-restoration key (src/router.tsx). The router keeps
 * scroll positions in sessionStorage under this key, and its default falls
 * back to the whole href, fragment and all, for a history entry without a
 * key of its own. This falls back to the path, so a deposit token can never
 * reach storage.
 */
export function scrollRestorationKey(location: {
	readonly pathname: string;
	readonly state: { readonly __TSR_key?: string };
}): string {
	return location.state.__TSR_key || location.pathname;
}
```

- [ ] **Step 4: Give the router the key**

In `apps/storefront/src/router.tsx`, add the import (Biome sorts it):

```ts
import { scrollRestorationKey } from "./deposit/token.ts";
```

and replace

```ts
		scrollRestoration: true,
```

with

```ts
		scrollRestoration: true,
		// Never the href: a deposit link's token is in its fragment (TAT-65b).
		getScrollRestorationKey: scrollRestorationKey,
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/token.test.ts`
Expected: PASS (5 tests).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes. If `getScrollRestorationKey`'s parameter type doesn't accept the function, check the installed `ParsedLocation['state']` (`rg -n "__TSR_key" node_modules/.pnpm/@tanstack+history@*/node_modules/@tanstack/history/dist/esm/index.d.ts`) and widen `scrollRestorationKey`'s parameter to match; never cast the router option.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/deposit/token.ts apps/storefront/src/router.tsx apps/storefront/test/deposit/fixtures.ts apps/storefront/test/deposit/token.test.ts
git commit -m "feat(storefront): read the deposit link's token from the fragment, in the browser only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Every word the deposit page shows

**Files:**
- Create: `apps/storefront/src/deposit/copy.ts`
- Test: `apps/storefront/test/deposit/copy.test.ts`

**Interfaces:**
- Consumes: `type DepositPaymentMethod` from `@tattoo-drip/sdk`; `type PhotoProblem` from `../intake/copy.ts`.
- Produces: `copy` (the whole object below), `PROOF_NOTICE_CODES`, `type ProofNoticeCode`, `type DepositMethodKind`, `interface NoticeText { title: string; body?: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/deposit/copy.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { copy, PROOF_NOTICE_CODES } from "../../src/deposit/copy.ts";
import { PHOTO_PROBLEMS } from "../../src/intake/copy.ts";

/** The placeholders the page fills somewhere. */
const PLACEHOLDERS = new Set([
	"studio",
	"artist",
	"amount",
	"date",
	"count",
	"code",
	"label",
	"number",
	"name",
	"wait",
]);

/** Every string in the copy, with its path. */
function strings(value: unknown, path = "copy"): Array<[string, string]> {
	if (typeof value === "string") return [[path, value]];
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, child]) =>
			strings(child, `${path}.${key}`),
		);
	}
	return [];
}

describe("the deposit page's copy", () => {
	test("uses only the placeholders the page fills, and no stray braces", () => {
		for (const [path, text] of strings(copy)) {
			for (const match of text.matchAll(/\{(\w+)\}/g)) {
				assert.ok(PLACEHOLDERS.has(match[1]), `${path}: {${match[1]}}`);
			}
			assert.doesNotMatch(text.replace(/\{\w+\}/g, ""), /[{}]/, path);
		}
	});

	test("has no empty string", () => {
		for (const [path, text] of strings(copy)) {
			assert.ok(text.trim().length > 0, path);
		}
	});

	test("explains every refusal and names the file in every screenshot problem", () => {
		for (const code of PROOF_NOTICE_CODES) {
			assert.ok(copy.notices[code].title.length > 0, code);
		}
		for (const problem of PHOTO_PROBLEMS) {
			assert.match(copy.form.problems[problem], /\{name\}/, problem);
		}
	});

	test("names every kind of payment method, its scan hint and its number", () => {
		for (const kind of ["fonepay", "esewa", "khalti", "bank"] as const) {
			assert.ok(copy.form.kinds[kind], kind);
			assert.ok(copy.methods.scan[kind], kind);
			assert.ok(copy.methods.accountNumber[kind], kind);
		}
	});

	test("keeps the TAT-65 spec's words", () => {
		assert.equal(copy.heading, "Pay your deposit to {studio}");
		assert.equal(
			copy.due.partial,
			"Part of your {amount} deposit was already received.",
		);
		assert.equal(
			copy.code.hint,
			"Write this code in the payment remark (or note).",
		);
		assert.equal(
			copy.methods.none,
			"The studio hasn't added payment details yet. Message them to ask how to pay.",
		);
		assert.equal(copy.policyTitle, "Deposit policy");
		assert.equal(
			copy.rejected,
			"The studio couldn't confirm your last screenshot. Check the amount and the reference code, then send a new one, or message the studio.",
		);
		assert.equal(copy.form.title, "After you pay, send a screenshot");
		assert.equal(copy.form.method, "How did you pay?");
		assert.equal(copy.form.proof, "Payment screenshot");
		assert.equal(copy.form.send, "Send screenshot");
		assert.equal(copy.form.sending, "Sending…");
		assert.equal(
			copy.form.tooLarge,
			"This image is too large. Use one of 10 MB or less.",
		);
		assert.equal(
			copy.notices.changed.title,
			"The deposit amount changed. Check the new amount.",
		);
		assert.equal(
			copy.notices["rate-limited"].title,
			"Too many tries. Wait {wait} and try again.",
		);
		assert.equal(
			copy.notices.offline.title,
			"Couldn't send. Check your connection and try again.",
		);
		assert.equal(
			copy.states.submitted,
			"We've sent your screenshot to {studio}, received {date}. They'll check it and confirm on WhatsApp or Viber.",
		);
		assert.equal(copy.states.paid, "Your deposit is paid. Thank you!");
		assert.equal(
			copy.states.paidNone,
			"No deposit is needed for this booking.",
		);
		assert.equal(
			copy.states.updating,
			"{studio} is updating your quote. They'll message you when it's ready.",
		);
		assert.equal(
			copy.states.expired,
			"This quote has expired. Message {studio} if you still want to book.",
		);
		assert.equal(
			copy.states.cancelled,
			"This booking was cancelled. Message {studio} if you think this is a mistake.",
		);
		assert.equal(
			copy.load.dead,
			"This link doesn't work any more. Ask the studio to send you a new one.",
		);
		assert.equal(
			copy.load["rate-limited"],
			"Too many tries. Wait a few minutes, then reload the page.",
		);
		assert.equal(
			copy.load.failed,
			"We couldn't load your deposit. Check your connection.",
		);
	});

	test("says the studio is paid directly, never Tattoo Drip", () => {
		assert.match(copy.footer, /\{studio\} directly/);
		assert.match(copy.footer, /never handles your money/);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/copy.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/copy.ts`.

- [ ] **Step 3: Write `copy.ts`**

Create `apps/storefront/src/deposit/copy.ts`:

```ts
import type { DepositPaymentMethod } from "@tattoo-drip/sdk";
import type { PhotoProblem } from "../intake/copy.ts";

/*
 * Every word the deposit page shows (TAT-65b), in English. Templates hold
 * named placeholders ({studio}, {date}…) that `fill` (src/intake/copy.ts)
 * replaces; components put the values in <bdi> through <Fill>, because names
 * may be Nepali or right-to-left. The sentences the TAT-65 spec fixed are
 * kept word for word. A Nepali version would be a second object of this
 * shape: nothing else would change.
 */

export type DepositMethodKind = DepositPaymentMethod["kind"];

/** The refusals after Send that a notice explains (problems.ts). */
export const PROOF_NOTICE_CODES = [
	"changed",
	"not-due",
	"gone",
	"rate-limited",
	"cut-off",
	"offline",
	"busy",
	"invalid",
	"server",
] as const;
export type ProofNoticeCode = (typeof PROOF_NOTICE_CODES)[number];

export interface NoticeText {
	readonly title: string;
	readonly body?: string;
}

const kinds: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
	bank: "Bank transfer",
};

const scan: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Scan it with your bank or wallet app (Fonepay).",
	esewa: "Scan it with your eSewa app.",
	khalti: "Scan it with your Khalti app.",
	bank: "Scan it with your banking app.",
};

/** What the number a client pays to is called (the platform keeps wallet IDs there too). */
const accountNumber: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Number",
	esewa: "eSewa ID",
	khalti: "Khalti ID",
	bank: "Account number",
};

const problems: Readonly<Record<PhotoProblem, string>> = {
	unsupported:
		"{name} isn't an image this page can use. Add a JPEG, PNG or WebP screenshot.",
	heic: "{name} is a HEIC photo, which this browser can't open. Take a screenshot of the payment instead.",
	"too-big":
		"{name} is too big to prepare. Take a screenshot of the payment instead.",
	unreadable:
		"{name} couldn't be opened. Try another image, or a screenshot of the payment.",
	"too-heavy":
		"{name} couldn't be made small enough to send. Take a screenshot of the payment instead.",
};

const notices: Readonly<Record<ProofNoticeCode, NoticeText>> = {
	changed: {
		title: "The deposit amount changed. Check the new amount.",
		body: "If you already paid the old amount, message {studio} before you send a screenshot.",
	},
	"not-due": {
		title: "This page changed while you were on it.",
		body: "Check what it says now. If it still asks for a screenshot, send it again.",
	},
	gone: {
		title: "This link doesn't work any more.",
		body: "Ask the studio to send you a new one.",
	},
	"rate-limited": { title: "Too many tries. Wait {wait} and try again." },
	"cut-off": {
		title: "The upload was cut off.",
		body: "Check your connection, then send again.",
	},
	offline: { title: "Couldn't send. Check your connection and try again." },
	busy: {
		title: "The page is busy right now.",
		body: "Send again in a minute.",
	},
	invalid: {
		title: "Your screenshot wasn't accepted.",
		body: "Reload the page, then send it again.",
	},
	server: {
		title: "Something went wrong on our side.",
		body: "Send again in a minute. If it keeps happening, message {studio}.",
	},
};

export const copy = {
	title: "Pay your deposit",
	titleWithStudio: "Pay your deposit · {studio}",
	description: "Pay your deposit, then send a screenshot of the payment.",
	descriptionWithStudio:
		"Pay your deposit to {studio}, then send a screenshot of the payment.",
	heading: "Pay your deposit to {studio}",
	withArtist: "with {artist}",
	briefSummary: "Your tattoo idea",
	loading: "Loading your deposit…",
	noScript: "Turn on JavaScript to see your deposit, or message {studio}.",
	due: {
		title: "Deposit due",
		partial: "Part of your {amount} deposit was already received.",
		payBy: "Pay by {date}.",
		payByToday: "Pay by today, {date}.",
		payByTomorrow: "Pay by tomorrow, {date}.",
		payByDays: "Pay by {date}, in {count} days.",
	},
	code: {
		title: "Reference code",
		hint: "Write this code in the payment remark (or note).",
		copy: "Copy code",
		copyLabel: "Copy code {code}",
	},
	methods: {
		title: "How to pay",
		samePhone:
			"Paying from this phone? Press and hold a QR code to save it, then choose it from your gallery in your payment app's scanner.",
		qrAlt: "{label} QR code for {studio}",
		scan,
		accountNumber,
		accountName: "Account name",
		bankName: "Bank",
		copy: "Copy",
		copyLabel: "Copy {number}",
		none: "The studio hasn't added payment details yet. Message them to ask how to pay.",
	},
	policyTitle: "Deposit policy",
	rejected:
		"The studio couldn't confirm your last screenshot. Check the amount and the reference code, then send a new one, or message the studio.",
	form: {
		title: "After you pay, send a screenshot",
		method: "How did you pay?",
		kinds,
		proof: "Payment screenshot",
		proofHint: "A screenshot or a photo of the payment: JPEG, PNG or WebP.",
		add: "Add screenshot",
		replace: "Choose another",
		remove: "Remove screenshot",
		previewAlt: "Your payment screenshot",
		preparing: "Preparing your screenshot…",
		ready: "Screenshot added.",
		problems,
		send: "Send screenshot",
		sending: "Sending…",
		sendingStatus: "Sending your screenshot…",
		stillSending:
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		required: {
			method: "Choose how you paid.",
			proof: "Add a screenshot of your payment.",
		},
		tooLarge: "This image is too large. Use one of 10 MB or less.",
		summaryOne: "Check this before sending",
		summaryMany: "Check these {count} things before sending",
		summaryLabels: { method: "How you paid", proof: "Payment screenshot" },
	},
	notices,
	wait: {
		minute: "a minute",
		minutes: "{count} minutes",
		hour: "an hour",
		hours: "{count} hours",
	},
	states: {
		submitted:
			"We've sent your screenshot to {studio}, received {date}. They'll check it and confirm on WhatsApp or Viber.",
		submittedUndated:
			"We've sent your screenshot to {studio}. They'll check it and confirm on WhatsApp or Viber.",
		amount: "Amount",
		paid: "Your deposit is paid. Thank you!",
		paidNone: "No deposit is needed for this booking.",
		updating:
			"{studio} is updating your quote. They'll message you when it's ready.",
		expired:
			"This quote has expired. Message {studio} if you still want to book.",
		cancelled:
			"This booking was cancelled. Message {studio} if you think this is a mistake.",
	},
	load: {
		dead: "This link doesn't work any more. Ask the studio to send you a new one.",
		"rate-limited": "Too many tries. Wait a few minutes, then reload the page.",
		failed: "We couldn't load your deposit. Check your connection.",
		retry: "Try again",
	},
	copied: "Copied",
	copyFailed: "Couldn't copy. Press and hold the text to copy it.",
	contact: "Questions? Message {studio}:",
	whatsapp: "WhatsApp",
	viber: "Viber",
	whatsappText: "Hi {studio}, about my deposit (reference code {code}).",
	whatsappTextNoCode: "Hi {studio}, about my deposit.",
	footer:
		"You pay {studio} directly. Tattoo Drip runs this page for them and never handles your money.",
};
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/copy.test.ts`
Expected: PASS (6 tests).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/deposit/copy.ts apps/storefront/test/deposit/copy.test.ts
git commit -m "feat(storefront): write the deposit page's copy in one place

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Screenshots through the intake form's image pipeline

**Files:**
- Modify: `apps/storefront/src/intake/images.ts`
- Create: `apps/storefront/src/deposit/proof.ts`
- Test: `apps/storefront/test/deposit/proof.test.ts` (and the existing `test/intake/images.test.ts`, unchanged, must stay green)

**Interfaces:**
- Produces in `images.ts`: `interface EncodeProfile { steps: readonly { edge: number; quality: number }[]; targetBytes: number; maxBytes: number; name: string }`, `REFERENCE_PROFILE`, `prepareImage(source, codec, profile, options?)`; `prepareReference` keeps its signature and behaviour.
- Produces in `proof.ts`: `PROOF_PROFILE`, `prepareProof(source, codec, options?)`, `type ProofState`, `type ProofAction`, `NO_PROOF`, `proofReducer`, `interface PreviewUrls`, `previewOf(file, urls)`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/deposit/proof.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	NO_PROOF,
	PROOF_PROFILE,
	prepareProof,
	previewOf,
	proofReducer,
} from "../../src/deposit/proof.ts";
import {
	type DecodedImage,
	type EncodeRequest,
	type ImageCodec,
	REFERENCE_PROFILE,
} from "../../src/intake/images.ts";

const MIB = 1024 * 1024;

interface FakeImage extends DecodedImage {
	closed: boolean;
}

/** A codec that decodes to the size it is told and encodes blobs of chosen sizes. */
function fakeCodec(
	options: {
		width?: number;
		height?: number;
		sizes?: number[];
		decode?: "fail";
	} = {},
) {
	const encoded: EncodeRequest[] = [];
	const images: FakeImage[] = [];
	let decoded = 0;
	const codec: ImageCodec<FakeImage> = {
		async decode() {
			decoded += 1;
			if (options.decode === "fail") throw new Error("can't decode");
			const image: FakeImage = {
				width: options.width ?? 1080,
				height: options.height ?? 2400,
				closed: false,
				close: () => {
					image.closed = true;
				},
			};
			images.push(image);
			return image;
		},
		async encode(_image, request) {
			encoded.push(request);
			const size = options.sizes?.[encoded.length - 1] ?? 300_000;
			return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
		},
	};
	return { codec, encoded, images, decodedCount: () => decoded };
}

/** A picked file whose size is `size` without allocating it. */
function picked(
	name = "Screenshot_20261018-141500.png",
	type = "image/png",
	size = 900_000,
) {
	const file = new File([new Uint8Array(8)], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

/** A PNG that is only its header: the size it declares, never the pixels. */
function declaredPng(width: number, height: number) {
	const word = (value: number) => [
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff,
	];
	const bytes = [
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
		0x44, 0x52, ...word(width), ...word(height), 8, 6, 0, 0, 0,
	];
	return new File([Uint8Array.from(bytes)], "declared.png", {
		type: "image/png",
	});
}

describe("the profiles", () => {
	test("a screenshot keeps 2048 px, like the platform keeps proofs", () => {
		assert.deepEqual(PROOF_PROFILE, {
			steps: [
				{ edge: 2048, quality: 0.85 },
				{ edge: 2048, quality: 0.72 },
				{ edge: 1600, quality: 0.72 },
			],
			targetBytes: 1.5 * MIB,
			maxBytes: 4 * MIB,
			name: "payment.jpg",
		});
	});

	test("the intake form's reference photos are as TAT-57 made them", () => {
		assert.deepEqual(REFERENCE_PROFILE, {
			steps: [
				{ edge: 1600, quality: 0.85 },
				{ edge: 1600, quality: 0.72 },
				{ edge: 1280, quality: 0.72 },
			],
			targetBytes: MIB,
			maxBytes: 3.5 * MIB,
			name: "reference.jpg",
		});
	});
});

describe("prepareProof", () => {
	test("keeps a tall screenshot's text readable: 2048 px, a JPEG on white, payment.jpg", async () => {
		const { codec, encoded, images, decodedCount } = fakeCodec();
		const result = await prepareProof(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.name, "payment.jpg");
		assert.equal(result.file.type, "image/jpeg");
		assert.deepEqual([result.width, result.height], [922, 2048]);
		assert.deepEqual(encoded, [
			{
				width: 922,
				height: 2048,
				quality: 0.85,
				type: "image/jpeg",
				background: "#ffffff",
			},
		]);
		assert.equal(decodedCount(), 1);
		assert.equal(images[0].closed, true);
	});

	test("never enlarges a small screenshot", async () => {
		const { codec, encoded } = fakeCodec({ width: 720, height: 1600 });
		await prepareProof(picked(), codec);

		assert.deepEqual([encoded[0].width, encoded[0].height], [720, 1600]);
	});

	test("lowers the quality, then the size, until it is at most 1.5 MiB", async () => {
		const { codec, encoded } = fakeCodec({
			sizes: [2_200_000, 1_900_000, 1_400_000],
		});
		const result = await prepareProof(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, 1_400_000);
		assert.deepEqual(
			encoded.map(({ width, quality }) => [width, quality]),
			[
				[922, 0.85],
				[922, 0.72],
				[720, 0.72],
			],
		);
		assert.deepEqual([result.width, result.height], [720, 1600]);
	});

	test("stops at the first step that is at most 1.5 MiB", async () => {
		const { codec, encoded } = fakeCodec({ sizes: [1_600_000, 1_500_000] });
		await prepareProof(picked(), codec);

		assert.equal(encoded.length, 2);
	});

	test("refuses one that stays over 4 MiB", async () => {
		const { codec, images } = fakeCodec({
			sizes: [5_000_000, 4_500_000, 4_300_000],
		});

		assert.deepEqual(await prepareProof(picked(), codec), {
			ok: false,
			problem: "too-heavy",
		});
		assert.equal(images[0].closed, true);
	});

	test("keeps TAT-57's bounds: type, 50 MiB, 100 megapixels, HEIC", async () => {
		const { codec, decodedCount } = fakeCodec();

		assert.deepEqual(
			await prepareProof(picked("clip.gif", "image/gif"), codec),
			{ ok: false, problem: "unsupported" },
		);
		assert.deepEqual(
			await prepareProof(picked("big.jpg", "image/jpeg", 50 * MIB + 1), codec),
			{ ok: false, problem: "too-big" },
		);
		assert.deepEqual(await prepareProof(declaredPng(20_000, 20_000), codec), {
			ok: false,
			problem: "too-big",
		});
		assert.equal(decodedCount(), 0);
		assert.deepEqual(
			await prepareProof(
				picked("IMG_0042.HEIC", "image/heic"),
				fakeCodec({ decode: "fail" }).codec,
			),
			{ ok: false, problem: "heic" },
		);
	});
});

describe("proofReducer", () => {
	const file = new File([new Uint8Array(4)], "payment.jpg", {
		type: "image/jpeg",
	});

	test("a pick is prepared, then ready", () => {
		const preparing = proofReducer(NO_PROOF, { type: "picked", id: 1 });
		assert.deepEqual(preparing, { kind: "preparing", id: 1 });
		assert.deepEqual(
			proofReducer(preparing, { type: "prepared", id: 1, file }),
			{ kind: "ready", id: 1, file },
		);
	});

	test("a refused pick leaves no screenshot and says why", () => {
		const preparing = proofReducer(NO_PROOF, { type: "picked", id: 2 });
		assert.deepEqual(
			proofReducer(preparing, {
				type: "refused",
				id: 2,
				problem: "heic",
				name: "IMG_0042.HEIC",
			}),
			{ kind: "empty", problem: { kind: "heic", name: "IMG_0042.HEIC" } },
		);
	});

	test("a result for an earlier pick, or after a removal, is dropped", () => {
		const second = proofReducer(
			proofReducer(NO_PROOF, { type: "picked", id: 1 }),
			{ type: "picked", id: 2 },
		);
		assert.equal(
			proofReducer(second, { type: "prepared", id: 1, file }),
			second,
		);
		const removed = proofReducer(second, { type: "removed" });
		assert.equal(removed, NO_PROOF);
		assert.equal(
			proofReducer(removed, { type: "prepared", id: 2, file }),
			NO_PROOF,
		);
	});
});

describe("previewOf", () => {
	test("makes one URL and frees it once, however often it is released", () => {
		const made: Blob[] = [];
		const revoked: string[] = [];
		const handle = previewOf(new Blob(["x"]), {
			create: (blob) => {
				made.push(blob);
				return "blob:preview-1";
			},
			revoke: (url) => {
				revoked.push(url);
			},
		});

		assert.equal(handle.url, "blob:preview-1");
		assert.equal(made.length, 1);
		handle.release();
		handle.release();
		assert.deepEqual(revoked, ["blob:preview-1"]);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/proof.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/proof.ts`.

- [ ] **Step 3: Give the pipeline a profile**

In `apps/storefront/src/intake/images.ts`:

(a) Replace the file's opening comment block (from `/*` to the first `*/`, "Reference photos, prepared in the browser before the upload…") with:

```ts
/*
 * Images picked in the browser, prepared before the upload (TAT-57, spec
 * ruling 5; TAT-65b): each one decoded once, shrunk and re-encoded as a
 * JPEG, so an upload on a slow connection stays small and no EXIF or GPS
 * data leaves the phone. An EncodeProfile says how far to shrink: the
 * intake form's reference photos (REFERENCE_PROFILE) and the deposit page's
 * payment screenshot (src/deposit/proof.ts) share every bound and timeout.
 * The decoder and the canvas sit behind ImageCodec: browser-codec.ts in the
 * page, fakes in the tests.
 */
```

(b) Right after the line `export const BACKGROUND = "#ffffff";`, add:

```ts

/**
 * How a picked image is re-encoded: `steps` tried in order until one gives
 * at most `targetBytes`; over `maxBytes` after the last, it is refused; the
 * sent file is named `name`, never the picked file's own name.
 */
export interface EncodeProfile {
	readonly steps: readonly {
		readonly edge: number;
		readonly quality: number;
	}[];
	readonly targetBytes: number;
	readonly maxBytes: number;
	readonly name: string;
}

/** The intake form's reference photos (TAT-57). */
export const REFERENCE_PROFILE: EncodeProfile = {
	steps: ENCODE_STEPS,
	targetBytes: TARGET_BYTES,
	maxBytes: MAX_PREPARED_BYTES,
	name: PREPARED_NAME,
};
```

(c) Replace the whole `prepareReference` function, from its doc comment `/** One picked file as the JPEG the form sends, or why it can't be. */` to its closing brace, with:

```ts
/** One picked reference photo as the JPEG the intake form sends, or why it can't be. */
export function prepareReference<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
	options: PrepareOptions = {},
): Promise<PreparedReference> {
	return prepareImage(source, codec, REFERENCE_PROFILE, options);
}

/** One picked image as a JPEG shrunk as `profile` says, or why it can't be. */
export async function prepareImage<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
	profile: EncodeProfile,
	options: PrepareOptions = {},
): Promise<PreparedReference> {
	const timer = options.timer ?? pageTimer;
	const kind = classifySource(source);
	if (kind === "unsupported") return { ok: false, problem: "unsupported" };
	if (source.size > MAX_SOURCE_BYTES) return { ok: false, problem: "too-big" };
	// The header says how many pixels the decoder would have to hold; a few
	// hundred KB can declare a gigabyte. Refused before anything is decoded.
	const declared = await readImageSize(source);
	if (declared && declared.width * declared.height > MAX_SOURCE_PIXELS) {
		return { ok: false, problem: "too-big" };
	}

	let image: Image;
	const decoding = codec.decode(source);
	try {
		image = await within(decoding, DECODE_TIMEOUT_MS, timer);
	} catch (error) {
		if (error instanceof TimedOut) {
			// Not waited for any more, but freed if it ever arrives.
			decoding.then(
				(late) => late.close(),
				() => undefined,
			);
			return { ok: false, problem: "unreadable" };
		}
		return { ok: false, problem: kind === "heic" ? "heic" : "unreadable" };
	}

	try {
		if (!(image.width > 0 && image.height > 0)) {
			return { ok: false, problem: "unreadable" };
		}
		let best: { blob: Blob; width: number; height: number } | null = null;
		for (const step of profile.steps) {
			const size = fitWithin(image.width, image.height, step.edge);
			const blob = await within(
				codec.encode(image, {
					...size,
					quality: step.quality,
					type: PREPARED_TYPE,
					background: BACKGROUND,
				}),
				ENCODE_TIMEOUT_MS,
				timer,
			);
			best = { blob, ...size };
			if (blob.size <= profile.targetBytes) break;
		}
		if (!best || best.blob.size > profile.maxBytes) {
			return { ok: false, problem: "too-heavy" };
		}
		return {
			ok: true,
			file: new File([best.blob], profile.name, { type: PREPARED_TYPE }),
			width: best.width,
			height: best.height,
		};
	} catch {
		return { ok: false, problem: "unreadable" };
	} finally {
		image.close();
	}
}
```

The body is TAT-57's, with `ENCODE_STEPS`, `TARGET_BYTES`, `MAX_PREPARED_BYTES` and `PREPARED_NAME` read from `profile`. If a review changed `prepareReference`'s body since the base, keep the reviewed body and make only those four substitutions.

- [ ] **Step 4: Write `proof.ts`**

Create `apps/storefront/src/deposit/proof.ts`:

```ts
import type { PhotoProblem } from "../intake/copy.ts";
import {
	type DecodedImage,
	type EncodeProfile,
	type ImageCodec,
	type PreparedReference,
	type PrepareOptions,
	prepareImage,
} from "../intake/images.ts";

/*
 * The payment screenshot (TAT-65b, spec rulings 14 and 15): one image,
 * prepared by the intake form's pipeline (src/intake/images.ts) with every
 * bound and timeout it has, and a profile of its own. Pure: the form runs
 * prepareProof and makes the preview URL (previewOf) around this state.
 */

const MIB = 1024 * 1024;

/**
 * 2048 px on the long edge, as the platform keeps proofs, so the small text
 * the studio checks (the amount, the transaction ID, the remark) stays
 * readable; at most 1.5 MiB when it can be, never over 4 MiB.
 */
export const PROOF_PROFILE: EncodeProfile = {
	steps: [
		{ edge: 2048, quality: 0.85 },
		{ edge: 2048, quality: 0.72 },
		{ edge: 1600, quality: 0.72 },
	],
	targetBytes: 1.5 * MIB,
	maxBytes: 4 * MIB,
	name: "payment.jpg",
};

/** The picked screenshot as the JPEG the page sends, or why it can't be. */
export function prepareProof<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
	options?: PrepareOptions,
): Promise<PreparedReference> {
	return prepareImage(source, codec, PROOF_PROFILE, options);
}

export type ProofState =
	| {
			readonly kind: "empty";
			/** Why the last pick wasn't added, with the picked file's name (for the message only). */
			readonly problem: {
				readonly kind: PhotoProblem;
				readonly name: string;
			} | null;
	  }
	| { readonly kind: "preparing"; readonly id: number }
	| { readonly kind: "ready"; readonly id: number; readonly file: File };

export type ProofAction =
	| { readonly type: "picked"; readonly id: number }
	| { readonly type: "prepared"; readonly id: number; readonly file: File }
	| {
			readonly type: "refused";
			readonly id: number;
			readonly problem: PhotoProblem;
			readonly name: string;
	  }
	| { readonly type: "removed" };

export const NO_PROOF: ProofState = { kind: "empty", problem: null };

/** A result for a pick that is no longer the one being prepared is dropped. */
export function proofReducer(
	state: ProofState,
	action: ProofAction,
): ProofState {
	switch (action.type) {
		case "picked":
			return { kind: "preparing", id: action.id };
		case "prepared":
			return state.kind === "preparing" && state.id === action.id
				? { kind: "ready", id: action.id, file: action.file }
				: state;
		case "refused":
			return state.kind === "preparing" && state.id === action.id
				? {
						kind: "empty",
						problem: { kind: action.problem, name: action.name },
					}
				: state;
		case "removed":
			return NO_PROOF;
	}
}

export interface PreviewUrls {
	create(file: Blob): string;
	revoke(url: string): void;
}

/** A preview URL for `file`, and what frees it (once, however often it is called). */
export function previewOf(
	file: Blob,
	urls: PreviewUrls,
): { readonly url: string; release(): void } {
	const url = urls.create(file);
	let released = false;
	return {
		url,
		release() {
			if (released) return;
			released = true;
			urls.revoke(url);
		},
	};
}
```

- [ ] **Step 5: Run the tests, TAT-57's included, and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/proof.test.ts test/intake/images.test.ts test/intake/references.test.ts`
Expected: PASS, TAT-57's image and tray tests with the same counts as before.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/intake/images.ts apps/storefront/src/deposit/proof.ts apps/storefront/test/deposit/proof.test.ts
git commit -m "feat(storefront): prepare payment screenshots with the intake form's image pipeline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: What the page shows, from the API's page

**Files:**
- Create: `apps/storefront/src/deposit/view-model.ts`
- Modify: `apps/storefront/test/deposit/fixtures.ts`
- Test: `apps/storefront/test/deposit/view-model.test.ts`

**Interfaces:**
- Consumes: `DepositPage`, `DepositPaymentMethod`, `DepositState` from `@tattoo-drip/sdk`; `fill` from `../intake/copy.ts`; `safeImageUrl`, `viberLink`, `whatsappLink` from `../studio/links.ts`; `cleanLine`, `cleanText` from `../studio/text.ts`; `copy` from `./copy.ts`.
- Produces: `DEPOSIT_KINDS`, `LONG_BRIEF`, `interface MethodView`, `interface DepositView`, `depositView(page)`, `todayIn(timeZone, now?)`, `daysUntil(day, today)`, `payByLine(view, today)`, `formatReceived(iso, timeZone)`, `stateTemplate(view, received)`, `interface DepositContact`, `depositContact(shell, referenceCode)`; fixtures `QR_URL`, `PAGE`, `page(overrides)`, `SHELL`.

- [ ] **Step 1: Add the page to the fixtures**

Append to `apps/storefront/test/deposit/fixtures.ts` (and add `import type { DepositPage } from "@tattoo-drip/sdk";` at its top):

```ts

export const QR_URL =
	"https://api.example.com/uploads/tenants/t/payment_qr/esewa.png";

/** A whole DepositPage (the contract's), due, with an eSewa QR and a bank account. */
export const PAGE: DepositPage = {
	studio: { name: "Black Needle" },
	project: {
		brief: "Fine line peony on the left forearm",
		artistName: "Sita Rai",
	},
	deposit: {
		amount: 300_000,
		amountText: "NPR 3,000",
		due: 300_000,
		dueText: "NPR 3,000",
		currency: "NPR",
		payBy: "2026-10-28",
		payByText: "28 Oct 2026",
	},
	referenceCode: "7K3M9Q",
	state: "due",
	lastProofRejected: false,
	proofSubmittedAt: null,
	paymentMethods: [
		{
			kind: "esewa",
			label: "eSewa",
			qrImageUrl: QR_URL,
			accountName: "Black Needle Pvt Ltd",
			accountNumber: "9812345678",
			bankName: null,
		},
		{
			kind: "bank",
			label: "Bank transfer",
			qrImageUrl: null,
			accountName: "Black Needle Pvt Ltd",
			accountNumber: "01234567890123",
			bankName: "Nabil Bank",
		},
	],
	depositPolicy:
		"Deposits hold your date.\nThey are kept if you cancel within 48 hours.",
};

export const page = (overrides: Partial<DepositPage> = {}): DepositPage => ({
	...PAGE,
	...overrides,
});

/** What the route's loader gives the screen (src/deposit/loader.ts's DepositShell). */
export const SHELL = {
	studioName: "Black Needle",
	timezone: "Asia/Kathmandu",
	phone: "+9779812345678",
};
```

- [ ] **Step 2: Write the failing test**

Create `apps/storefront/test/deposit/view-model.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { copy } from "../../src/deposit/copy.ts";
import {
	daysUntil,
	depositContact,
	depositView,
	formatReceived,
	payByLine,
	stateTemplate,
	todayIn,
} from "../../src/deposit/view-model.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";

describe("depositView", () => {
	test("a due deposit: methods in the API's order, its kinds once each, the form", () => {
		const view = depositView(PAGE);

		assert.equal(view.state, "due");
		assert.deepEqual(
			view.methods.map((method) => [method.id, method.kind, method.label]),
			[
				["method-0", "esewa", "eSewa"],
				["method-1", "bank", "Bank transfer"],
			],
		);
		assert.equal(view.methods[0].qr, QR_URL);
		assert.equal(view.methods[0].accountNumber, "9812345678");
		assert.equal(view.methods[1].qr, null);
		assert.equal(view.methods[1].bankName, "Nabil Bank");
		assert.deepEqual(view.kinds, ["esewa", "bank"]);
		assert.equal(view.takesProof, true);
		assert.equal(view.due, 300_000);
		assert.equal(view.dueText, "NPR 3,000");
		assert.equal(view.partial, false);
		assert.equal(view.payBy, "2026-10-28");
		assert.equal(view.referenceCode, "7K3M9Q");
		assert.equal(view.artistName, "Sita Rai");
		assert.equal(
			view.policy,
			"Deposits hold your date.\nThey are kept if you cancel within 48 hours.",
		);
	});

	test("a kind once, kinds it can't take dropped, QR codes only over http(s)", () => {
		const [esewa, bank] = PAGE.paymentMethods;
		const view = depositView(
			page({
				paymentMethods: [
					esewa,
					{ ...esewa, label: "eSewa (Sita)", qrImageUrl: "javascript:alert(1)" },
					{ ...bank, kind: "cash" as never },
				],
			}),
		);

		assert.deepEqual(view.kinds, ["esewa"]);
		assert.deepEqual(
			view.methods.map((method) => method.label),
			["eSewa", "eSewa (Sita)"],
		);
		assert.equal(view.methods[1].qr, null);
	});

	test("a method without a label is named by its kind", () => {
		const view = depositView(
			page({ paymentMethods: [{ ...PAGE.paymentMethods[1], label: "  " }] }),
		);
		assert.equal(view.methods[0].label, "Bank transfer");
	});

	test("no payment details and no form outside due", () => {
		for (const state of [
			"submitted",
			"paid",
			"updating",
			"expired",
			"cancelled",
		] as const) {
			const view = depositView(page({ state }));
			assert.deepEqual(view.methods, [], state);
			assert.deepEqual(view.kinds, [], state);
			assert.equal(view.takesProof, false, state);
		}
	});

	test("no form when the studio shows no way to pay", () => {
		const view = depositView(page({ paymentMethods: [] }));
		assert.equal(view.state, "due");
		assert.equal(view.takesProof, false);
	});

	test("a state this page doesn't know is updating: nothing to pay shown", () => {
		const view = depositView(page({ state: "refunded" as never }));
		assert.equal(view.state, "updating");
		assert.deepEqual(view.methods, []);
	});

	test("part of the deposit received, or none needed", () => {
		const part = depositView(
			page({
				deposit: { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" },
			}),
		);
		assert.equal(part.partial, true);

		const none = depositView(
			page({
				state: "paid",
				deposit: {
					...PAGE.deposit,
					amount: 0,
					amountText: "NPR 0",
					due: 0,
					dueText: "NPR 0",
				},
			}),
		);
		assert.equal(none.partial, false);
		assert.equal(none.amount, 0);
	});

	test("the last screenshot's rejection shows only while due", () => {
		assert.equal(
			depositView(page({ lastProofRejected: true })).lastProofRejected,
			true,
		);
		assert.equal(
			depositView(page({ lastProofRejected: true, state: "submitted" }))
				.lastProofRejected,
			false,
		);
	});

	test("folds a brief over 240 characters, counted as characters", () => {
		const brief = (text: string) =>
			depositView(page({ project: { brief: text, artistName: null } }))
				.briefLong;
		assert.equal(brief("a".repeat(240)), false);
		assert.equal(brief("a".repeat(241)), true);
		assert.equal(brief("क".repeat(240)), false);
	});

	test("cleans the API's text", () => {
		const view = depositView(
			page({
				project: { brief: "  Fine line\r\n\r\n\r\npeony  ", artistName: "  Sita   Rai " },
				depositPolicy: "   ",
				deposit: { ...PAGE.deposit, payBy: "soon" },
			}),
		);
		assert.equal(view.brief, "Fine line\n\npeony");
		assert.equal(view.artistName, "Sita Rai");
		assert.equal(view.policy, null);
		assert.equal(view.payBy, null);
	});
});

describe("dates, in the studio's timezone", () => {
	test("today, where the studio is", () => {
		const evening = new Date("2026-10-18T20:00:00Z");
		assert.equal(todayIn("Asia/Kathmandu", evening), "2026-10-19");
		assert.equal(todayIn("UTC", evening), "2026-10-18");
		assert.equal(todayIn("Not/AZone", evening), null);
	});

	test("whole days until the last day to pay", () => {
		assert.equal(daysUntil("2026-10-28", "2026-10-18"), 10);
		assert.equal(daysUntil("2026-10-18", "2026-10-18"), 0);
		assert.equal(daysUntil("2026-10-17", "2026-10-18"), -1);
		assert.equal(daysUntil("2026-11-02", "2026-10-30"), 3);
		assert.equal(daysUntil("soon", "2026-10-18"), null);
	});

	test("the pay-by line", () => {
		const view = { payBy: "2026-10-28", payByText: "28 Oct 2026" };
		assert.equal(payByLine(view, "2026-10-18"), "Pay by 28 Oct 2026, in 10 days.");
		assert.equal(payByLine(view, "2026-10-27"), "Pay by tomorrow, 28 Oct 2026.");
		assert.equal(payByLine(view, "2026-10-28"), "Pay by today, 28 Oct 2026.");
		assert.equal(payByLine(view, "2026-10-29"), "Pay by 28 Oct 2026.");
		assert.equal(payByLine(view, null), "Pay by 28 Oct 2026.");
		assert.equal(
			payByLine({ payBy: null, payByText: "28 Oct 2026" }, "2026-10-18"),
			"Pay by 28 Oct 2026.",
		);
	});

	test("when the screenshot came", () => {
		assert.equal(
			formatReceived("2026-10-18T08:20:00.000Z", "Asia/Kathmandu"),
			"18 Oct 2026, 2:05 pm",
		);
		assert.equal(
			formatReceived("2026-10-18T18:30:00.000Z", "Asia/Kathmandu"),
			"19 Oct 2026, 12:15 am",
		);
		assert.equal(formatReceived(null, "Asia/Kathmandu"), null);
		assert.equal(formatReceived("not a date", "Asia/Kathmandu"), null);
		assert.equal(
			formatReceived("2026-10-18T08:20:00.000Z", "Not/AZone"),
			null,
		);
	});
});

describe("stateTemplate", () => {
	test("each state's sentence", () => {
		const view = (state: (typeof PAGE)["state"], amount = 300_000) => ({
			state,
			amount,
		});
		assert.equal(
			stateTemplate(view("submitted"), "18 Oct 2026, 2:05 pm"),
			copy.states.submitted,
		);
		assert.equal(
			stateTemplate(view("submitted"), null),
			copy.states.submittedUndated,
		);
		assert.equal(stateTemplate(view("paid"), null), copy.states.paid);
		assert.equal(stateTemplate(view("paid", 0), null), copy.states.paidNone);
		assert.equal(stateTemplate(view("updating"), null), copy.states.updating);
		assert.equal(stateTemplate(view("expired"), null), copy.states.expired);
		assert.equal(stateTemplate(view("cancelled"), null), copy.states.cancelled);
	});
});

describe("depositContact", () => {
	test("WhatsApp with the reference code, and Viber", () => {
		assert.deepEqual(depositContact(SHELL, "7K3M9Q"), {
			whatsapp: `https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit (reference code 7K3M9Q).")}`,
			viber: "viber://chat?number=%2B9779812345678",
		});
	});

	test("before the code is known, and without a phone", () => {
		assert.equal(
			depositContact(SHELL, null).whatsapp,
			`https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit.")}`,
		);
		assert.deepEqual(depositContact({ ...SHELL, phone: null }, "7K3M9Q"), {
			whatsapp: null,
			viber: null,
		});
	});
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/view-model.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/view-model.ts`.

- [ ] **Step 4: Write `view-model.ts`**

Create `apps/storefront/src/deposit/view-model.ts`:

```ts
import type {
	DepositPage,
	DepositPaymentMethod,
	DepositState,
} from "@tattoo-drip/sdk";
import { fill } from "../intake/copy.ts";
import { safeImageUrl, viberLink, whatsappLink } from "../studio/links.ts";
import { cleanLine, cleanText } from "../studio/text.ts";
import { copy, type DepositMethodKind } from "./copy.ts";

/*
 * What the deposit page shows (TAT-65b), from the API's DepositPage. Pure.
 * Every string the API sends is plain text, cleaned here and rendered as
 * text; QR codes pass safeImageUrl (http or https only). Amounts are the
 * API's own text: the page never formats paisa.
 */

/** The kinds a screenshot can name (the contract's DepositPaymentMethod.kind). */
export const DEPOSIT_KINDS: readonly DepositMethodKind[] = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
];

const STATES: readonly DepositState[] = [
	"due",
	"submitted",
	"paid",
	"updating",
	"expired",
	"cancelled",
];

/** A brief longer than this many characters is folded, so the amount stays on a phone's first screen. */
export const LONG_BRIEF = 240;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface MethodView {
	/** Stable for React keys: the method's place in the API's list. */
	readonly id: string;
	readonly kind: DepositMethodKind;
	readonly label: string;
	/** The QR image's URL, or null (none, or not http(s)). */
	readonly qr: string | null;
	readonly accountName: string | null;
	/** The bank account number, or the eSewa or Khalti ID. */
	readonly accountNumber: string | null;
	readonly bankName: string | null;
}

export interface DepositView {
	readonly state: DepositState;
	readonly brief: string | null;
	readonly briefLong: boolean;
	readonly artistName: string | null;
	/** The current quote's deposit, in paisa. */
	readonly amount: number;
	readonly amountText: string;
	/** What is still to pay, in paisa: sent back as `expectedAmount`. */
	readonly due: number;
	readonly dueText: string;
	/** Part of the deposit was already received. */
	readonly partial: boolean;
	/** The last day to pay (yyyy-mm-dd, the studio's timezone), or null. */
	readonly payBy: string | null;
	readonly payByText: string;
	readonly referenceCode: string;
	readonly lastProofRejected: boolean;
	readonly proofSubmittedAt: string | null;
	/** Only in `due`. */
	readonly methods: readonly MethodView[];
	/** The methods' kinds, once each, in the API's order: the "How did you pay?" choices. */
	readonly kinds: readonly DepositMethodKind[];
	readonly policy: string | null;
	/** `due`, with a way to pay and something to pay: the form shows. */
	readonly takesProof: boolean;
}

export function depositView(page: DepositPage): DepositView {
	const state: DepositState = STATES.includes(page.state)
		? page.state
		: "updating";
	const methods = state === "due" ? methodViews(page.paymentMethods) : [];
	const brief = cleanText(page.project.brief);
	const { amount, due } = page.deposit;
	return {
		state,
		brief,
		briefLong: brief !== null && Array.from(brief).length > LONG_BRIEF,
		artistName: cleanLine(page.project.artistName),
		amount,
		amountText: cleanLine(page.deposit.amountText) ?? "",
		due,
		dueText: cleanLine(page.deposit.dueText) ?? "",
		partial: due > 0 && due < amount,
		payBy: DAY.test(page.deposit.payBy) ? page.deposit.payBy : null,
		payByText: cleanLine(page.deposit.payByText) ?? "",
		referenceCode: cleanLine(page.referenceCode) ?? "",
		lastProofRejected: state === "due" && page.lastProofRejected === true,
		proofSubmittedAt: page.proofSubmittedAt,
		methods,
		kinds: [...new Set(methods.map((method) => method.kind))],
		policy: cleanText(page.depositPolicy),
		takesProof:
			state === "due" && methods.length > 0 && Number.isInteger(due) && due > 0,
	};
}

function methodViews(
	methods: readonly DepositPaymentMethod[],
): MethodView[] {
	return methods
		.filter((method) => DEPOSIT_KINDS.includes(method.kind))
		.map((method, index) => ({
			id: `method-${index}`,
			kind: method.kind,
			label: cleanLine(method.label) ?? copy.form.kinds[method.kind],
			qr: safeImageUrl(method.qrImageUrl),
			accountName: cleanLine(method.accountName),
			accountNumber: cleanLine(method.accountNumber),
			bankName: cleanLine(method.bankName),
		}));
}

/** Today's date (yyyy-mm-dd) in `timeZone`, or null when this browser doesn't know the zone. */
export function todayIn(
	timeZone: string,
	now: Date = new Date(),
): string | null {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(now);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((each) => each.type === type)?.value;
		const year = part("year");
		const month = part("month");
		const day = part("day");
		return year && month && day ? `${year}-${month}-${day}` : null;
	} catch {
		return null;
	}
}

/** Whole days from `today` to `day` (both yyyy-mm-dd), or null. */
export function daysUntil(day: string, today: string): number | null {
	if (!DAY.test(day) || !DAY.test(today)) return null;
	const end = Date.parse(`${day}T00:00:00Z`);
	const start = Date.parse(`${today}T00:00:00Z`);
	return Number.isNaN(end) || Number.isNaN(start)
		? null
		: Math.round((end - start) / DAY_MS);
}

/** "Pay by 28 Oct 2026, in 10 days." The API's date always; the count only when it makes sense. */
export function payByLine(
	view: Pick<DepositView, "payBy" | "payByText">,
	today: string | null,
): string {
	const date = view.payByText;
	const days = view.payBy && today ? daysUntil(view.payBy, today) : null;
	if (days === 0) return fill(copy.due.payByToday, { date });
	if (days === 1) return fill(copy.due.payByTomorrow, { date });
	if (days !== null && days > 1) {
		return fill(copy.due.payByDays, { date, count: days });
	}
	return fill(copy.due.payBy, { date });
}

/**
 * When the screenshot came, as "18 Oct 2026, 2:05 pm" in `timeZone`, or null.
 * Assembled from Intl's parts (en-GB month names, like the platform's
 * formatDay), so no browser's spacing or capitals change it.
 */
export function formatReceived(
	iso: string | null,
	timeZone: string,
): string | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).formatToParts(date);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((each) => each.type === type)?.value ?? "";
		return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
	} catch {
		return null;
	}
}

/** The sentence a state other than `due` shows (copy.states). */
export function stateTemplate(
	view: Pick<DepositView, "state" | "amount">,
	received: string | null,
): string {
	switch (view.state) {
		case "submitted":
			return received ? copy.states.submitted : copy.states.submittedUndated;
		case "paid":
			return view.amount === 0 ? copy.states.paidNone : copy.states.paid;
		case "updating":
			return copy.states.updating;
		case "expired":
			return copy.states.expired;
		case "cancelled":
			return copy.states.cancelled;
		case "due":
			return "";
	}
}

/** The studio's chat links on every state (spec ruling 9). */
export interface DepositContact {
	/** WhatsApp, the message prefilled with the reference code once it is known. */
	readonly whatsapp: string | null;
	readonly viber: string | null;
}

export function depositContact(
	shell: { readonly studioName: string; readonly phone: string | null },
	referenceCode: string | null,
): DepositContact {
	const text = referenceCode
		? fill(copy.whatsappText, {
				studio: shell.studioName,
				code: referenceCode,
			})
		: fill(copy.whatsappTextNoCode, { studio: shell.studioName });
	return {
		whatsapp: whatsappLink(shell.phone, text),
		viber: viberLink(shell.phone),
	};
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/view-model.test.ts`
Expected: PASS. If "when the screenshot came" fails only on the day period's or the hour's form, print `new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date("2026-10-18T18:30:00Z"))` with the pinned Node and report it: the expected strings are Node 24.3.0's ICU; do not loosen them to a regex.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/deposit/view-model.ts apps/storefront/test/deposit/fixtures.ts apps/storefront/test/deposit/view-model.test.ts
git commit -m "feat(storefront): build the deposit page's view from the API's page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Every refusal and failure, in words a person can act on

**Files:**
- Create: `apps/storefront/src/deposit/problems.ts`
- Test: `apps/storefront/test/deposit/problems.test.ts`

**Interfaces:**
- Consumes: `isTattooApiError`, `type DepositPage` from `@tattoo-drip/sdk`; `fill` from `../intake/copy.ts`; `copy`, `type ProofNoticeCode` from `./copy.ts`.
- Produces: `type LoadProblem = "dead" | "rate-limited" | "failed"`, `isGone`, `describeLoadError`, `type Screen`, `screenFor`, `type ProofProblem`, `DEFAULT_WAIT_SECONDS`, `describeProofError`, `firstMessage`, `formatWait`, `validateProofForm`, `interface SummaryItem`, `summaryItems`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/deposit/problems.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import { copy } from "../../src/deposit/copy.ts";
import {
	describeLoadError,
	describeProofError,
	firstMessage,
	formatWait,
	type ProofProblem,
	screenFor,
	summaryItems,
	validateProofForm,
} from "../../src/deposit/problems.ts";
import { PAGE } from "./fixtures.ts";

const api = (
	status: number,
	code: string,
	extra: { fields?: Record<string, string[]>; retryAfter?: number } = {},
) =>
	new TattooApiError(
		status,
		{ code, message: "The API's own words.", fields: extra.fields },
		{ retryAfter: extra.retryAfter },
	);

const notice = (
	code: string,
	refetch = false,
	waitSeconds: number | null = null,
) => ({ kind: "notice", code, refetch, waitSeconds });

function fieldsOf(problem: ProofProblem) {
	assert.equal(problem.kind, "fields");
	return problem.kind === "fields" ? problem.fields : {};
}

describe("loading the page", () => {
	test("a link that doesn't work, a rate limit, anything else", () => {
		assert.equal(describeLoadError(api(404, "not_found")), "dead");
		assert.equal(describeLoadError(api(404, "unknown_error")), "dead");
		assert.equal(describeLoadError(api(429, "rate_limited")), "rate-limited");
		for (const error of [
			api(0, "network_error"),
			api(0, "timeout"),
			api(500, "internal_error"),
			api(200, "invalid_response"),
			new TypeError("x"),
		]) {
			assert.equal(describeLoadError(error), "failed");
		}
	});

	test("loading, then the page", () => {
		assert.deepEqual(screenFor({ data: undefined, error: null }), {
			kind: "loading",
		});
		assert.deepEqual(screenFor({ data: PAGE, error: null }), {
			kind: "page",
			page: PAGE,
		});
	});

	test("a link that stopped working replaces the page, even over data already shown", () => {
		assert.deepEqual(screenFor({ data: PAGE, error: api(404, "not_found") }), {
			kind: "problem",
			problem: "dead",
		});
	});

	test("any other failed refresh keeps the page shown", () => {
		for (const error of [api(0, "network_error"), api(429, "rate_limited")]) {
			assert.deepEqual(screenFor({ data: PAGE, error }), {
				kind: "page",
				page: PAGE,
			});
		}
	});

	test("a failed first read says why", () => {
		assert.deepEqual(
			screenFor({ data: undefined, error: api(429, "rate_limited") }),
			{ kind: "problem", problem: "rate-limited" },
		);
		assert.deepEqual(
			screenFor({ data: undefined, error: api(500, "internal_error") }),
			{ kind: "problem", problem: "failed" },
		);
	});
});

describe("describeProofError", () => {
	test("every refusal, and whether to read the page again", () => {
		const cases: Array<[unknown, ReturnType<typeof notice>]> = [
			[api(409, "deposit_changed"), notice("changed", true)],
			[api(409, "deposit_not_due"), notice("not-due", true)],
			[api(409, "unknown_error"), notice("not-due", true)],
			[api(404, "not_found"), notice("gone", true)],
			[api(404, "unknown_error"), notice("gone", true)],
			[
				api(429, "rate_limited", { retryAfter: 1200 }),
				notice("rate-limited", false, 1200),
			],
			[api(429, "rate_limited"), notice("rate-limited", false, 60)],
			[api(429, "unknown_error"), notice("rate-limited", false, 60)],
			[api(400, "bad_request"), notice("cut-off")],
			[api(415, "unsupported_media_type"), notice("cut-off")],
			[api(503, "service_busy", { retryAfter: 5 }), notice("busy")],
			[api(500, "internal_error"), notice("server")],
			[api(200, "invalid_response"), notice("server")],
			[new TypeError("x"), notice("server")],
		];
		for (const [error, expected] of cases) {
			assert.deepEqual(describeProofError(error), expected, String(error));
		}
	});

	test("a timeout, a network error and a 408 read the page again: the upload may have landed", () => {
		for (const error of [
			api(0, "timeout"),
			api(0, "network_error"),
			api(408, "request_timeout"),
		]) {
			assert.deepEqual(describeProofError(error), notice("offline", true));
		}
	});

	test("a too-large upload is the screenshot's own problem", () => {
		for (const error of [
			api(413, "payload_too_large"),
			api(413, "unknown_error"),
		]) {
			assert.deepEqual(fieldsOf(describeProofError(error)), {
				proof: copy.form.tooLarge,
			});
		}
	});

	test("validation_failed puts the API's message under its field", () => {
		assert.deepEqual(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", {
						fields: { proof: ["The image could not be read."] },
					}),
				),
			),
			{ proof: "The image could not be read." },
		);
		assert.deepEqual(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", {
						fields: {
							method: ["Choose one of the page's payment methods."],
							proof: ["Bad."],
						},
					}),
				),
			),
			{ method: "Choose one of the page's payment methods.", proof: "Bad." },
		);
		const long = "x".repeat(400);
		assert.equal(
			fieldsOf(
				describeProofError(
					api(422, "validation_failed", { fields: { proof: [long] } }),
				),
			).proof?.length,
			300,
		);
	});

	test("an amount the API refuses means the page is stale; nothing placeable is a notice", () => {
		assert.deepEqual(
			describeProofError(
				api(422, "validation_failed", { fields: { expectedAmount: ["x"] } }),
			),
			notice("changed", true),
		);
		assert.deepEqual(
			describeProofError(
				api(422, "validation_failed", { fields: { other: ["x"] } }),
			),
			notice("invalid"),
		);
		assert.deepEqual(
			describeProofError(api(422, "validation_failed")),
			notice("invalid"),
		);
	});
});

describe("the form's own checks", () => {
	test("a method must be one the page lists", () => {
		assert.equal(validateProofForm({ method: "esewa" }, ["esewa", "bank"]), null);
		assert.deepEqual(validateProofForm({ method: "" }, ["esewa", "bank"]), {
			method: copy.form.required.method,
		});
		assert.deepEqual(validateProofForm({ method: "cash" }, ["esewa"]), {
			method: copy.form.required.method,
		});
	});

	test("the summary lists the method, then the screenshot", () => {
		assert.deepEqual(summaryItems("Choose how you paid.", "Add a screenshot of your payment."), [
			{
				target: "method-0",
				label: copy.form.summaryLabels.method,
				message: "Choose how you paid.",
			},
			{
				target: "proof-input",
				label: copy.form.summaryLabels.proof,
				message: "Add a screenshot of your payment.",
			},
		]);
		assert.deepEqual(summaryItems(undefined, null), []);
	});

	test("firstMessage reads the API's lists and the form's errors", () => {
		assert.equal(firstMessage(["", "  First.  ", "Second."]), "First.");
		assert.equal(firstMessage("Alone."), "Alone.");
		assert.equal(firstMessage([{ message: "From the form." }]), "From the form.");
		assert.equal(firstMessage([1, null, {}]), undefined);
		assert.equal(firstMessage(undefined), undefined);
	});

	test("formatWait: rounded up, in minutes or hours (TAT-57's rule)", () => {
		assert.equal(formatWait(10), "a minute");
		assert.equal(formatWait(60), "a minute");
		assert.equal(formatWait(61), "2 minutes");
		assert.equal(formatWait(1200), "20 minutes");
		assert.equal(formatWait(3600), "an hour");
		assert.equal(formatWait(3601), "2 hours");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/problems.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/problems.ts`.

- [ ] **Step 3: Write `problems.ts`**

Create `apps/storefront/src/deposit/problems.ts`:

```ts
import { type DepositPage, isTattooApiError } from "@tattoo-drip/sdk";
import { fill } from "../intake/copy.ts";
import { copy, type ProofNoticeCode } from "./copy.ts";

/*
 * What the deposit page says when a read or a send doesn't go through
 * (TAT-65b, spec ruling 17 and its table). Branches on the API's code and
 * status, never its message; the only API words shown are
 * validation_failed's field messages, as text.
 */

export type LoadProblem = "dead" | "rate-limited" | "failed";

/** A 404, with or without the API's envelope: this link doesn't work (TAT-65 ruling 4). */
export function isGone(error: unknown): boolean {
	return isTattooApiError(error) && error.status === 404;
}

export function describeLoadError(error: unknown): LoadProblem {
	if (isGone(error)) return "dead";
	if (isTattooApiError(error) && error.status === 429) return "rate-limited";
	return "failed";
}

export type Screen =
	| { readonly kind: "loading" }
	| { readonly kind: "problem"; readonly problem: LoadProblem }
	| { readonly kind: "page"; readonly page: DepositPage };

/**
 * What the screen shows for the query's state. A 404 wins over data already
 * shown (a replaced or expired link must stop showing payment details); any
 * other failed refresh keeps the data.
 */
export function screenFor(query: {
	readonly data: DepositPage | undefined;
	readonly error: unknown;
}): Screen {
	if (query.error && isGone(query.error)) {
		return { kind: "problem", problem: "dead" };
	}
	if (query.data) return { kind: "page", page: query.data };
	if (query.error) {
		return { kind: "problem", problem: describeLoadError(query.error) };
	}
	return { kind: "loading" };
}

export type ProofProblem =
	| {
			readonly kind: "fields";
			readonly fields: { readonly proof?: string; readonly method?: string };
	  }
	| {
			readonly kind: "notice";
			readonly code: ProofNoticeCode;
			/** Read the page again: it may have changed, or the upload may have landed. */
			readonly refetch: boolean;
			/** Block Send this long (a rate limit). */
			readonly waitSeconds: number | null;
	  };

/** How long a 429 without Retry-After blocks Send. */
export const DEFAULT_WAIT_SECONDS = 60;
/** The most of an API field message the page shows. */
const MAX_MESSAGE = 300;

function notice(
	code: ProofNoticeCode,
	flags: { refetch?: boolean; waitSeconds?: number } = {},
): ProofProblem {
	return {
		kind: "notice",
		code,
		refetch: flags.refetch ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

const TOO_LARGE: ProofProblem = {
	kind: "fields",
	fields: { proof: copy.form.tooLarge },
};

export function describeProofError(error: unknown): ProofProblem {
	if (!isTattooApiError(error)) return notice("server");
	const wait = error.retryAfter ?? DEFAULT_WAIT_SECONDS;
	switch (error.code) {
		case "validation_failed":
			return fieldProblem(error.fields);
		case "deposit_changed":
			return notice("changed", { refetch: true });
		case "deposit_not_due":
			return notice("not-due", { refetch: true });
		case "not_found":
			return notice("gone", { refetch: true });
		case "payload_too_large":
			return TOO_LARGE;
		case "rate_limited":
			return notice("rate-limited", { waitSeconds: wait });
		case "bad_request":
		case "unsupported_media_type":
			return notice("cut-off");
		case "request_timeout":
		case "timeout":
		case "network_error":
			return notice("offline", { refetch: true });
		case "service_busy":
			return notice("busy");
	}
	// A response without the API's envelope (a proxy's 404, 409, 413 or 429).
	if (error.status === 404) return notice("gone", { refetch: true });
	if (error.status === 409) return notice("not-due", { refetch: true });
	if (error.status === 413) return TOO_LARGE;
	if (error.status === 429) return notice("rate-limited", { waitSeconds: wait });
	return notice("server");
}

function fieldProblem(apiFields: Readonly<Record<string, unknown>>): ProofProblem {
	const proof = firstMessage(apiFields.proof);
	const method = firstMessage(apiFields.method);
	if (proof || method) {
		return {
			kind: "fields",
			fields: { ...(proof ? { proof } : {}), ...(method ? { method } : {}) },
		};
	}
	// The page's amount is stale: TAT-65's deposit_changed in all but name.
	if (firstMessage(apiFields.expectedAmount)) {
		return notice("changed", { refetch: true });
	}
	return notice("invalid");
}

/**
 * A field's first message as text, at most 300 characters: the API's list
 * (a lone string counts), or the form's errors (strings or `{ message }`).
 */
export function firstMessage(value: unknown): string | undefined {
	const list: readonly unknown[] = Array.isArray(value) ? value : [value];
	for (const each of list) {
		const text =
			typeof each === "string"
				? each
				: typeof each === "object" &&
						each !== null &&
						"message" in each &&
						typeof each.message === "string"
					? each.message
					: undefined;
		if (text?.trim()) return text.trim().slice(0, MAX_MESSAGE);
	}
	return undefined;
}

/** "a minute", "20 minutes", "an hour", "24 hours": rounded up (TAT-57's rule). */
export function formatWait(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	if (minutes <= 1) return copy.wait.minute;
	if (minutes < 60) return fill(copy.wait.minutes, { count: minutes });
	const hours = Math.ceil(seconds / 3600);
	return hours <= 1 ? copy.wait.hour : fill(copy.wait.hours, { count: hours });
}

/** The form's own rule: a method the page lists. The screenshot is checked apart (it isn't a form value). */
export function validateProofForm(
	values: { readonly method: string },
	kinds: readonly string[],
): { method: string } | null {
	return kinds.includes(values.method)
		? null
		: { method: copy.form.required.method };
}

/** One line of the error summary: the control it focuses, the field's name, the message. */
export interface SummaryItem {
	readonly target: "method-0" | "proof-input";
	readonly label: string;
	readonly message: string;
}

export function summaryItems(
	method: string | undefined,
	proof: string | null,
): SummaryItem[] {
	const items: SummaryItem[] = [];
	if (method) {
		items.push({
			target: "method-0",
			label: copy.form.summaryLabels.method,
			message: method,
		});
	}
	if (proof) {
		items.push({
			target: "proof-input",
			label: copy.form.summaryLabels.proof,
			message: proof,
		});
	}
	return items;
}
```

`formatWait` is a copy of TAT-57's (`src/intake/problems.ts`), with this page's words: importing that one would pull the intake form's rules and copy into this page's chunk.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/problems.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/deposit/problems.ts apps/storefront/test/deposit/problems.test.ts
git commit -m "feat(storefront): map every deposit page refusal and load failure to fixed copy

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The head, the headers and the shell's loader

**Files:**
- Create: `apps/storefront/src/deposit/seo.ts`, `apps/storefront/src/deposit/loader.ts`
- Test: `apps/storefront/test/deposit/seo.test.ts`, `apps/storefront/test/deposit/loader.test.ts`

**Interfaces:**
- Consumes: `type HeadMeta`, `type HeadTags` from `../studio/seo.ts`; `loadStudio` from `../api/loaders.ts`; `type ApiContext` from `../api/context.ts`; `studioViewModel` from `../studio/view-model.ts`.
- Produces: `DEPOSIT_PAGE_HEADERS`, `depositHead(studioName: string | null): HeadTags`; `interface DepositShell { studioName; timezone; phone }`, `depositShell(studio)`, `loadDepositShell(context)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/test/deposit/seo.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEPOSIT_PAGE_HEADERS, depositHead } from "../../src/deposit/seo.ts";

describe("the deposit page's head", () => {
	test("never indexed, no Referer, and the studio named for a chat app's preview", () => {
		const head = depositHead("Black Needle");
		const description =
			"Pay your deposit to Black Needle, then send a screenshot of the payment.";
		assert.deepEqual(head.meta, [
			{ title: "Pay your deposit · Black Needle" },
			{ name: "description", content: description },
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "referrer", content: "no-referrer" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Black Needle" },
			{ property: "og:title", content: "Pay your deposit · Black Needle" },
			{ property: "og:description", content: description },
			{ name: "twitter:card", content: "summary" },
		]);
		assert.deepEqual(head.links, []);
		assert.deepEqual(head.scripts, []);
	});

	test("without the studio (a failed read) it still says what the page is", () => {
		const head = depositHead(null);
		assert.deepEqual(head.meta.slice(0, 4), [
			{ title: "Pay your deposit" },
			{
				name: "description",
				content: "Pay your deposit, then send a screenshot of the payment.",
			},
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "referrer", content: "no-referrer" },
		]);
		assert.ok(
			!head.meta.some(
				(meta) => "property" in meta && meta.property === "og:site_name",
			),
		);
	});

	test("the response's headers: never stored, no Referer, never indexed", () => {
		assert.deepEqual(DEPOSIT_PAGE_HEADERS, {
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"X-Robots-Tag": "noindex, nofollow",
		});
	});
});
```

Create `apps/storefront/test/deposit/loader.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { depositShell, loadDepositShell } from "../../src/deposit/loader.ts";
import { STUDIO } from "../studio/fixtures.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

describe("the deposit page's loader", () => {
	test("reads the studio from the lookup's cache: no API call at all", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "x" } }),
		);
		const api = createApiContext("server");
		connectServer(api, { config: { apiUrl: "http://api.test" }, studio: STUDIO, fetch });
		seedStudio(api, STUDIO);

		assert.deepEqual(await loadDepositShell(api), {
			studioName: "Black Needle",
			timezone: "Asia/Kathmandu",
			phone: "+9779812345678",
		});
		assert.equal(calls.length, 0);
	});

	test("cleans the name and drops a phone that isn't E.164", () => {
		assert.deepEqual(
			depositShell({
				...STUDIO,
				name: "  Black   Needle ",
				contact: { ...STUDIO.contact, phone: "9812345678" },
			}),
			{ studioName: "Black Needle", timezone: "Asia/Kathmandu", phone: null },
		);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/seo.test.ts test/deposit/loader.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/seo.ts` and `src/deposit/loader.ts`.

- [ ] **Step 3: Write `seo.ts` and `loader.ts`**

Create `apps/storefront/src/deposit/seo.ts`:

```ts
import { fill } from "../intake/copy.ts";
import type { HeadMeta, HeadTags } from "../studio/seo.ts";
import { copy } from "./copy.ts";

/*
 * The deposit page's head and headers (TAT-65b, spec ruling 6): never
 * indexed, never stored, no Referer for anything it loads or links to. The
 * studio's name comes from the lookup the server already made, so the
 * preview a chat app draws from the link (fetched without its fragment)
 * names the studio. No canonical link, og:url or JSON-LD.
 */

export const DEPOSIT_PAGE_HEADERS: Readonly<Record<string, string>> = {
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Robots-Tag": "noindex, nofollow",
};

export function depositHead(studioName: string | null): HeadTags {
	const values = { studio: studioName ?? "" };
	const title = studioName ? fill(copy.titleWithStudio, values) : copy.title;
	const description = studioName
		? fill(copy.descriptionWithStudio, values)
		: copy.description;
	const meta: HeadMeta[] = [
		{ title },
		{ name: "description", content: description },
		{ name: "robots", content: "noindex, nofollow" },
		{ name: "referrer", content: "no-referrer" },
		{ property: "og:type", content: "website" },
	];
	if (studioName) meta.push({ property: "og:site_name", content: studioName });
	meta.push(
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ name: "twitter:card", content: "summary" },
	);
	return { meta, links: [], scripts: [] };
}
```

Create `apps/storefront/src/deposit/loader.ts`:

```ts
import type { Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "../api/context.ts";
import { loadStudio } from "../api/loaders.ts";
import { studioViewModel } from "../studio/view-model.ts";

/*
 * The deposit page's loader (TAT-65b, spec ruling 5): only what a server can
 * know, the studio, from the lookup the tenant middleware cached. The deposit
 * loads in the browser, because its token is in the URL's fragment, which no
 * server sees. Loader data is serialized into the page: all of it is public.
 */

export interface DepositShell {
	readonly studioName: string;
	/** The studio's IANA timezone: "Pay by" and the screenshot's time are counted in it. */
	readonly timezone: string;
	/** E.164, checked; null when the studio set none. */
	readonly phone: string | null;
}

export function depositShell(studio: Studio): DepositShell {
	const view = studioViewModel(studio);
	return {
		studioName: view.name,
		timezone: studio.timezone,
		phone: view.phone,
	};
}

export async function loadDepositShell(
	context: ApiContext,
): Promise<DepositShell> {
	return depositShell(await loadStudio(context));
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/seo.test.ts test/deposit/loader.test.ts`
Expected: PASS (5 tests).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/deposit/seo.ts apps/storefront/src/deposit/loader.ts apps/storefront/test/deposit/seo.test.ts apps/storefront/test/deposit/loader.test.ts
git commit -m "feat(storefront): give the deposit page its head, headers and shell loader

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The page's blocks: states, amount, code, payment methods, notices

**Files:**
- Create: `apps/storefront/src/deposit/browser.ts`
- Create: `apps/storefront/src/deposit/components/copy-button.tsx`, `notices.tsx`, `deposit-page.tsx`
- Modify: `apps/storefront/src/styles.css`
- Create: `apps/storefront/test/deposit/html.ts`
- Test: `apps/storefront/test/deposit/render.test.ts`

**Interfaces:**
- Produces: `copyText(text): Promise<boolean>` (DOM); `CopyButton({ text, label, visible })`; `ProofNoticeView({ code, waitSeconds, studioName })`, `ProofSummary({ items, ref? })`; `DepositFrame({ studioName, children })`, `DepositLoading({ studioName })`, `LoadProblemView({ problem, onRetry?, ref? })`, `DepositIntro({ view })`, `StateMessage({ view, studioName, received, ref? })`, `DueView({ view, studioName, today, form })`, `MethodCard({ method, studioName, eager })`, `ContactLine({ studioName, contact })`.

- [ ] **Step 1: Write the markup helpers and the failing test**

Create `apps/storefront/test/deposit/html.ts`:

```ts
/** Small readers for react-dom/server's markup, shared by the deposit page's render tests. */

export const decode = (value: string) =>
	value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");

/** The markup's text without its tags. */
export const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ""));

/** Every opening tag named `name`. */
export const tags = (html: string, name: string): string[] =>
	html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

/** An attribute's value in one tag, whatever its case. */
export const attr = (tag: string, name: string): string | undefined => {
	const value = new RegExp(` ${name}="([^"]*)"`, "i").exec(tag)?.[1];
	return value === undefined ? undefined : decode(value);
};

/** Every href, decoded. */
export const hrefs = (html: string): string[] =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) => decode(match[1]));
```

Create `apps/storefront/test/deposit/render.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DepositPage } from "@tattoo-drip/sdk";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ContactLine,
	DepositFrame,
	DepositIntro,
	DepositLoading,
	DueView,
	LoadProblemView,
	StateMessage,
} from "../../src/deposit/components/deposit-page.tsx";
import {
	ProofNoticeView,
	ProofSummary,
} from "../../src/deposit/components/notices.tsx";
import { summaryItems } from "../../src/deposit/problems.ts";
import { depositContact, depositView } from "../../src/deposit/view-model.ts";
import { isAllowedHref } from "../../src/studio/links.ts";
import { PAGE, page, QR_URL, SHELL } from "./fixtures.ts";
import { attr, hrefs, tags, textOf } from "./html.ts";

const render = (element: ReactElement) => renderToStaticMarkup(element);
const STUDIO = "Black Needle";

const dueHtml = (view = depositView(PAGE), today: string | null = "2026-10-18") =>
	render(createElement(DueView, { view, studioName: STUDIO, today, form: null }));

const stateHtml = (overrides: Partial<DepositPage>, received: string | null = null) =>
	render(
		createElement(StateMessage, {
			view: depositView(page(overrides)),
			studioName: STUDIO,
			received,
		}),
	);

/** Every block, for the checks that hold everywhere. */
function everything(): string {
	return [
		render(createElement(DepositFrame, { studioName: STUDIO, children: null })),
		render(createElement(DepositLoading, { studioName: STUDIO })),
		render(createElement(LoadProblemView, { problem: "failed", onRetry: () => undefined })),
		render(createElement(DepositIntro, { view: depositView(PAGE) })),
		dueHtml(),
		stateHtml({ state: "submitted" }, "18 Oct 2026, 2:05 pm"),
		render(
			createElement(ContactLine, {
				studioName: STUDIO,
				contact: depositContact(SHELL, "7K3M9Q"),
			}),
		),
		render(createElement(ProofNoticeView, { code: "changed", waitSeconds: null, studioName: STUDIO })),
		render(createElement(ProofSummary, { items: summaryItems("x", "y") })),
	].join("\n");
}

describe("the frame", () => {
	test("one h1 naming the studio in <bdi>, and a footer saying the studio is paid directly", () => {
		const html = render(
			createElement(DepositFrame, { studioName: "मीना Ink", children: null }),
		);
		assert.equal(tags(html, "h1").length, 1);
		assert.match(html, /<h1[^>]*>Pay your deposit to <bdi>मीना Ink<\/bdi><\/h1>/);
		assert.match(
			textOf(html),
			/You pay मीना Ink directly\. Tattoo Drip runs this page for them and never handles your money\./,
		);
	});

	test("loading: a skeleton marked busy, words for screen readers, a no-JavaScript line", () => {
		const html = render(createElement(DepositLoading, { studioName: STUDIO }));
		assert.match(html, /aria-busy="true"/);
		assert.match(html, /class="sr-only">Loading your deposit…</);
		assert.match(
			html,
			/<noscript>[\s\S]*Turn on JavaScript to see your deposit, or message [\s\S]*Black Needle[\s\S]*<\/noscript>/,
		);
	});

	test("a load problem is an alert; only a failed read offers to try again", () => {
		const dead = render(createElement(LoadProblemView, { problem: "dead" }));
		assert.match(dead, /<p[^>]*role="alert"/);
		assert.match(
			textOf(dead),
			/This link doesn't work any more\. Ask the studio to send you a new one\./,
		);
		assert.equal(tags(dead, "button").length, 0);

		const limited = render(
			createElement(LoadProblemView, {
				problem: "rate-limited",
				onRetry: () => undefined,
			}),
		);
		assert.equal(tags(limited, "button").length, 0);

		const failed = render(
			createElement(LoadProblemView, {
				problem: "failed",
				onRetry: () => undefined,
			}),
		);
		assert.match(textOf(failed), /We couldn't load your deposit\. Check your connection\./);
		assert.equal(attr(tags(failed, "button")[0], "type"), "button");
		assert.match(textOf(failed), /Try again/);
	});
});

describe("the intro", () => {
	test("a short brief as text, the artist in <bdi>", () => {
		const html = render(createElement(DepositIntro, { view: depositView(PAGE) }));
		assert.match(
			html,
			/<p class="user-text" dir="auto">Fine line peony on the left forearm<\/p>/,
		);
		assert.match(html, /with <bdi>Sita Rai<\/bdi>/);
		assert.doesNotMatch(html, /<details/);
	});

	test("a long brief folds, closed, whole", () => {
		const brief = "Fine line peony. ".repeat(20).trim();
		const html = render(
			createElement(DepositIntro, {
				view: depositView(page({ project: { brief, artistName: null } })),
			}),
		);
		assert.match(html, /<details class="deposit-brief"><summary>Your tattoo idea<\/summary>/);
		assert.doesNotMatch(tags(html, "details")[0], / open/);
		assert.ok(textOf(html).includes(brief));
	});

	test("nothing at all without a brief or an artist", () => {
		const html = render(
			createElement(DepositIntro, {
				view: depositView(page({ project: { brief: " ", artistName: null } })),
			}),
		);
		assert.equal(html, "");
	});
});

describe("due", () => {
	test("the amount, part paid, the last day, the reference code", () => {
		const html = dueHtml(
			depositView(
				page({ deposit: { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" } }),
			),
		);
		const text = textOf(html);
		assert.match(html, /<h2 id="deposit-due-title">Deposit due<\/h2>/);
		assert.match(html, /<p class="deposit-amount"[^>]*>NPR 1,000<\/p>/);
		assert.match(text, /Part of your NPR 3,000 deposit was already received\./);
		assert.match(text, /Pay by 28 Oct 2026, in 10 days\./);
		assert.match(html, /<p class="deposit-code"[^>]*>7K3M9Q<\/p>/);
		assert.match(text, /Write this code in the payment remark \(or note\)\./);
	});

	test("the code and every number have a copy button named after what it copies", () => {
		const html = dueHtml();
		const buttons = tags(html, "button");
		assert.deepEqual(
			buttons.map((button) => attr(button, "aria-label")),
			["Copy code 7K3M9Q", "Copy 9812345678", "Copy 01234567890123"],
		);
		for (const button of buttons) assert.equal(attr(button, "type"), "button");
		assert.match(html, /aria-label="Copy code 7K3M9Q">.*Copy code<\/button>/s);
		assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 3);
	});

	test("each method: its label, its QR with alt text and reserved size, its details", () => {
		const html = dueHtml();
		const text = textOf(html);
		assert.match(html, /<h3 dir="auto">eSewa<\/h3>/);
		assert.match(html, /<h3 dir="auto">Bank transfer<\/h3>/);
		const images = tags(html, "img");
		assert.equal(images.length, 1);
		assert.equal(attr(images[0], "src"), QR_URL);
		assert.equal(attr(images[0], "alt"), "eSewa QR code for Black Needle");
		assert.equal(attr(images[0], "width"), "280");
		assert.equal(attr(images[0], "height"), "280");
		assert.equal(attr(images[0], "loading"), "eager");
		assert.equal(attr(images[0], "referrerpolicy"), "no-referrer");
		assert.match(text, /Scan it with your eSewa app\./);
		assert.match(text, /eSewa ID9812345678/);
		assert.match(text, /BankNabil BankAccount nameBlack Needle Pvt LtdAccount number01234567890123/);
		assert.match(
			text,
			/Paying from this phone\? Press and hold a QR code to save it/,
		);
	});

	test("the first QR loads at once, the others when scrolled to", () => {
		const html = dueHtml(
			depositView(
				page({
					paymentMethods: [
						PAGE.paymentMethods[0],
						{
							kind: "khalti",
							label: "Khalti",
							qrImageUrl: "https://api.example.com/uploads/khalti.png",
							accountName: null,
							accountNumber: "9800000000",
							bankName: null,
						},
					],
				}),
			),
		);
		assert.deepEqual(
			tags(html, "img").map((image) => attr(image, "loading")),
			["eager", "lazy"],
		);
	});

	test("the deposit policy keeps its line breaks", () => {
		const html = dueHtml();
		assert.match(html, /<h2 id="deposit-policy-title">Deposit policy<\/h2>/);
		assert.match(
			html,
			/<p class="user-text" dir="auto">Deposits hold your date\.\nThey are kept/,
		);
	});

	test("no payment details: the note, no methods and no same-phone hint", () => {
		const html = dueHtml(depositView(page({ paymentMethods: [] })));
		assert.match(
			textOf(html),
			/The studio hasn't added payment details yet\. Message them to ask how to pay\./,
		);
		assert.doesNotMatch(html, /How to pay|<img|Paying from this phone/);
	});
});

describe("the other states", () => {
	test("each state's message, focusable, in the studio's name", () => {
		const cases: Array<[Partial<DepositPage>, RegExp]> = [
			[{ state: "paid" }, /^Your deposit is paid\. Thank you!$/],
			[
				{
					state: "paid",
					deposit: { ...PAGE.deposit, amount: 0, amountText: "NPR 0", due: 0, dueText: "NPR 0" },
				},
				/^No deposit is needed for this booking\.$/,
			],
			[
				{ state: "updating" },
				/^Black Needle is updating your quote\. They'll message you when it's ready\.$/,
			],
			[
				{ state: "expired" },
				/^This quote has expired\. Message Black Needle if you still want to book\.$/,
			],
			[
				{ state: "cancelled" },
				/^This booking was cancelled\. Message Black Needle if you think this is a mistake\.$/,
			],
		];
		for (const [overrides, expected] of cases) {
			const html = stateHtml(overrides);
			const message = /<p[^>]*class="deposit-state-title"[^>]*>(.*?)<\/p>/s.exec(html);
			assert.ok(message, String(overrides.state));
			assert.match(textOf(message[1]), expected, String(overrides.state));
			assert.match(message[0], /tabindex="-1"/i);
			assert.doesNotMatch(html, /<dl/);
		}
	});

	test("submitted says when it came, and repeats the amount and the code", () => {
		const html = stateHtml({ state: "submitted" }, "18 Oct 2026, 2:05 pm");
		const text = textOf(html);
		assert.match(
			text,
			/We've sent your screenshot to Black Needle, received 18 Oct 2026, 2:05 pm\. They'll check it and confirm on WhatsApp or Viber\./,
		);
		assert.match(text, /AmountNPR 3,000/);
		assert.match(text, /Reference code7K3M9Q/);
		assert.match(
			textOf(stateHtml({ state: "submitted" })),
			/^We've sent your screenshot to Black Needle\. They'll check/,
		);
	});
});

describe("contact, notices and the summary", () => {
	test("WhatsApp with the code and Viber; nothing without a phone", () => {
		const html = render(
			createElement(ContactLine, {
				studioName: STUDIO,
				contact: depositContact(SHELL, "7K3M9Q"),
			}),
		);
		assert.match(textOf(html), /^Questions\? Message Black Needle:WhatsAppViber$/);
		const anchors = tags(html, "a");
		assert.equal(anchors.length, 2);
		assert.equal(attr(anchors[0], "rel"), "noopener noreferrer");
		assert.equal(attr(anchors[1], "rel"), undefined);
		assert.equal(
			render(
				createElement(ContactLine, {
					studioName: STUDIO,
					contact: depositContact({ ...SHELL, phone: null }, "7K3M9Q"),
				}),
			),
			"",
		);
	});

	test("a notice is an alert with fixed words", () => {
		const changed = render(
			createElement(ProofNoticeView, {
				code: "changed",
				waitSeconds: null,
				studioName: STUDIO,
			}),
		);
		assert.match(changed, /<div class="deposit-alert" role="alert">/);
		assert.match(
			textOf(changed),
			/The deposit amount changed\. Check the new amount\.If you already paid the old amount, message Black Needle before you send a screenshot\./,
		);
		const limited = render(
			createElement(ProofNoticeView, {
				code: "rate-limited",
				waitSeconds: 1200,
				studioName: STUDIO,
			}),
		);
		assert.match(textOf(limited), /^Too many tries\. Wait 20 minutes and try again\.$/);
	});

	test("the summary is focusable and its items are buttons, not fragment links", () => {
		const html = render(
			createElement(ProofSummary, {
				items: summaryItems("Choose how you paid.", "Add a screenshot of your payment."),
			}),
		);
		assert.match(html, /<section[^>]*tabindex="-1"/i);
		assert.match(html, /aria-labelledby="proof-summary-title"/);
		assert.match(textOf(html), /Check these 2 things before sending/);
		assert.equal(tags(html, "button").length, 2);
		assert.equal(hrefs(html).length, 0);
	});
});

describe("everywhere", () => {
	test("only allowed links, none to a fragment, no style or target", () => {
		const html = everything();
		for (const href of hrefs(html)) {
			assert.ok(isAllowedHref(href), href);
			assert.ok(!href.startsWith("#"), href);
		}
		assert.doesNotMatch(html, / style=| target=/);
	});
});
```

React renders `<noscript>` content on the server; the check allows for markup inside it either way.

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/render.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/components/deposit-page.tsx`.

- [ ] **Step 3: Write `browser.ts` and the copy button**

Create `apps/storefront/src/deposit/browser.ts`:

```ts
/*
 * The deposit page's DOM side (TAT-65b, spec ruling 13): the clipboard.
 * Node tests can't run it; the browser pass checks Copy in Chrome and in an
 * in-app browser (Instagram's, Facebook's and Viber's often refuse the
 * clipboard API).
 */

/** Copies `text`; false when neither the clipboard API nor the old way worked. */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Refused (an in-app browser, or no permission): the old way below.
	}
	const active = document.activeElement;
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.className = "sr-only";
	document.body.append(area);
	try {
		area.select();
		area.setSelectionRange(0, text.length);
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
		if (active instanceof HTMLElement) active.focus();
	}
}
```

Create `apps/storefront/src/deposit/components/copy-button.tsx`:

```tsx
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "../browser.ts";
import { copy } from "../copy.ts";

/** How long "Copied" shows. */
export const COPIED_MS = 2_000;

/**
 * A Copy button and its polite live region (spec ruling 13). `label` is the
 * accessible name and starts with the visible words (WCAG 2.5.3).
 */
export function CopyButton({
	text,
	label,
	visible,
}: {
	text: string;
	label: string;
	visible: string;
}) {
	const [result, setResult] = useState<"copied" | "failed" | null>(null);

	useEffect(() => {
		if (result !== "copied") return;
		const timer = window.setTimeout(() => setResult(null), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [result]);

	return (
		<>
			<button
				type="button"
				className="deposit-copy"
				aria-label={label}
				onClick={() => {
					void copyText(text).then((ok) => setResult(ok ? "copied" : "failed"));
				}}
			>
				<Copy aria-hidden="true" className="size-4" />
				{visible}
			</button>
			<span className="deposit-copied" aria-live="polite">
				{result === "copied"
					? copy.copied
					: result === "failed"
						? copy.copyFailed
						: ""}
			</span>
		</>
	);
}
```

- [ ] **Step 4: Write the notices**

Create `apps/storefront/src/deposit/components/notices.tsx`:

```tsx
import type { Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/copy.ts";
import { copy, type ProofNoticeCode } from "../copy.ts";
import {
	DEFAULT_WAIT_SECONDS,
	formatWait,
	type SummaryItem,
} from "../problems.ts";

/** A refusal after Send (spec ruling 17): fixed words, announced, shown above Send. */
export function ProofNoticeView({
	code,
	waitSeconds,
	studioName,
}: {
	code: ProofNoticeCode;
	waitSeconds: number | null;
	studioName: string;
}) {
	const text = copy.notices[code];
	const values = {
		studio: studioName,
		wait: formatWait(waitSeconds ?? DEFAULT_WAIT_SECONDS),
	};
	return (
		<div className="deposit-alert" role="alert">
			<p className="deposit-alert-title">
				<Fill template={text.title} values={values} />
			</p>
			{text.body ? (
				<p>
					<Fill template={text.body} values={values} />
				</p>
			) : null}
		</div>
	);
}

/**
 * What to fix before sending, focused after a refused Send. Its items are
 * buttons that focus the control: a "#field" link would replace the token
 * in the URL.
 */
export function ProofSummary({
	items,
	ref,
}: {
	items: readonly SummaryItem[];
	ref?: Ref<HTMLElement>;
}) {
	return (
		<section
			ref={ref}
			className="deposit-alert"
			tabIndex={-1}
			aria-labelledby="proof-summary-title"
		>
			<p id="proof-summary-title" className="deposit-alert-title">
				{items.length === 1
					? copy.form.summaryOne
					: fill(copy.form.summaryMany, { count: items.length })}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item.target}>
						<button
							type="button"
							className="deposit-summary-link"
							onClick={() => document.getElementById(item.target)?.focus()}
						>
							{item.label}: {item.message}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
```

- [ ] **Step 5: Write the blocks**

Create `apps/storefront/src/deposit/components/deposit-page.tsx`:

```tsx
import type { ReactNode, Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { fill } from "../../intake/copy.ts";
import { linkRel } from "../../studio/links.ts";
import { copy } from "../copy.ts";
import type { LoadProblem } from "../problems.ts";
import {
	type DepositContact,
	type DepositView,
	type MethodView,
	payByLine,
	stateTemplate,
} from "../view-model.ts";
import { CopyButton } from "./copy-button.tsx";

/*
 * The deposit page's blocks (TAT-65b). Props only: no router or query hooks,
 * so test/deposit/render.test.ts renders them with react-dom/server. API
 * text renders as text, names inside sentences in <bdi> (<Fill>), user text
 * with dir="auto". No link here starts with "#": following one would
 * replace the token in the URL.
 */

/** Around every state: one h1 naming the studio, and who runs the page. */
export function DepositFrame({
	studioName,
	children,
}: {
	studioName: string;
	children: ReactNode;
}) {
	return (
		<>
			<main className="deposit">
				<h1 className="deposit-title">
					<Fill template={copy.heading} values={{ studio: studioName }} />
				</h1>
				{children}
			</main>
			<footer className="deposit-footer">
				<p>
					<Fill template={copy.footer} values={{ studio: studioName }} />
				</p>
			</footer>
		</>
	);
}

/** Before the deposit arrives (and on the server, which never sees the token). */
export function DepositLoading({ studioName }: { studioName: string }) {
	return (
		<>
			<div className="deposit-skeleton" aria-busy="true">
				<p className="sr-only">{copy.loading}</p>
				<span
					className="deposit-skeleton-line deposit-skeleton-amount"
					aria-hidden="true"
				/>
				<span className="deposit-skeleton-line" aria-hidden="true" />
				<span
					className="deposit-skeleton-line deposit-skeleton-short"
					aria-hidden="true"
				/>
			</div>
			<noscript>
				<p className="deposit-note">
					<Fill template={copy.noScript} values={{ studio: studioName }} />
				</p>
			</noscript>
		</>
	);
}

/** A link that doesn't work, a rate limit, or a read that failed (TAT-65's words). */
export function LoadProblemView({
	problem,
	onRetry,
	ref,
}: {
	problem: LoadProblem;
	onRetry?: () => void;
	ref?: Ref<HTMLParagraphElement>;
}) {
	return (
		<div className="deposit-state">
			<p
				ref={ref}
				className="deposit-state-title"
				role="alert"
				tabIndex={-1}
			>
				{copy.load[problem]}
			</p>
			{problem === "failed" && onRetry ? (
				<button
					type="button"
					className="action action-secondary"
					onClick={onRetry}
				>
					{copy.load.retry}
				</button>
			) : null}
		</div>
	);
}

/** The brief (folded when long, spec ruling 10) and the artist. */
export function DepositIntro({ view }: { view: DepositView }) {
	if (!view.brief && !view.artistName) return null;
	return (
		<div className="deposit-intro">
			{view.brief ? (
				view.briefLong ? (
					<details className="deposit-brief">
						<summary>{copy.briefSummary}</summary>
						<p className="user-text" dir="auto">
							{view.brief}
						</p>
					</details>
				) : (
					<p className="user-text" dir="auto">
						{view.brief}
					</p>
				)
			) : null}
			{view.artistName ? (
				<p className="deposit-muted">
					<Fill template={copy.withArtist} values={{ artist: view.artistName }} />
				</p>
			) : null}
		</div>
	);
}

/** Every state but `due`: its sentence (focusable: focus moves here after a send), and for `submitted` the amount and code. */
export function StateMessage({
	view,
	studioName,
	received,
	ref,
}: {
	view: DepositView;
	studioName: string;
	received: string | null;
	ref?: Ref<HTMLParagraphElement>;
}) {
	return (
		<div className="deposit-state">
			<p ref={ref} className="deposit-state-title" tabIndex={-1}>
				<Fill
					template={stateTemplate(view, received)}
					values={{ studio: studioName, date: received ?? "" }}
				/>
			</p>
			{view.state === "submitted" ? (
				<dl className="deposit-details">
					<dt>{copy.states.amount}</dt>
					<dd translate="no">{view.dueText}</dd>
					<dt>{copy.code.title}</dt>
					<dd className="deposit-number" translate="no">
						{view.referenceCode}
					</dd>
				</dl>
			) : null}
		</div>
	);
}

/** `due`: the amount, the code, how to pay, the policy, then `form` (the screenshot form, or nothing). */
export function DueView({
	view,
	studioName,
	today,
	form,
}: {
	view: DepositView;
	studioName: string;
	today: string | null;
	form: ReactNode;
}) {
	const firstQr = view.methods.find((method) => method.qr)?.id ?? null;
	return (
		<>
			<section className="deposit-block" aria-labelledby="deposit-due-title">
				<h2 id="deposit-due-title">{copy.due.title}</h2>
				<p className="deposit-amount" translate="no">
					{view.dueText}
				</p>
				{view.partial ? (
					<p>{fill(copy.due.partial, { amount: view.amountText })}</p>
				) : null}
				<p>{payByLine(view, today)}</p>
			</section>
			<section className="deposit-block" aria-labelledby="deposit-code-title">
				<h2 id="deposit-code-title">{copy.code.title}</h2>
				<div className="deposit-code-row">
					<p className="deposit-code" translate="no">
						{view.referenceCode}
					</p>
					<CopyButton
						text={view.referenceCode}
						label={fill(copy.code.copyLabel, { code: view.referenceCode })}
						visible={copy.code.copy}
					/>
				</div>
				<p>{copy.code.hint}</p>
			</section>
			{view.methods.length > 0 ? (
				<section
					className="deposit-block"
					aria-labelledby="deposit-methods-title"
				>
					<h2 id="deposit-methods-title">{copy.methods.title}</h2>
					{firstQr ? (
						<p className="deposit-muted">{copy.methods.samePhone}</p>
					) : null}
					<ul className="deposit-methods">
						{view.methods.map((method) => (
							<li key={method.id} className="deposit-method">
								<MethodCard
									method={method}
									studioName={studioName}
									eager={method.id === firstQr}
								/>
							</li>
						))}
					</ul>
				</section>
			) : (
				<p className="deposit-note">{copy.methods.none}</p>
			)}
			{view.policy ? (
				<section
					className="deposit-block"
					aria-labelledby="deposit-policy-title"
				>
					<h2 id="deposit-policy-title">{copy.policyTitle}</h2>
					<p className="user-text" dir="auto">
						{view.policy}
					</p>
				</section>
			) : null}
			{form}
		</>
	);
}

/** One way to pay: its label, its QR (a square reserved while it loads), its details. */
export function MethodCard({
	method,
	studioName,
	eager,
}: {
	method: MethodView;
	studioName: string;
	eager: boolean;
}) {
	const hasDetails = Boolean(
		method.bankName || method.accountName || method.accountNumber,
	);
	return (
		<>
			<h3 dir="auto">{method.label}</h3>
			{method.qr ? (
				<figure className="deposit-qr-figure">
					<img
						className="deposit-qr"
						src={method.qr}
						alt={fill(copy.methods.qrAlt, {
							label: method.label,
							studio: studioName,
						})}
						width={280}
						height={280}
						loading={eager ? "eager" : "lazy"}
						decoding="async"
						referrerPolicy="no-referrer"
					/>
					<figcaption>{copy.methods.scan[method.kind]}</figcaption>
				</figure>
			) : null}
			{hasDetails ? (
				<dl className="deposit-details">
					{method.bankName ? (
						<>
							<dt>{copy.methods.bankName}</dt>
							<dd dir="auto">{method.bankName}</dd>
						</>
					) : null}
					{method.accountName ? (
						<>
							<dt>{copy.methods.accountName}</dt>
							<dd dir="auto">{method.accountName}</dd>
						</>
					) : null}
					{method.accountNumber ? (
						<>
							<dt>{copy.methods.accountNumber[method.kind]}</dt>
							<dd>
								<span className="deposit-number" translate="no">
									{method.accountNumber}
								</span>
								<CopyButton
									text={method.accountNumber}
									label={fill(copy.methods.copyLabel, {
										number: method.accountNumber,
									})}
									visible={copy.methods.copy}
								/>
							</dd>
						</>
					) : null}
				</dl>
			) : null}
		</>
	);
}

/** The studio's chat links, under every state (spec ruling 9). */
export function ContactLine({
	studioName,
	contact,
}: {
	studioName: string;
	contact: DepositContact;
}) {
	const links = [
		contact.whatsapp ? { href: contact.whatsapp, label: copy.whatsapp } : null,
		contact.viber ? { href: contact.viber, label: copy.viber } : null,
	].filter((link) => link !== null);
	if (links.length === 0) return null;
	return (
		<p className="deposit-contact">
			<Fill template={copy.contact} values={{ studio: studioName }} />
			{links.map((link) => (
				<a
					key={link.href}
					className="text-link"
					href={link.href}
					rel={linkRel(link.href)}
				>
					{link.label}
				</a>
			))}
		</p>
	);
}
```

- [ ] **Step 6: The styles**

Append to `apps/storefront/src/styles.css`, after TAT-57's last `@media (prefers-reduced-motion: reduce)` block:

```css

/*
 * The deposit page (TAT-65b): TAT-48's tokens in one column of at most 28rem
 * with 16 px gutters on a phone. The amount and the reference code are the
 * largest things on it; red (--destructive) is for errors only; the one
 * motion is the sending line. An empty live region keeps its place in the
 * accessibility tree (never display: none) but takes no room in the grid.
 */
@layer components {
  .deposit { display: grid; gap: 2rem; width: min(28rem, 100% - 2rem); margin-inline: auto; padding-block: 2rem 1rem; }
  .deposit-title { font-size: clamp(1.75rem, 1.4rem + 1.5vw, 2.25rem); line-height: 1.2; }
  .deposit-intro { display: grid; gap: 0.5rem; justify-items: start; }
  .deposit-brief summary { display: flex; align-items: center; min-block-size: 2.75rem; color: var(--stencil); font-weight: 600; cursor: pointer; }
  .deposit-muted { color: var(--ink-muted); font-size: 0.9375rem; }
  .deposit-live:empty, .deposit-copied:empty { position: absolute; }
  .deposit-block { display: grid; gap: 0.75rem; justify-items: start; min-width: 0; }
  .deposit-block h2 { font-size: 1.375rem; line-height: 1.25; }
  .deposit-amount { font-family: var(--display-face); font-size: 2.5rem; font-weight: 700; line-height: 1.1; overflow-wrap: anywhere; }
  .deposit-code-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
  .deposit-code { padding: 0.375rem 1rem; border: 1.5px dashed var(--stencil); border-radius: var(--radius); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 1.75rem; font-weight: 700; letter-spacing: 0.15em; user-select: all; }
  .deposit-number { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; overflow-wrap: anywhere; user-select: all; }
  .deposit-copy { display: inline-flex; align-items: center; gap: 0.375rem; min-block-size: 2.75rem; min-inline-size: 2.75rem; padding: 0.25rem 0.875rem; border: 1px solid var(--line-strong); border-radius: var(--radius); background: transparent; color: var(--stencil); font-weight: 600; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
  .deposit-copy:hover { border-color: var(--stencil); background: var(--stencil-wash); }
  .deposit-copied { color: var(--ink-muted); font-size: 0.9375rem; }
  .deposit-methods { display: grid; gap: 1.5rem; inline-size: 100%; margin: 0; padding: 0; list-style: none; }
  .deposit-method { display: grid; gap: 0.75rem; justify-items: start; padding-block-start: 1.25rem; border-top: 1px solid var(--line); }
  .deposit-method h3 { font-size: 1.25rem; line-height: 1.3; }
  .deposit-qr-figure { display: grid; gap: 0.5rem; inline-size: 100%; margin: 0; }
  .deposit-qr { display: block; inline-size: 100%; max-inline-size: 17.5rem; block-size: auto; border: 1px solid var(--line); background: #ffffff; }
  .deposit-details { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.25rem 1rem; align-items: center; inline-size: 100%; margin: 0; }
  .deposit-details dt { color: var(--ink-muted); font-size: 0.9375rem; }
  .deposit-details dd { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .deposit-note { padding-inline-start: 0.875rem; border-inline-start: 2px solid var(--stencil); }
  .deposit-state { position: relative; isolation: isolate; display: grid; gap: 0.75rem; justify-items: start; margin: 0 0.375rem 0.375rem 0; padding: 1.25rem; border: 1.5px solid var(--stencil); background: var(--paper); }
  .deposit-state::after { content: ''; position: absolute; inset: 0; z-index: -1; translate: 0.375rem 0.375rem; border: 1.5px solid var(--stencil); }
  .deposit-state-title { font-weight: 600; }
  .deposit-skeleton { display: grid; gap: 1rem; }
  .deposit-skeleton-line { display: block; inline-size: 100%; block-size: 1.25rem; border-radius: var(--radius); background: var(--stencil-wash); }
  .deposit-skeleton-amount { inline-size: 60%; block-size: 3rem; }
  .deposit-skeleton-short { inline-size: 40%; }
  .deposit-form { display: grid; gap: 1.5rem; inline-size: 100%; }
  .deposit-label { margin-block-end: 0.25rem; font-size: 1rem; font-weight: 600; line-height: 1.375; }
  .deposit-proof { display: grid; gap: 0.75rem; justify-items: start; min-width: 0; margin: 0; padding: 0; border: 0; }
  .deposit-preview { display: block; max-inline-size: 12rem; max-block-size: 20rem; inline-size: auto; block-size: auto; border: 1.5px solid var(--stencil); background: var(--stencil-wash); }
  .deposit-proof-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
  .deposit-pick { display: inline-flex; align-items: center; gap: 0.5rem; min-block-size: 3rem; padding: 0.5rem 1.25rem; border: 1.5px dashed var(--stencil); border-radius: var(--radius); color: var(--stencil); font-weight: 600; cursor: pointer; }
  .deposit-pick:hover { background: var(--stencil-wash); }
  .deposit-pick:focus-within { outline: 2px solid var(--stencil); outline-offset: 3px; }
  .deposit-pick-locked { cursor: progress; opacity: 0.75; }
  .deposit-proof-status, .deposit-send-status { min-block-size: 1.6em; font-size: 0.9375rem; font-weight: 600; }
  .deposit-field-error { color: var(--destructive); font-size: 0.9375rem; }
  .deposit-alert { display: grid; gap: 0.5rem; justify-items: start; padding-block: 0.75rem; padding-inline: 1rem 0; border-inline-start: 2px solid var(--destructive); }
  .deposit-alert-title { font-weight: 700; }
  .deposit-alert ul { display: grid; gap: 0.25rem; margin: 0; padding-inline-start: 1.25rem; }
  .deposit-summary-link { min-block-size: 2.75rem; padding: 0; border: 0; background: none; color: var(--stencil); text-align: start; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.2em; cursor: pointer; }
  .deposit-submit { display: grid; gap: 0.75rem; inline-size: 100%; }
  .deposit-submit .action { inline-size: 100%; }
  .deposit-submit .action[aria-disabled='true'] { cursor: progress; opacity: 0.75; }
  .deposit-progress { position: relative; block-size: 2px; overflow: hidden; background: var(--stencil-wash); }
  .deposit-progress::before { content: ''; position: absolute; inset-block: 0; inline-size: 30%; background: var(--stencil); animation: intake-trace 1.4s ease-in-out infinite; }
  .deposit-contact { color: var(--ink-muted); font-size: 0.9375rem; }
  .deposit-contact a { margin-inline-start: 0.75rem; }
  .deposit-footer { width: min(28rem, 100% - 2rem); margin: 3rem auto 0; padding-block: 1.5rem 2.5rem; border-top: 1px solid var(--line); color: var(--ink-muted); font-size: 0.9375rem; }
}

@media (prefers-reduced-motion: reduce) {
  .deposit-progress::before { animation: none; inline-size: 100%; opacity: 0.5; }
  .deposit-copy { transition: none; }
}
```

(`intake-trace` is TAT-57's keyframes, already in this file. Biome ignores `styles.css`; `test/studio/assets.test.ts` checks its `url()`s, and this block has none.)

- [ ] **Step 7: Run the tests, the typecheck and Biome**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/render.test.ts test/studio/assets.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm exec biome check apps/storefront/src/deposit apps/storefront/test/deposit`
Expected: no errors (apply `--write` for formatting only; if a lint rule fires, fix the code the way TAT-57's notes did: a named `<section aria-labelledby>` instead of a `div` with `aria-labelledby`, a spread for `role={undefined}`; never a `biome-ignore` without saying why in the report).

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/deposit/browser.ts apps/storefront/src/deposit/components apps/storefront/src/styles.css apps/storefront/test/deposit/html.ts apps/storefront/test/deposit/render.test.ts
git commit -m "feat(storefront): render the deposit page's states, amount, code and payment methods

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The payment screenshot form

**Files:**
- Create: `apps/storefront/src/deposit/components/proof-picker.tsx`, `apps/storefront/src/deposit/components/proof-form.tsx`
- Test: `apps/storefront/test/deposit/form.test.ts`

**Interfaces:**
- Consumes: `useSubmitDepositProof` from `@tattoo-drip/react`; `useAppForm` from `../../components/ui/form.tsx`; `revalidateLogic`, `type AnyFieldApi` from `@tanstack/react-form`; `browserCodec` from `../../intake/browser-codec.ts`; `ACCEPT` from `../../intake/images.ts`; Task 3's `proof.ts`; Task 5's `problems.ts`; Task 7's `notices.tsx`.
- Produces: `ProofPicker(props: ProofPickerProps)`, `proofStatus(state)`; `ProofForm(props: ProofFormProps)` with `ProofFormProps { token; view; studioName; reread(): Promise<DepositState | "gone" | "failed">; onLeftDue(): void }`, `SLOW_AFTER_MS`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/deposit/form.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProofForm } from "../../src/deposit/components/proof-form.tsx";
import {
	ProofPicker,
	type ProofPickerProps,
} from "../../src/deposit/components/proof-picker.tsx";
import { copy } from "../../src/deposit/copy.ts";
import { NO_PROOF, type ProofState } from "../../src/deposit/proof.ts";
import { depositView } from "../../src/deposit/view-model.ts";
import { renderWithProviders } from "../intake/providers.tsx";
import { PAGE, page, TOKEN } from "./fixtures.ts";
import { attr, hrefs, tags, textOf } from "./html.ts";

// @tattoo-drip/react is used from source, and tsx compiles its .tsx files with
// the classic JSX transform (the storefront's tsconfig doesn't cover them),
// which calls the global React.
Object.assign(globalThis, { React });

const file = new File([new Uint8Array(4)], "payment.jpg", {
	type: "image/jpeg",
});

const picker = (overrides: Partial<ProofPickerProps> = {}) =>
	renderToStaticMarkup(
		createElement(ProofPicker, {
			state: NO_PROOF,
			preview: null,
			busy: false,
			error: null,
			onPick: () => undefined,
			onRemove: () => undefined,
			...overrides,
		}),
	);

const fileInput = (html: string) =>
	tags(html, "input").find((tag) => attr(tag, "type") === "file") ?? "";

const formHtml = (view = depositView(PAGE)) =>
	renderWithProviders(
		createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-48",
			fetch: () => Promise.reject(new Error("no request during a render")),
		}),
		createElement(ProofForm, {
			token: TOKEN,
			view,
			studioName: "Black Needle",
			reread: async () => "due" as const,
			onLeftDue: () => undefined,
		}),
	);

describe("ProofPicker", () => {
	test("empty: a fieldset with its hint, one file input for JPEG, PNG or WebP", () => {
		const html = picker();
		assert.match(html, /<fieldset id="proof"/);
		assert.match(html, /<legend[^>]*>Payment screenshot<\/legend>/);
		assert.match(
			html,
			/<p id="proof-hint"[^>]*>A screenshot or a photo of the payment: JPEG, PNG or WebP\.<\/p>/,
		);
		const input = fileInput(html);
		assert.equal(attr(input, "id"), "proof-input");
		assert.equal(attr(input, "accept"), "image/jpeg,image/png,image/webp");
		assert.equal(attr(input, "aria-describedby"), "proof-hint");
		assert.equal(attr(input, "multiple"), undefined);
		assert.equal(attr(input, "aria-disabled"), undefined);
		assert.match(textOf(html), /Add screenshot/);
		assert.doesNotMatch(html, /<img|Remove screenshot/);
	});

	test("preparing: the picker does nothing and says why", () => {
		const html = picker({ state: { kind: "preparing", id: 1 } });
		assert.equal(attr(fileInput(html), "aria-disabled"), "true");
		assert.match(html, /class="deposit-pick deposit-pick-locked"/);
		assert.match(
			html,
			/<p class="deposit-proof-status" aria-live="polite">Preparing your screenshot…<\/p>/,
		);
	});

	test("ready: the preview, another pick, Remove", () => {
		const ready: ProofState = { kind: "ready", id: 1, file };
		const html = picker({ state: ready, preview: "blob:http://x/1" });
		const image = tags(html, "img")[0];
		assert.equal(attr(image, "src"), "blob:http://x/1");
		assert.equal(attr(image, "alt"), "Your payment screenshot");
		assert.match(textOf(html), /Choose another/);
		const remove = tags(html, "button")[0];
		assert.equal(attr(remove, "type"), "button");
		assert.match(textOf(html), /Remove screenshot/);
		assert.match(html, /aria-live="polite">Screenshot added\.<\/p>/);

		const sending = picker({ state: ready, preview: "blob:http://x/1", busy: true });
		assert.equal(attr(tags(sending, "button")[0], "aria-disabled"), "true");
		assert.equal(attr(fileInput(sending), "aria-disabled"), "true");
	});

	test("a refused pick says why, naming the file", () => {
		const html = picker({
			state: { kind: "empty", problem: { kind: "heic", name: "IMG_0042.HEIC" } },
		});
		assert.match(
			textOf(html),
			/IMG_0042\.HEIC is a HEIC photo, which this browser can't open\. Take a screenshot of the payment instead\./,
		);
	});

	test("an error is tied to the input", () => {
		const html = picker({ error: copy.form.required.proof });
		const input = fileInput(html);
		assert.equal(attr(input, "aria-invalid"), "true");
		assert.equal(attr(input, "aria-describedby"), "proof-hint proof-error");
		assert.match(html, /<p id="proof-error"[^>]*>Add a screenshot of your payment\.<\/p>/);
	});
});

describe("ProofForm", () => {
	test("its heading, a no-validate form, both ways to pay, the picker and Send", () => {
		const html = formHtml();
		assert.match(html, /<h2 id="proof-title">After you pay, send a screenshot<\/h2>/);
		const form = tags(html, "form")[0];
		assert.match(form, /novalidate=""/i);
		assert.equal(attr(form, "aria-labelledby"), "proof-title");
		assert.match(html, /<legend[^>]*>How did you pay\?<\/legend>/);
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		assert.deepEqual(
			radios.map((radio) => [attr(radio, "id"), attr(radio, "value")]),
			[
				["method-0", "esewa"],
				["method-1", "bank"],
			],
		);
		for (const radio of radios) assert.doesNotMatch(radio, / checked=""/);
		assert.match(textOf(html), /eSewa.*Bank transfer/s);
		assert.ok(fileInput(html));
		const send = tags(html, "button").find((tag) => attr(tag, "type") === "submit");
		assert.ok(send);
		assert.equal(attr(send, "aria-disabled"), undefined);
		assert.match(html, />Send screenshot<\/button>/);
		assert.doesNotMatch(html, /role="alert"|proof-summary-title/);
	});

	test("one way to pay is chosen already", () => {
		const html = formHtml(
			depositView(page({ paymentMethods: [PAGE.paymentMethods[0]] })),
		);
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		assert.equal(radios.length, 1);
		assert.match(radios[0], / checked=""/);
	});

	test("says when the studio couldn't confirm the last screenshot", () => {
		const html = formHtml(depositView(page({ lastProofRejected: true })));
		assert.ok(textOf(html).includes(copy.rejected));
		assert.ok(!textOf(formHtml()).includes(copy.rejected));
	});

	test("holds no link and never the token", () => {
		const html = formHtml();
		assert.equal(hrefs(html).length, 0);
		assert.ok(!html.includes(TOKEN));
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/form.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/deposit/components/proof-form.tsx`.

- [ ] **Step 3: Write the picker**

Create `apps/storefront/src/deposit/components/proof-picker.tsx`:

```tsx
import { ImagePlus, X } from "lucide-react";
import type { Ref } from "react";
import { fill } from "../../intake/copy.ts";
import { ACCEPT } from "../../intake/images.ts";
import { copy } from "../copy.ts";
import type { ProofState } from "../proof.ts";

export interface ProofPickerProps {
	readonly state: ProofState;
	/** The prepared JPEG's object URL; the form makes and revokes it. */
	readonly preview: string | null;
	/** While a send runs: the picker and Remove do nothing. */
	readonly busy: boolean;
	/** "Add a screenshot…", or the API's message about it. */
	readonly error: string | null;
	readonly inputRef?: Ref<HTMLInputElement>;
	onPick(file: File): void;
	onRemove(): void;
}

/** What the picker's polite status says. */
export function proofStatus(state: ProofState): string {
	if (state.kind === "preparing") return copy.form.preparing;
	if (state.kind === "ready") return copy.form.ready;
	if (state.problem) {
		return fill(copy.form.problems[state.problem.kind], {
			name: state.problem.name,
		});
	}
	return "";
}

/**
 * One payment screenshot (spec ruling 15). The file input stays in place
 * whatever the state, so focus never drops; while a screenshot is being
 * prepared or sent, its click is prevented (no second decode, no swap
 * mid-send) and it says so with aria-disabled.
 */
export function ProofPicker({
	state,
	preview,
	busy,
	error,
	inputRef,
	onPick,
	onRemove,
}: ProofPickerProps) {
	const locked = busy || state.kind === "preparing";
	return (
		<fieldset id="proof" className="deposit-proof">
			<legend className="deposit-label">{copy.form.proof}</legend>
			<p id="proof-hint" className="deposit-muted">
				{copy.form.proofHint}
			</p>
			{state.kind === "ready" && preview ? (
				<img
					className="deposit-preview"
					src={preview}
					alt={copy.form.previewAlt}
				/>
			) : null}
			<div className="deposit-proof-actions">
				<label
					className={locked ? "deposit-pick deposit-pick-locked" : "deposit-pick"}
				>
					<input
						ref={inputRef}
						id="proof-input"
						className="sr-only"
						type="file"
						accept={ACCEPT}
						aria-describedby={error ? "proof-hint proof-error" : "proof-hint"}
						aria-invalid={error ? true : undefined}
						aria-disabled={locked ? true : undefined}
						onClick={(event) => {
							if (locked) event.preventDefault();
						}}
						onChange={(event) => {
							const input = event.currentTarget;
							const picked = input.files?.[0];
							input.value = "";
							if (picked) onPick(picked);
						}}
					/>
					<ImagePlus aria-hidden="true" className="size-5" />
					<span>
						{state.kind === "ready" ? copy.form.replace : copy.form.add}
					</span>
				</label>
				{state.kind === "ready" ? (
					<button
						type="button"
						className="action action-secondary"
						aria-disabled={busy ? true : undefined}
						onClick={() => {
							if (!busy) onRemove();
						}}
					>
						<X aria-hidden="true" className="size-5" />
						{copy.form.remove}
					</button>
				) : null}
			</div>
			<p className="deposit-proof-status" aria-live="polite">
				{proofStatus(state)}
			</p>
			{error ? (
				<p id="proof-error" className="deposit-field-error">
					{error}
				</p>
			) : null}
		</fieldset>
	);
}
```

- [ ] **Step 4: Write the form**

Create `apps/storefront/src/deposit/components/proof-form.tsx`:

```tsx
import { type AnyFieldApi, revalidateLogic } from "@tanstack/react-form";
import { useSubmitDepositProof } from "@tattoo-drip/react";
import type { DepositState } from "@tattoo-drip/sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { useAppForm } from "../../components/ui/form.tsx";
import { browserCodec } from "../../intake/browser-codec.ts";
import { copy, type DepositMethodKind } from "../copy.ts";
import {
	describeProofError,
	firstMessage,
	type ProofProblem,
	summaryItems,
	validateProofForm,
} from "../problems.ts";
import { NO_PROOF, prepareProof, previewOf, proofReducer } from "../proof.ts";
import type { DepositView } from "../view-model.ts";
import { ProofNoticeView, ProofSummary } from "./notices.tsx";
import { ProofPicker } from "./proof-picker.tsx";

/** After this long sending, the status line says a slow connection can take 2 minutes. */
export const SLOW_AFTER_MS = 15_000;

const BROWSER_URLS = {
	create: (file: Blob) => URL.createObjectURL(file),
	revoke: (url: string) => URL.revokeObjectURL(url),
};

type NoticeProblem = Extract<ProofProblem, { kind: "notice" }>;

interface ProofValues {
	method: string;
}

export interface ProofFormProps {
	readonly token: string;
	/** A `due` page that takes a screenshot (`view.takesProof`). */
	readonly view: DepositView;
	readonly studioName: string;
	/** Reads the page again: its state now, "gone" (a 404) or "failed". */
	reread(): Promise<DepositState | "gone" | "failed">;
	/** The page left `due` (sent, or changed under the form): the screen moves focus to its message. */
	onLeftDue(): void;
}

/**
 * The screenshot form (TAT-65b, spec rulings 15 to 17): how the client paid
 * (TanStack Form), one screenshot prepared by TAT-57's pipeline, and Send,
 * through useSubmitDepositProof (never retried; on 201 the hook puts the
 * `submitted` page in the cache). One attempt at a time; everything picked
 * stays after a refusal.
 */
export function ProofForm({
	token,
	view,
	studioName,
	reread,
	onLeftDue,
}: ProofFormProps) {
	const submit = useSubmitDepositProof(token);
	const [proof, dispatch] = useReducer(proofReducer, NO_PROOF);
	const [preview, setPreview] = useState<string | null>(null);
	const [proofError, setProofError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeProblem | null>(null);
	const [showSummary, setShowSummary] = useState(false);
	const [focusSummary, setFocusSummary] = useState(false);
	const [sending, setSending] = useState(false);
	const [slow, setSlow] = useState(false);
	const [blockedUntil, setBlockedUntil] = useState<number | null>(null);

	const latestProof = useRef(proof);
	const latestDue = useRef(view.due);
	const blocked = useRef(false);
	const inFlight = useRef(false);
	const mounted = useRef(false);
	const nextId = useRef(0);
	const summaryRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const kinds = view.kinds;
	const form = useAppForm({
		defaultValues: { method: kinds.length === 1 ? kinds[0] : "" } as ProofValues,
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: {
			onDynamic: ({ value }: { value: ProofValues }) => {
				const fields = validateProofForm(value, kinds);
				return fields ? { fields } : undefined;
			},
		},
		listeners: {
			onChange: ({ fieldApi }) => clearServerError(fieldApi),
		},
		onSubmit: ({ value }) => send(value),
		onSubmitInvalid: () => {
			if (latestProof.current.kind === "empty") {
				setProofError(copy.form.required.proof);
			}
			setShowSummary(true);
			setFocusSummary(true);
		},
	});

	async function send(values: ProofValues): Promise<void> {
		if (inFlight.current || blocked.current) return;
		const current = latestProof.current;
		if (current.kind !== "ready") {
			if (current.kind === "empty") {
				setProofError(copy.form.required.proof);
				setShowSummary(true);
				setFocusSummary(true);
			}
			return;
		}
		inFlight.current = true;
		setNotice(null);
		setShowSummary(false);
		setProofError(null);
		setSending(true);
		try {
			await submit.mutateAsync({
				proof: current.file,
				method: values.method as DepositMethodKind,
				expectedAmount: latestDue.current,
			});
			dispatch({ type: "removed" });
			onLeftDue();
		} catch (error) {
			refused(describeProofError(error));
		} finally {
			inFlight.current = false;
			if (mounted.current) setSending(false);
		}
	}

	function refused(problem: ProofProblem): void {
		if (problem.kind === "fields") {
			const { method, proof: proofMessage } = problem.fields;
			if (method) {
				form.setFieldMeta("method", (meta) => ({
					...meta,
					isTouched: true,
					errorMap: { ...meta.errorMap, onServer: method },
				}));
			}
			if (proofMessage) setProofError(proofMessage);
			setShowSummary(true);
			setFocusSummary(true);
			return;
		}
		if (problem.waitSeconds !== null) {
			setBlockedUntil(Date.now() + problem.waitSeconds * 1000);
		}
		setNotice(problem);
		if (problem.refetch) {
			// The page may have moved on (the upload landed after all, the studio
			// acted, the link died): when it left `due`, the screen takes focus to
			// its new message. This form is gone by then; the callback is not.
			void reread().then((next) => {
				if (next !== "due" && next !== "failed") onLeftDue();
			});
		}
	}

	function pick(file: File): void {
		if (inFlight.current || latestProof.current.kind === "preparing") return;
		const id = nextId.current++;
		setProofError(null);
		dispatch({ type: "picked", id });
		void prepareProof(file, browserCodec).then((result) =>
			dispatch(
				result.ok
					? { type: "prepared", id, file: result.file }
					: { type: "refused", id, problem: result.problem, name: file.name },
			),
		);
	}

	useEffect(() => {
		latestProof.current = proof;
	}, [proof]);

	useEffect(() => {
		latestDue.current = view.due;
	}, [view.due]);

	useEffect(() => {
		blocked.current = blockedUntil !== null;
	}, [blockedUntil]);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// One preview URL for the prepared screenshot, revoked when it goes.
	const readyFile = proof.kind === "ready" ? proof.file : null;
	useEffect(() => {
		if (!readyFile) {
			setPreview(null);
			return;
		}
		const handle = previewOf(readyFile, BROWSER_URLS);
		setPreview(handle.url);
		return () => handle.release();
	}, [readyFile]);

	useEffect(() => {
		if (!focusSummary) return;
		setFocusSummary(false);
		summaryRef.current?.focus();
	}, [focusSummary]);

	useEffect(() => {
		if (!sending) {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [sending]);

	// Leaving while the screenshot is on its way asks first.
	useEffect(() => {
		if (!sending) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [sending]);

	useEffect(() => {
		if (blockedUntil === null) return;
		const timer = window.setTimeout(
			() => {
				setBlockedUntil(null);
				setNotice((shown) => (shown?.code === "rate-limited" ? null : shown));
			},
			Math.max(0, blockedUntil - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [blockedUntil]);

	const busy = sending || proof.kind === "preparing" || blockedUntil !== null;

	return (
		<section className="deposit-block" aria-labelledby="proof-title">
			<h2 id="proof-title">{copy.form.title}</h2>
			{view.lastProofRejected ? (
				<p className="deposit-note">{copy.rejected}</p>
			) : null}
			<form
				className="deposit-form"
				method="post"
				noValidate
				aria-labelledby="proof-title"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					if (!busy) void form.handleSubmit();
				}}
			>
				<form.Subscribe selector={(state) => state.fieldMeta.method?.errors}>
					{(errors) => {
						const items = summaryItems(firstMessage(errors), proofError);
						return showSummary && items.length > 0 ? (
							<ProofSummary ref={summaryRef} items={items} />
						) : null;
					}}
				</form.Subscribe>
				<form.AppField name="method">
					{(field) => (
						<field.ChoiceField
							legend={copy.form.method}
							options={kinds.map((kind) => ({
								value: kind,
								label: copy.form.kinds[kind],
							}))}
							required
							disabled={sending}
						/>
					)}
				</form.AppField>
				<ProofPicker
					state={proof}
					preview={preview}
					busy={sending}
					error={proofError}
					inputRef={inputRef}
					onPick={pick}
					onRemove={() => {
						dispatch({ type: "removed" });
						setProofError(null);
						inputRef.current?.focus();
					}}
				/>
				{notice ? (
					<ProofNoticeView
						code={notice.code}
						waitSeconds={notice.waitSeconds}
						studioName={studioName}
					/>
				) : null}
				<div className="deposit-submit">
					<button
						type="submit"
						className="action action-primary"
						aria-disabled={busy ? true : undefined}
					>
						{sending ? copy.form.sending : copy.form.send}
					</button>
					{sending ? (
						<div className="deposit-progress" aria-hidden="true" />
					) : null}
					<p className="deposit-send-status" aria-live="polite">
						{sending
							? slow
								? copy.form.stillSending
								: copy.form.sendingStatus
							: ""}
					</p>
				</div>
			</form>
		</section>
	);
}

/** The API's error on a field goes as soon as the client changes that field. */
function clearServerError(field: AnyFieldApi): void {
	if (field.state.meta.errorMap.onServer === undefined) return;
	field.setMeta((meta) => ({
		...meta,
		errorMap: { ...meta.errorMap, onServer: undefined },
	}));
}
```

- [ ] **Step 5: Run the tests, the typecheck and Biome**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/form.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes. If `form.Subscribe`'s selector types `state.fieldMeta.method` differently in the installed TanStack Form, follow `intake-form.tsx`'s `selector={(formState) => formState.fieldMeta}` and read `.method?.errors` inside the render function instead.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm exec biome check apps/storefront/src/deposit apps/storefront/test/deposit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/storefront/src/deposit/components/proof-picker.tsx apps/storefront/src/deposit/components/proof-form.tsx apps/storefront/test/deposit/form.test.ts
git commit -m "feat(storefront): add the payment screenshot form

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The screen and the route at `/deposit`

**Files:**
- Create: `apps/storefront/src/deposit/components/deposit-screen.tsx`
- Create: `apps/storefront/src/routes/deposit.tsx`
- Regenerate (by `pnpm build`): `apps/storefront/src/routeTree.gen.ts`
- Modify: `apps/storefront/test/studio/prototype-removed.test.ts`, `apps/storefront/scripts/check-page.mjs`
- Test: `apps/storefront/test/deposit/screen.test.ts`, `apps/storefront/test/deposit/guard.test.ts`

**Interfaces:**
- Consumes: `useDeposit` from `@tattoo-drip/react`; everything from Tasks 1 to 8.
- Produces: `DepositScreen({ shell }: { shell: DepositShell })`; the route `Route` (`/deposit`).

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/test/deposit/screen.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DepositScreen } from "../../src/deposit/components/deposit-screen.tsx";
import { SHELL } from "./fixtures.ts";
import { hrefs, tags, textOf } from "./html.ts";

Object.assign(globalThis, { React });

test("the server renders the shell only: the studio, a busy skeleton, its chat links", () => {
	const html = renderToStaticMarkup(createElement(DepositScreen, { shell: SHELL }));

	assert.equal(tags(html, "h1").length, 1);
	assert.match(html, /<h1[^>]*>Pay your deposit to <bdi>Black Needle<\/bdi><\/h1>/);
	assert.match(html, /aria-busy="true"/);
	assert.match(textOf(html), /Questions\? Message Black Needle:WhatsAppViber/);
	assert.deepEqual(hrefs(html), [
		`https://wa.me/9779812345678?text=${encodeURIComponent("Hi Black Needle, about my deposit.")}`,
		"viber://chat?number=%2B9779812345678",
	]);
	assert.match(textOf(html), /You pay Black Needle directly\./);
	assert.doesNotMatch(html, /<form|deposits|Deposit due|role="alert"/);
});
```

Create `apps/storefront/test/deposit/guard.test.ts`:

```ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * What must never come into the deposit page's code (TAT-65b, spec ruling 4):
 * the token stays in the URL's fragment and in the API's path, nowhere else.
 */

const SRC = new URL("../../src/", import.meta.url);
const DEPOSIT = new URL("deposit/", SRC);

function depositFiles(): string[] {
	return readdirSync(DEPOSIT, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file))
		.sort();
}

const read = (file: string) => readFileSync(new URL(file, DEPOSIT), "utf8");

test("nothing on the deposit page stores, logs, tracks or reads the query", () => {
	for (const file of depositFiles()) {
		const text = read(file);
		for (const banned of [
			/localStorage/,
			/sessionStorage/,
			/indexedDB/i,
			/document\.cookie/,
			/dangerouslySetInnerHTML/,
			/\bstyle=\{/,
			/\btarget=/,
			/console\./,
			/location\.search/,
			/searchParams/,
			/sendBeacon/,
			/posthog/i,
			/sentry/i,
		]) {
			assert.doesNotMatch(text, banned, `${file}: ${banned}`);
		}
	}
});

test("no in-page fragment link: following one would replace the token", () => {
	for (const file of depositFiles()) {
		assert.doesNotMatch(read(file), /href=["{`]+#/, file);
	}
});

test("only the screen reads the fragment", () => {
	assert.deepEqual(
		depositFiles().filter((file) => /location\.hash/.test(read(file))),
		["components/deposit-screen.tsx"],
	);
});

test("imports only the page's own modules, React, the SDK, its hooks, the form kit and icons", () => {
	const allowed = new Set([
		"react",
		"@tattoo-drip/react",
		"@tattoo-drip/sdk",
		"@tanstack/react-form",
		"lucide-react",
	]);
	for (const file of depositFiles()) {
		for (const match of read(file).matchAll(/from "([^"]+)"/g)) {
			assert.ok(
				match[1].startsWith(".") || allowed.has(match[1]),
				`${file} imports ${match[1]}`,
			);
		}
	}
});

test("the route reads no URL itself, and the router never keys storage by href", () => {
	const route = readFileSync(new URL("routes/deposit.tsx", SRC), "utf8");
	assert.doesNotMatch(route, /\.hash\b|useLocation|window\.location|useSearch/);
	const router = readFileSync(new URL("router.tsx", SRC), "utf8");
	assert.match(router, /getScrollRestorationKey: scrollRestorationKey/);
});
```

In `apps/storefront/test/studio/prototype-removed.test.ts`, replace

```ts
test("the studio page has exactly its two routes", () => {
	assert.deepEqual(
		sourceFiles().filter((file) => file.startsWith("routes/")),
		["routes/__root.tsx", "routes/artists/$slug.tsx", "routes/index.tsx"],
	);
});
```

with

```ts
test("the storefront has exactly its three routes", () => {
	assert.deepEqual(
		sourceFiles().filter((file) => file.startsWith("routes/")),
		[
			"routes/__root.tsx",
			"routes/artists/$slug.tsx",
			"routes/deposit.tsx",
			"routes/index.tsx",
		],
	);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/screen.test.ts test/deposit/guard.test.ts test/studio/prototype-removed.test.ts`
Expected: FAIL: `ERR_MODULE_NOT_FOUND` for `deposit-screen.tsx`; the guard's "only the screen reads the fragment" and "the route reads no URL" fail (no screen, no route); the three-routes test fails.

- [ ] **Step 3: Write the screen**

Create `apps/storefront/src/deposit/components/deposit-screen.tsx`:

```tsx
import { useDeposit } from "@tattoo-drip/react";
import type { DepositState } from "@tattoo-drip/sdk";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { DepositShell } from "../loader.ts";
import { isGone, screenFor } from "../problems.ts";
import { readDepositToken } from "../token.ts";
import {
	depositContact,
	depositView,
	formatReceived,
	todayIn,
} from "../view-model.ts";
import {
	ContactLine,
	DepositFrame,
	DepositIntro,
	DepositLoading,
	DueView,
	LoadProblemView,
	StateMessage,
} from "./deposit-page.tsx";
import { ProofForm } from "./proof-form.tsx";

const subscribeToHash = (onChange: () => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

/**
 * The URL's fragment, in the browser only: undefined on the server (which
 * never receives it) and while hydrating, so both render the same shell.
 */
function useLocationHash(): string | undefined {
	return useSyncExternalStore(
		subscribeToHash,
		() => window.location.hash,
		() => undefined,
	);
}

/**
 * The deposit page (TAT-65b): the token from the fragment (spec ruling 3),
 * then the page from useDeposit. A missing or malformed token is the
 * dead-link message, with no request.
 */
export function DepositScreen({ shell }: { shell: DepositShell }) {
	const hash = useLocationHash();
	const token = hash === undefined ? undefined : readDepositToken(hash);
	const contact = depositContact(shell, null);
	return (
		<DepositFrame studioName={shell.studioName}>
			{token === undefined ? (
				<>
					<DepositLoading studioName={shell.studioName} />
					<ContactLine studioName={shell.studioName} contact={contact} />
				</>
			) : token === null ? (
				<>
					<LoadProblemView problem="dead" />
					<ContactLine studioName={shell.studioName} contact={contact} />
				</>
			) : (
				<DepositLoaded key={token} token={token} shell={shell} />
			)}
		</DepositFrame>
	);
}

function DepositLoaded({
	token,
	shell,
}: {
	token: string;
	shell: DepositShell;
}) {
	const query = useDeposit(token);
	const { refetch } = query;
	const screen = screenFor({ data: query.data, error: query.error });
	const view = screen.kind === "page" ? depositView(screen.page) : null;
	const shown = view ? view.state : screen.kind;
	const [moveFocus, setMoveFocus] = useState(false);
	const messageRef = useRef<HTMLParagraphElement>(null);

	const reread = useCallback(async (): Promise<
		DepositState | "gone" | "failed"
	> => {
		const result = await refetch();
		if (result.error) return isGone(result.error) ? "gone" : "failed";
		return result.data?.state ?? "failed";
	}, [refetch]);

	const leftDue = useCallback(() => setMoveFocus(true), []);

	// After the client's own Send, once the page shows its new state (or the
	// dead link), focus goes to that message (TAT-65: "focus moves to its
	// message"). Never on load: nothing takes focus by itself.
	useEffect(() => {
		if (!moveFocus || shown === "due" || shown === "loading") return;
		setMoveFocus(false);
		messageRef.current?.focus();
	}, [moveFocus, shown]);

	return (
		<>
			{view ? <DepositIntro view={view} /> : null}
			<div className="deposit-live" aria-live="polite">
				{view && view.state !== "due" ? (
					<StateMessage
						ref={messageRef}
						view={view}
						studioName={shell.studioName}
						received={formatReceived(view.proofSubmittedAt, shell.timezone)}
					/>
				) : null}
			</div>
			{screen.kind === "loading" ? (
				<DepositLoading studioName={shell.studioName} />
			) : null}
			{screen.kind === "problem" ? (
				<LoadProblemView
					ref={messageRef}
					problem={screen.problem}
					onRetry={() => {
						void refetch();
					}}
				/>
			) : null}
			{view && view.state === "due" ? (
				<DueView
					view={view}
					studioName={shell.studioName}
					today={todayIn(shell.timezone)}
					form={
						view.takesProof ? (
							<ProofForm
								token={token}
								view={view}
								studioName={shell.studioName}
								reread={reread}
								onLeftDue={leftDue}
							/>
						) : null
					}
				/>
			) : null}
			<ContactLine
				studioName={shell.studioName}
				contact={depositContact(shell, view?.referenceCode || null)}
			/>
		</>
	);
}
```

- [ ] **Step 4: Write the route**

Create `apps/storefront/src/routes/deposit.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DepositScreen } from "../deposit/components/deposit-screen.tsx";
import { loadDepositShell } from "../deposit/loader.ts";
import { DEPOSIT_PAGE_HEADERS, depositHead } from "../deposit/seo.ts";

/**
 * The deposit page (TAT-65b): `/deposit#<token>`, the link an owner sends
 * (TAT-65). The server renders only the shell, from the studio the lookup
 * cached; the deposit loads in the browser (DepositScreen), because the
 * token is in the fragment, which no server sees. Never stored, never
 * indexed, no Referer.
 */
export const Route = createFileRoute("/deposit")({
	loader: ({ context }) => loadDepositShell(context),
	head: ({ loaderData }) => depositHead(loaderData?.studioName ?? null),
	headers: () => ({ ...DEPOSIT_PAGE_HEADERS }),
	component: DepositRoute,
});

function DepositRoute() {
	return <DepositScreen shell={Route.useLoaderData()} />;
}
```

- [ ] **Step 5: Regenerate the route tree with the build, then typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: the build passes and ends with the client-bundle check passing. It rewrote `src/routeTree.gen.ts`.

Run:

```bash
git diff --stat -- apps/storefront/src/routeTree.gen.ts
rg -n "'/deposit'" apps/storefront/src/routeTree.gen.ts
rg -n "import type \{ startInstance \} from './start.ts'" apps/storefront/src/routeTree.gen.ts
```

Expected: the file changed; `/deposit` appears in its route maps; the Register footer is still there. If the footer is missing, the tree was written by `tsr generate`, not the build: run the build again and never commit a tree without the footer.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: passes.

- [ ] **Step 6: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/deposit/screen.test.ts test/deposit/guard.test.ts test/studio/prototype-removed.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: `# fail 0`.

- [ ] **Step 7: `check:page` checks `/deposit`**

In `apps/storefront/scripts/check-page.mjs`:

(a) In the header comment, after "a failed lookup is a 503." add " The deposit page (TAT-65b) is its shell only: one lookup, no-store, no Referer, noindex."

(b) Right after the block that ends with

```js
		"An artist's page asked the API for more than the lookup and the list.",
	);
```

insert:

```js

	// The deposit page (TAT-65b): the server renders its shell from the cached
	// lookup alone. The token is in the fragment, so the server never sees one
	// and asks the API for nothing else. Never stored, never indexed, no Referer.
	apiLog.length = 0;
	page = await get("/deposit");
	expect(
		page.status === 200 &&
			page.body.includes(
				"<title>Pay your deposit · Canary Ink &lt;Studio&gt;</title>",
			),
		`/deposit is ${page.status}, or lacks its own title.`,
	);
	expect(
		page.cacheControl === "no-store",
		`/deposit's Cache-Control is "${page.cacheControl}", not no-store.`,
	);
	expect(
		page.headers.includes('"referrer-policy":"no-referrer"') &&
			page.headers.includes('"x-robots-tag":"noindex, nofollow"'),
		"/deposit does not send Referrer-Policy: no-referrer and X-Robots-Tag: noindex, nofollow.",
	);
	expect(
		/<meta name="robots" content="noindex, nofollow"\/?>/.test(page.body) &&
			/<meta name="referrer" content="no-referrer"\/?>/.test(page.body),
		"/deposit lacks its robots or referrer meta.",
	);
	expect(
		page.body.includes('aria-busy="true"') &&
			page.body.includes("https://wa.me/9779812345678") &&
			!page.body.includes("/deposits/"),
		"/deposit does not render its loading shell with the studio's WhatsApp link, or names the deposit API.",
	);
	expect(
		apiLog.length === 1 && apiLog[0].url === `/api/v1/tenants/${SLUG}`,
		`/deposit asked the API for ${apiLog.map((call) => call.url).join(", ")} instead of the lookup alone.`,
	);
```

(c) In the final `console.log`, after "a failed read is an uncached error page, a failed lookup a 503;" add " the deposit page is an uncached, unindexed shell from the lookup alone;".

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront check:page`
Expected: "Page check passed: …" (the build from Step 5 is current). If the meta check fails, print the `<head>` of `/deposit` from the check's `page.body` and match the router's actual meta markup (attribute order, self-closing) in the two regexes; never drop the check.

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/deposit/components/deposit-screen.tsx apps/storefront/src/routes/deposit.tsx apps/storefront/src/routeTree.gen.ts apps/storefront/test/deposit/screen.test.ts apps/storefront/test/deposit/guard.test.ts apps/storefront/test/studio/prototype-removed.test.ts apps/storefront/scripts/check-page.mjs
git commit -m "feat(storefront): serve the deposit page at /deposit, its token read in the browser

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs

**Files:**
- Modify: `apps/storefront/docs/development.md`, `apps/storefront/AGENTS.md`, `apps/storefront/README.md`
- Modify: `docs/sdk.md`, `docs/architecture.md`, `docs/requirements.md`, `docs/README.md`, `README.md`, `apps/platform/docs/deploy.md`

Edit by content (earlier tickets moved lines). Biome doesn't check Markdown: re-read each edit and check its links.

- [ ] **Step 1: Storefront development guide**

In `apps/storefront/docs/development.md`:

(a) In "## Studio page", in its first paragraph, replace "Any other path is the router's not-found page." with "`/deposit` is the [deposit page](#deposit-page) (TAT-65b); any other path is the router's not-found page."

(b) In "## Intake form", at the end of the bullet that starts "Photos: picked with", append: " The pipeline is `prepareImage` with `REFERENCE_PROFILE`; the [deposit page](#deposit-page) runs it with a profile of its own."

(c) Append at the end of the file:

```md
## Deposit page

`/deposit#<token>` (TAT-65b; `src/deposit/`, route `src/routes/deposit.tsx`) is the page an owner's deposit link opens (TAT-65): what to pay, by when, the reference code, the studio's QR codes and details, its deposit policy, and one screenshot of the payment. It reads the page with `useDeposit(token)` and sends the screenshot with `useSubmitDepositProof(token)`, straight from the browser to the API.

- The token is the link's fragment, 43 base64url characters (`readDepositToken`, pinned to the contract). Browsers never send a fragment to a server, so the server renders only the shell (the studio's name from the cached lookup, a loading state, the studio's WhatsApp and Viber links) and the deposit loads in the browser after hydration; a missing or malformed token shows the dead-link message without a request. The token goes only into the API's path, whose access log the platform's proxy turns off ([public API production checklist](../../platform/docs/deploy.md#public-api-production-checklist)). Never put it in a query string, a log, storage or the page's HTML, and never give the page an in-page `#` link: following one replaces the token (the error summary's items are buttons). The router keys its scroll positions in `sessionStorage` by history entry, else by path (`scrollRestorationKey` in `src/router.tsx`), never by href. An old slug's 302 keeps the fragment: browsers carry it across a redirect.
- Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, the same robots and referrer rules in `<meta>`, and `referrerpolicy="no-referrer"` on the QR images. No analytics, no browser-side error reporter (the server's error reporting never sees the fragment) and no Turnstile on this page: the token and the API's per-link limits protect it. A browser-side reporter added later must drop the fragment from every URL it records.
- Data: no polling. The query is always stale, so it refetches when the tab regains focus (coming back from the payment app) and on reconnect; a 404 at any time (a link replaced or expired) replaces the page with the dead-link message, even over data already shown. Amounts are the API's `dueText` and `amountText`; only `deposit.due` goes back, as `expectedAmount`. "Pay by" adds today, tomorrow or "in N days", counted in the studio's timezone, and the screenshot's time is shown in that timezone.
- Screenshot: one, prepared by the intake form's pipeline (`prepareImage` with `PROOF_PROFILE` from `src/deposit/proof.ts`: the same type checks, decode bounds and timeouts, then a long edge of 2048 px at 0.85, 0.72, then 1600 px until at most 1.5 MiB, refused over 4 MiB), sent as `payment.jpg`. While it is being prepared or sent, the picker and Remove do nothing; the preview's object URL is revoked on replace, remove, success and unmount.
- Sending: Send is `aria-disabled` while a screenshot is being prepared, while sending and while a rate limit lasts; never retried; "Still sending" after 15 s; a `beforeunload` prompt while sending; offline it fails at once (`networkMode: "always"`). Refusals (`src/deposit/problems.ts`) are field errors in a focused summary, or one notice above Send (`role="alert"`). `deposit_changed`, `deposit_not_due`, a 404, a timeout and a network error read the page again; when it has left `due` (the upload landed after all, or the studio acted), focus moves to the new message. A 429 blocks Send for its `Retry-After`.
- Pure modules, tested with `node:test` in `test/deposit/`: `token.ts`, `copy.ts` (every word; TAT-65's sentences verbatim), `view-model.ts`, `proof.ts`, `problems.ts`, `seo.ts`, `loader.ts`; the components render with `react-dom/server`, and a guard test keeps storage, logging, analytics, `location.search` and `#` links out of `src/deposit/`. `browser.ts` (the clipboard) and the fragment hook in `components/deposit-screen.tsx` touch the DOM, so only the browser pass covers them. `pnpm check:page` checks the built `/deposit` (its headers and meta, the shell, and nothing asked of the API but the lookup).
- Browser pass (no node test can do these), at 375 px and on a real phone when possible: every state; a keyboard-only upload (the radios, the picker, Send, focus on the sent message); the upload arrives as a JPEG of at most 2048 px with no EXIF; a HEIC from Files on Android Chrome gets its message; Copy in Chrome and in Instagram's and Viber's in-app browsers; with DevTools' network at "Slow 3G", "Still sending"; offline, "Couldn't send"; a 404 after the page showed replaces it; an old slug's link still shows the deposit; and no request but the API's carries the token (no Referer anywhere, nothing in storage).
```

- [ ] **Step 2: Storefront AGENTS.md and README**

In `apps/storefront/AGENTS.md`, replace "the studio page is `src/studio/` ([studio page](docs/development.md#studio-page))." with "the studio page is `src/studio/` ([studio page](docs/development.md#studio-page)), the deposit page `src/deposit/` ([deposit page](docs/development.md#deposit-page))."

In `apps/storefront/README.md`, replace "and `/artists/<slug>` asks for one artist." with "`/artists/<slug>` asks for one artist, and `/deposit#<token>` is a project's deposit page." and "the intake form, forms and monitoring" with "the intake form, the deposit page, forms and monitoring".

- [ ] **Step 3: SDK guide, architecture, requirements, index**

In `docs/sdk.md`, after the paragraph that starts "The deposit page reads `client.deposits.get(token)`", add:

```md
The studio page's deposit page is `apps/storefront/src/deposit/` ([deposit page](../apps/storefront/docs/development.md#deposit-page)): it reads the token from the fragment in the browser only, re-encodes the screenshot as a JPEG before the upload, and never polls.
```

In `docs/architecture.md`, "Deposit (customer → studio)", append to step 2: " The page reads the token from the link's fragment in the browser only (the studio page's server never sees it) and re-encodes the screenshot as a JPEG first (at most 2048 px, no EXIF)."

In `docs/requirements.md`:
- tick `- [ ] Deposit page per project: amount, the studio's QR codes and a reference code; the client uploads proof of payment`: `- [ ]` becomes `- [x]`, the text unchanged;
- in "## Studio page rules", after the bullet that starts "- The page shows only what the public API returns", add:

```md
- The deposit page (`/deposit#<token>`) is the one page that shows a project's deposit, the studio's deposit-page payment methods and its deposit policy, to whoever holds the link: never cached or indexed, sending no Referer, and the token, in the link's fragment, never reaches the studio page's server or anything but the API.
```

In `docs/README.md`, the storefront row: add "the deposit page, " after "the intake form, " (keep the rest as it is).

- [ ] **Step 4: Deployment notes**

In `README.md`, "Deployment", the **Payment proofs** bullet: replace "before a pilot takes deposits, the storefront deposit page (TAT-65b) and object storage (TAT-27) must ship." with "before a pilot takes deposits, object storage (TAT-27) must ship (the storefront's deposit page, `/deposit`, is TAT-65b's)."

In `apps/platform/docs/deploy.md`:
- replace "Still required before any public deploy: object storage (TAT-27: the local disks must never deploy) and the storefront deposit page (TAT-65b). The intake form (TAT-57) must be merged too." with "Still required before any public deploy: object storage (TAT-27: the local disks must never deploy). The intake form (TAT-57) and the deposit page (TAT-65b) must be merged too.";
- in "### After the first deploy", add a bullet after the `curl -sI` one: "- Open a deposit link (a project's \"Copy link\") on a phone, then check the storefront's and the CDN's request logs: `/deposit` appears without its `#` fragment, and the API proxy's access log has no `/deposits/` line."

If any of these sentences reads differently on the base (a review reworded it), make the same change to the sentence as it is.

- [ ] **Step 5: Check and commit**

Run: `rg -n "deposit-page|#public-api-production-checklist" apps/storefront/AGENTS.md apps/storefront/docs/development.md docs/sdk.md`
Expected: the links point at `## Deposit page` (it exists in `apps/storefront/docs/development.md`) and at the checklist heading in `apps/platform/docs/deploy.md` (`rg -n "^## Public API production checklist" apps/platform/docs/deploy.md` finds it).

Run: `rg -n "^- \[x\] Deposit page per project" docs/requirements.md; rg -n "TAT-65b" README.md apps/platform/docs/deploy.md`
Expected: one ticked line; no sentence left that calls TAT-65b missing.

```bash
git add apps/storefront/docs/development.md apps/storefront/AGENTS.md apps/storefront/README.md docs/sdk.md docs/architecture.md docs/requirements.md docs/README.md README.md apps/platform/docs/deploy.md
git commit -m "docs(storefront): document the deposit page, its token rule and its screenshot

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification

- [ ] **Step 1: Root gates**

Run each, from the root:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: all pass (`pnpm check` keeps its two old platform warnings); the storefront build ends with the client-bundle check. After the build, `git status -s` shows no change (the route tree was committed in Task 9). If `pnpm check` fails with "nested root configuration" because of another checkout under `.claude/worktrees/`, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm exec biome check apps packages` instead and say so.

- [ ] **Step 2: The test suites**

Run in the background (about 2 minutes; the platform's suite needs PostgreSQL): `PORT=3402 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm test > <scratchpad>/tat65b-suite.log 2>&1; echo "exit $?" >> <scratchpad>/tat65b-suite.log`
Expected: exit 0; the storefront's `# fail 0` with about 90 more tests than Task 0's baseline; the SDK, React and platform counts equal to the base's (none of their code changed). Read the counts in the log, not only the exit code.

- [ ] **Step 3: Nothing that must stay put moved**

```bash
git diff --quiet <base> -- apps/storefront/package.json pnpm-lock.yaml packages apps/platform/app apps/platform/config apps/platform/start apps/platform/database apps/platform/tests apps/platform/inertia; echo "exit $?"
git diff --name-only <base> -- apps/platform
rg -n "localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML|console\." apps/storefront/src/deposit; echo "exit $?"
rg -n 'href="#' apps/storefront/src/deposit; echo "exit $?"
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront check:page
```

Expected: `exit 0`; only `apps/platform/docs/deploy.md`; `exit 1`; `exit 1`; then "Page check passed: … the deposit page is an uncached, unindexed shell from the lookup alone; …".

Run: `for f in apps/storefront/.output/public/assets/*.js; do printf '%s %s\n' "$(gzip -c "$f" | wc -c)" "$f"; done | sort -n | tail -10` and `rg -l "Send screenshot" apps/storefront/.output/public/assets`
Note in the report the gzipped size of the chunk(s) holding the deposit page (the file with "Send screenshot") and of the largest chunk. Expected: the deposit page is its own chunk (the route is code-split), well under 60 KB gzipped; Task 12 Step 3 checks the studio page doesn't load it.

---

### Task 12: Browser pass

- [ ] **Step 1: Test images and a stand-in API**

Create `<scratchpad>/tat65b-images.mjs`:

```js
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

// Test images for the deposit page's browser pass (TAT-65b), written into the
// directory given: a phone screenshot as a PNG, a HEIC no desktop browser can
// open, and a PNG header that declares 400 megapixels.
const [dir] = process.argv.slice(2);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function header(width, height) {
	const data = Buffer.alloc(13);
	data.writeUInt32BE(width, 0);
	data.writeUInt32BE(height, 4);
	data[8] = 8; // bit depth
	data[9] = 6; // RGBA
	return chunk("IHDR", data);
}

function png(width, height, pixel) {
	const stride = width * 4 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			raw.set(pixel(x, y), y * stride + 1 + x * 4);
		}
	}
	return Buffer.concat([
		SIGNATURE,
		header(width, height),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// 1080 x 2400, like an Android screenshot: dark "text" bars on white, and a
// transparent strip at the bottom that must arrive white.
writeFileSync(
	`${dir}/tat65b-screenshot.png`,
	png(1080, 2400, (x, y) => {
		if (y >= 2200) return [0, 0, 0, 0];
		const line = Math.floor(y / 36) % 3 === 0 && y % 36 < 22;
		return line && x % 60 < 48 ? [24, 22, 48, 255] : [250, 250, 252, 255];
	}),
);
writeFileSync(
	`${dir}/tat65b-photo.heic`,
	Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(64)]),
);
writeFileSync(
	`${dir}/tat65b-huge.png`,
	Buffer.concat([SIGNATURE, header(20000, 20000), chunk("IEND", Buffer.alloc(0))]),
);
```

Create `<scratchpad>/tat65b-fake-api.mjs`:

```js
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

// A stand-in API for the deposit page's browser pass (TAT-65b). The studio
// answers as demo-studio and, as an old slug, as old-demo; one deposit link
// whose page and upload answer come from the mode file ({"get": …, "post": …});
// every request is logged with its Referer and Origin, an upload with its
// fields and image.
const [port, logFile, modeFile, uploadDir] = process.argv.slice(2);
const TOKEN = "tat65b-browser-pass-token-0123456789abcdefg";
const API = `http://127.0.0.1:${port}`;
const studio = {
	slug: "demo-studio",
	name: "Demo Studio",
	type: "studio",
	intro: null,
	timezone: "Asia/Kathmandu",
	contact: { phone: "+9779812345678", email: null, address: null },
	socialLinks: [],
	acceptingInquiries: true,
};
const esewa = { kind: "esewa", label: "eSewa", qrImageUrl: `${API}/uploads/qr-esewa.svg`, accountName: "Demo Studio", accountNumber: "9812345678", bankName: null };
const khalti = { kind: "khalti", label: "Khalti", qrImageUrl: `${API}/uploads/qr-khalti.svg`, accountName: null, accountNumber: "9800000000", bankName: null };
const bank = { kind: "bank", label: "Bank transfer", qrImageUrl: null, accountName: "Demo Studio Pvt Ltd", accountNumber: "01234567890123", bankName: "Nabil Bank" };
const deposit = (due = 300000) => ({ amount: 300000, amountText: "NPR 3,000", due, dueText: `NPR ${(due / 100).toLocaleString("en-US")}`, currency: "NPR", payBy: "2026-12-31", payByText: "31 Dec 2026" });
const base = {
	studio: { name: "Demo Studio" },
	project: { brief: "Fine line peony on the left forearm, about 10 cm, with a few leaves.", artistName: "मीना गुरुङ" },
	deposit: deposit(),
	referenceCode: "7K3M9Q",
	state: "due",
	lastProofRejected: false,
	proofSubmittedAt: null,
	paymentMethods: [esewa, khalti, bank],
	depositPolicy: "Deposits hold your date.\nThey are kept if you cancel within 48 hours.",
};
const closed = { paymentMethods: [] };
const pages = {
	due: base,
	partial: { ...base, deposit: deposit(250000) },
	rejected: { ...base, lastProofRejected: true },
	"one-method": { ...base, paymentMethods: [esewa] },
	"no-methods": { ...base, ...closed },
	"long-brief": { ...base, project: { brief: "Fine line peony on the left forearm. ".repeat(12), artistName: null } },
	submitted: { ...base, ...closed, state: "submitted", proofSubmittedAt: new Date().toISOString() },
	paid: { ...base, ...closed, state: "paid", deposit: deposit(0) },
	"paid-zero": { ...base, ...closed, state: "paid", deposit: { ...deposit(0), amount: 0, amountText: "NPR 0" } },
	updating: { ...base, ...closed, state: "updating" },
	expired: { ...base, ...closed, state: "expired" },
	cancelled: { ...base, ...closed, state: "cancelled" },
};
const error = (status, code, extra = {}) => [status, { error: { code, message: "The API's own words.", ...extra } }];
const failures = {
	404: error(404, "not_found"),
	429: [...error(429, "rate_limited"), { "retry-after": "1200" }],
	500: error(500, "internal_error"),
	503: [...error(503, "service_busy"), { "retry-after": "5" }],
	413: error(413, "payload_too_large"),
	"422-proof": error(422, "validation_failed", { fields: { proof: ["The image could not be read."] } }),
	"422-method": error(422, "validation_failed", { fields: { method: ["Choose one of the page's payment methods."] } }),
	"409-changed": error(409, "deposit_changed"),
	"409-notdue": error(409, "deposit_not_due"),
};
const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "retry-after" };
const mode = () => {
	try {
		return { get: "due", post: "201", ...JSON.parse(readFileSync(modeFile, "utf8")) };
	} catch {
		return { get: "due", post: "201" };
	}
};
const setMode = (value) => writeFileSync(modeFile, JSON.stringify(value));
const qr = () =>
	'<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 7 7"><rect width="7" height="7" fill="#fff"/><path d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 6h1v1H6z" fill="#000"/></svg>';

/** A JPEG's size from its SOF marker, "HAS EXIF" if an APP1 comes first, or why not. */
function jpegInfo(bytes) {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "NOT A JPEG";
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) return "bad JPEG";
		const marker = bytes[at + 1];
		if (marker === 0xe1) return "HAS EXIF";
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			return `${bytes.readUInt16BE(at + 7)}x${bytes.readUInt16BE(at + 5)}`;
		}
		at += 2 + bytes.readUInt16BE(at + 2);
	}
	return "no size";
}

createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", async () => {
		appendFileSync(logFile, `${request.method} ${request.url} referer=${request.headers.referer ?? "-"} origin=${request.headers.origin ?? "-"} key=${request.headers.authorization ? "yes" : "no"}\n`);
		const send = (status, body, headers = {}) => {
			response.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
			response.end(JSON.stringify(body));
		};
		const { get, post } = mode();
		if (request.url === "/api/v1/tenants/demo-studio" || request.url === "/api/v1/tenants/old-demo") {
			return send(200, { data: studio });
		}
		if (request.url?.startsWith("/uploads/qr-")) {
			response.writeHead(200, { ...cors, "content-type": "image/svg+xml" });
			return response.end(qr());
		}
		if (request.url === `/api/v1/tenants/demo-studio/deposits/${TOKEN}`) {
			if (request.method === "GET") {
				if (get === "hang") return;
				if (pages[get]) return send(200, { data: pages[get] });
				const [status, body, headers] = failures[get] ?? failures[500];
				return send(status, body, headers);
			}
			if (request.method === "POST") {
				const form = await new Response(Buffer.concat(chunks), {
					headers: { "content-type": request.headers["content-type"] ?? "" },
				}).formData();
				for (const [name, value] of form) {
					if (typeof value === "string") {
						appendFileSync(logFile, `  ${name}=${JSON.stringify(value)}\n`);
					} else {
						const bytes = Buffer.from(await value.arrayBuffer());
						writeFileSync(`${uploadDir}/tat65b-upload.jpg`, bytes);
						appendFileSync(logFile, `  ${name}=<${value.type} ${value.name} ${bytes.length} bytes ${jpegInfo(bytes)}>\n`);
					}
				}
				if (post === "hang") return;
				if (post === "201") {
					setMode({ get: "submitted", post: "409-notdue" });
					return send(201, { data: { ...pages.submitted, proofSubmittedAt: new Date().toISOString() } });
				}
				if (post === "409-changed") setMode({ get: "partial", post: "201" });
				if (post === "409-notdue") setMode({ get: "submitted", post: "409-notdue" });
				const [status, body, headers] = failures[post] ?? failures[500];
				return send(status, body, headers);
			}
		}
		send(404, { error: { code: "not_found", message: "Not found." } });
	});
}).listen(Number(port), "127.0.0.1");
```

- [ ] **Step 2: Start them**

1. `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node <scratchpad>/tat65b-images.mjs <scratchpad>` (writes the three test files).
2. In the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node <scratchpad>/tat65b-fake-api.mjs 3403 <scratchpad>/tat65b-api.log <scratchpad>/tat65b-mode <scratchpad>`. Note its PID.
3. In the background, from the build of Task 11: `NODE_ENV=production API_URL=http://127.0.0.1:3403 STOREFRONT_URL='http://{tenant}.localhost:3404' STOREFRONT_SERVER_KEY=canary-key-0123456789abcdefghijklmnopqrstuv TURNSTILE_SITE_KEY=1x00000000000000000000AA PORT=3404 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront start > <scratchpad>/tat65b-start.log 2>&1`. Wait until its log shows it listening on 3404 (use Monitor or a background wait, never a foreground `sleep`), and note the PID of the `node … .output/server/index.mjs` process (`pgrep -af "output/server/index.mjs"`).

Set a mode with `echo '{"get":"due","post":"201"}' > <scratchpad>/tat65b-mode` (any mode below the same way). The link is `http://demo-studio.localhost:3404/deposit#tat65b-browser-pass-token-0123456789abcdefg`.

- [ ] **Step 3: Curl checks**

With `-H 'Host: demo-studio.localhost:3404'` on each request to `http://127.0.0.1:3404` (use `http://[::1]:3404` if it refuses 127.0.0.1):
- `curl -sD - -o <scratchpad>/tat65b-deposit.html …/deposit`: 200, `cache-control: no-store`, `referrer-policy: no-referrer`, `x-robots-tag: noindex, nofollow`; the HTML has the title "Pay your deposit · Demo Studio", `aria-busy="true"`, and no `deposits/`.
- `curl -s …/ -o <scratchpad>/tat65b-studio.html`, then `rg -c "<file name of the chunk holding Send screenshot>" <scratchpad>/tat65b-studio.html`: no match (the studio page doesn't preload the deposit page's chunk).
- The fake API's log so far has only `GET /api/v1/tenants/demo-studio … key=yes` lines.

- [ ] **Step 4: The pass in a browser**

Use the Chrome tool if one is connected; else Playwright 1.63 from the main checkout, read-only, as TAT-48's harness did (`createRequire("/home/blank/Coding/tattoo-drip/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/")`, `chromium.launch()`, a context with `viewport: { width: 375, height: 812 }`, `page.on("request", …)` to record every URL and `referer` header); else write in the report that no browser ran and leave this list to the user. At 375×812, then 1280×800, light then dark:

1. **Due** (`{"get":"due"}`): the h1, the brief, "with मीना गुरुङ", "Deposit due", NPR 3,000, "Pay by 31 Dec 2026, in N days.", the code box, Copy code ("Copied" shows for 2 s; paste somewhere to check `7K3M9Q`), "How to pay" with the same-phone hint, eSewa's and Khalti's QR (the first loaded at once), the bank's details with Copy, the policy on two lines, the form. No horizontal scroll (`document.documentElement.scrollWidth <= window.innerWidth`). Screenshot.
2. **Keyboard only**: Tab reaches the copy buttons, the radios (arrows move between them), "Add screenshot" (Enter or Space opens the chooser; pick `tat65b-screenshot.png` with the tool's file upload), Send; the focus ring shows on each. After the pick the status says "Preparing your screenshot…", then "Screenshot added." and the preview shows; focus is still on the picker. Choose eSewa, Send: "Sending…", then the `submitted` message takes focus and says "received <today>, <time>". The fake API's log shows `method="esewa"`, `expectedAmount="300000"` and `proof=<image/jpeg payment.jpg … bytes 922x2048>`, never `HAS EXIF`; open `<scratchpad>/tat65b-upload.jpg`: the bottom strip is white.
3. **Send with nothing** (reload with `{"get":"due","post":"201"}`): the summary appears and takes focus with 2 items; each button moves focus to its control. Pick `tat65b-photo.heic`: the HEIC message naming the file. Pick `tat65b-huge.png`: "too big to prepare", and no decode stalls the tab. Pick the screenshot, then Remove: focus returns to the picker.
4. **Refusals** (each with the screenshot picked and eSewa chosen; set `post`, keep `get` `due` unless said): `422-proof` (the API's message under the picker and in the summary), `422-method` (under the radios), `409-changed` (the notice, and the amount becomes NPR 2,500 after the page is read again), `409-notdue` (the page becomes `submitted` and its message takes focus), `413` (TAT-65's 10 MB sentence under the picker), `429` (the notice says "Wait 20 minutes", Send stays `aria-disabled`), `500`, `hang` (with DevTools' network at "Slow 3G" or not: "Still sending…" after 15 s; after the SDK's 2 minutes, "Couldn't send…"; switch `get` to `submitted` before the 2 minutes end and check the page then shows `submitted`). Offline (DevTools offline): "Couldn't send. Check your connection and try again." at once, the screenshot kept.
5. **Every other state** (set `get`): `partial` (the part-paid line), `rejected` (the note above the form), `one-method` (eSewa already chosen), `no-methods` (the note, no form), `long-brief` (a closed "Your tattoo idea"), `submitted`, `paid`, `paid-zero`, `updating`, `expired`, `cancelled` (no payment details, the contact line), `404` (the dead-link message), `429`, `500` (after the retries, "We couldn't load your deposit…"; set `due`, press "Try again": the page shows). Screenshot each at 375 px.
6. **A 404 over the page**: load `due`, set `get` to `404`, switch to another tab and back: the dead-link message replaces the payment details.
7. **Broken links ask nothing**: open `/deposit` and `/deposit#short`: the dead-link message; the fake API's log has no `/deposits/` line for them.
8. **Old slug**: open `http://old-demo.localhost:3404/deposit#tat65b-browser-pass-token-0123456789abcdefg`: the browser lands on `demo-studio.localhost:3404/deposit#…` with the fragment and shows the deposit.
9. **The token goes nowhere else**: in the recorded requests (or DevTools' network panel), the token appears only in `/api/v1/tenants/demo-studio/deposits/<token>` URLs; no request has a `Referer` (the fake API's log says `referer=-` for every line, the QR images too); `<scratchpad>/tat65b-start.log` doesn't contain the token (`rg -c tat65b-browser-pass <scratchpad>/tat65b-start.log` finds nothing); after a reload and a visit to `/` and back, `JSON.stringify(sessionStorage)` and `JSON.stringify(localStorage)` in the console don't contain it; no request goes to any origin but `demo-studio.localhost:3404` and `127.0.0.1:3403` (nothing to `challenges.cloudflare.com`).
10. **Without JavaScript** (DevTools, disable JavaScript): the shell with the `<noscript>` line and the WhatsApp and Viber links.
11. Reduced motion (DevTools rendering, `prefers-reduced-motion: reduce`): the sending line doesn't move.

- [ ] **Step 5: Stop everything**

Stop the storefront and the fake API by their exact PIDs (`kill <pid>`). Never `pkill -f`. `git status -s` is clean (the scratchpad holds every file this pass made).

---

### Task 13: PR text (not committed)

- [ ] **Step 1: Write the PR text**

Write `<scratchpad>/pr3-tat-65b.md` (not committed). Say up front: storefront and docs only; no platform, contract, SDK or React change; no dependency, migration or new setting; one new route, `/deposit`. Then a few "what and why" bullets per part (mentor mode): the token in the fragment, read in the browser only, and everything that keeps it from anything but the API (the scroll key, no `#` links, no storage, no Referer, `no-store`, `noindex`); the shell rendered on the server from the cached lookup; the states and TAT-65's words; the screenshot through TAT-57's pipeline at 2048 px (`prepareImage` and its two profiles); sending and every refusal (the table in the spec), reading the page again so a lost 201 shows `submitted`; no polling; the same-phone QR hint and the in-app-browser Copy fallback. List the rulings that depart from TAT-65's page section (spec rulings 4, 6, 13, 14, 18) with their one-line reasons. Give the test counts (storefront, SDK, React, platform) against the baselines, the chunk sizes, the `check:page` result, and the browser pass (screenshots, the fake API log's fields and image size, what was not run and why). End with "Before any public deploy" from the spec (TAT-27, `STOREFRONT_URL`, `TRUST_PROXY`, the nginx regex location for `/deposits/`, a real-phone pass including Instagram's and Viber's in-app browsers) and "For the user": a Linear ticket for TAT-65b doesn't exist yet (this branch is named `harublank00/tat-65b-storefront-deposit-page`); open one if you want it tracked. Do not push and do not open a PR.

- [ ] **Step 2: Report**

Commits (hashes and subjects); the test counts against the baselines; the chunk sizes; the curl results; the browser pass or why it was skipped; any deviation from this plan with its reason.
