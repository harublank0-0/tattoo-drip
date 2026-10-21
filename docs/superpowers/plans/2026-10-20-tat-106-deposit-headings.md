# Deposit page: one heading per state and a receipt when paid (TAT-106)

> Instructions for the coding agent (opencode, deepseek-v4.1-flash-free). Do the tasks in order. In every task, write the test first, run it, check that it fails for the reason given, and only then change the code. Read `docs/agent-environment.md` first.

**Goal:** the client's deposit page (`/deposit#<token>`) always says "Pay your deposit to {studio}" in its `h1`, even after paying, and the paid state is one sentence with nothing else. After this plan the `h1` names the state ("Deposit paid", "Screenshot sent", "Your quote is being updated", "This quote has expired", "This booking was cancelled"), and the paid state also shows the deposit's amount and the reference code, as a receipt. About 1 point. UX audit findings D-1 and D-2.

**Scope:** only these files, and nothing else:

- `apps/storefront/src/deposit/copy.ts`
- `apps/storefront/src/deposit/view-model.ts`
- `apps/storefront/src/deposit/components/deposit-page.tsx`
- `apps/storefront/src/deposit/components/deposit-screen.tsx`
- `apps/storefront/test/deposit/view-model.test.ts`
- `apps/storefront/test/deposit/render.test.ts`
- `apps/storefront/test/deposit/load.test.ts`
- `apps/storefront/test/deposit/providers.tsx` (new)

No styles (`styles.css`), no route, no `head-copy.ts` or `seo.ts`, no documentation, no `package.json`, no new dependency, no platform, API, SDK or types change. Never edit a generated file (`apps/storefront/src/routeTree.gen.ts`, `packages/types/src/openapi.gen.ts`).

**STOP rule:** if a test fails for a reason this plan does not give, or a "Find" text below is not in the file exactly once, stop. Do not improvise and do not change any other file. Never weaken, skip or delete an existing test; the only existing test this plan changes is the one named in Task 3, exactly as shown. Write what you saw under "Findings" at the bottom of this file (the command, the test name, expected and actual) and report it.

## Facts already verified on this branch (do not redo them)

- The API's `DepositState` (`packages/types/src/openapi.gen.ts`, `DepositPage.state`) has six values, decided by the platform (`apps/platform/app/modules/payments/deposit_page.ts`): `cancelled` first, then `paid` (nothing left to pay), `submitted` (a screenshot waits), `due`, `expired`, else `updating`. The storefront treats a value it doesn't know as `updating` (`depositView`).
- The ticket's five headings map one to one onto the five states other than `due` (same names, same meaning). The table also shows what the code has beyond the ticket: the loading shell, the load problems, `due` itself, and `paid` with a zero deposit:

| What the page shows | Code | `h1` today | `h1` after this plan | Message under it (unchanged) | Below the message |
|---|---|---|---|---|---|
| Server shell and loading | no token read yet, or `screen.kind === "loading"` | Pay your deposit to {studio} | unchanged | skeleton | |
| Broken link, rate limit, failed load | token `null`, or `screen.kind === "problem"` | Pay your deposit to {studio} | unchanged (not in the ticket) | `copy.load.*` | |
| Due | `due` | Pay your deposit to {studio} | unchanged | the due blocks and the form | |
| Screenshot sent | `submitted` | Pay your deposit to {studio} | **Screenshot sent** | `copy.states.submitted` | Amount (`dueText`) and Reference code, as today |
| Deposit paid | `paid` with `deposit.amount > 0` | Pay your deposit to {studio} | **Deposit paid** | `copy.states.paid` | **new:** Amount (`amountText`) and Reference code |
| No deposit needed | `paid` with `deposit.amount === 0` | Pay your deposit to {studio} | **No deposit needed** (new string: "Deposit paid" would not match its message) | `copy.states.paidNone` | nothing |
| Quote being updated | `updating` | Pay your deposit to {studio} | **Your quote is being updated** | `copy.states.updating` | |
| Quote expired | `expired` | Pay your deposit to {studio} | **This quote has expired** | `copy.states.expired` | |
| Booking cancelled | `cancelled` | Pay your deposit to {studio} | **This booking was cancelled** | `copy.states.cancelled` | |

