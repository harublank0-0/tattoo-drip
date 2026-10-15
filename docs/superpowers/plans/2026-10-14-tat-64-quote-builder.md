# Quote builder (TAT-64) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff quote a project (fixed or hourly, deposit, expiry), revise it, mark it accepted, and send it by one tap; the project's status follows, and an expired quote cancels a project that was never accepted or never paid.

**Architecture:** Two services in the projects module: `QuoteService` (quote rows, no outside dependencies; `DepositService` reads through it) and `ProjectService` (project lookup with the artist rule, and the issue, accept and expire moves, using `QuoteService`, `DepositService` and `SessionService`). A delayed `ExpireQuoteJob` (a `TenantJob`) is queued in the issuing transaction and re-checks everything under the project row lock. Three Inertia routes and one page (`projects/show`). No migration, no API.

**Tech Stack:** AdonisJS 7, Lucid (PostgreSQL, RLS), VineJS, `@adonisjs/queue` (database driver), Luxon, Inertia + React, shadcn/ui, Japa.

**Spec:** `docs/superpowers/specs/2026-10-14-tat-64-quote-builder-design.md`

## Global Constraints

- Money is stored as integer paisa; the form takes whole rupees; the currency is always `NPR`.
- Validator caps: fixed price 1 to 10,000,000 rupees; hourly rate 1 to 100,000 rupees an hour; estimated hours 0.25 to 100 in steps of 0.25 (stored as whole minutes); deposit 0 to the total, whole rupees; last valid day from today to one year ahead in the tenant's timezone.
- `expires_at` is the start of the day after the chosen date in the tenant's timezone. A quote is expired when now ≥ `expires_at`. The form's default is 14 days from today.
- No drafts: saving issues the next version, and `created_at` is the issue time. No migration. No API, SDK or OpenAPI changes.
- Quotable statuses: `reviewing`, `quoted`, `on_hold`, `deposit_pending`; issuing moves the project to `quoted`. Anything else: `QuoteRuleError("project_closed")`.
- Accept: only from `quoted`, only the current quote (`quote_changed` otherwise), only before expiry (`expired`); moves to `deposit_pending`, then `SessionService.settleBooking` in the same transaction.
- Expiry cancels `quoted` and `on_hold`, and `deposit_pending` when `DepositService.isSettled` is false; it cancels the project's `scheduled` sessions first. Anything else is a no-op.
- Access: owners see every live project; an artist only projects whose `artist_id` is their own live artist profile (`user_id`). Anything else is E_ROW_NOT_FOUND (404).
- Flash texts, verbatim: `project_closed` "This project can no longer be quoted.", `not_quoted` "This project is not waiting for the client's answer.", `quote_changed` "The quote changed: check the new version.", `expired` "This quote has expired: revise it first."; successes "Quote issued.", "Quote revised (version N).", "Accepted: waiting for the deposit.", "Accepted and booked."
- Chat message, verbatim shape: "Hi {first name}, here is your quote from {studio}: {price}. Deposit: {amount}. Valid until {d LLL yyyy}. Reply here to confirm." A zero deposit reads "No deposit needed."; an hourly price reads "NPR 3,000/hour × about 5 h ≈ NPR 15,000".
- `@inject()` dependencies are value imports with the `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.` comment. Every query is scoped by `tenant_id`.
- Commands run from `apps/platform` unless stated. Tests use `PORT=3402` (another dev server holds 3333). Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder.

## Deviations from the spec (decided while planning)

1. **Page props are built in the controller** (the `ArtistsController.toProps` pattern) with the tested pure helpers from `quotes.ts`, not a transformer: the only transformer in the app is the shared `UserTransformer`, and every page builds its props in its controller.
2. **The default deposit is suggested in the browser** (`suggestedDeposit` in `inertia/components/projects.ts`): it depends on the price being typed. There is no frontend test runner, so it is checked in the browser pass; the server still enforces deposit ≤ total.
3. **Viber gets no prefilled text.** Viber's documented `viber://chat?number=` link has no text parameter (the only prefill is for bot links). The Viber button opens the chat, and a **Copy message** button copies the text.
4. **Routes use `:id`**, not `:project`: the isolation harness only substitutes `:id`.
5. **`acceptQuote` returns the project's new status**, so the flash can say "Accepted and booked." when `settleBooking` booked it.
6. **Money shows South Asian grouping** (`en-IN`): "NPR 1,50,000".
7. **No separate "job fails without tenantId" test**: `TenantJob` already has it (`tests/functional/queue/tenant_job.spec.ts`).

## Review Focus

1. Two staff on one project: one revises while the other taps "Client accepted" on the old version; the accept must fail with "quote changed", never accept a quote nobody showed. (Task 6 service test, Task 8 HTTP test.)
2. Rupee fields typed with separators or decimals ("15,000", "1500.5"): a field error, not a 500 and not a silently rounded price. (Task 3.)
3. A client with no phone (anonymized): the page renders without chat links instead of crashing on `null`. (Task 7.)
4. An expired current quote: the page says "Expired", offers no accept button and no message, and still lets staff revise. (Task 7.)
5. A late-night date in the studio's timezone (server in UTC, studio UTC+5:45): the studio's "today" is accepted and its "yesterday" refused, whatever the server's date. (Task 3.)

---

## Before Task 1: preconditions

- [ ] **PR #17 (TAT-36) is merged.** `ProjectService` needs `SessionService` and `DepositService`. Check: `gh pr view 17 --json state -q .state` prints `MERGED`. If not, stop and tell the user.

- [ ] **Rebase this branch onto the new main and fix its upstream.**

```bash
cd /home/blank/Coding/tattoo-drip
git fetch origin
git switch harublank00/tat-64-quote-builder-fixed-or-hourly-deposit-expiry-revisions
git rebase origin/main
git branch --unset-upstream
git log --oneline -3
```

Expected: the spec commit (`docs(platform): add the TAT-64 quote builder design spec`) and this plan's commit on top of the merge of PR #17. The branch has no upstream until the first `git push -u origin <branch>`.

- [ ] **Baseline.** `cd apps/platform && PORT=3402 pnpm test functional --files=deposit_service.spec.ts` and `--files=session_service.spec.ts`. Expected: both PASS.

- [ ] **Linear:** set TAT-64 to In Progress.

---

### Task 1: Quote helpers

Pure functions shared by the services, the controller and the message. No database.

**Files:**
- Create: `apps/platform/app/modules/projects/quotes.ts`
- Test: `apps/platform/tests/unit/modules/projects/quotes.spec.ts`

**Interfaces:**
- Consumes: `Quote` model type (`#modules/projects/models/quote`), `ProjectStatus` (`#modules/projects/models/tattoo_project`).
- Produces:
  - `QUOTABLE_STATUSES: readonly ProjectStatus[]`
  - `type QuoteAmounts = Pick<Quote, "kind" | "fixedPrice" | "hourlyRate" | "estimatedMinutes">`
  - `quoteTotal(quote: QuoteAmounts): bigint`
  - `formatMoney(paisa: bigint | number): string`
  - `formatHours(minutes: number): string`
  - `priceText(quote: QuoteAmounts): string`
  - `isExpired(quote: Pick<Quote, "expiresAt">, now?: DateTime): boolean`
  - `expiresAtFor(date: string, timezone: string): DateTime`
  - `validUntil(expiresAt: DateTime, timezone: string): string`
  - `todayIn(timezone: string, now?: DateTime): string`
  - `formatDay(date: string): string`
  - `quoteMessage(input: QuoteMessageInput): string`
  - `chatLinks(phone: string, text: string): { whatsapp: string; viber: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/projects/quotes.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	chatLinks,
	expiresAtFor,
	formatDay,
	formatHours,
	formatMoney,
	isExpired,
	priceText,
	quoteMessage,
	quoteTotal,
	todayIn,
	validUntil,
} from "#modules/projects/quotes";

const KTM = "Asia/Kathmandu";

const fixed = {
	kind: "fixed" as const,
	fixedPrice: 1_500_000,
	hourlyRate: null,
	estimatedMinutes: null,
};
const hourly = {
	kind: "hourly" as const,
	fixedPrice: null,
	hourlyRate: 300_000,
	estimatedMinutes: 300,
};

test.group("quoteTotal", () => {
	test("is the fixed price, or the rate for the estimated minutes", ({
		assert,
	}) => {
		assert.equal(quoteTotal(fixed), 1_500_000n);
		assert.equal(quoteTotal(hourly), 1_500_000n);
		assert.equal(quoteTotal({ ...hourly, estimatedMinutes: 270 }), 1_350_000n);
	});

	test("rounds half away from zero, like the database check", ({ assert }) => {
		// 1 paisa an hour for 30 minutes is half a paisa: rounds up.
		assert.equal(quoteTotal({ ...hourly, hourlyRate: 1, estimatedMinutes: 30 }), 1n);
		assert.equal(quoteTotal({ ...hourly, hourlyRate: 1, estimatedMinutes: 29 }), 0n);
	});

	test("stays exact past 2^53", ({ assert }) => {
		const max = 2_147_483_647;
		// 2147483647² = 4611686014132420609; / 60 = 76861433568873676.816…
		assert.equal(
			quoteTotal({ ...hourly, hourlyRate: max, estimatedMinutes: max }),
			76_861_433_568_873_677n,
		);
	});
});

test.group("formatMoney, formatHours and priceText", () => {
	test("formats paisa as rupees with South Asian grouping", ({ assert }) => {
		assert.equal(formatMoney(1_500_000), "NPR 15,000");
		assert.equal(formatMoney(15_000_000n), "NPR 1,50,000");
		assert.equal(formatMoney(123_450), "NPR 1,234.50");
		assert.equal(formatMoney(5), "NPR 0.05");
		assert.equal(formatMoney(0), "NPR 0");
	});

	test("formats minutes as hours without trailing zeros", ({ assert }) => {
		assert.equal(formatHours(300), "5");
		assert.equal(formatHours(270), "4.5");
		assert.equal(formatHours(285), "4.75");
		assert.equal(formatHours(15), "0.25");
	});

	test("prints the price line", ({ assert }) => {
		assert.equal(priceText(fixed), "NPR 15,000");
		assert.equal(priceText(hourly), "NPR 3,000/hour × about 5 h");
	});
});

test.group("expiry dates", () => {
	test("a quote valid through a day expires at the start of the next one there", ({
		assert,
	}) => {
		const expiresAt = expiresAtFor("2026-10-28", KTM);
		// Kathmandu is UTC+5:45.
		assert.equal(expiresAt.toUTC().toISO(), "2026-10-28T18:15:00.000Z");
		assert.equal(validUntil(expiresAt, KTM), "2026-10-28");
	});

	test("follows the timezone across a daylight-saving change", ({ assert }) => {
		const zone = "America/New_York";
		// Clocks go back on 1 Nov 2026; 2 Nov starts at UTC-5.
		const expiresAt = expiresAtFor("2026-11-01", zone);
		assert.equal(expiresAt.toUTC().toISO(), "2026-11-02T05:00:00.000Z");
		assert.equal(validUntil(expiresAt, zone), "2026-11-01");
	});

	test("today is the studio's date, not the server's", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-14T20:00:00Z");
		assert.equal(todayIn(KTM, now), "2026-10-15");
		assert.equal(todayIn("UTC", now), "2026-10-14");
	});

	test("a quote is expired from its expires_at on", ({ assert }) => {
		const expiresAt = DateTime.fromISO("2026-10-28T18:15:00Z");
		assert.isTrue(isExpired({ expiresAt }, expiresAt));
		assert.isFalse(isExpired({ expiresAt }, expiresAt.minus({ milliseconds: 1 })));
	});

	test("formats a day for people", ({ assert }) => {
		assert.equal(formatDay("2026-10-28"), "28 Oct 2026");
		assert.equal(formatDay("2026-01-05"), "5 Jan 2026");
	});
});

test.group("quoteMessage and chatLinks", () => {
	const expiresAt = expiresAtFor("2026-10-28", KTM);

	test("writes a fixed quote with its deposit", ({ assert }) => {
		assert.equal(
			quoteMessage({
				clientName: "Sita Rai",
				studioName: "Ink House",
				quote: { ...fixed, depositAmount: 300_000, expiresAt },
				timezone: KTM,
			}),
			"Hi Sita, here is your quote from Ink House: NPR 15,000. Deposit: NPR 3,000. Valid until 28 Oct 2026. Reply here to confirm.",
		);
	});

	test("writes an hourly quote with no deposit", ({ assert }) => {
		assert.equal(
			quoteMessage({
				clientName: "Sita Rai",
				studioName: "Ink House",
				quote: { ...hourly, depositAmount: 0, expiresAt },
				timezone: KTM,
			}),
			"Hi Sita, here is your quote from Ink House: NPR 3,000/hour × about 5 h ≈ NPR 15,000. No deposit needed. Valid until 28 Oct 2026. Reply here to confirm.",
		);
	});

	test("greets a client with no name plainly", ({ assert }) => {
		const text = quoteMessage({
			clientName: "  ",
			studioName: "Ink House",
			quote: { ...fixed, depositAmount: 0, expiresAt },
			timezone: KTM,
		});
		assert.isTrue(text.startsWith("Hi, here is your quote"));
	});

	test("builds WhatsApp and Viber links from an E.164 phone", ({ assert }) => {
		assert.deepEqual(chatLinks("+9779812345678", "Hi & bye"), {
			whatsapp: "https://wa.me/9779812345678?text=Hi%20%26%20bye",
			viber: "viber://chat?number=%2B9779812345678",
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test unit --files=quotes.spec.ts`
Expected: FAIL, cannot find module `#modules/projects/quotes`.

- [ ] **Step 3: Write the implementation**

Create `apps/platform/app/modules/projects/quotes.ts`:

```ts
import { DateTime } from "luxon";
import type Quote from "#modules/projects/models/quote";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * The statuses in which a project can be quoted or re-quoted. Issuing a
 * quote moves the project to `quoted`; from `booked` on, quotes are locked.
 */
export const QUOTABLE_STATUSES: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
];

/** What a quote's total is made of. */
export type QuoteAmounts = Pick<
	Quote,
	"kind" | "fixedPrice" | "hourlyRate" | "estimatedMinutes"
>;

/**
 * The quote's total in paisa: the fixed price, or the hourly rate for the
 * estimated minutes rounded half away from zero, the same as the database's
 * `quotes_deposit_within_total` check. A bigint, because a stored rate ×
 * minutes can pass 2^53 (see the backend conventions).
 */
export function quoteTotal(quote: QuoteAmounts): bigint {
	if (quote.kind === "fixed") return BigInt(quote.fixedPrice ?? 0);
	const product =
		BigInt(quote.hourlyRate ?? 0) * BigInt(quote.estimatedMinutes ?? 0);
	// round(product / 60) for a positive product, in integers.
	return (product * 2n + 60n) / 120n;
}

const GROUPED = new Intl.NumberFormat("en-IN");

/**
 * Paisa as rupees for people: "NPR 1,50,000", with South Asian digit
 * grouping, and the paisa only when there are some ("NPR 1,234.50").
 */
export function formatMoney(paisa: bigint | number): string {
	const value = BigInt(paisa);
	const rupees = GROUPED.format(value / 100n);
	const rest = value % 100n;
	return rest === 0n
		? `NPR ${rupees}`
		: `NPR ${rupees}.${String(rest).padStart(2, "0")}`;
}

/** Whole minutes as hours, without trailing zeros: 270 is "4.5". */
export function formatHours(minutes: number): string {
	return String(Number((minutes / 60).toFixed(2)));
}

/** The price line: "NPR 15,000", or "NPR 3,000/hour × about 5 h". */
export function priceText(quote: QuoteAmounts): string {
	if (quote.kind === "fixed") return formatMoney(quoteTotal(quote));
	return `${formatMoney(quote.hourlyRate ?? 0)}/hour × about ${formatHours(quote.estimatedMinutes ?? 0)} h`;
}

/** Whether the quote's expiry has passed: it is expired from `expires_at` on. */
export function isExpired(
	quote: Pick<Quote, "expiresAt">,
	now: DateTime = DateTime.now(),
): boolean {
	return now.toMillis() >= quote.expiresAt.toMillis();
}

/**
 * When a quote valid through `date` (yyyy-MM-dd, the studio's local date)
 * expires: the start of the next day in `timezone`, so a quote "valid until
 * 28 Oct" holds for all of 28 Oct where the studio is.
 */
export function expiresAtFor(date: string, timezone: string): DateTime {
	return DateTime.fromISO(date, { zone: timezone })
		.plus({ days: 1 })
		.startOf("day");
}

/**
 * The last local day a quote is valid (yyyy-MM-dd): the day before it
 * expires, in `timezone`.
 */
export function validUntil(expiresAt: DateTime, timezone: string): string {
	return expiresAt
		.setZone(timezone)
		.minus({ milliseconds: 1 })
		.toFormat("yyyy-MM-dd");
}

/** Today's date (yyyy-MM-dd) in `timezone`. */
export function todayIn(
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	return now.setZone(timezone).toFormat("yyyy-MM-dd");
}

/** A yyyy-MM-dd date for people: "28 Oct 2026". */
export function formatDay(date: string): string {
	return DateTime.fromISO(date, { locale: "en-GB" }).toFormat("d LLL yyyy");
}

export type QuoteMessageInput = {
	clientName: string;
	studioName: string;
	quote: QuoteAmounts & Pick<Quote, "depositAmount" | "expiresAt">;
	timezone: string;
};

/**
 * The quote as a chat message to the client, in English. TAT-52 turns the
 * one-tap messages into editable templates.
 */
export function quoteMessage({
	clientName,
	studioName,
	quote,
	timezone,
}: QuoteMessageInput): string {
	const firstName = clientName.trim().split(/\s+/)[0];
	const greeting = firstName ? `Hi ${firstName}` : "Hi";
	const total = formatMoney(quoteTotal(quote));
	const price =
		quote.kind === "fixed" ? total : `${priceText(quote)} ≈ ${total}`;
	const deposit =
		quote.depositAmount === 0
			? "No deposit needed."
			: `Deposit: ${formatMoney(quote.depositAmount)}.`;
	const until = formatDay(validUntil(quote.expiresAt, timezone));
	return `${greeting}, here is your quote from ${studioName}: ${price}. ${deposit} Valid until ${until}. Reply here to confirm.`;
}

/**
 * Links that open a chat with `phone` (E.164). WhatsApp prefills `text`;
 * Viber's chat link takes no text, so staff paste it (the page's Copy
 * button).
 */
export function chatLinks(
	phone: string,
	text: string,
): { whatsapp: string; viber: string } {
	const digits = phone.replace(/\D/g, "");
	return {
		whatsapp: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
		viber: `viber://chat?number=%2B${digits}`,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=quotes.spec.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/quotes.ts tests/unit/modules/projects/quotes.spec.ts
git commit -m "feat(platform): add quote totals, expiry dates and the quote message"
```

---

### Task 2: QuoteService, and DepositService reads through it

**Files:**
- Create: `apps/platform/app/modules/projects/services/quote_service.ts`
- Modify: `apps/platform/app/modules/payments/services/deposit_service.ts`
- Modify: `apps/platform/tests/functional/payments/deposit_service.spec.ts` (constructor)
- Modify: `apps/platform/tests/functional/scheduling/session_service.spec.ts` (constructor)
- Test: `apps/platform/tests/functional/projects/quote_service.spec.ts`

**Interfaces:**
- Consumes: `Quote`, `TattooProject`, `Tenant` models; `withTransaction` from `#services/db_context` (tests only).
- Produces:
  - `type NewQuote = { kind: "fixed"; fixedPrice: number; depositAmount: number; expiresAt: DateTime } | { kind: "hourly"; hourlyRate: number; estimatedMinutes: number; depositAmount: number; expiresAt: DateTime }` (stored units: paisa, minutes)
  - `QuoteService.current(tenant: TenantRef, project: ProjectRef): Promise<Quote | null>`
  - `QuoteService.history(tenant: TenantRef, project: ProjectRef): Promise<Quote[]>` (newest first)
  - `QuoteService.create(trx: TransactionClientContract, tenant: TenantRef, project: ProjectRef, input: NewQuote): Promise<Quote>`
  - `new DepositService(quotes: QuoteService)` (was `new DepositService()`)

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/projects/quote_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import QuoteService, {
	type NewQuote,
} from "#modules/projects/services/quote_service";
import { withTransaction } from "#services/db_context";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const quotes = new QuoteService();

const fixed = (): NewQuote => ({
	kind: "fixed",
	fixedPrice: 1_500_000,
	depositAmount: 300_000,
	expiresAt: DateTime.utc().plus({ days: 14 }),
});

const hourly = (): NewQuote => ({
	kind: "hourly",
	hourlyRate: 300_000,
	estimatedMinutes: 270,
	depositAmount: 0,
	expiresAt: DateTime.utc().plus({ days: 14 }),
});