- The paid payload already has what the receipt needs; no API change. The platform sends `deposit.amountText` = the current quote's deposit and `deposit.dueText` = what is still to pay, which is "NPR 0" once paid (`apps/platform/app/transformers/public_deposit_transformer.ts`). So the receipt shows `amountText`, never `dueText`. `referenceCode` is sent in every state.
- The state messages keep their words. They are TAT-65's sentences, pinned by `test/deposit/copy.test.ts` ("keeps the TAT-65 spec's words"), and each must make sense alone: it is what the polite live region announces when the state changes, and where focus moves after the client's Send. So "This quote has expired" appears in the `h1` and again at the start of its message; that is expected.
- The `h1` is in `DepositFrame` (`components/deposit-page.tsx`), which `DepositScreen` renders around everything, while the state is only known inside `DepositLoaded` (`components/deposit-screen.tsx`). Task 4 moves the frame: `DepositScreen` draws it for the shell and the broken link, and `DepositLoaded` draws it itself, with the deposit. The server-rendered shell stays byte for byte the same (`test/deposit/screen.test.ts` checks it).
- The browser tab's title stays "Pay your deposit · {studio}" (`head-copy.ts`): it is written on the server, which never sees the token. Do not change it.
- Every new string goes in `copy.ts` (`copy.headings`), as plain short English that a Nepali copy file could mirror; no English text inside components.
- Test command: the storefront suite runs as one command (about 10 seconds), and it is the only test command you may run:
  `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`.
  Extra arguments do not narrow it. Read the `ℹ tests`, `ℹ pass` and `ℹ fail` lines at the end, and the "✖ failing tests:" list above them. When a test fails, pnpm also prints `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`; that is normal in the red step.
- A test file that imports a name the source doesn't export yet fails as a whole: it counts as 1 failed test and its other tests don't run. The red counts below include that.
- The baseline on this branch: 587 tests, 587 pass; storefront typecheck clean; `pnpm check` exits 0 with 2 warnings in platform files (`apps/platform/inertia/ssr.tsx`, `apps/platform/inertia/types.ts`); leave them.
- The pre-commit hook runs Biome on the staged files and may rewrite them. Read a file again before editing it after a commit.

## Rules that must still hold (`apps/storefront/docs/development.md`, "Deposit page") and the tests that guard them

You only add tests. The one existing assertion that changes is in Task 3, exactly as shown. All of these must pass at the end:

1. The token lives only in the URL's fragment and the API's path: never in a query string, a log, storage or the page's HTML. Guard: `test/deposit/guard.test.ts` ("nothing on the deposit page stores, logs, tracks or reads the query"), `test/deposit/screen.test.ts` (the server renders the shell only).
2. No in-page `#` link anywhere on the page (following one replaces the token); use buttons. Guard: `guard.test.ts` ("no in-page fragment link"), `render.test.ts` ("everywhere": only allowed links, none to a fragment, no `style` or `target`).
3. Only `components/deposit-screen.tsx` reads `location.hash`. Guard: `guard.test.ts` ("only the screen reads the fragment"). Keep `useLocationHash` where it is.
4. The token's format and the router's scroll key are unchanged. Guard: `test/deposit/token.test.ts`.
5. `noindex`, `no-store` and `no-referrer`, and the head imports only `head-copy.ts`. Guard: `test/deposit/seo.test.ts`, `guard.test.ts` ("the head (seo.ts) imports only the head strings"), `copy.test.ts` ("the head strings": exactly four keys). Do not touch `seo.ts` or `head-copy.ts`.
6. Imports only from React, `@tattoo-drip/react`, `@tattoo-drip/sdk`, `@tanstack/react-form`, `lucide-react` and relative paths; no analytics, no error reporter, nothing natively `disabled`, no `dangerouslySetInnerHTML`. Guard: `guard.test.ts`.
7. Names inside sentences go in `<bdi>` through `<Fill>`; one `h1` on the page. Guard: `render.test.ts` ("one h1 naming the studio in <bdi>"), `screen.test.ts`.
8. The state message stays focusable (`tabIndex={-1}`, the `ref`), inside the polite live region; focus moves only after the client's own action. Guard: `render.test.ts` ("each state's message, focusable…", "the state region").
9. TAT-65's words and the placeholders. Guard: `copy.test.ts`.