test.group("QuoteService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("current is null without a quote, then the highest version", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.isNull(await quotes.current(tenant, project));

			await makeQuote(tenant, project, { version: 1 });
			const v3 = await makeQuote(tenant, project, { version: 3 });
			await makeQuote(tenant, project, { version: 2 });

			assert.equal((await quotes.current(tenant, project))?.id, v3.id);
			assert.deepEqual(
				(await quotes.history(tenant, project)).map(({ version }) => version),
				[3, 2, 1],
			);
		});
	});

	test("create numbers versions per project and stores the kind's columns", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const first = await makeProject(tenant, client);
			const second = await makeProject(tenant, client);

			const a1 = await withTransaction((trx) =>
				quotes.create(trx, tenant, first, fixed()),
			);
			const a2 = await withTransaction((trx) =>
				quotes.create(trx, tenant, first, hourly()),
			);
			const b1 = await withTransaction((trx) =>
				quotes.create(trx, tenant, second, fixed()),
			);

			assert.deepEqual(
				[a1.version, a2.version, b1.version],
				[1, 2, 1],
			);
			assert.include(a1.serialize(), {
				kind: "fixed",
				fixedPrice: 1_500_000,
				hourlyRate: null,
				estimatedMinutes: null,
				depositAmount: 300_000,
				currency: "NPR",
			});
			assert.include(a2.serialize(), {
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 300_000,
				estimatedMinutes: 270,
				depositAmount: 0,
			});
		});
	});

	test("another tenant sees none of the project's quotes", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await inTenant(a, async () => {
			const project = await makeProject(a, await makeClient(a));
			await makeQuote(a, project);
			return project;
		});

		await inTenant(b, async () => {
			assert.isNull(await quotes.current(b, project));
			assert.deepEqual(await quotes.history(b, project), []);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=quote_service.spec.ts`
Expected: FAIL, cannot find module `#modules/projects/services/quote_service`.

- [ ] **Step 3: Write QuoteService**

Create `apps/platform/app/modules/projects/services/quote_service.ts`:

```ts
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { DateTime } from "luxon";
import Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;
type ProjectRef = Pick<TattooProject, "id">;

/**
 * A new quote version in stored units: paisa and whole minutes. The
 * currency is always NPR for now.
 */
export type NewQuote =
	| {
			kind: "fixed";
			fixedPrice: number;
			depositAmount: number;
			expiresAt: DateTime;
	  }
	| {
			kind: "hourly";
			hourlyRate: number;
			estimatedMinutes: number;
			depositAmount: number;
			expiresAt: DateTime;
	  };

/**
 * The way to read a project's quotes and add a version. Quotes are history:
 * this class only inserts, so "the price, deposit and expiry never change"
 * and "history is never deleted" hold. Every call is scoped to the tenant.
 * The status moves that go with quotes live in ProjectService.
 */
export default class QuoteService {
	/** The project's current quote (its highest version), or null. */
	async current(tenant: TenantRef, project: ProjectRef): Promise<Quote | null> {
		return Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();
	}

	/** Every version of the project's quote, newest first. */
	async history(tenant: TenantRef, project: ProjectRef): Promise<Quote[]> {
		return Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc");
	}

	/**
	 * Inserts the project's next version (1 for the first). The caller holds
	 * the project's row lock (ProjectService), so two saves cannot take the
	 * same version; the `(project_id, version)` unique key backs that up.
	 */
	async create(
		trx: TransactionClientContract,
		tenant: TenantRef,
		project: ProjectRef,
		input: NewQuote,
	): Promise<Quote> {
		const latest = await Quote.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();

		return Quote.create(
			{
				tenantId: tenant.id,
				projectId: project.id,
				version: (latest?.version ?? 0) + 1,
				kind: input.kind,
				fixedPrice: input.kind === "fixed" ? input.fixedPrice : null,
				hourlyRate: input.kind === "hourly" ? input.hourlyRate : null,
				estimatedMinutes:
					input.kind === "hourly" ? input.estimatedMinutes : null,
				depositAmount: input.depositAmount,
				currency: "NPR",
				expiresAt: input.expiresAt,
			},
			{ client: trx },
		);
	}
}
```

- [ ] **Step 4: Run the QuoteService test**

Run: `PORT=3402 pnpm test functional --files=quote_service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Make DepositService read through QuoteService**

In `apps/platform/app/modules/payments/services/deposit_service.ts`:

Replace the imports at the top:

```ts
import Payment from "#modules/payments/models/payment";
import Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
```

with:

```ts
import { inject } from "@adonisjs/core";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import type Tenant from "#modules/tenancy/models/tenant";
```

Replace the class comment and opening:

```ts
/**
 * Whether a project's deposit is covered. Read-only; TAT-65 (the deposit page
 * and proofs) will own this class and grow it.
 *
 * It reads the `Quote` model directly because there is no quote service yet:
 * TAT-64 adds one, and this should call it then.
 */
export default class DepositService {
```

with:

```ts
/**
 * Whether a project's deposit is covered. Read-only; TAT-65 (the deposit page
 * and proofs) will own this class and grow it. The current quote comes from
 * QuoteService.
 */
@inject()
export default class DepositService {
	constructor(private quotes: QuoteService) {}

```

And in `isSettled`, replace:

```ts
		const quote = await Quote.query()
			.where("tenant_id", tenant.id)
			.where("project_id", project.id)
			.orderBy("version", "desc")
			.first();
```

with:

```ts
		const quote = await this.quotes.current(tenant, project);
```

Leave the rest of `isSettled` (the zero-deposit check, the currency filter, the sum) unchanged.

- [ ] **Step 6: Update the two specs that build DepositService**

In `apps/platform/tests/functional/payments/deposit_service.spec.ts`, add the import `import QuoteService from "#modules/projects/services/quote_service";` and replace `const deposits = new DepositService();` with `const deposits = new DepositService(new QuoteService());`.

In `apps/platform/tests/functional/scheduling/session_service.spec.ts`, add the same import and replace `new DepositService(),` with `new DepositService(new QuoteService()),`.

- [ ] **Step 7: Run the affected specs**

Run: `PORT=3402 pnpm test functional --files=deposit_service.spec.ts` then `--files=session_service.spec.ts` then `--files=quote_service.spec.ts`
Expected: all PASS, unchanged counts for the first two.

- [ ] **Step 8: Commit**

```bash
git add app/modules/projects/services/quote_service.ts app/modules/payments/services/deposit_service.ts tests/functional/projects/quote_service.spec.ts tests/functional/payments/deposit_service.spec.ts tests/functional/scheduling/session_service.spec.ts
git commit -m "feat(platform): add QuoteService and read deposits' quotes through it"
```

---

### Task 3: Quote form validator

**Files:**
- Create: `apps/platform/app/modules/projects/validators/quote.ts`
- Test: `apps/platform/tests/unit/modules/projects/quote_validator.spec.ts`

**Interfaces:**
- Consumes: `QUOTE_KINDS` (`#modules/projects/models/quote`), `expiresAtFor`, `todayIn` (Task 1), `NewQuote` (Task 2).
- Produces:
  - `quoteValidator` (VineJS, `vine.create`), `type QuoteForm = Infer<typeof quoteValidator>`
  - `toQuoteInput(form: QuoteForm, timezone: string, now?: DateTime): NewQuote` (throws `errors.E_VALIDATION_ERROR`)
  - `acceptQuoteValidator` (`{ quoteId: uuid }`)

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/projects/quote_validator.spec.ts`:

```ts
import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import { expiresAtFor } from "#modules/projects/quotes";
import {
	type QuoteForm,
	quoteValidator,
	toQuoteInput,
} from "#modules/projects/validators/quote";

const KTM = "Asia/Kathmandu";
// 20:00 UTC is already 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");

/** The field → message map a validation error carries, or {} if it passes. */
async function problems(work: () => unknown) {
	try {
		await work();
		return {};
	} catch (error) {
		if (error instanceof errors.E_VALIDATION_ERROR) {
			return Object.fromEntries(
				(error.messages as { field: string; message: string }[]).map(
					({ field, message }) => [field, message],
				),
			);
		}
		throw error;
	}
}

/** What the body parser hands over: strings, and null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	kind: "fixed",
	fixedPrice: "15000",
	hourlyRate: null,
	estimatedHours: null,
	depositAmount: "3000",
	expiresOn: "2026-10-28",
	...over,
});

const form = (over: Partial<QuoteForm> = {}): QuoteForm => ({
	kind: "fixed",
	fixedPrice: 15_000,
	hourlyRate: null,
	estimatedHours: null,
	depositAmount: 3_000,
	expiresOn: "2026-10-28",
	...over,
});

test.group("quoteValidator", () => {
	test("accepts a fixed and an hourly quote", async ({ assert }) => {
		assert.deepEqual(await problems(() => quoteValidator.validate(body())), {});
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(
					body({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: "3000",
						estimatedHours: "4.5",
					}),
				),
			),
			{},
		);
	});

	test("rejects separators, decimals and out-of-range rupees", async ({
		assert,
	}) => {
		const price = "Enter whole rupees from 1 to 1,00,00,000.";
		for (const fixedPrice of ["15,000", "1500.5", "0", "10000001"]) {
			assert.deepEqual(
				await problems(() => quoteValidator.validate(body({ fixedPrice }))),
				{ fixedPrice: price },
				fixedPrice,
			);
		}
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(body({ kind: "hourly", hourlyRate: "100001" })),
			),
			{ hourlyRate: "Enter whole rupees from 1 to 1,00,000 an hour." },
		);
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(body({ kind: "hourly", estimatedHours: "0.1" })),
			),
			{ estimatedHours: "Enter hours from 0.25 to 100." },
		);
	});

	test("needs a deposit, a kind and a date", async ({ assert }) => {
		assert.deepEqual(
			await problems(() =>
				quoteValidator.validate(
					body({ kind: "per-cm", depositAmount: null, expiresOn: "28/10/2026" }),
				),
			),
			{
				kind: "Choose fixed or hourly.",
				depositAmount: "Enter the deposit in whole rupees (0 for none).",
				expiresOn: "Pick the last day the quote is valid.",
			},
		);
	});
});

test.group("toQuoteInput", () => {
	test("converts a fixed quote to paisa and the expiry instant", ({
		assert,
	}) => {
		const input = toQuoteInput(form(), KTM, NOW);

		assert.deepInclude(input, {
			kind: "fixed",
			fixedPrice: 1_500_000,
			depositAmount: 300_000,
		});
		assert.equal(
			input.expiresAt.toMillis(),
			expiresAtFor("2026-10-28", KTM).toMillis(),
		);
	});

	test("converts an hourly quote to paisa and minutes", ({ assert }) => {
		const input = toQuoteInput(
			form({
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 3_000,
				estimatedHours: 4.75,
				depositAmount: 0,
			}),
			KTM,
			NOW,
		);

		assert.deepInclude(input, {
			kind: "hourly",
			hourlyRate: 300_000,
			estimatedMinutes: 285,
			depositAmount: 0,
		});
	});

	test("needs the fields of the chosen kind", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toQuoteInput(form({ fixedPrice: null }), KTM, NOW)),
			{ fixedPrice: "Enter the price." },
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ kind: "hourly", fixedPrice: 15_000 }), KTM, NOW),
			),
			{
				hourlyRate: "Enter the hourly rate.",
				estimatedHours: "Enter the estimated hours.",
			},
		);
	});

	test("takes quarter hours only", async ({ assert }) => {
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(
					form({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: 3_000,
						estimatedHours: 4.3,
						depositAmount: 0,
					}),
					KTM,
					NOW,
				),
			),
			{ estimatedHours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
	});

	test("keeps the deposit within the total", async ({ assert }) => {
		const tooMuch = "The deposit can't be more than the total.";
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ depositAmount: 15_001 }), KTM, NOW),
			),
			{ depositAmount: tooMuch },
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ depositAmount: 15_000 }), KTM, NOW),
			),
			{},
		);
		// 3,000 an hour for 2.5 hours is 7,500.
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(
					form({
						kind: "hourly",
						fixedPrice: null,
						hourlyRate: 3_000,
						estimatedHours: 2.5,
						depositAmount: 7_501,
					}),
					KTM,
					NOW,
				),
			),
			{ depositAmount: tooMuch },
		);
	});

	test("takes a last day from the studio's today to a year ahead", async ({
		assert,
	}) => {
		const range = { expiresOn: "Pick a date from today to a year from now." };
		// It is 15 Oct in Kathmandu although the server says 14 Oct.
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-10-15" }), KTM, NOW),
			),
			{},
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-10-14" }), KTM, NOW),
			),
			range,
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2027-10-16" }), KTM, NOW),
			),
			range,
		);
		assert.deepEqual(
			await problems(() =>
				toQuoteInput(form({ expiresOn: "2026-02-30" }), KTM, NOW),
			),
			range,
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test unit --files=quote_validator.spec.ts`
Expected: FAIL, cannot find module `#modules/projects/validators/quote`.

- [ ] **Step 3: Write the validator**

Create `apps/platform/app/modules/projects/validators/quote.ts`:

```ts
import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import { QUOTE_KINDS } from "#modules/projects/models/quote";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import type { NewQuote } from "#modules/projects/services/quote_service";

/**
 * The quote form's shape, in the form's units: whole rupees, hours and the
 * last valid day (yyyy-MM-dd, the studio's local date). Empty fields arrive
 * as null. What depends on the kind, the total or the studio's timezone is
 * checked by toQuoteInput.
 */
export const quoteValidator = vine.create({
	kind: vine.enum(QUOTE_KINDS),
	fixedPrice: vine
		.number()
		.withoutDecimals()
		.range([1, 10_000_000])
		.nullable()
		.optional(),
	hourlyRate: vine
		.number()
		.withoutDecimals()
		.range([1, 100_000])
		.nullable()
		.optional(),
	estimatedHours: vine.number().range([0.25, 100]).nullable().optional(),
	depositAmount: vine.number().withoutDecimals().min(0),
	expiresOn: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type QuoteForm = Infer<typeof quoteValidator>;

const PRICE = "Enter whole rupees from 1 to 1,00,00,000.";
const RATE = "Enter whole rupees from 1 to 1,00,000 an hour.";
const HOURS = "Enter hours from 0.25 to 100.";
const DEPOSIT = "Enter the deposit in whole rupees (0 for none).";
const EXPIRY = "Pick the last day the quote is valid.";

quoteValidator.messagesProvider = new SimpleMessagesProvider({
	"kind.required": "Choose fixed or hourly.",
	"kind.enum": "Choose fixed or hourly.",
	"fixedPrice.number": PRICE,
	"fixedPrice.withoutDecimals": PRICE,
	"fixedPrice.range": PRICE,
	"hourlyRate.number": RATE,
	"hourlyRate.withoutDecimals": RATE,
	"hourlyRate.range": RATE,
	"estimatedHours.number": HOURS,
	"estimatedHours.range": HOURS,
	"depositAmount.required": DEPOSIT,
	"depositAmount.number": DEPOSIT,
	"depositAmount.withoutDecimals": DEPOSIT,
	"depositAmount.min": DEPOSIT,
	"expiresOn.required": EXPIRY,
	"expiresOn.regex": EXPIRY,
});

type Problem = { field: string; message: string; rule: string };

/**
 * The service's input from the validated form, in stored units: paisa,
 * whole minutes and the expiry instant (expiresAtFor). Throws
 * E_VALIDATION_ERROR, shown next to the field, for what the shape can't
 * check: the price fields of the chosen kind, quarter-hour estimates, a
 * deposit above the total, and a last day outside today to a year from now
 * in the studio's timezone. The caps keep rate × hours far below 2^53, so
 * plain numbers are exact here.
 */
export function toQuoteInput(
	form: QuoteForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): NewQuote {
	const problems: Problem[] = [];
	const fail = (field: string, message: string, rule: string) => {
		problems.push({ field, message, rule });
	};

	const expiresAt = checkExpiry(form.expiresOn, timezone, now, fail);
	const depositAmount = form.depositAmount * 100;
	const overTotal = (total: number) => {
		if (depositAmount > total) {
			fail("depositAmount", "The deposit can't be more than the total.", "max");
		}
	};

	if (form.kind === "fixed") {
		const price = form.fixedPrice;
		if (price == null) fail("fixedPrice", "Enter the price.", "required");
		else overTotal(price * 100);
		if (problems.length || price == null || !expiresAt) {
			throw new errors.E_VALIDATION_ERROR(problems);
		}
		return { kind: "fixed", fixedPrice: price * 100, depositAmount, expiresAt };
	}

	const rate = form.hourlyRate;
	const hours = form.estimatedHours;
	if (rate == null) fail("hourlyRate", "Enter the hourly rate.", "required");
	if (hours == null) {
		fail("estimatedHours", "Enter the estimated hours.", "required");
	} else if (!Number.isInteger(hours * 4)) {
		fail(
			"estimatedHours",
			"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
			"quarterHours",
		);
	}
	if (rate != null && hours != null) overTotal(rate * 100 * hours);
	if (problems.length || rate == null || hours == null || !expiresAt) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		kind: "hourly",
		hourlyRate: rate * 100,
		estimatedMinutes: hours * 60,
		depositAmount,
		expiresAt,
	};
}

/**
 * The expiry instant for a last valid day from the studio's today to a
 * year ahead, else null after recording the problem. The dates are
 * yyyy-MM-dd strings, so they compare as text.
 */
function checkExpiry(
	date: string,
	timezone: string,
	now: DateTime,
	fail: (field: string, message: string, rule: string) => void,
): DateTime | null {
	const today = todayIn(timezone, now);
	const last = DateTime.fromISO(today, { zone: "utc" })
		.plus({ years: 1 })
		.toFormat("yyyy-MM-dd");
	const real = DateTime.fromISO(date, { zone: "utc" }).isValid;
	if (!real || date < today || date > last) {
		fail("expiresOn", "Pick a date from today to a year from now.", "range");
		return null;
	}
	return expiresAtFor(date, timezone);
}

/** The quote the client accepted, as the page showed it. */
export const acceptQuoteValidator = vine.create({
	quoteId: vine.string().uuid(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=quote_validator.spec.ts`
Expected: PASS. If VineJS reports `kind` with the rule `required` rather than `enum` for an unknown value, keep both message keys; the test asserts the message, not the rule.

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/validators/quote.ts tests/unit/modules/projects/quote_validator.spec.ts
git commit -m "feat(platform): validate the quote form and convert it to stored units"
```

---

### Task 4: ProjectService: finding a project, and expiring its quote

**Files:**
- Create: `apps/platform/app/modules/projects/errors.ts`
- Create: `apps/platform/app/modules/projects/services/project_service.ts`
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts`

**Interfaces:**
- Consumes: `ArtistService.list(tenant)`, `QuoteService.current` (Task 2), `DepositService.isSettled`, `SessionService.listForProject` and `SessionService.cancel` (TAT-36), `isExpired` (Task 1), `withTransaction`.
- Produces:
  - `QUOTE_RULE_REASONS`, `type QuoteRuleReason`, `class QuoteRuleError { reason }`
  - `type Member = Pick<TenantMembership, "userId" | "role">`
  - `new ProjectService(artists: ArtistService, quotes: QuoteService, deposits: DepositService, sessions: SessionService)`
  - `ProjectService.findFor(tenant: TenantRef, member: Member, id: string): Promise<TattooProject>`
  - `ProjectService.expireQuote(tenant: TenantRef, projectId: string, quoteId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/projects/project_service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

type TenantRef = { id: string };

const statusOf = async (project: TattooProject) =>
	(await TattooProject.findOrFail(project.id)).status;

/** A project in `status` whose only quote expired an hour ago. */
async function expiredQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	depositAmount = 300_000,
) {
	const project = await makeProject(tenant, await makeClient(tenant), {
		status,
	});
	const quote = await makeQuote(tenant, project, {
		depositAmount,
		expiresAt: DateTime.utc().minus({ hours: 1 }),
	});
	return { project, quote };
}

test.group("ProjectService.findFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner finds any live project of the tenant", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: artist.id,
			});

			const found = await projects.findFor(tenant, member, project.id);
			assert.equal(found.id, project.id);
			await assert.rejects(
				() => projects.findFor(tenant, member, randomUUID()),
				/Row not found/,
			);
		});
	});

	test("an artist finds only projects assigned to their own profile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const other = await makeArtist(tenant, "ram");
			const client = await makeClient(tenant);
			const assigned = await makeProject(tenant, client, { artistId: mine.id });
			const elsewhere = await makeProject(tenant, client, {
				artistId: other.id,
			});
			const unassigned = await makeProject(tenant, client);

			const asha = { userId: user.id, role: "artist" as const };
			assert.equal(
				(await projects.findFor(tenant, asha, assigned.id)).id,
				assigned.id,
			);
			for (const project of [elsewhere, unassigned]) {
				await assert.rejects(
					() => projects.findFor(tenant, asha, project.id),
					/Row not found/,
				);
			}

			// An artist with no profile of their own sees no project at all.
			const ram = { userId: stranger.id, role: "artist" as const };
			await assert.rejects(
				() => projects.findFor(tenant, ram, unassigned.id),
				/Row not found/,
			);
		});
	});

	test("another tenant's project is not found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const project = await inTenant(a, async () =>
			makeProject(a, await makeClient(a)),
		);

		await inTenant(b, async () => {
			await assert.rejects(
				() =>
					projects.findFor(
						b,
						{ userId: ownerB.id, role: "owner" },
						project.id,
					),
				/Row not found/,
			);
		});
	});
});

test.group("ProjectService.expireQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("cancels a quoted or on-hold project once its current quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of ["quoted", "on_hold"] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isTrue(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), "cancelled", status);
			}
		});
	});

	test("cancels an accepted project whose deposit is not settled", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.equal(await statusOf(project), "cancelled");
		});
	});

	test("spares an accepted project whose deposit is settled or zero", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const paid = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, paid.project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			assert.isFalse(
				await projects.expireQuote(tenant, paid.project.id, paid.quote.id),
			);
			assert.equal(await statusOf(paid.project), "deposit_pending");

			const free = await expiredQuote(tenant, "deposit_pending", 0);
			assert.isFalse(
				await projects.expireQuote(tenant, free.project.id, free.quote.id),
			);
			assert.equal(await statusOf(free.project), "deposit_pending");
		});
	});

	test("leaves every other status alone", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"booked",
				"in_progress",
				"completed",
				"healing_check",
				"declined",
				"cancelled",
			] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isFalse(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("ignores a quote that has not expired or is no longer current", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const live = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().plus({ days: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, project.id, live.id));

			// v1's job runs after v2 replaced it; v2 has expired too, but v2's own
			// job decides that.
			const revised = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const v1 = await makeQuote(tenant, revised, {
				version: 1,
				expiresAt: DateTime.utc().minus({ days: 2 }),
			});
			await makeQuote(tenant, revised, {
				version: 2,
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, revised.id, v1.id));

			assert.equal(await statusOf(project), "quoted");
			assert.equal(await statusOf(revised), "quoted");
		});
	});

	test("cancels the project's scheduled sessions so the artist's time is free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			const artist = await makeArtist(tenant);
			const held = await makeSession(tenant, project, artist);
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			await held.refresh();
			await done.refresh();
			assert.equal(held.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});

	test("a second run, a missing project and a deleted one change nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));

			assert.isFalse(
				await projects.expireQuote(tenant, randomUUID(), randomUUID()),
			);

			const gone = await expiredQuote(tenant, "quoted");
			await gone.project.softDelete();
			assert.isFalse(
				await projects.expireQuote(tenant, gone.project.id, gone.quote.id),
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL, cannot find module `#modules/projects/services/project_service`.

- [ ] **Step 3: Write the errors**

Create `apps/platform/app/modules/projects/errors.ts`:

```ts
export const QUOTE_RULE_REASONS = [
	"project_closed",
	"not_quoted",
	"quote_changed",
	"expired",
] as const;
export type QuoteRuleReason = (typeof QUOTE_RULE_REASONS)[number];

const MESSAGES: Record<QuoteRuleReason, string> = {
	project_closed:
		"Only a reviewing, quoted, on-hold or deposit-pending project can be quoted",
	not_quoted: "Only a quoted project can accept its quote",
	quote_changed: "The quote is no longer the project's current quote",
	expired: "The quote has expired",
};

/**
 * A quote rule was broken; `reason` says which. Thrown after the failed
 * savepoint has rolled back, so the request stays usable. The message is for
 * developers; show your own to the user.
 */
export class QuoteRuleError extends Error {
	constructor(readonly reason: QuoteRuleReason) {
		super(MESSAGES[reason]);
		this.name = "QuoteRuleError";
	}
}
```

- [ ] **Step 4: Write ProjectService with findFor and expireQuote**

Create `apps/platform/app/modules/projects/services/project_service.ts`:

```ts
import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { isExpired } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** Who is asking: their user and their role in the tenant. */
export type Member = Pick<TenantMembership, "userId" | "role">;

/**
 * The way to find a tenant's projects and move them through the quote steps
 * of their lifecycle (TAT-64): issue, accept and expire. TAT-46 adds the
 * rest (hold, decline, notes). Every write locks the project row first, the
 * same order as SessionService, so a concurrent accept, revision, expiry or
 * session change serializes on that row.
 */
@inject()
export default class ProjectService {
	constructor(
		private artists: ArtistService,
		private quotes: QuoteService,
		private deposits: DepositService,
		private sessions: SessionService,
	) {}

	/**
	 * The tenant's live project with this id, if `member` may open it: owners
	 * see every project, an artist only the projects assigned to their own
	 * live artist profile. Anything else throws E_ROW_NOT_FOUND (a 404), the
	 * same as another tenant's project.
	 */
	async findFor(
		tenant: TenantRef,
		member: Member,
		id: string,
	): Promise<TattooProject> {
		const query = TattooProject.query()
			.where("tenant_id", tenant.id)
			.where("id", id);
		if (member.role !== "owner") {
			const profiles = await this.artists.list(tenant);
			const mine = profiles.find(({ userId }) => userId === member.userId);
			// No profile of their own: no project is theirs.
			if (mine) query.where("artist_id", mine.id);
			else query.whereRaw("false");
		}
		return query.firstOrFail();
	}

	/**
	 * What ExpireQuoteJob does once a quote's expiry passes. Cancels the
	 * project if `quoteId` is still its current quote, that quote has
	 * expired, and the client never accepted it (`quoted`, `on_hold`) or
	 * accepted but never paid (`deposit_pending` with the deposit not
	 * settled). The project's scheduled sessions are cancelled first, so the
	 * artist's time is free. Anything else, a missing or deleted project
	 * included, changes nothing: the job is safe to repeat, and the jobs of
	 * revised quotes do nothing. Returns whether it cancelled.
	 */
	async expireQuote(
		tenant: TenantRef,
		projectId: string,
		quoteId: string,
	): Promise<boolean> {
		return withTransaction(async (trx) => {
			const project = await TattooProject.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", projectId)
				.forUpdate()
				.first();
			if (!project) return false;
			const quote = await this.quotes.current(tenant, project);
			if (!quote || quote.id !== quoteId || !isExpired(quote)) return false;
			if (!(await this.expiryCancels(tenant, project))) return false;

			for (const session of await this.sessions.listForProject(
				tenant,
				project,
			)) {
				if (session.status === "scheduled") {
					await this.sessions.cancel(tenant, session);
				}
			}
			await setStatus(project, "cancelled");
			return true;
		});
	}

	/** Whether an expired quote cancels a project in its current status. */
	private async expiryCancels(
		tenant: TenantRef,
		project: TattooProject,
	): Promise<boolean> {
		if (project.status === "quoted" || project.status === "on_hold") {
			return true;
		}
		if (project.status === "deposit_pending") {
			return !(await this.deposits.isSettled(tenant, project));
		}
		return false;
	}
}

/**
 * Changes a locked project's status. The row came from a `forUpdate` read in
 * the same transaction, so it saves there.
 */
async function setStatus(project: TattooProject, status: ProjectStatus) {
	project.status = status;
	await project.save();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: PASS (both groups).

- [ ] **Step 6: Commit**

```bash
git add app/modules/projects/errors.ts app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): add ProjectService to find projects and expire quotes"
```

---

### Task 5: ExpireQuoteJob, and issuing a quote

**Files:**
- Create: `apps/platform/app/modules/projects/jobs/expire_quote_job.ts`
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/projects/project_service.spec.ts`
- Test: `apps/platform/tests/functional/projects/expire_quote_job.spec.ts`

**Interfaces:**
- Consumes: `TenantJob` (`#services/tenant_job`), `dispatchInTransaction` (`#services/queue`), `QuoteService.create` and `NewQuote` (Task 2), `QUOTABLE_STATUSES`, `isExpired` (Task 1), `QuoteRuleError` (Task 4).
- Produces:
  - `ExpireQuoteJob` with payload `{ tenantId: string; projectId: string; quoteId: string }`
  - `ProjectService.issueQuote(tenant: TenantRef, project: TattooProject, input: NewQuote): Promise<Quote>`

- [ ] **Step 1: Write the failing job test**

Create `apps/platform/tests/functional/projects/expire_quote_job.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import TattooProject from "#modules/projects/models/tattoo_project";
import { dispatchInTransaction } from "#services/queue";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued, registerJob } from "#tests/helpers/worker";

/** The test's global transaction, which the test worker reads. */
const trx = () => db.connection() as TransactionClientContract;

test.group("ExpireQuoteJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(ExpireQuoteJob));

	test("cancels the project in the payload's tenant once its quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, quote } = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const quote = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ minutes: 1 }),
			});
			return { project, quote };
		});

		await dispatchInTransaction(
			ExpireQuoteJob.dispatch({
				tenantId: tenant.id,
				projectId: project.id,
				quoteId: quote.id,
			}),
			trx(),
		);
		await processQueued();

		const reloaded = await inTenant(tenant, () =>
			TattooProject.findOrFail(project.id),
		);
		assert.equal(reloaded.status, "cancelled");
	});
});
```

- [ ] **Step 2: Add the failing issueQuote tests**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, add these imports:

```ts
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { QuoteRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import type { NewQuote } from "#modules/projects/services/quote_service";
import { withTransaction } from "#services/db_context";
```

Add these helpers below `expiredQuote`:

```ts
const fixed = (expiresAt = DateTime.utc().plus({ days: 14 })): NewQuote => ({
	kind: "fixed",
	fixedPrice: 1_500_000,
	depositAmount: 300_000,
	expiresAt,
});

/** The QuoteRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof QuoteRuleError) return error.reason;
		throw error;
	}
}

const queuedJobs = async () =>
	Number((await db.from("queue_jobs").count("* as n"))[0].n);
```

Add this group at the end of the file:

```ts
test.group("ProjectService.issueQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the first quote is version 1 and the project becomes quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const quote = await projects.issueQuote(tenant, project, fixed());

			assert.equal(quote.version, 1);
			assert.equal(await statusOf(project), "quoted");
		});
	});

	test("every quotable status takes a revision and becomes quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
			] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				await makeQuote(tenant, project);
				const quote = await projects.issueQuote(tenant, project, fixed());

				assert.equal(quote.version, 2, status);
				assert.equal(await statusOf(project), "quoted", status);
			}
		});
	});

	test("a project past deposit_pending cannot be quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"booked",
				"in_progress",
				"completed",
				"healing_check",
				"declined",
				"cancelled",
			] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				assert.equal(
					await reasonOf(() => projects.issueQuote(tenant, project, fixed())),
					"project_closed",
					status,
				);
				assert.isNull(await quotes.current(tenant, project), status);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("a quote that is already expired is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(
						tenant,
						project,
						fixed(DateTime.utc().minus({ minutes: 1 })),
					),
				),
				"expired",
			);
			assert.equal(await statusOf(project), "reviewing");
		});
	});

	test("queues ExpireQuoteJob to run when the quote expires", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		const quote = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			return projects.issueQuote(tenant, project, fixed());
		});

		const expected = quote.expiresAt.toMillis() - Date.now();
		fake.assertPushed(ExpireQuoteJob, {
			payload: {
				tenantId: tenant.id,
				projectId: quote.projectId,
				quoteId: quote.id,
			},
			delay: (delay) =>
				delay !== undefined && Math.abs(delay - expected) < 60_000,
		});
		assert.isAbove(expected, 0);
	});

	test("a rolled-back save leaves no quote and no job", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const before = await queuedJobs();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			await assert.rejects(
				() =>
					withTransaction(async () => {
						await projects.issueQuote(tenant, project, fixed());
						throw new Error("roll back");
					}),
				"roll back",
			);
			assert.isNull(await quotes.current(tenant, project));
			assert.equal(await statusOf(project), "reviewing");
		});
		assert.equal(await queuedJobs(), before);
	});
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts` and `--files=expire_quote_job.spec.ts`
Expected: FAIL, cannot find module `#modules/projects/jobs/expire_quote_job` (and `issueQuote` does not exist).

- [ ] **Step 4: Write the job**

Create `apps/platform/app/modules/projects/jobs/expire_quote_job.ts`:

```ts
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; projectId: string; quoteId: string };

/**
 * Runs once a quote's expiry passes: ProjectService.issueQuote queues it in
 * the issuing transaction, delayed until `expires_at`. ProjectService
 * .expireQuote re-checks everything under the project lock, so the old jobs
 * of revised quotes, a repeat run and a deleted project all do nothing.
 */
export default class ExpireQuoteJob extends TenantJob<Payload> {
	protected async handle() {
		// Imported here, not at the top: ProjectService imports this job to
		// queue it, and a static import both ways would be a cycle.
		const { default: ProjectService } = await import(
			"#modules/projects/services/project_service"
		);
		const projects = await app.container.make(ProjectService);
		const { tenantId, projectId, quoteId } = this.payload;
		await projects.expireQuote({ id: tenantId }, projectId, quoteId);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, projectId, quoteId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, projectId, quoteId },
			"Expiring a quote failed.",
		);
	}
}
```

- [ ] **Step 5: Add issueQuote to ProjectService**

In `apps/platform/app/modules/projects/services/project_service.ts`, extend the imports so the top of the file reads:

```ts
import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import { QuoteRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import type Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { isExpired, QUOTABLE_STATUSES } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService, {
	type NewQuote,
} from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";
import { withTransaction } from "#services/db_context";
import { dispatchInTransaction } from "#services/queue";
```

Add this method to the class, after `findFor`:

```ts
	/**
	 * Issues the project's next quote version. There are no drafts: saving is
	 * sending. Allowed while the project is `reviewing`, `quoted`, `on_hold`
	 * or `deposit_pending` (else QuoteRuleError "project_closed"), and only
	 * for a quote that has not expired yet ("expired"). The project becomes
	 * `quoted`, so a revision after the client accepted must be accepted
	 * again. Queues ExpireQuoteJob for the quote's expiry in the same
	 * transaction, so a rolled-back save leaves no job.
	 */
	async issueQuote(
		tenant: TenantRef,
		project: TattooProject,
		input: NewQuote,
	): Promise<Quote> {
		assertProjectOf(tenant, project);
		if (isExpired(input)) throw new QuoteRuleError("expired");
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			if (!QUOTABLE_STATUSES.includes(live.status)) {
				throw new QuoteRuleError("project_closed");
			}
			const quote = await this.quotes.create(trx, tenant, live, input);
			await setStatus(live, "quoted");
			await dispatchInTransaction(
				ExpireQuoteJob.dispatch({
					tenantId: tenant.id,
					projectId: live.id,
					quoteId: quote.id,
				}).in(Math.max(0, quote.expiresAt.toMillis() - Date.now())),
				trx,
			);
			return quote;
		});
	}
```

Add these helpers at the bottom of the file, next to `setStatus`:

```ts
/**
 * Locks the live project row. A deleted or other tenant's project is a 404.
 */
function lockProject(
	trx: TransactionClientContract,
	tenant: TenantRef,
	id: string,
) {
	return TattooProject.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("id", id)
		.forUpdate()
		.firstOrFail();
}

/**
 * A caller bug, not a user error: projects come from the tenant's own reads.
 */
function assertProjectOf(tenant: TenantRef, project: TattooProject) {
	if (project.tenantId !== tenant.id) {
		throw new Error(`Project ${project.id} belongs to another tenant`);
	}
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`, then `--files=expire_quote_job.spec.ts`, then `PORT=3402 pnpm test unit --files=job_classes.spec.ts`
Expected: all PASS. `job_classes.spec.ts` finds the new job under `app/modules/*/jobs/` and accepts it because it extends `TenantJob`.

- [ ] **Step 7: Commit**

```bash
git add app/modules/projects/jobs/expire_quote_job.ts app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts tests/functional/projects/expire_quote_job.spec.ts
git commit -m "feat(platform): issue quotes and expire them with a delayed job"
```

---

### Task 6: Accepting a quote

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts`
- Modify: `apps/platform/tests/functional/projects/project_service.spec.ts`

**Interfaces:**
- Consumes: `SessionService.settleBooking(tenant, project): Promise<boolean>` (TAT-36), `lockProject`, `assertProjectOf`, `setStatus` (Task 5).
- Produces: `ProjectService.acceptQuote(tenant: TenantRef, project: TattooProject, quoteId: string): Promise<ProjectStatus>` (returns `"deposit_pending"` or `"booked"`).

- [ ] **Step 1: Write the failing tests**

Add this group at the end of `apps/platform/tests/functional/projects/project_service.spec.ts`:

```ts
test.group("ProjectService.acceptQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A quoted project whose current quote is still valid. */
	async function quoted(tenant: TenantRef, depositAmount = 300_000) {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "quoted",
		});
		const quote = await makeQuote(tenant, project, { depositAmount });
		return { project, quote };
	}

	test("moves a quoted project to deposit_pending", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant);
			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"deposit_pending",
			);
			assert.equal(await statusOf(project), "deposit_pending");
		});
	});

	test("books at once when the deposit is zero and a tattoo session is held", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant, 0);
			await makeSession(tenant, project, await makeArtist(tenant));

			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"booked",
			);
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("waits for a session even when the deposit is already paid", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"deposit_pending",
			);
		});
	});

	test("only a quoted project accepts", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of ["reviewing", "on_hold", "deposit_pending"] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const quote = await makeQuote(tenant, project);
				assert.equal(
					await reasonOf(() => projects.acceptQuote(tenant, project, quote.id)),
					"not_quoted",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("refuses a quote that was revised since the page loaded", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote: shown } = await quoted(tenant);
			await makeQuote(tenant, project, { version: 2 });

			assert.equal(
				await reasonOf(() => projects.acceptQuote(tenant, project, shown.id)),
				"quote_changed",
			);
			assert.equal(
				await reasonOf(() => projects.acceptQuote(tenant, project, randomUUID())),
				"quote_changed",
			);
			assert.equal(await statusOf(project), "quoted");
		});
	});

	test("refuses an expired quote", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted");
			assert.equal(
				await reasonOf(() => projects.acceptQuote(tenant, project, quote.id)),
				"expired",
			);
			assert.equal(await statusOf(project), "quoted");
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL, `projects.acceptQuote is not a function` (and a type error in the editor).

- [ ] **Step 3: Write acceptQuote**

Add this method to `ProjectService`, after `issueQuote`:

```ts
	/**
	 * The client accepted the quote they were shown (`quoteId`): the project
	 * moves from `quoted` to `deposit_pending`, then settleBooking books it at
	 * once if the deposit is already settled (or zero) and a tattoo session
	 * is scheduled. QuoteRuleError "not_quoted" outside `quoted`,
	 * "quote_changed" when `quoteId` is no longer the current quote (revised
	 * since the page loaded), "expired" once its expiry has passed. Returns
	 * the project's new status.
	 */
	async acceptQuote(
		tenant: TenantRef,
		project: TattooProject,
		quoteId: string,
	): Promise<ProjectStatus> {
		assertProjectOf(tenant, project);
		return withTransaction(async (trx) => {
			const live = await lockProject(trx, tenant, project.id);
			if (live.status !== "quoted") throw new QuoteRuleError("not_quoted");
			const quote = await this.quotes.current(tenant, live);
			if (!quote || quote.id !== quoteId) {
				throw new QuoteRuleError("quote_changed");
			}
			if (isExpired(quote)) throw new QuoteRuleError("expired");

			await setStatus(live, "deposit_pending");
			const booked = await this.sessions.settleBooking(tenant, live);
			return booked ? "booked" : "deposit_pending";
		});
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: PASS (all four groups).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): accept a quote and book the project when it can"
```

---

### Task 7: The project page (read side)

The route, controller, page props and a page that shows the project, its quote and its history. The form, accept button and chat links come in Tasks 8 and 9.

**Files:**
- Create: `apps/platform/app/modules/clients/services/client_service.ts`
- Create: `apps/platform/app/controllers/projects_controller.ts`
- Create: `apps/platform/inertia/components/projects.ts`
- Create: `apps/platform/inertia/pages/projects/show.tsx`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/helpers/tenants.ts` (seed keys for isolation)
- Modify: `apps/platform/tests/isolation/cases.ts`
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Regenerate: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/projects/project_page.spec.ts`

**Interfaces:**
- Consumes: `ProjectService.findFor` (Task 4), `QuoteService.history` (Task 2), `ArtistService.list`, the helpers of Task 1, `tenantContext(ctx)` (`{ tenant, membership }`).
- Produces:
  - `ClientService.find(tenant: TenantRef, id: string): Promise<Client | null>`
  - Route `GET /t/:tenant/projects/:id` named `tenant.projects.show`, in a `/projects` group with `middleware.role({ allow: ["owner", "artist"] })`.
  - Page `projects/show` with props `ProjectPageProps` (see `inertia/components/projects.ts` below); quote props `QuoteProps`.
  - `Studio` (tests) gains `project`, `quotedProject`, `quotedQuote`; `IsolationCase.resource` gains `"project" | "quotedProject"`.

- [ ] **Step 1: Write the failing page test**

Create `apps/platform/tests/functional/projects/project_page.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const KTM = "Asia/Kathmandu";

/** A last valid day `days` from today in Kathmandu (the test studio's zone). */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

const page = (projectId: string) => `/t/black-needle/projects/${projectId}`;

test.group("Project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the project, its current quote, history and message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const lastDay = dayFromNow(10);
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
			});
			const project = await makeProject(tenant, customer, { status: "quoted" });
			await makeQuote(tenant, project, {
				version: 1,
				fixedPrice: 1_200_000,
				depositAmount: 200_000,
			});
			await makeQuote(tenant, project, {
				version: 2,
				expiresAt: expiresAtFor(lastDay, KTM),
			});
			return project;
		});

		const response = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/show");
		const props = response.inertiaProps;
		assert.deepEqual(props.project, {
			id: project.id,
			status: "quoted",
			brief: "A small fine-line moth on the forearm",
			clientName: "Sita Rai",
			artistName: null,
		});
		assert.deepInclude(props.quote, {
			version: 2,
			kind: "fixed",
			priceText: "NPR 15,000",
			totalText: "NPR 15,000",
			depositText: "NPR 3,000",
			validUntil: lastDay,
			expired: false,
			fixedPrice: 15_000,
			hourlyRate: null,
			estimatedHours: null,
			depositAmount: 3_000,
		});
		assert.deepEqual(
			props.history.map(({ version }: { version: number }) => version),
			[1],
		);
		assert.isTrue(props.canQuote);
		assert.isTrue(props.canAccept);
		assert.match(
			props.message.whatsappUrl,
			/^https:\/\/wa\.me\/9779812345678\?text=Hi%20Sita%2C%20here%20is%20your%20quote%20from%20Black%20Needle/,
		);
		assert.equal(props.message.viberUrl, "viber://chat?number=%2B9779812345678");
		assert.deepEqual(props.form, {
			depositPercent: null,
			defaultValidUntil: dayFromNow(14),
			minDate: todayIn(KTM),
			maxDate: DateTime.fromISO(todayIn(KTM)).plus({ years: 1 }).toFormat("yyyy-MM-dd"),
		});
	});

	test("an expired quote can be revised but not accepted or sent", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isTrue(props.quote.expired);
		assert.isFalse(props.canAccept);
		assert.isNull(props.message);
		assert.isTrue(props.canQuote);
	});

	test("a client without a phone gets no chat links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, customer, { status: "quoted" });
			await makeQuote(tenant, project);
			return project;
		});

		const response = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		assert.isNull(response.inertiaProps.message);
		assert.isTrue(response.inertiaProps.canAccept);
	});

	test("a project with no quote, and a booked one that can't be re-quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { fresh, booked } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const fresh = await makeProject(tenant, customer);
			const booked = await makeProject(tenant, customer, { status: "booked" });
			await makeQuote(tenant, booked);
			return { fresh, booked };
		});

		const first = (
			await client.get(page(fresh.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isNull(first.quote);
		assert.deepEqual(first.history, []);
		assert.isTrue(first.canQuote);
		assert.isFalse(first.canAccept);

		const later = (
			await client.get(page(booked.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isFalse(later.canQuote);
		assert.isFalse(later.canAccept);
	});

	test("the assigned artist sees the page; another artist gets a 404", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
			});
		});

		const own = await client.get(page(project.id)).withInertia().loginAs(asha);
		own.assertStatus(200);
		assert.equal(own.inertiaProps.project.artistName, "Sita");

		const other = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(ram);
		other.assertStatus(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_page.spec.ts`
Expected: FAIL with 404s (no route).

- [ ] **Step 3: Write ClientService**

Create `apps/platform/app/modules/clients/services/client_service.ts`:

```ts
import Client from "#modules/clients/models/client";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/**
 * The way other modules read a tenant's clients. TAT-51 (intake and
 * matching by phone) grows it.
 */
export default class ClientService {
	/** The tenant's live client with this id, or null. */
	async find(tenant: TenantRef, id: string): Promise<Client | null> {
		return Client.query().where("tenant_id", tenant.id).where("id", id).first();
	}
}
```

- [ ] **Step 4: Write the page's prop types and shell**

Create `apps/platform/inertia/components/projects.ts`:

```ts
/**
 * One quote version as the project page gets it. The amounts in the form's
 * units (rupees, hours) prefill a revision.
 */
export type QuoteProps = {
	id: string;
	version: number;
	kind: "fixed" | "hourly";
	priceText: string;
	totalText: string;
	depositText: string;
	/** yyyy-MM-dd, the last day it is valid in the studio's timezone. */
	validUntil: string;
	validUntilText: string;
	issuedText: string;
	expired: boolean;
	fixedPrice: number | null;
	hourlyRate: number | null;
	estimatedHours: number | null;
	depositAmount: number;
};

export type ProjectPageProps = {
	project: {
		id: string;
		status: string;
		brief: string;
		clientName: string | null;
		artistName: string | null;
	};
	/** The current quote (the highest version), or null. */
	quote: QuoteProps | null;
	/** Earlier versions, newest first. */
	history: QuoteProps[];
	canQuote: boolean;
	canAccept: boolean;
	/** The chat message for the current quote, when it can be sent. */
	message: { text: string; whatsappUrl: string; viberUrl: string } | null;
	form: {
		depositPercent: number | null;
		defaultValidUntil: string;
		minDate: string;
		maxDate: string;
	};
};

export const STATUS_LABELS: Record<string, string> = {
	reviewing: "Reviewing",
	quoted: "Quoted",
	on_hold: "On hold",
	deposit_pending: "Deposit pending",
	booked: "Booked",
	in_progress: "In progress",
	completed: "Completed",
	healing_check: "Healing check",
	declined: "Declined",
	cancelled: "Cancelled",
};

const GROUPED = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Rupees for people, like the server's formatMoney: "NPR 1,50,000". */
export function formatRupees(rupees: number): string {
	return `NPR ${GROUPED.format(rupees)}`;
}

/**
 * The deposit the form suggests: `percent` of the total, in whole rupees and
 * never above the total. The server enforces the real limit.
 */
export function suggestedDeposit(
	total: number,
	percent: number | null,
): number {
	if (!percent || !(total > 0)) return 0;
	return Math.min(Math.floor(total), Math.round((total * percent) / 100));
}
```

Create `apps/platform/inertia/pages/projects/show.tsx`:

```tsx
import Page from "~/components/page";
import {
	type ProjectPageProps,
	type QuoteProps,
	STATUS_LABELS,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import AppLayout from "~/layouts/app";

/**
 * One project: its brief, current quote and earlier versions (TAT-64).
 * TAT-46 grows it into the full project screen.
 */
export default function ProjectShow({
	project,
	quote,
	history,
}: ProjectPageProps) {
	return (
		<Page
			title={project.clientName ?? "Project"}
			description={
				project.artistName ? `With ${project.artistName}` : "No artist yet"
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				<Card>
					<CardContent className="flex flex-col gap-3">
						<Badge variant="secondary">
							{STATUS_LABELS[project.status] ?? project.status}
						</Badge>
						<p className="text-sm whitespace-pre-line">{project.brief}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Quote</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{quote ? (
							<QuoteSummary quote={quote} />
						) : (
							<p className="text-sm text-muted-foreground">No quote yet.</p>
						)}
					</CardContent>
				</Card>

				{history.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Earlier versions</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col divide-y text-sm">
								{history.map((old) => (
									<li
										key={old.id}
										className="flex flex-wrap justify-between gap-2 py-2"
									>
										<span>
											Version {old.version}: {old.totalText}, deposit{" "}
											{old.depositText}
										</span>
										<span className="text-muted-foreground">
											Issued {old.issuedText}, valid until {old.validUntilText}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}
			</div>
		</Page>
	);
}

function QuoteSummary({ quote }: { quote: QuoteProps }) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt className="text-muted-foreground">Version</dt>
			<dd>{quote.version}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd>
				{quote.priceText}
				{quote.kind === "hourly" && ` ≈ ${quote.totalText}`}
			</dd>
			<dt className="text-muted-foreground">Deposit</dt>
			<dd>{quote.depositText}</dd>
			<dt className="text-muted-foreground">Valid until</dt>
			<dd className="flex items-center gap-2">
				{quote.validUntilText}
				{quote.expired && <Badge variant="destructive">Expired</Badge>}
			</dd>
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}

ProjectShow.layout = [AppLayout];
```

- [ ] **Step 5: Write ProjectsController**

Create `apps/platform/app/controllers/projects_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import type Quote from "#modules/projects/models/quote";
import {
	chatLinks,
	formatDay,
	formatMoney,
	isExpired,
	priceText,
	QUOTABLE_STATUSES,
	quoteMessage,
	quoteTotal,
	todayIn,
	validUntil,
} from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";

/** How long a new quote is valid by default, in days. */
const DEFAULT_VALID_DAYS = 14;

/**
 * A project's page: its quote, the quote's history and the quote form.
 * Owners open any project, artists the ones assigned to them; anyone else
 * gets a 404 (ProjectService.findFor).
 */
@inject()
export default class ProjectsController {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private clients: ClientService,
		private artists: ArtistService,
	) {}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const client = await this.clients.find(tenant, project.clientId);
		const artist = project.artistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === project.artistId,
				)
			: undefined;
		const versions = await this.quotes.history(tenant, project);
		const current = versions.at(0) ?? null;
		const live = current && !isExpired(current) ? current : null;
		const { timezone } = tenant;
		const today = DateTime.fromISO(todayIn(timezone), { zone: "utc" });

		return ctx.inertia.render("projects/show", {
			project: {
				id: project.id,
				status: project.status,
				brief: project.brief,
				clientName: client?.name ?? null,
				artistName: artist?.name ?? null,
			},
			quote: current ? quoteProps(current, timezone) : null,
			history: versions.slice(1).map((quote) => quoteProps(quote, timezone)),
			canQuote: QUOTABLE_STATUSES.includes(project.status),
			canAccept: project.status === "quoted" && live !== null,
			message:
				live && client?.phone
					? messageProps(live, client.name, client.phone, tenant.name, timezone)
					: null,
			form: {
				depositPercent: tenant.defaultDepositPercent,
				defaultValidUntil: today
					.plus({ days: DEFAULT_VALID_DAYS })
					.toFormat("yyyy-MM-dd"),
				minDate: today.toFormat("yyyy-MM-dd"),
				maxDate: today.plus({ years: 1 }).toFormat("yyyy-MM-dd"),
			},
		});
	}
}

/**
 * What the page gets for one quote version: display text in the studio's
 * timezone, and the amounts in the form's units for a revision.
 */
function quoteProps(quote: Quote, timezone: string) {
	const lastDay = validUntil(quote.expiresAt, timezone);
	return {
		id: quote.id,
		version: quote.version,
		kind: quote.kind,
		priceText: priceText(quote),
		totalText: formatMoney(quoteTotal(quote)),
		depositText:
			quote.depositAmount === 0 ? "No deposit" : formatMoney(quote.depositAmount),
		validUntil: lastDay,
		validUntilText: formatDay(lastDay),
		issuedText: formatDay(
			quote.createdAt.setZone(timezone).toFormat("yyyy-MM-dd"),
		),
		expired: isExpired(quote),
		fixedPrice: quote.fixedPrice === null ? null : quote.fixedPrice / 100,
		hourlyRate: quote.hourlyRate === null ? null : quote.hourlyRate / 100,
		estimatedHours:
			quote.estimatedMinutes === null ? null : quote.estimatedMinutes / 60,
		depositAmount: quote.depositAmount / 100,
	};
}

/** The chat message for a live quote, and the links that send it. */
function messageProps(
	quote: Quote,
	clientName: string,
	phone: string,
	studioName: string,
	timezone: string,
) {
	const text = quoteMessage({ clientName, studioName, quote, timezone });
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}
```

- [ ] **Step 6: Add the route**

In `apps/platform/start/routes.ts`, inside the `/t/:tenant` group, after the artists group (the one ending `.prefix("/artists").use(middleware.role({ allow: ["owner"] }));`), add:

```ts
		/**
		 * Projects: owners, and the artist assigned to the project
		 * (ProjectService.findFor gives anyone else a 404). Every projects
		 * route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get(":id", [controllers.Projects, "show"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.show");
			})
			.prefix("/projects")
			.use(middleware.role({ allow: ["owner", "artist"] }));
```

Run: `node ace codegen`
Expected: `.adonisjs/server/controllers.ts` gains `Projects`, `.adonisjs/server/pages.d.ts` gains `'projects/show'`, `.adonisjs/server/routes.d.ts` gains `tenant.projects.show`.

- [ ] **Step 7: Seed isolation resources and add the GET case**

In `apps/platform/tests/helpers/tenants.ts`, change the pipeline import to:

```ts
import { makeProject, makeQuote, seedPipeline } from "#tests/helpers/pipeline";
```

In `studio()`, replace:

```ts
	const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
	return { tenant, owner, artist, paymentMethod, artistProfile, pipeline };
```

with:

```ts
	const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
	// A second project waiting for the client's answer, for the accept route.
	const quoted = await inTenant(tenant, async () => {
		const project = await makeProject(tenant, pipeline.client, {
			status: "quoted",
		});
		return { project, quote: await makeQuote(tenant, project) };
	});
	return {
		tenant,
		owner,
		artist,
		paymentMethod,
		artistProfile,
		pipeline,
		// The :id resources of the project routes' isolation cases.
		project: pipeline.project,
		quotedProject: quoted.project,
		quotedQuote: quoted.quote,
	};
```

Update the `twoStudios` comment to mention them: replace `reference image, quote and a submitted payment). Later tickets` with `reference image, quote and a submitted payment), plus a quoted project (`quotedProject`, `quotedQuote`); `project` is the pipeline's project. Later tickets`.

In `apps/platform/tests/isolation/cases.ts`, add imports:

```ts
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
```

Change the `resource` type to:

```ts
	resource?: "paymentMethod" | "artistProfile" | "project" | "quotedProject";
```

Add below `artistRows`:

```ts
// Projects with their status, deleted ones included, and every quote.
const projectRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		projects: (
			await TattooProject.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((project) => project.serialize()),
		quotes: (
			await Quote.query().where("tenant_id", target.tenant.id).orderBy("id")
		).map((quote) => quote.serialize()),
	}));
```

Add at the end of `isolationCases`:

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/projects/:id",
		resource: "project",
		actor: "owner",
		ownStatus: 200,
		snapshot: projectRows,
	},