## Task 0: Preconditions

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`. Use that PATH prefix for every `pnpm` command below.
- [ ] `git branch --show-current` prints `harublank00/tat-106-deposit-page-one-heading-per-state-and-a-receipt-when-paid`; `git status --short` prints nothing.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test` ends with `ℹ tests 587`, `ℹ pass 587`, `ℹ fail 0`.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck` prints no error.
- [ ] Read these files once, whole: `apps/storefront/src/deposit/copy.ts`, `view-model.ts`, `components/deposit-page.tsx`, `components/deposit-screen.tsx`, and `apps/storefront/test/deposit/render.test.ts`, `load.test.ts`, `view-model.test.ts`, `fixtures.ts`, `html.ts`.

## Task 1: The heading words and `headingTemplate`

Every edit below is "Find" (the exact text, which is in the file once) and "Replace with". The code uses tabs, like the files.

### 1a. The failing test

**Edit 1.1** `apps/storefront/test/deposit/view-model.test.ts`. Find:

```ts
	formatReceived,
	payByLine,
```

Replace with:

```ts
	formatReceived,
	headingTemplate,
	payByLine,
```

**Edit 1.2** `apps/storefront/test/deposit/view-model.test.ts`. Find:

```ts
describe("depositContact", () => {
```

Replace with:

```ts
describe("headingTemplate", () => {
	test("the page's h1 names the state; before the deposit is read, and while it is due, it names the studio", () => {
		const view = (state: (typeof PAGE)["state"], amount = 300_000) => ({
			state,
			amount,
		});
		assert.equal(headingTemplate(null), "Pay your deposit to {studio}");
		assert.equal(headingTemplate(view("due")), "Pay your deposit to {studio}");
		assert.equal(headingTemplate(view("submitted")), "Screenshot sent");
		assert.equal(headingTemplate(view("paid")), "Deposit paid");
		assert.equal(headingTemplate(view("paid", 0)), "No deposit needed");
		assert.equal(
			headingTemplate(view("updating")),
			"Your quote is being updated",
		);
		assert.equal(headingTemplate(view("expired")), "This quote has expired");
		assert.equal(
			headingTemplate(view("cancelled")),
			"This booking was cancelled",
		);
	});
});

describe("depositContact", () => {
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 571`, `ℹ pass 570`, `ℹ fail 1`. The "✖ failing tests:" list names only `✖ test/deposit/view-model.test.ts` ('test failed'), and higher up the output says `SyntaxError: The requested module '../../src/deposit/view-model.ts' does not provide an export named 'headingTemplate'`. Any other failure: STOP.

### 1b. The code

**Edit 1.3** `apps/storefront/src/deposit/copy.ts`. Find:

```ts
	heading: "Pay your deposit to {studio}",
```

Replace with:

```ts
	heading: "Pay your deposit to {studio}",
	/** The h1 once the deposit has left `due` (TAT-106); each says what its state's message says. */
	headings: {
		submitted: "Screenshot sent",
		paid: "Deposit paid",
		paidNone: "No deposit needed",
		updating: "Your quote is being updated",
		expired: "This quote has expired",
		cancelled: "This booking was cancelled",
	},
```

**Edit 1.4** `apps/storefront/src/deposit/view-model.ts`. Find:

```ts
/** The studio's chat links on every state (spec ruling 9). */
```

Replace with:

```ts
/**
 * The page's one h1 (TAT-106): what the state's message says, in a few
 * words. Before the deposit is read (`null`: loading, or a link that doesn't
 * work) and while it is due, it asks to pay the studio.
 */
export function headingTemplate(
	view: Pick<DepositView, "state" | "amount"> | null,
): string {
	if (view === null) return copy.heading;
	switch (view.state) {
		case "due":
			return copy.heading;
		case "submitted":
			return copy.headings.submitted;
		case "paid":
			return view.amount === 0 ? copy.headings.paidNone : copy.headings.paid;
		case "updating":
			return copy.headings.updating;
		case "expired":
			return copy.headings.expired;
		case "cancelled":
			return copy.headings.cancelled;
	}
}

/** The studio's chat links on every state (spec ruling 9). */
```

- [ ] Run the storefront tests. Expected: `ℹ tests 588`, `ℹ pass 588`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/deposit/copy.ts apps/storefront/src/deposit/view-model.ts apps/storefront/test/deposit/view-model.test.ts
git commit -m "feat(storefront): add a heading for each deposit state (TAT-106)" -m "copy.headings has one short heading per state after due; headingTemplate picks it." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 2: The frame's `h1` follows the state

### 2a. The failing test

**Edit 2.1** `apps/storefront/test/deposit/render.test.ts`. Find:

```ts
import { depositContact, depositView } from "../../src/deposit/view-model.ts";
```

Replace with:

```ts
import {
	type DepositView,
	depositContact,
	depositView,
} from "../../src/deposit/view-model.ts";
```

**Edit 2.2** `apps/storefront/test/deposit/render.test.ts`. Find:

```ts
	test("loading: a skeleton marked busy, words for screen readers, a no-JavaScript line", () => {
```

Replace with:

```ts
	test("the h1 names the deposit's state once it is read, and the studio before that and while due (TAT-106)", () => {
		const h1 = (view: DepositView | null) => {
			const html = render(
				createElement(DepositFrame, { studioName: STUDIO, view }),
			);
			assert.equal(tags(html, "h1").length, 1);
			return textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "");
		};
		const nothingDue = {
			...PAGE.deposit,
			amount: 0,
			amountText: "NPR 0",
			due: 0,
			dueText: "NPR 0",
		};
		assert.equal(h1(null), "Pay your deposit to Black Needle");
		assert.equal(h1(depositView(PAGE)), "Pay your deposit to Black Needle");
		assert.equal(
			h1(depositView(page({ state: "submitted" }))),
			"Screenshot sent",
		);
		assert.equal(h1(depositView(page({ state: "paid" }))), "Deposit paid");
		assert.equal(
			h1(depositView(page({ state: "paid", deposit: nothingDue }))),
			"No deposit needed",
		);
		assert.equal(
			h1(depositView(page({ state: "updating" }))),
			"Your quote is being updated",
		);
		assert.equal(
			h1(depositView(page({ state: "expired" }))),
			"This quote has expired",
		);
		assert.equal(
			h1(depositView(page({ state: "cancelled" }))),
			"This booking was cancelled",
		);
	});

	test("loading: a skeleton marked busy, words for screen readers, a no-JavaScript line", () => {
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 589`, `ℹ pass 588`, `ℹ fail 1`. The failing test is "the h1 names the deposit's state once it is read, and the studio before that and while due (TAT-106)", with `+ 'Pay your deposit to Black Needle'` (actual) and `- 'Screenshot sent'` (expected): the frame ignores `view` so far. Any other failure: STOP.

### 2b. The code

**Edit 2.3** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```ts
	type DepositView,
	type MethodView,
```

Replace with:

```ts
	type DepositView,
	headingTemplate,
	type MethodView,
```

**Edit 2.4** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```tsx
/** Around every state: one h1 naming the studio, and who runs the page. */
export function DepositFrame({
	studioName,
	children,
}: {
	studioName: string;
	children?: ReactNode;
}) {
	return (
		<>
			<main className="deposit">
				<h1 className="deposit-title">
					<Fill template={copy.heading} values={{ studio: studioName }} />
				</h1>
```

Replace with:

```tsx
/**
 * Around every state: one h1, and who runs the page. The h1 names the
 * deposit's state once it is read (TAT-106); before that, and while it is
 * due, it asks to pay the studio (headingTemplate).
 */
export function DepositFrame({
	studioName,
	view = null,
	children,
}: {
	studioName: string;
	/** The deposit, once read; null (or left out) while it loads and for a link that doesn't work. */
	view?: Pick<DepositView, "state" | "amount"> | null;
	children?: ReactNode;
}) {
	return (
		<>
			<main className="deposit">
				<h1 className="deposit-title">
					<Fill
						template={headingTemplate(view)}
						values={{ studio: studioName }}
					/>
				</h1>
```

- [ ] Run the storefront tests. Expected: `ℹ tests 589`, `ℹ pass 589`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/deposit/components/deposit-page.tsx apps/storefront/test/deposit/render.test.ts
git commit -m "feat(storefront): let the deposit frame's h1 name the deposit's state (TAT-106)" -m "DepositFrame takes the read deposit; without it the h1 still asks to pay the studio." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 3: The paid receipt

The paid state repeats the deposit's amount (`amountText`) and the reference code, in the same list markup `submitted` already uses. Not when no deposit was needed (`amount` 0). One existing test changes here, and only as shown: "each state's message, focusable, in the studio's name" asserted that no state message has a `<dl>`; now it asserts exactly one `<dl>` for the paid case and none for the others (this is stricter, not weaker).

### 3a. The failing tests

**Edit 3.1** `apps/storefront/test/deposit/view-model.test.ts`. Find:

```ts
	payByLine,
	stateTemplate,
```

Replace with:

```ts
	payByLine,
	receiptAmount,
	stateTemplate,
```

**Edit 3.2** `apps/storefront/test/deposit/view-model.test.ts`. Find:

```ts
describe("depositContact", () => {
```

Replace with:

```ts
describe("receiptAmount", () => {
	test("submitted repeats what was sent, a paid deposit its amount; nothing otherwise (TAT-106)", () => {
		const amount = (state: (typeof PAGE)["state"], deposit = PAGE.deposit) =>
			receiptAmount(depositView(page({ state, deposit })));
		const partPaid = { ...PAGE.deposit, due: 100_000, dueText: "NPR 1,000" };
		const paidUp = { ...PAGE.deposit, due: 0, dueText: "NPR 0" };
		const nothingDue = {
			...PAGE.deposit,
			amount: 0,
			amountText: "NPR 0",
			due: 0,
			dueText: "NPR 0",
		};
		assert.equal(amount("submitted", partPaid), "NPR 1,000");
		assert.equal(amount("paid", paidUp), "NPR 3,000");
		assert.equal(amount("paid", nothingDue), null);
		for (const state of ["due", "updating", "expired", "cancelled"] as const) {
			assert.equal(amount(state), null, state);
		}
	});
});

describe("depositContact", () => {
```

**Edit 3.3** `apps/storefront/test/deposit/render.test.ts` (the one existing test that changes, and a new test after it). Find:

```ts
			assert.match(message[0], /tabindex="-1"/i);
			assert.doesNotMatch(html, /<dl/);
		}
	});
```

Replace with:

```ts
			assert.match(message[0], /tabindex="-1"/i);
			const receipt =
				overrides.state === "paid" && overrides.deposit === undefined;
			assert.equal(
				tags(html, "dl").length,
				receipt ? 1 : 0,
				String(overrides.state),
			);
		}
	});

	test("paid is a receipt: the deposit's amount and the reference code (TAT-106)", () => {
		const html = stateHtml({
			state: "paid",
			deposit: { ...PAGE.deposit, due: 0, dueText: "NPR 0" },
		});
		const text = textOf(html);
		assert.match(text, /^Your deposit is paid\. Thank you!/);
		assert.equal(tags(html, "dl").length, 1);
		assert.match(html, /<dt>Amount<\/dt><dd translate="no">NPR 3,000<\/dd>/);
		assert.match(text, /Reference code7K3M9Q/);
		assert.doesNotMatch(text, /NPR 0/);
	});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 573`, `ℹ pass 570`, `ℹ fail 3`. The three failures are exactly:
  1. "each state's message, focusable, in the studio's name": `AssertionError [ERR_ASSERTION]: paid` with `0 !== 1`;
  2. "paid is a receipt: the deposit's amount and the reference code (TAT-106)": `0 !== 1`;
  3. `✖ test/deposit/view-model.test.ts` ('test failed'); higher up the output says `SyntaxError: The requested module '../../src/deposit/view-model.ts' does not provide an export named 'receiptAmount'`.
  Any other failure: STOP.

### 3b. The code

**Edit 3.4** `apps/storefront/src/deposit/view-model.ts`. Find:

```ts
/** The studio's chat links on every state (spec ruling 9). */
```

Replace with:

```ts
/**
 * The amount the state message shows with the reference code: what was sent
 * for `submitted`; for `paid`, the deposit as a receipt (TAT-106; its `due`
 * is then 0). Null for the other states and when no deposit was needed.
 */
export function receiptAmount(
	view: Pick<DepositView, "state" | "amount" | "amountText" | "dueText">,
): string | null {
	if (view.state === "submitted") return view.dueText;
	if (view.state === "paid" && view.amount > 0) return view.amountText;
	return null;
}

/** The studio's chat links on every state (spec ruling 9). */
```

**Edit 3.5** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```ts
	payByLine,
	stateTemplate,
} from "../view-model.ts";
```

Replace with:

```ts
	payByLine,
	receiptAmount,
	stateTemplate,
} from "../view-model.ts";
```

**Edit 3.6** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```tsx
/** Every state but `due`: its sentence (focusable: focus moves here after a send), and for `submitted` the amount and code. */
```

Replace with:

```tsx
/** Every state but `due`: its sentence (focusable: focus moves here after a send), and for `submitted` and a paid deposit the amount and code (receiptAmount). */
```

**Edit 3.7** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```tsx
	ref?: Ref<HTMLParagraphElement>;
}) {
	return (
		<div className="deposit-state">
```

Replace with:

```tsx
	ref?: Ref<HTMLParagraphElement>;
}) {
	const amount = receiptAmount(view);
	return (
		<div className="deposit-state">
```

**Edit 3.8** `apps/storefront/src/deposit/components/deposit-page.tsx`. Find:

```tsx
			{view.state === "submitted" ? (
				<dl className="deposit-details">
					<dt>{copy.states.amount}</dt>
					<dd translate="no">{view.dueText}</dd>
```

Replace with:

```tsx
			{amount !== null ? (
				<dl className="deposit-details">
					<dt>{copy.states.amount}</dt>
					<dd translate="no">{amount}</dd>
```

- [ ] Run the storefront tests. Expected: `ℹ tests 591`, `ℹ pass 591`, `ℹ fail 0`.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/deposit/view-model.ts apps/storefront/src/deposit/components/deposit-page.tsx apps/storefront/test/deposit/view-model.test.ts apps/storefront/test/deposit/render.test.ts
git commit -m "feat(storefront): show the amount and reference code when the deposit is paid (TAT-106)" -m "The paid message is followed by the deposit's amount and its code, like a receipt." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 4: The loaded page draws its own frame

So far nothing passes the deposit to the frame: `DepositScreen` draws the frame without it. Now `DepositScreen` draws the frame only for the shell and the broken link, and `DepositLoaded` draws it itself, with the deposit it read. The test renders `DepositLoaded` with the deposit already in the query's cache, so nothing is fetched.

### 4a. The failing test

**New file** `apps/storefront/test/deposit/providers.tsx` (create it with exactly this content):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TattooProvider, tattooKeys } from "@tattoo-drip/react";
import type { DepositPage, TattooClient } from "@tattoo-drip/sdk";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `element` rendered as the page renders it once the deposit of `token` has
 * been read: `page` is already in the query's cache, so nothing is fetched.
 */
export function renderWithDeposit(
	client: TattooClient,
	token: string,
	page: DepositPage,
	element: ReactElement,
): string {
	const queryClient = new QueryClient();
	queryClient.setQueryData(tattooKeys.deposit(client.tenant, token), page);
	return renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<TattooProvider client={client}>{element}</TattooProvider>
		</QueryClientProvider>,
	);
}
```

**Edit 4.1** `apps/storefront/test/deposit/load.test.ts`. Find:

```ts
import { createTattooClient } from "@tattoo-drip/sdk";
```

Replace with:

```ts
import { createTattooClient, type DepositPage } from "@tattoo-drip/sdk";
```

**Edit 4.2** `apps/storefront/test/deposit/load.test.ts`. Find:

```ts
import { SHELL, TOKEN } from "./fixtures.ts";
import { attr, tags, textOf } from "./html.ts";
```

Replace with:

```ts
import { PAGE, page, SHELL, TOKEN } from "./fixtures.ts";
import { attr, tags, textOf } from "./html.ts";
import { renderWithDeposit } from "./providers.tsx";
```

**Edit 4.3** `apps/storefront/test/deposit/load.test.ts`: add this at the very end of the file, after the last line (`});`), with one empty line between:

```ts
/** The loaded screen once the deposit has been read (TAT-106). */
const readHtml = (deposit: DepositPage) =>
	renderWithDeposit(
		createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-48",
			fetch: () => Promise.reject(new Error("no request during a render")),
		}),
		TOKEN,
		deposit,
		createElement(DepositLoaded, { token: TOKEN, shell: SHELL }),
	);

describe("the screen once the deposit is read (TAT-106)", () => {
	test("its one h1 names the state, above that state's message", () => {
		const h1 = (html: string) => {
			assert.equal(tags(html, "h1").length, 1);
			return textOf(/<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1] ?? "");
		};
		// Due without payment methods: no screenshot form (rendering one keeps the process alive for 5 s).
		const due = readHtml(page({ paymentMethods: [] }));
		assert.equal(h1(due), "Pay your deposit to Black Needle");
		assert.match(textOf(due), /Deposit due/);

		const paid = readHtml(
			page({
				state: "paid",
				deposit: { ...PAGE.deposit, due: 0, dueText: "NPR 0" },
			}),
		);
		assert.equal(h1(paid), "Deposit paid");
		assert.match(textOf(paid), /Your deposit is paid\. Thank you!/);
		assert.match(textOf(paid), /AmountNPR 3,000Reference code7K3M9Q/);

		const expired = readHtml(page({ state: "expired" }));
		assert.equal(h1(expired), "This quote has expired");
		assert.match(
			textOf(expired),
			/This quote has expired\. Message Black Needle if you still want to book\./,
		);
		assert.match(textOf(expired), /You pay Black Needle directly\./);
	});
});
```

- [ ] Run the storefront tests. Expected red: `ℹ tests 592`, `ℹ pass 591`, `ℹ fail 1`. The failing test is "its one h1 names the state, above that state's message", with `0 !== 1`: `DepositLoaded` has no `h1` yet. Any other failure: STOP.

### 4b. The code

**Edit 4.4** `apps/storefront/src/deposit/components/deposit-screen.tsx`. Find:

```tsx
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
```

Replace with:

```tsx
/**
 * The deposit page (TAT-65b): the token from the fragment (spec ruling 3),
 * then the page from useDeposit. A missing or malformed token is the
 * dead-link message, with no request. With a token, DepositLoaded draws the
 * frame itself, so its h1 can name the deposit's state (TAT-106).
 */
export function DepositScreen({ shell }: { shell: DepositShell }) {
	const hash = useLocationHash();
	const token = hash === undefined ? undefined : readDepositToken(hash);
	if (typeof token === "string") {
		return <DepositLoaded key={token} token={token} shell={shell} />;
	}
	const contact = depositContact(shell, null);
	return (
		<DepositFrame studioName={shell.studioName}>
			{token === undefined ? (
				<DepositLoading studioName={shell.studioName} />
			) : (
				<LoadProblemView problem="dead" />
			)}
			<ContactLine studioName={shell.studioName} contact={contact} />
		</DepositFrame>
	);
}
```

**Edit 4.5** `apps/storefront/src/deposit/components/deposit-screen.tsx`. Find:

```tsx
	return (
		<>
			{view ? <DepositIntro view={view} /> : null}
```

Replace with:

```tsx
	return (
		<DepositFrame studioName={shell.studioName} view={view}>
			{view ? <DepositIntro view={view} /> : null}
```

**Edit 4.6** `apps/storefront/src/deposit/components/deposit-screen.tsx`. Find:

```tsx
				contact={depositContact(shell, view?.referenceCode || null)}
			/>
		</>
	);
}
```

Replace with:

```tsx
				contact={depositContact(shell, view?.referenceCode || null)}
			/>
		</DepositFrame>
	);
}
```

- [ ] Run the storefront tests. Expected: `ℹ tests 592`, `ℹ pass 592`, `ℹ fail 0`. `test/deposit/screen.test.ts` ("the server renders the shell only…") must still pass unchanged: it proves the server-rendered page is the same as before.
- [ ] Run the storefront typecheck: no error.
- [ ] Commit:

```bash
git add apps/storefront/src/deposit/components/deposit-screen.tsx apps/storefront/test/deposit/load.test.ts apps/storefront/test/deposit/providers.tsx
git commit -m "feat(storefront): pass the loaded deposit to the frame so its heading names the state (TAT-106)" -m "DepositLoaded draws the frame itself; the server's shell and the broken link are unchanged." -m "Assisted-by: opencode (deepseek-v4.1-flash-free)"
```

- [ ] `git status --short` prints nothing.

## Task 5: Gates and finish

- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`: `ℹ tests 592`, `ℹ pass 592`, `ℹ fail 0` (587 before, plus 5 new tests: headingTemplate, the frame's h1, receiptAmount, the paid receipt, the loaded screen's h1).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`: no error.
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check` from the repository root: exit 0, `Found 2 warnings.` (the same two platform warnings as before; nothing in `apps/storefront`).
- [ ] `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`: ends with `Client bundle check: 10 files in .output/public, no server-only text.` (the build output is gitignored).
- [ ] `git status --short` prints nothing. `git diff --stat HEAD~4` lists only the eight files in "Scope" above. `git log --oneline -6` shows your four commits on top of the plan commit.
- [ ] Do NOT push and do NOT open a pull request. Write your result as your final message: the test counts (587 before, 592 after), the four commit hashes, the red output you saw in each task, and anything you could not do.

## Manual browser check (for the coordinator, after the build; not for the coding agent)

At 375 px (DevTools), with the storefront dev server and deposit links in each state:

1. Due: the `h1` still reads "Pay your deposit to {studio}"; nothing else changed.
2. Send a screenshot: the `h1` becomes "Screenshot sent", focus lands on the message, which is read once; Amount and Reference code show as before.
3. Paid (verify the payment on the dashboard, then return to the tab: it refetches on focus): `h1` "Deposit paid", "Your deposit is paid. Thank you!", then Amount (the deposit, not "NPR 0") and Reference code; the WhatsApp link's message carries the code.
4. Updating (revise the quote), expired, cancelled: each `h1` matches its message. Expired and cancelled repeat their `h1` as the message's first sentence: judge whether that reads well.
5. A broken link (`/deposit#nonsense`): unchanged, "Pay your deposit to {studio}" over "This link doesn't work any more…".
6. Unchanged token rules: no request but the API's carries the token, nothing in storage, no `#` link, the tab title is still "Pay your deposit · {studio}"; no flash of the frame right after the page loads (Task 4 makes the frame mount once more after hydration, with the same content).
7. `pnpm --filter @tattoo-drip/storefront check:page` after the build (opencode needs approval for it; it passed on the planner's prototype).

## Findings

Planner's notes, verified before writing this plan (for the coordinator; the coding agent leaves them as they are):

- The data for the receipt was already there: `deposit.amountText` (the current quote's deposit) and `referenceCode`. The receipt is that and no more. The payload has no date paid, payment method, total of verified payments or session; the session (date, time, artist) is TAT-110 (WP-13, contract change), the rest would need a contract change too.
- The receipt's amount is the current quote's deposit, not the sum the studio verified (they are equal unless a revision lowered the deposit after a larger payment).
- The `h1` no longer names the studio once the deposit has left `due`; the studio is still named in the footer, the contact line and the tab title.
- Left as they were, outside the ticket: the broken-link, rate-limit and failed-load screens keep "Pay your deposit to {studio}" over their message (a candidate for TAT-110 or a follow-up); the tab title stays "Pay your deposit · {studio}" in every state (the server can't see the state).
- Rendering the due page's screenshot form in a node test keeps the process alive about 5 s (`test/deposit/form.test.ts` already does); the new screen test avoids it by rendering due without payment methods.
- The prototype of this plan passed: 592 tests, typecheck, `pnpm check` (2 warnings), `pnpm build` and `pnpm check:page`.

Coding agent:

(none yet)