```

- [ ] **Step 8: Check the projects group in the route guard**

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, replace the loop header and title:

```ts
	for (const area of ["settings", "artists"]) {
		test(`every ${area} route runs auth, then the tenant check, then owners only`, ({
```

with:

```ts
	for (const { area, allow } of [
		{ area: "settings", allow: ["owner"] },
		{ area: "artists", allow: ["owner"] },
		{ area: "projects", allow: ["owner", "artist"] },
	]) {
		test(`every ${area} route runs auth, then the tenant check, then the role check (${allow.join(", ")})`, ({
```

and in its body replace:

```ts
				assert.deepEqual(
					entries[role]?.args,
					{ allow: ["owner"] },
					route.pattern,
				);
```

with:

```ts
				assert.deepEqual(entries[role]?.args, { allow }, route.pattern);
```

- [ ] **Step 9: Run the tests**

Run, one at a time: `PORT=3402 pnpm test functional --files=project_page.spec.ts`, `--files=cross_tenant.spec.ts`, `--files=tenant_routes.spec.ts`, `--files=harness.spec.ts`
Expected: all PASS. Then `pnpm typecheck` (from `apps/platform`): clean; the page props type checks the controller's `render` call.

- [ ] **Step 10: Commit**

```bash
git add app/modules/clients/services/client_service.ts app/controllers/projects_controller.ts inertia/components/projects.ts inertia/pages/projects/show.tsx start/routes.ts .adonisjs tests/helpers/tenants.ts tests/isolation/cases.ts tests/functional/tenancy/tenant_routes.spec.ts tests/functional/projects/project_page.spec.ts
git commit -m "feat(platform): add the project page with its quote and history"
```

---

### Task 8: Issuing and accepting from the page (routes and controller)

**Files:**
- Create: `apps/platform/app/controllers/quotes_controller.ts`
- Modify: `apps/platform/start/routes.ts`
- Modify: `apps/platform/tests/isolation/cases.ts`
- Regenerate: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/projects/quotes_http.spec.ts`

**Interfaces:**
- Consumes: `ProjectService.findFor`, `issueQuote`, `acceptQuote` (Tasks 4 to 6), `quoteValidator`, `toQuoteInput`, `acceptQuoteValidator` (Task 3), `QuoteRuleError` and `QuoteRuleReason` (Task 4).
- Produces: routes `POST /t/:tenant/projects/:id/quotes` (`tenant.projects.quotes.store`) and `POST /t/:tenant/projects/:id/quotes/accept` (`tenant.projects.quotes.accept`); both redirect to `tenant.projects.show`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/projects/quotes_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const KTM = "Asia/Kathmandu";
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

const quotesUrl = (id: string) => `/t/black-needle/projects/${id}/quotes`;
const acceptUrl = (id: string) => `/t/black-needle/projects/${id}/quotes/accept`;
const pageUrl = (id: string) => `/t/black-needle/projects/${id}`;

const fixedForm = (over: Record<string, string> = {}) => ({
	kind: "fixed",
	fixedPrice: "15000",
	depositAmount: "3000",
	expiresOn: dayFromNow(7),
	...over,
});

async function projectIn(
	tenant: { id: string },
	status: ProjectStatus = "reviewing",
) {
	return inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), { status }),
	);
}

const reload = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () => TattooProject.findOrFail(project.id));

const versions = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () =>
		Quote.query().where("project_id", project.id).orderBy("version"),
	);

test.group("Issuing a quote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner issues a fixed quote and the project becomes quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const lastDay = dayFromNow(7);

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ expiresOn: lastDay }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage("success", "Quote issued.");
		const [quote] = await versions(tenant, project);
		assert.include(quote.serialize(), {
			version: 1,
			kind: "fixed",
			fixedPrice: 1_500_000,
			depositAmount: 300_000,
		});
		assert.equal(
			quote.expiresAt.toMillis(),
			expiresAtFor(lastDay, KTM).toMillis(),
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("an hourly revision brings an accepted project back to quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "deposit_pending");
		await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(quotesUrl(project.id))
			.form({
				kind: "hourly",
				hourlyRate: "3000",
				estimatedHours: "4.5",
				depositAmount: "0",
				expiresOn: dayFromNow(7),
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", "Quote revised (version 2).");
		const latest = (await versions(tenant, project)).at(-1);
		assert.include(latest?.serialize(), {
			version: 2,
			kind: "hourly",
			hourlyRate: 300_000,
			estimatedMinutes: 270,
			depositAmount: 0,
		});
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("bad input comes back as field errors and stores nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const send = (form: Record<string, string>) =>
			client
				.post(quotesUrl(project.id))
				.form(form)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		assertValidationError(
			await send(fixedForm({ fixedPrice: "" })),
			"fixedPrice",
			"Enter the price.",
		);
		assertValidationError(
			await send(fixedForm({ depositAmount: "15001" })),
			"depositAmount",
			"The deposit can't be more than the total.",
		);
		assertValidationError(
			await send(fixedForm({ expiresOn: dayFromNow(-1) })),
			"expiresOn",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send(fixedForm({ fixedPrice: "15,000" })),
			"fixedPrice",
			"Enter whole rupees from 1 to 1,00,00,000.",
		);
		assert.deepEqual(await versions(tenant, project), []);
	});

	test("a booked project cannot be quoted", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm())
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage("error", "This project can no longer be quoted.");
		assert.deepEqual(await versions(tenant, project), []);
	});
});

test.group("Accepting a quote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("moves the project to deposit_pending", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const quote = await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage("success", "Accepted: waiting for the deposit.");
		assert.equal((await reload(tenant, project)).status, "deposit_pending");
	});

	test("refuses the old version after a revision", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const shown = await inTenant(tenant, async () => {
			const shown = await makeQuote(tenant, project);
			await makeQuote(tenant, project, { version: 2 });
			return shown;
		});

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: shown.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"The quote changed: check the new version.",
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("refuses an expired quote", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const quote = await inTenant(tenant, () =>
			makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			}),
		);

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"This quote has expired: revise it first.",
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("refuses a project that is not waiting for an answer", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "reviewing");
		const quote = await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"This project is not waiting for the client's answer.",
		);
	});
});

test.group("Quotes and artists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the assigned artist can quote; another artist gets a 404 on both routes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const { project, quote } = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
				status: "quoted",
			});
			return { project, quote: await makeQuote(tenant, project) };
		});

		const other = await client
			.post(quotesUrl(project.id))
			.form(fixedForm())
			.withCsrfToken()
			.loginAs(ram)
			.redirects(0);
		other.assertStatus(404);
		const otherAccept = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(ram)
			.redirects(0);
		otherAccept.assertStatus(404);
		assert.equal((await reload(tenant, project)).status, "quoted");

		const own = await client
			.post(quotesUrl(project.id))
			.form(fixedForm())
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		own.assertFlashMessage("success", "Quote revised (version 2).");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=quotes_http.spec.ts`
Expected: FAIL with 404s (no routes).

- [ ] **Step 3: Write QuotesController**

Create `apps/platform/app/controllers/quotes_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { QuoteRuleError, type QuoteRuleReason } from "#modules/projects/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	acceptQuoteValidator,
	quoteValidator,
	toQuoteInput,
} from "#modules/projects/validators/quote";

/** What a broken quote rule tells the user. */
const RULE_MESSAGES: Record<QuoteRuleReason, string> = {
	project_closed: "This project can no longer be quoted.",
	not_quoted: "This project is not waiting for the client's answer.",
	quote_changed: "The quote changed: check the new version.",
	expired: "This quote has expired: revise it first.",
};

/**
 * Issuing, revising and accepting a project's quote from its page. Every
 * :id loads through ProjectService.findFor first, so another tenant's
 * project, or another artist's, is a 404 even with a bad body.
 */
@inject()
export default class QuotesController {
	constructor(private projects: ProjectService) {}

	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(quoteValidator);
		const input = toQuoteInput(form, tenant.timezone);

		await flashRuleErrors(ctx, async () => {
			const quote = await this.projects.issueQuote(tenant, project, input);
			ctx.session.flash(
				"success",
				quote.version === 1
					? "Quote issued."
					: `Quote revised (version ${quote.version}).`,
			);
		});
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}

	async accept(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { quoteId } = await ctx.request.validateUsing(acceptQuoteValidator);

		await flashRuleErrors(ctx, async () => {
			const status = await this.projects.acceptQuote(tenant, project, quoteId);
			ctx.session.flash(
				"success",
				status === "booked"
					? "Accepted and booked."
					: "Accepted: waiting for the deposit.",
			);
		});
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
	}
}

/**
 * Runs `work`, turning a broken quote rule into a flash error. The service
 * already rolled its savepoint back, so the request goes on.
 */
async function flashRuleErrors(ctx: HttpContext, work: () => Promise<void>) {
	try {
		await work();
	} catch (error) {
		if (!(error instanceof QuoteRuleError)) throw error;
		ctx.session.flash("error", RULE_MESSAGES[error.reason]);
	}
}
```

- [ ] **Step 4: Add the routes**

In `apps/platform/start/routes.ts`, inside the projects group from Task 7, after the `show` route, add:

```ts
				router
					.post(":id/quotes", [controllers.Quotes, "store"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.quotes.store");
				router
					.post(":id/quotes/accept", [controllers.Quotes, "accept"])
					.where("id", router.matchers.uuid())
					.as("tenant.projects.quotes.accept");
```

Run: `node ace codegen`
Expected: `.adonisjs/server/controllers.ts` gains `Quotes`, `routes.d.ts` gains both route names.

- [ ] **Step 5: Add the isolation cases**

In `apps/platform/tests/isolation/cases.ts`, add the import `import { DateTime } from "luxon";` and these entries at the end of `isolationCases`:

```ts
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/quotes",
		resource: "project",
		actor: "owner",
		body: () => ({
			kind: "fixed",
			fixedPrice: "20000",
			depositAmount: "5000",
			// The test studios' timezone.
			expiresOn: DateTime.now()
				.setZone("Asia/Kathmandu")
				.plus({ days: 14 })
				.toFormat("yyyy-MM-dd"),
		}),
		ownStatus: 302,
		snapshot: projectRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/projects/:id/quotes/accept",
		resource: "quotedProject",
		actor: "owner",
		body: (own) => ({ quoteId: own.quotedQuote.id }),
		ownStatus: 302,
		snapshot: projectRows,
	},
```

- [ ] **Step 6: Run the tests**

Run: `PORT=3402 pnpm test functional --files=quotes_http.spec.ts`, then `--files=cross_tenant.spec.ts`, then `--files=tenant_routes.spec.ts`
Expected: all PASS. Then `pnpm typecheck`: clean.

- [ ] **Step 7: Commit**

```bash
git add app/controllers/quotes_controller.ts start/routes.ts .adonisjs tests/isolation/cases.ts tests/functional/projects/quotes_http.spec.ts
git commit -m "feat(platform): issue, revise and accept quotes from the project page"
```

---

### Task 9: The quote form, accept button and chat links

UI only. Checked by typecheck and Biome here, and in the browser in Task 10.

**Files:**
- Modify: `apps/platform/inertia/pages/projects/show.tsx`

**Interfaces:**
- Consumes: `ProjectPageProps`, `QuoteProps`, `formatRupees`, `suggestedDeposit` (Task 7); routes `tenant.projects.quotes.store` and `tenant.projects.quotes.accept` (Task 8); `Form` from `@adonisjs/inertia/react`; `toast` from `sonner`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Replace the page with the full version**

Replace the whole of `apps/platform/inertia/pages/projects/show.tsx` with:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { toast } from "sonner";
import Page from "~/components/page";
import {
	formatRupees,
	type ProjectPageProps,
	type QuoteProps,
	STATUS_LABELS,
	suggestedDeposit,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type Kind = QuoteProps["kind"];

const KINDS: { value: Kind; title: string; description: string }[] = [
	{
		value: "fixed",
		title: "Fixed price",
		description: "One price for the whole tattoo.",
	},
	{
		value: "hourly",
		title: "Hourly",
		description: "A rate per hour and the hours you expect.",
	},
];

/**
 * One project: its brief, current quote with the chat message and the
 * accept button, the quote form, and earlier versions (TAT-64). TAT-46
 * grows it into the full project screen.
 */
export default function ProjectShow({
	project,
	quote,
	history,
	canQuote,
	canAccept,
	message,
	form,
}: ProjectPageProps) {
	return (
		<Page
			title={project.clientName ?? "Project"}
			description={
				project.artistName ? `With ${project.artistName}` : "No artist yet"
			}
		>
			<div className="flex max-w-2xl flex-col gap-6">
				<Card>
					<CardContent className="flex flex-col gap-3">
						<Badge variant="secondary">
							{STATUS_LABELS[project.status] ?? project.status}
						</Badge>
						<p className="text-sm whitespace-pre-line">{project.brief}</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Quote</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{quote ? (
							<QuoteSummary quote={quote} />
						) : (
							<p className="text-sm text-muted-foreground">No quote yet.</p>
						)}
						{message && <ChatMessage message={message} />}
						{canAccept && quote && (
							<AcceptQuote projectId={project.id} quoteId={quote.id} />
						)}
					</CardContent>
				</Card>

				{canQuote && (
					<Card>
						<CardHeader>
							<CardTitle>{quote ? "Revise the quote" : "Issue a quote"}</CardTitle>
						</CardHeader>
						<CardContent>
							<QuoteForm
								key={quote?.id ?? "first"}
								projectId={project.id}
								quote={quote}
								form={form}
							/>
						</CardContent>
					</Card>
				)}

				{history.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle>Earlier versions</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="flex flex-col divide-y text-sm">
								{history.map((old) => (
									<li
										key={old.id}
										className="flex flex-wrap justify-between gap-2 py-2"
									>
										<span>
											Version {old.version}: {old.totalText}, deposit{" "}
											{old.depositText}
										</span>
										<span className="text-muted-foreground">
											Issued {old.issuedText}, valid until {old.validUntilText}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				)}
			</div>
		</Page>
	);
}

function QuoteSummary({ quote }: { quote: QuoteProps }) {
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
			<dt className="text-muted-foreground">Version</dt>
			<dd>{quote.version}</dd>
			<dt className="text-muted-foreground">Price</dt>
			<dd>
				{quote.priceText}
				{quote.kind === "hourly" && ` ≈ ${quote.totalText}`}
			</dd>
			<dt className="text-muted-foreground">Deposit</dt>
			<dd>{quote.depositText}</dd>
			<dt className="text-muted-foreground">Valid until</dt>
			<dd className="flex items-center gap-2">
				{quote.validUntilText}
				{quote.expired && <Badge variant="destructive">Expired</Badge>}
			</dd>
			<dt className="text-muted-foreground">Issued</dt>
			<dd>{quote.issuedText}</dd>
		</dl>
	);
}

/**
 * The quote as a chat message: WhatsApp opens with it filled in; Viber's
 * link can't carry text, so staff copy it and paste.
 */
function ChatMessage({
	message,
}: {
	message: NonNullable<ProjectPageProps["message"]>;
}) {
	const copy = () => {
		navigator.clipboard.writeText(message.text).then(
			() => toast.success("Message copied."),
			() => toast.error("Couldn't copy: select the text instead."),
		);
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<p className="text-sm whitespace-pre-line">{message.text}</p>
			<div className="flex flex-wrap gap-2">
				<a
					href={message.whatsappUrl}
					target="_blank"
					rel="noreferrer"
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Send on WhatsApp
				</a>
				<a
					href={message.viberUrl}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Open Viber chat
				</a>
				<Button type="button" variant="ghost" size="sm" onClick={copy}>
					Copy message
				</Button>
			</div>
		</div>
	);
}

function AcceptQuote({
	projectId,
	quoteId,
}: {
	projectId: string;
	quoteId: string;
}) {
	const tenant = useTenant();

	return (
		<Form
			route="tenant.projects.quotes.accept"
			routeParams={{ tenant: tenant.slug, id: projectId }}
		>
			{({ processing }) => (
				<div className="flex flex-wrap items-center gap-3">
					<input type="hidden" name="quoteId" value={quoteId} />
					<Button type="submit" disabled={processing}>
						{processing ? "Saving…" : "Client accepted"}
					</Button>
					<p className="text-sm text-muted-foreground">
						Tap when the client agrees. The project then waits for the deposit.
					</p>
				</div>
			)}
		</Form>
	);
}

/**
 * Issues the first quote or a revision. A revision starts from the current
 * quote; a first quote's deposit follows the studio's default percentage
 * until staff change it.
 */
function QuoteForm({
	projectId,
	quote,
	form,
}: {
	projectId: string;
	quote: QuoteProps | null;
	form: ProjectPageProps["form"];
}) {
	const tenant = useTenant();
	const [kind, setKind] = useState<Kind>(quote?.kind ?? "fixed");
	const [fixedPrice, setFixedPrice] = useState(
		quote?.fixedPrice?.toString() ?? "",
	);
	const [hourlyRate, setHourlyRate] = useState(
		quote?.hourlyRate?.toString() ?? "",
	);
	const [hours, setHours] = useState(quote?.estimatedHours?.toString() ?? "");
	const [depositTouched, setDepositTouched] = useState(quote !== null);
	const [deposit, setDeposit] = useState(
		quote?.depositAmount.toString() ?? "",
	);

	const total =
		kind === "fixed" ? Number(fixedPrice) : Number(hourlyRate) * Number(hours);
	const shownDeposit = depositTouched
		? deposit
		: String(suggestedDeposit(total, form.depositPercent));

	return (
		<Form
			route="tenant.projects.quotes.store"
			routeParams={{ tenant: tenant.slug, id: projectId }}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<FieldSet data-invalid={!!errors.kind}>
						<FieldLegend variant="label">Pricing</FieldLegend>
						<RadioGroup
							name="kind"
							value={kind}
							onValueChange={(value) =>
								setKind(value === "hourly" ? "hourly" : "fixed")
							}
						>
							{KINDS.map(({ value, title, description }) => (
								<FieldLabel key={value} htmlFor={`kind-${value}`}>
									<Field orientation="horizontal">
										<FieldContent>
											<FieldTitle>{title}</FieldTitle>
											<FieldDescription>{description}</FieldDescription>
										</FieldContent>
										<RadioGroupItem value={value} id={`kind-${value}`} />
									</Field>
								</FieldLabel>
							))}
						</RadioGroup>
						{errors.kind && <FieldError>{errors.kind}</FieldError>}
					</FieldSet>

					{kind === "fixed" ? (
						<Field data-invalid={!!errors.fixedPrice}>
							<FieldLabel htmlFor="fixedPrice">Price (NPR)</FieldLabel>
							<Input
								id="fixedPrice"
								name="fixedPrice"
								type="number"
								inputMode="numeric"
								min={1}
								step={1}
								value={fixedPrice}
								onChange={(event) => setFixedPrice(event.target.value)}
								aria-invalid={!!errors.fixedPrice}
							/>
							{errors.fixedPrice && <FieldError>{errors.fixedPrice}</FieldError>}
						</Field>
					) : (
						<>
							<Field data-invalid={!!errors.hourlyRate}>
								<FieldLabel htmlFor="hourlyRate">Rate per hour (NPR)</FieldLabel>
								<Input
									id="hourlyRate"
									name="hourlyRate"
									type="number"
									inputMode="numeric"
									min={1}
									step={1}
									value={hourlyRate}
									onChange={(event) => setHourlyRate(event.target.value)}
									aria-invalid={!!errors.hourlyRate}
								/>
								{errors.hourlyRate && (
									<FieldError>{errors.hourlyRate}</FieldError>
								)}
							</Field>
							<Field data-invalid={!!errors.estimatedHours}>
								<FieldLabel htmlFor="estimatedHours">Estimated hours</FieldLabel>
								<Input
									id="estimatedHours"
									name="estimatedHours"
									type="number"
									inputMode="decimal"
									min={0.25}
									step={0.25}
									value={hours}
									onChange={(event) => setHours(event.target.value)}
									aria-invalid={!!errors.estimatedHours}
								/>
								<FieldDescription>
									{total > 0
										? `About ${formatRupees(total)} in total.`
										: "In quarter hours: 4.5 for four and a half."}
								</FieldDescription>
								{errors.estimatedHours && (
									<FieldError>{errors.estimatedHours}</FieldError>
								)}
							</Field>
						</>
					)}

					<Field data-invalid={!!errors.depositAmount}>
						<FieldLabel htmlFor="depositAmount">Deposit (NPR)</FieldLabel>
						<Input
							id="depositAmount"
							name="depositAmount"
							type="number"
							inputMode="numeric"
							min={0}
							step={1}
							value={shownDeposit}
							onChange={(event) => {
								setDepositTouched(true);
								setDeposit(event.target.value);
							}}
							aria-invalid={!!errors.depositAmount}
						/>
						<FieldDescription>
							{Number(shownDeposit) === 0
								? "No deposit step: the project is booked once the client accepts and a session is scheduled."
								: !depositTouched && form.depositPercent !== null
									? `Your default ${form.depositPercent}% of the total.`
									: "Paid before the first session."}
						</FieldDescription>
						{errors.depositAmount && (
							<FieldError>{errors.depositAmount}</FieldError>
						)}
					</Field>

					<Field data-invalid={!!errors.expiresOn}>
						<FieldLabel htmlFor="expiresOn">Valid until</FieldLabel>
						<Input
							id="expiresOn"
							name="expiresOn"
							type="date"
							min={form.minDate}
							max={form.maxDate}
							defaultValue={form.defaultValidUntil}
							aria-invalid={!!errors.expiresOn}
						/>
						<FieldDescription>
							If the client hasn&apos;t accepted, or hasn&apos;t paid the
							deposit, by the end of this day, the project is cancelled.
						</FieldDescription>
						{errors.expiresOn && <FieldError>{errors.expiresOn}</FieldError>}
					</Field>

					<div>
						<Button type="submit" disabled={processing}>
							{processing ? "Saving…" : quote ? "Revise quote" : "Issue quote"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

ProjectShow.layout = [AppLayout];
```

- [ ] **Step 2: Typecheck and lint**

Run: `pnpm typecheck` (from `apps/platform`), then from the repo root `pnpm exec biome check apps/platform/inertia/pages/projects/show.tsx apps/platform/inertia/components/projects.ts`
Expected: clean. A route name typo in `Form route=` fails the typecheck.

- [ ] **Step 3: Commit**

```bash
git add inertia/pages/projects/show.tsx
git commit -m "feat(platform): add the quote form, accept button and chat links"
```

---

### Task 10: Development seeder and a browser check

**Files:**
- Create: `apps/platform/database/seeders/demo_project_seeder.ts`
- Modify: `apps/platform/package.json` (script `seed:dev`)

**Interfaces:**
- Consumes: the `owner` database connection (table owner; row-level security does not apply to it), `Tenant`, `Client`, `TattooProject` models.
- Produces: `pnpm seed:dev`.

- [ ] **Step 1: Write the seeder**

Create `apps/platform/database/seeders/demo_project_seeder.ts`:

```ts
import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import Client from "#modules/clients/models/client";
import TattooProject from "#modules/projects/models/tattoo_project";
import Tenant from "#modules/tenancy/models/tenant";

/** A fixed demo phone, so a second run reuses the client. */
const DEMO_PHONE = "+9779800000001";

/**
 * Development only: gives every tenant without a project a demo client and
 * a `reviewing` project, and prints each project page's path, so the quote
 * builder can be tried before TAT-46 lets staff create projects. Run it as
 * the owner role, which row-level security does not apply to:
 * `pnpm seed:dev`.
 */
export default class DemoProjectSeeder extends BaseSeeder {
	static environment = ["development"];

	async run() {
		const client = this.client;
		for (const tenant of await Tenant.query({ client })) {
			const existing = await TattooProject.query({ client })
				.where("tenant_id", tenant.id)
				.first();
			const project =
				existing ??
				(await TattooProject.create(
					{
						tenantId: tenant.id,
						clientId: (await demoClient(tenant, this.client)).id,
						brief: "Demo: a small fine-line moth on the forearm",
						status: "reviewing",
					},
					{ client },
				));
			logger.info(`/t/${tenant.slug}/projects/${project.id}`);
		}
	}
}

async function demoClient(
	tenant: Tenant,
	client: DemoProjectSeeder["client"],
) {
	const found = await Client.query({ client })
		.where("tenant_id", tenant.id)
		.where("phone", DEMO_PHONE)
		.first();
	return (
		found ??
		Client.create(
			{ tenantId: tenant.id, name: "Demo Client", phone: DEMO_PHONE },
			{ client },
		)
	);
}
```

- [ ] **Step 2: Add the script**

In `apps/platform/package.json` `scripts`, after `"migrate:rollback"`, add:

```json
		"seed:dev": "node ace db:seed --connection=owner",
```

- [ ] **Step 3: Run it against the dev database**

Run: `pnpm migrate` (no new migrations; makes sure the dev database is current), then `pnpm seed:dev`
Expected: one `/t/<slug>/projects/<uuid>` line per tenant. Run it again: the same paths, no new rows.

- [ ] **Step 4: Typecheck, lint and commit**

Run: `pnpm typecheck` and from the root `pnpm exec biome check apps/platform/database/seeders apps/platform/package.json`
Expected: clean.

```bash
git add database/seeders/demo_project_seeder.ts package.json
git commit -m "feat(platform): add a development seeder for a demo project"
```

- [ ] **Step 5: Browser check (ask the user to do it, or drive it with the run skill)**

Start the dev server on 3401 (`PORT=3401 pnpm dev`; 3333 is taken), sign in as the owner of a seeded tenant, open the printed path and check:
1. Issue a fixed quote: the deposit field follows the studio's default % (set one on Settings → Payments first) until edited; "Quote issued." toast; status "Quoted".
2. Revise as hourly (rate, 4.5 h): the live "About NPR … in total"; "Quote revised (version 2)."; version 1 under "Earlier versions".
3. "Send on WhatsApp" opens wa.me with the text; "Copy message" copies it; "Open Viber chat" opens Viber on a phone with Viber (check whether `viber://chat?number=%2B…` opens the right chat; if it does not, try `viber://chat?number=<digits>` without the `%2B` and fix `chatLinks` and its test).
4. "Client accepted": "Accepted: waiting for the deposit."; status "Deposit pending"; the accept button is gone; the form is still there (revising goes back to quoted).
5. Mobile width (devtools, 375 px): nothing overflows.

---

### Task 11: Docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/requirements.md`
- Modify: `docs/data-model.md`
- Modify: `apps/platform/docs/backend.md`
- Modify: `apps/platform/app/modules/projects/models/tattoo_project.ts` (doc comment only)

- [ ] **Step 1: architecture.md, the deposit flow**

Replace:

```
1. Staff accept the inquiry, which creates a project, and send a quote. The project moves to `deposit_pending`, and a deposit page link goes out through a one-tap WhatsApp or Viber message.
```

with:

```
1. Staff accept the inquiry, which creates a project, and send a quote through a one-tap WhatsApp or Viber message; the project moves to `quoted`. When the client agrees, staff mark the quote accepted: the project moves to `deposit_pending`, and a deposit page link goes out the same way. A quote that expires first cancels the project.
```

- [ ] **Step 2: requirements.md, the project rules**

Replace:

```
- A quote's expiry moves an unpaid project to `cancelled`.
```

with:

```
- Issuing a quote moves the project to `quoted`; staff mark it accepted when the client agrees, which moves it to `deposit_pending`. A quote can be revised (a new version) until the project is `booked`, and a revision moves a `deposit_pending` project back to `quoted`.
- A quote's expiry moves a project that was never accepted (`quoted`, `on_hold`) or never paid (`deposit_pending` with the deposit not settled) to `cancelled`, and cancels its scheduled sessions.
```

- [ ] **Step 3: data-model.md, the Quote row**

In the **Quote** row, after `the current quote is the highest, and history is never deleted.`, insert ` There are no drafts: saving issues the next version, so \`created_at\` is when it was sent.` (one sentence, same cell).

- [ ] **Step 4: backend.md**

In the "Clients, inquiries and projects" bullet, replace:

```
There are no services yet: TAT-51 (intake and client matching), TAT-46 (inbox and lifecycle), TAT-64 (quotes) and TAT-65 (deposit page and proofs) add them, so until then touch these models only in tests and inside a tenant context.
```

with:

```
Projects and quotes go through the services below; clients have only `ClientService.find(tenant, id)` (TAT-51 grows it) and inquiries have no service yet (TAT-51, TAT-46), so touch those models only in tests and inside a tenant context.
```

and replace `are conventions for TAT-64 to keep` with `are conventions that \`QuoteService\` keeps (it only inserts)`.

In the Scheduling bullet, replace:

```
`DepositService` (payments module) reads the `Quote` model directly until TAT-64 adds a quote service.
```

with:

```
`DepositService` (payments module) reads the current quote through `QuoteService`.
```

Add a new bullet after the Scheduling bullet:

```
- Projects and quotes (TAT-64): `app/modules/projects/` has two services, layered so that no class depends on itself through another module. `QuoteService` (`#modules/projects/services/quote_service`) depends on nothing outside the module: `current` (the highest version), `history` (newest first) and `create(trx, …)` (the next version, under the caller's project lock). `ProjectService` (`#modules/projects/services/project_service`) depends on it, `DepositService` and `SessionService`: `findFor(tenant, member, id)` (owners see every live project, an artist only those assigned to their own live artist profile, anyone else a 404), `issueQuote` (allowed in `reviewing`, `quoted`, `on_hold`, `deposit_pending`; moves to `quoted`; queues `ExpireQuoteJob` in the same transaction, delayed to `expires_at`), `acceptQuote` (only `quoted`, only the current unexpired quote; moves to `deposit_pending`, then `settleBooking`) and `expireQuote` (what the job runs: cancels `quoted`, `on_hold` and unsettled `deposit_pending` projects and their scheduled sessions; anything else, including a revised quote's old job, is a no-op). They throw `QuoteRuleError` with a reason (`project_closed`, `not_quoted`, `quote_changed`, `expired`). There are no drafts: saving issues the next version. `ExpireQuoteJob` imports `ProjectService` inside `handle()`, because `ProjectService` imports the job. Pure helpers (totals in bigint, money and date formatting, `expiresAtFor`: the start of the day after the chosen date in the tenant's timezone, the chat message and links) are in `#modules/projects/quotes`. `pnpm seed:dev` (development only, as the owner role) gives each tenant without a project a demo project to open.
```

- [ ] **Step 5: The TattooProject model comment**

In `apps/platform/app/modules/projects/models/tattoo_project.ts`, replace `The transition rules arrive with TAT-46.` with `The quote moves (to \`quoted\`, \`deposit_pending\`, and \`cancelled\` on expiry) live in ProjectService (TAT-64); the rest arrive with TAT-46.`

- [ ] **Step 6: Find what is left**

Run from the repo root: `rg -n "TAT-64" docs apps/platform/docs apps/platform/app --glob '!docs/superpowers/**'`
Expected: no remaining mention that says a quote service is still to come. Fix any that does, in the same plain style.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture.md docs/requirements.md docs/data-model.md apps/platform/docs/backend.md apps/platform/app/modules/projects/models/tattoo_project.ts
git commit -m "docs(platform): document quotes, acceptance and expiry"
```

---

### Task 12: Verification and handoff

- [ ] **Step 1: Full checks**

Run from `apps/platform`: `PORT=3402 node ace test` (every suite). From the repo root: `pnpm typecheck`, `pnpm check`. From `apps/platform`: `node ace codegen` then `git status --short` (expected: no changes).
Expected: all pass; the test count is the previous total plus this plan's tests. Report the numbers.

- [ ] **Step 2: Reviews before the PR**

Run the whole-branch review, then the `codex-review` skill (Codex code review plus the security-focused adversarial review) on `origin/main...HEAD`. Check each finding against the cited code, fix the confirmed ones, commit.

- [ ] **Step 3: Push and open the PR**

Push with `git -c 'url.https://github.com/.pushInsteadOf=git@github.com-personal:' -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin harublank00/tat-64-quote-builder-fixed-or-hourly-deposit-expiry-revisions`, then `gh pr create` with a body that lists the deviations above and the review results. A hook asks the user to confirm both.

- [ ] **Step 4: Linear**

Set TAT-64 to In Review with the PR link, and post the carry-forwards: TAT-46 (expiry is done; the project page and `ProjectService` are its starting point; `on_hold` and its return to `quoted` are its own; the projects list and navigation), TAT-65 (the deposit link comes after acceptance; `DepositService` reads `QuoteService`), TAT-52 (fold `quoteMessage` and `chatLinks` into its templates; Viber has no prefill, hence the Copy button).
