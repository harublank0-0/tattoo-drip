# Pilot metrics: link share, inquiry to verified deposit, no-shows (TAT-70) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three numbers decide gate 1, derived from data the platform already stores: the share of new work that arrives through the intake link, the median time from an inquiry to its verified deposit, and the session no-show rate. Owners see their studio's on a "Last 30 days" card under the inbox; the team sees every studio's with `node ace metrics:pilot`. About 2 points, as the ticket says.

**Architecture:** Four small reads in the modules that own the tables (`InquiryService.countReceived` / `receivedAt`, `ProjectService.countBookedAtDesk` / `inquiryIdsFor`, `DepositService.firstVerifiedDeposits`) plus TAT-85's `SessionService.countByStatus`, gathered by `PilotMetricsService.forStudio` in a new `reports` module; pure arithmetic and words in `#modules/reports/pilot_metrics`. The inbox controller adds a `pilotMetrics` prop rendered by `PilotMetricsCard`. The ace command `metrics:pilot` lists the live studios as the owner role (the only cross-tenant read) and computes each studio's numbers with the same service as the app role inside `withDbContext({ tenantId })`. No migration, no route, no setting.

**Tech Stack:** AdonisJS 7 (ace commands), Lucid on PostgreSQL 18 with RLS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-20-tat-70-pilot-metrics-design.md`. Read its Rulings first: they decide every open question (the exact definitions are rulings 3 to 7).

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides; say which in your report). `<scratchpad>` is your session's scratchpad directory. `<db-env>` is the isolated-database prefix the coordinator gives you (for example `DB_DATABASE=td_build_70`): put it in front of every test, `migrate`, `db:seed` and `metrics:pilot` command below. **Never run them without it**: the user's dev database is not for builds. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **No migration, no new route, no new setting, no dependency, no `package.json` change.** Never read or edit `apps/platform/.env`.
- **Copy (verbatim).** Card: `Last 30 days`, `Through the link`, `Inquiry to deposit`, `No-shows`, `{n} inquiries through the link, {m} bookings at the desk` (`1 inquiry`, `1 booking`), `No inquiries or desk bookings yet.`, `Median of {n} deposits`, `From 1 deposit`, `No deposits verified from an inquiry yet.`, `{a} of {b} finished sessions` (`1 finished session`), `No finished sessions yet.`, `{n} past sessions without an outcome aren't counted.`, `1 past session without an outcome isn't counted.`, `—` (an em dash). Durations: `under an hour`, `1 hour`, `{n} hours`, `{n} days`, `{n.n} days`. Command: `Pilot numbers for the last {n} days: {from} to {to} UTC.`, `{name} ({slug})`, `All studios ({n})`, `No studios yet.`, `Give --days a whole number from 1 to 3650.`.
- Fixture slugs in new tests end in `-70` (`metrics-a-70`). Tests added to an existing file that uses `studioWithOwner()` with no slug keep it (`black-needle`).
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no nested ternaries, no custom CSS classes (Tailwind utilities and tokens only), nothing wider than 375 px.
- Tests: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After the controller and page changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/` if it changed.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 6), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **The definitions are exactly the spec's.** Link share counts every live inquiry in the window (any status) against live desk bookings; the deposit time is each inquiry-made project's first verified, unreversed deposit, counted in the window of that verification; the no-show rate is `no_show / (completed + no_show)` by start time, with unrecorded past sessions reported. Tests: Task 1 group; Task 2 "countReceived and countBookedAtDesk…", "firstVerifiedDeposits…"; Task 3 "forStudio…".
2. **Every number is one studio's, under row-level security.** The service reads only through models in the ambient tenant context; another studio's context sees nothing. Tests: Task 2 and Task 3 "…another studio's context sees none of it".
3. **The cross-tenant read is one list, as the owner role, outside the web process.** `metrics:pilot`'s `studios()` reads ids, slugs and names; every number runs as the app role in `withDbContext({ tenantId })`. Tests: Task 5 (through the overridden `studios()`); the owner-role listing itself in the browser pass.
4. **Owners only.** The card is on the inbox (owners only, unchanged). Tests: Task 4 and the existing "artists get a 404 on the inbox and on an inquiry".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-20-tat-70-pilot-metrics.md` → the commit "docs: plan TAT-70 pilot metrics".

- [ ] **Step 2: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -nF "async countByStatus(" -- apps/platform/app/modules/scheduling/services/session_service.ts
git -C <repo> grep -nF "async countNew(tenant: TenantRef): Promise<number> {" -- apps/platform/app/modules/inquiries/services/inquiry_service.ts
git -C <repo> grep -nF "async projectIdsForInquiries(" -- apps/platform/app/modules/projects/services/project_service.ts
git -C <repo> grep -nF "async countPendingProofs(tenant: TenantRef): Promise<number> {" -- apps/platform/app/modules/payments/services/deposit_service.ts
git -C <repo> grep -nF "inquiryId: null," -- apps/platform/app/modules/projects/services/booking_service.ts
git -C <repo> grep -nF '"tenant.inbox.index"' -- apps/platform/app/controllers/dashboard_controller.ts
git -C <repo> grep -nF "newCount: await this.inquiries.countNew(tenant)," -- apps/platform/app/controllers/inquiries_controller.ts
git -C <repo> grep -nF "private templates: MessageTemplateService," -- apps/platform/app/controllers/inquiries_controller.ts
git -C <repo> grep -nF "export type InboxListProps = {" -- apps/platform/inertia/components/inquiries.ts
git -C <repo> grep -nF "{page.last > 1 && (" -- apps/platform/inertia/pages/inquiries/index.tsx
git -C <repo> grep -nF 'static commandName = "account:verify";' -- apps/platform/commands/verify_account.ts
git -C <repo> grep -nF 'user: env.get("DB_MIGRATION_USER"),' -- apps/platform/config/database.ts
git -C <repo> grep -nF '| "anonymizedAt"' -- apps/platform/tests/helpers/pipeline.ts
git -C <repo> grep -nF '"artistId" | "inquiryId" | "brief" | "notes" | "status" | "lastContactedAt"' -- apps/platform/tests/helpers/pipeline.ts
git -C <repo> grep -nF 'test("artists get a 404 on the inbox and on an inquiry"' -- apps/platform/tests/functional/inquiries/inbox.spec.ts
```

Each of these must print nothing:

```
git -C <repo> ls-files apps/platform/app/modules/reports apps/platform/commands/pilot_metrics.ts
git -C <repo> grep -n "metrics:pilot\|pilotMetrics\|countReceived\|countBookedAtDesk\|firstVerifiedDeposits\|inquiryIdsFor" -- apps/platform
```

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 3: Install and environment**

If `<repo>/apps/platform/node_modules` is missing: when `<repo>/node_modules` is a symlink (`test -L <repo>/node_modules && echo link`), STOP and ask the coordinator (an install would write through it into another checkout); otherwise `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok`. Check the isolated database is migrated: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` shows every migration completed (if not, `<db-env> … pnpm -C <repo>/apps/platform migrate` first).

- [ ] **Step 4: Baseline**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inbox.spec.ts --files=session_counts.spec.ts --files=inquiry_service.spec.ts --files=project_service.spec.ts --files=deposit_service.spec.ts --files=verify_account_command.spec.ts`. Expected: PASS (a file name that matches nothing is fine). Then the full suite in the background: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (the final count must be 16 higher; Task 7 has the breakdown).

---

### Task 1: The arithmetic and the words

**Files:**
- Create: `apps/platform/app/modules/reports/pilot_metrics.ts`
- Test: `apps/platform/tests/unit/modules/reports/pilot_metrics.spec.ts` (create)

**Interfaces:**
- From `#modules/reports/pilot_metrics` (imports luxon only): `CARD_DAYS` (30), `GATE_DAYS` (42), `type MetricsWindow`, `lastDays(days, now?)`, `type PilotFacts`, `noFacts()`, `linkShare(facts)`, `median(values)`, `noShowRate(sessions)`, `percentText(ratio)`, `durationText(hours)`, `combineFacts(list)`, `type PilotTile`, `type PilotCard`, `pilotTiles(facts)`, `pilotNote(facts)`, `pilotCard(facts, days)`, `pilotLines(heading, facts)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/reports/pilot_metrics.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	combineFacts,
	durationText,
	lastDays,
	linkShare,
	median,
	noFacts,
	noShowRate,
	type PilotFacts,
	percentText,
	pilotCard,
	pilotLines,
} from "#modules/reports/pilot_metrics";

const facts = (over: Partial<PilotFacts> = {}): PilotFacts => ({
	...noFacts(),
	...over,
});

const busy = facts({
	linkInquiries: 12,
	deskProjects: 4,
	depositHours: [10, 50, 60, 70, 200, 30, 90, 80],
	sessions: { completed: 23, noShow: 2, noOutcome: 3 },
});

test.group("pilot metrics: arithmetic", () => {
	test("lastDays is the N × 24 hours before now, half-open", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-20T09:30:00Z");
		const { from, to } = lastDays(30, now);
		assert.equal(to.toMillis(), now.toMillis());
		assert.equal(now.diff(from, "hours").hours, 720);
	});

	test("linkShare, noShowRate and median, and null with nothing to count", ({
		assert,
	}) => {
		assert.equal(linkShare({ linkInquiries: 12, deskProjects: 4 }), 0.75);
		assert.equal(linkShare({ linkInquiries: 0, deskProjects: 3 }), 0);
		assert.isNull(linkShare({ linkInquiries: 0, deskProjects: 0 }));
		assert.equal(noShowRate({ completed: 23, noShow: 2, noOutcome: 9 }), 0.08);
		assert.isNull(noShowRate({ completed: 0, noShow: 0, noOutcome: 4 }));
		assert.equal(median([5, 1, 3]), 3);
		assert.equal(median([4, 1, 3, 2]), 2.5);
		assert.equal(median([7]), 7);
		assert.isNull(median([]));
	});

	test("percentText rounds to whole percents; durationText reads hours, then days", ({
		assert,
	}) => {
		assert.equal(percentText(0.75), "75%");
		assert.equal(percentText(0.0833), "8%");
		assert.equal(percentText(1), "100%");
		assert.equal(durationText(0.4), "under an hour");
		assert.equal(durationText(1.2), "1 hour");
		assert.equal(durationText(18.4), "18 hours");
		assert.equal(durationText(47.6), "48 hours");
		assert.equal(durationText(48), "2 days");
		assert.equal(durationText(60), "2.5 days");
		assert.equal(durationText(73), "3 days");
	});

	test("combineFacts sums the counts and pools the durations", ({ assert }) => {
		assert.deepEqual(
			combineFacts([
				facts({
					linkInquiries: 2,
					deskProjects: 1,
					depositHours: [10],
					sessions: { completed: 3, noShow: 1, noOutcome: 0 },
				}),
				facts({
					linkInquiries: 1,
					depositHours: [20, 30],
					sessions: { completed: 1, noShow: 0, noOutcome: 2 },
				}),
			]),
			{
				linkInquiries: 3,
				deskProjects: 1,
				depositHours: [10, 20, 30],
				sessions: { completed: 4, noShow: 1, noOutcome: 2 },
			},
		);
		assert.deepEqual(combineFacts([]), noFacts());
	});
});

test.group("pilot metrics: words", () => {
	test("the card with data", ({ assert }) => {
		assert.deepEqual(pilotCard(busy, 30), {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "75%",
					detail: "12 inquiries through the link, 4 bookings at the desk",
				},
				{
					label: "Inquiry to deposit",
					value: "2.7 days",
					detail: "Median of 8 deposits",
				},
				{
					label: "No-shows",
					value: "8%",
					detail: "2 of 25 finished sessions",
				},
			],
			note: "3 past sessions without an outcome aren't counted.",
		});
	});

	test("the card with nothing yet: dashes and why", ({ assert }) => {
		assert.deepEqual(pilotCard(noFacts(), 30), {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "—",
					detail: "No inquiries or desk bookings yet.",
				},
				{
					label: "Inquiry to deposit",
					value: "—",
					detail: "No deposits verified from an inquiry yet.",
				},
				{
					label: "No-shows",
					value: "—",
					detail: "No finished sessions yet.",
				},
			],
			note: null,
		});
	});

	test("singulars", ({ assert }) => {
		const card = pilotCard(
			facts({
				linkInquiries: 1,
				deskProjects: 1,
				depositHours: [5],
				sessions: { completed: 0, noShow: 1, noOutcome: 1 },
			}),
			7,
		);
		assert.equal(card.title, "Last 7 days");
		assert.deepEqual(
			card.tiles.map(({ value, detail }) => [value, detail]),
			[
				["50%", "1 inquiry through the link, 1 booking at the desk"],
				["5 hours", "From 1 deposit"],
				["100%", "1 of 1 finished session"],
			],
		);
		assert.equal(card.note, "1 past session without an outcome isn't counted.");
	});

	test("pilotLines: the heading, one line per number, then the note", ({
		assert,
	}) => {
		assert.deepEqual(pilotLines("Black Needle (black-needle)", busy), [
			"Black Needle (black-needle)",
			"  Through the link: 75% (12 inquiries through the link, 4 bookings at the desk)",
			"  Inquiry to deposit: 2.7 days (Median of 8 deposits)",
			"  No-shows: 8% (2 of 25 finished sessions)",
			"  3 past sessions without an outcome aren't counted.",
		]);
		assert.lengthOf(pilotLines("Red Ink (red-ink)", noFacts()), 4);
	});
});
```

(`busy`'s sorted hours are 10, 30, 50, 60, 70, 80, 90, 200: the median is (60 + 70) / 2 = 65 hours, 2.708 days, which reads "2.7 days".)

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=pilot_metrics.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `#modules/reports/pilot_metrics`.

- [ ] **Step 3: Write the module**

Create `apps/platform/app/modules/reports/pilot_metrics.ts`:

```ts
import { DateTime } from "luxon";

/**
 * The pilot's three numbers (TAT-70) as plain arithmetic and words: how
 * much new work arrives through the intake link, how long an inquiry takes
 * to become a verified deposit, and how many clients miss their session.
 * PilotMetricsService gathers the facts; the inbox card and metrics:pilot
 * print them with these functions. The definitions are the spec's rulings
 * 3 to 7.
 */

/** The owners' card covers the last 30 days. */
export const CARD_DAYS = 30;

/** metrics:pilot's default: gate 1's six weeks. */
export const GATE_DAYS = 42;

/** A half-open window of instants: [from, to). */
export type MetricsWindow = { from: DateTime; to: DateTime };

/** The `days` × 24 hours before `now`: instants, so no time zone changes a number. */
export function lastDays(
	days: number,
	now: DateTime = DateTime.now(),
): MetricsWindow {
	return { from: now.minus({ hours: days * 24 }), to: now };
}

/** One studio's raw facts in a window (or several studios', combined). */
export type PilotFacts = {
	/** Live inquiries that arrived in the window: every inquiry comes through the intake link. */
	linkInquiries: number;
	/** Live projects booked at the desk (no inquiry) in the window. */
	deskProjects: number;
	/** Hours from each inquiry to its project's first verified deposit, for those verified in the window. */
	depositHours: number[];
	/** Sessions that started in the window, by outcome; `noOutcome` ones are still scheduled. */
	sessions: { completed: number; noShow: number; noOutcome: number };
};

/** Facts with nothing in them. */
export function noFacts(): PilotFacts {
	return {
		linkInquiries: 0,
		deskProjects: 0,
		depositHours: [],
		sessions: { completed: 0, noShow: 0, noOutcome: 0 },
	};
}

/** The share of new work that came through the link, or null with none at all. */
export function linkShare({
	linkInquiries,
	deskProjects,
}: Pick<PilotFacts, "linkInquiries" | "deskProjects">): number | null {
	const total = linkInquiries + deskProjects;
	return total === 0 ? null : linkInquiries / total;
}

/** The middle value (the mean of the two middle ones for an even count), or null for none. */
export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const at = (index: number) => sorted[index] ?? 0;
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return at(middle);
	return (at(middle - 1) + at(middle)) / 2;
}

/** No-shows out of the sessions that happened or should have, or null with none. */
export function noShowRate({
	completed,
	noShow,
}: PilotFacts["sessions"]): number | null {
	const finished = completed + noShow;
	return finished === 0 ? null : noShow / finished;
}

/** "75%": a whole percentage. */
export function percentText(ratio: number): string {
	return `${Math.round(ratio * 100)}%`;
}

/** "under an hour", "18 hours" (under 48), then "2.5 days" or "3 days". */
export function durationText(hours: number): string {
	if (hours < 1) return "under an hour";
	if (hours < 48) {
		const whole = Math.round(hours);
		return whole === 1 ? "1 hour" : `${whole} hours`;
	}
	const days = Math.round((hours / 24) * 10) / 10;
	return `${Number.isInteger(days) ? days.toFixed(0) : days.toFixed(1)} days`;
}

/** Several studios' facts as one: counts summed, durations pooled (the median is over all of them). */
export function combineFacts(list: readonly PilotFacts[]): PilotFacts {
	return list.reduce(
		(all, one) => ({
			linkInquiries: all.linkInquiries + one.linkInquiries,
			deskProjects: all.deskProjects + one.deskProjects,
			depositHours: [...all.depositHours, ...one.depositHours],
			sessions: {
				completed: all.sessions.completed + one.sessions.completed,
				noShow: all.sessions.noShow + one.sessions.noShow,
				noOutcome: all.sessions.noOutcome + one.sessions.noOutcome,
			},
		}),
		noFacts(),
	);
}

/** One number: its label, its value ("—" with nothing to count) and what it is made of. */
export type PilotTile = { label: string; value: string; detail: string };

/** The owners' card: "Last 30 days", three tiles, and the hint about sessions without an outcome. */
export type PilotCard = { title: string; tiles: PilotTile[]; note: string | null };

const NONE = "—";

const plural = (count: number, one: string, many: string) =>
	`${count} ${count === 1 ? one : many}`;

/** The three numbers, worded. */
export function pilotTiles(facts: PilotFacts): PilotTile[] {
	const share = linkShare(facts);
	const middle = median(facts.depositHours);
	const rate = noShowRate(facts.sessions);
	const deposits = facts.depositHours.length;
	const finished = facts.sessions.completed + facts.sessions.noShow;

	let depositDetail = "No deposits verified from an inquiry yet.";
	if (deposits === 1) depositDetail = "From 1 deposit";
	else if (deposits > 1) depositDetail = `Median of ${deposits} deposits`;

	return [
		{
			label: "Through the link",
			value: share === null ? NONE : percentText(share),
			detail:
				share === null
					? "No inquiries or desk bookings yet."
					: `${plural(facts.linkInquiries, "inquiry", "inquiries")} through the link, ${plural(facts.deskProjects, "booking", "bookings")} at the desk`,
		},
		{
			label: "Inquiry to deposit",
			value: middle === null ? NONE : durationText(middle),
			detail: depositDetail,
		},
		{
			label: "No-shows",
			value: rate === null ? NONE : percentText(rate),
			detail:
				rate === null
					? "No finished sessions yet."
					: `${facts.sessions.noShow} of ${plural(finished, "finished session", "finished sessions")}`,
		},
	];
}

/** "3 past sessions without an outcome aren't counted.", or null when every past session has one. */
export function pilotNote({ sessions }: PilotFacts): string | null {
	if (sessions.noOutcome === 0) return null;
	if (sessions.noOutcome === 1) {
		return "1 past session without an outcome isn't counted.";
	}
	return `${sessions.noOutcome} past sessions without an outcome aren't counted.`;
}

/** The inbox card's props for the last `days` days. */
export function pilotCard(facts: PilotFacts, days: number): PilotCard {
	return {
		title: `Last ${days} days`,
		tiles: pilotTiles(facts),
		note: pilotNote(facts),
	};
}

/** metrics:pilot's block: the heading, one line per number, then the note. */
export function pilotLines(heading: string, facts: PilotFacts): string[] {
	const note = pilotNote(facts);
	return [
		heading,
		...pilotTiles(facts).map(
			({ label, value, detail }) => `  ${label}: ${value} (${detail})`,
		),
		...(note ? [`  ${note}`] : []),
	];
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=pilot_metrics.spec.ts`
Expected: PASS, 8 tests. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/reports/pilot_metrics.ts apps/platform/tests/unit/modules/reports/pilot_metrics.spec.ts
git -C <repo> add apps/platform/app/modules/reports/pilot_metrics.ts apps/platform/tests/unit/modules/reports/pilot_metrics.spec.ts
git -C <repo> commit -m "feat(platform): add the pilot metrics' arithmetic and words" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The reads, each in its own module

**Files:**
- Modify: `apps/platform/app/modules/inquiries/services/inquiry_service.ts` (`countReceived`, `receivedAt`)
- Modify: `apps/platform/app/modules/projects/services/project_service.ts` (`countBookedAtDesk`, `inquiryIdsFor`)
- Modify: `apps/platform/app/modules/payments/services/deposit_service.ts` (`firstVerifiedDeposits`)
- Modify: `apps/platform/tests/helpers/pipeline.ts` (`createdAt` in `InquiryOver` and `ProjectOver`)
- Test: `apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts` (create; Task 3 adds to it)

**Interfaces:**
- `InquiryService.countReceived(tenant, { from, to }): Promise<number>`; `InquiryService.receivedAt(tenant, ids: string[]): Promise<Map<string, DateTime>>`.
- `ProjectService.countBookedAtDesk(tenant, { from, to }): Promise<number>`; `ProjectService.inquiryIdsFor(tenant, projectIds: string[]): Promise<Map<string, string>>` (project id → inquiry id).
- `DepositService.firstVerifiedDeposits(tenant, { from, to }): Promise<{ projectId: string; verifiedAt: DateTime }[]>` (no order).

- [ ] **Step 1: Let the factories take a creation time**

In `apps/platform/tests/helpers/pipeline.ts`, in `type InquiryOver`, replace

```ts
		| "anonymizedAt"
	>
>;
```

with

```ts
		| "anonymizedAt"
		| "createdAt"
	>
>;
```

and in `type ProjectOver`, replace

```ts
		"artistId" | "inquiryId" | "brief" | "notes" | "status" | "lastContactedAt"
```

with

```ts
		| "artistId"
		| "inquiryId"
		| "brief"
		| "notes"
		| "status"
		| "lastContactedAt"
		| "createdAt"
```

(Lucid's `autoCreate` keeps a `createdAt` that is given.)

- [ ] **Step 2: Write the failing tests**

Create `apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts`:

```ts
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry from "#modules/inquiries/models/inquiry";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import {
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const WINDOW = {
	from: DateTime.utc(2026, 11, 1),
	to: DateTime.utc(2026, 12, 1),
};
/** 10:00 UTC (or `hour`) on a day of November 2026. */
const nov = (day: number, hour = 10) => DateTime.utc(2026, 11, day, hour);
const verifiedOn = (at: DateTime) => ({
	status: "verified" as const,
	verifiedAt: at,
});

test.group("Pilot metrics reads (TAT-70)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("countReceived and countBookedAtDesk: the window's live inquiries, any status, and its live desk bookings", async ({
		assert,
	}) => {
		const inquiries = await app.container.make(InquiryService);
		const projects = await app.container.make(ProjectService);
		const { tenant } = await studioWithOwner("reads-a-70");
		const { tenant: other } = await studioWithOwner("reads-b-70");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeInquiry(tenant, client, { createdAt: nov(2) });
			await makeInquiry(tenant, client, {
				status: "declined",
				decidedAt: nov(3),
				createdAt: nov(3),
			});
			const accepted = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(5),
				createdAt: nov(4),
			});
			// Made from an inquiry: not a desk booking.
			await makeProject(tenant, client, {
				inquiryId: accepted.id,
				createdAt: nov(5),
			});
			const gone = await makeInquiry(tenant, client, { createdAt: nov(6) });
			await (await Inquiry.findOrFail(gone.id)).softDelete();
			// Outside the half-open window.
			await makeInquiry(tenant, client, {
				createdAt: DateTime.utc(2026, 10, 31, 23, 59),
			});
			await makeInquiry(tenant, client, { createdAt: WINDOW.to });

			await makeProject(tenant, client, { status: "booked", createdAt: nov(2) });
			const deleted = await makeProject(tenant, client, {
				status: "booked",
				createdAt: nov(10),
			});
			await (await TattooProject.findOrFail(deleted.id)).softDelete();
			await makeProject(tenant, client, {
				status: "booked",
				createdAt: DateTime.utc(2026, 10, 30),
			});
		});

		assert.equal(
			await inTenant(tenant, () => inquiries.countReceived(tenant, WINDOW)),
			3,
		);
		assert.equal(
			await inTenant(tenant, () => projects.countBookedAtDesk(tenant, WINDOW)),
			1,
		);
		// Another studio's context can't see these rows, even naming the tenant.
		assert.equal(
			await inTenant(other, () => inquiries.countReceived(tenant, WINDOW)),
			0,
		);
		assert.equal(
			await inTenant(other, () => projects.countBookedAtDesk(tenant, WINDOW)),
			0,
		);
	});

	test("firstVerifiedDeposits: each project's first verified deposit that no correction reverses, when that is in the window", async ({
		assert,
	}) => {
		const deposits = await app.container.make(DepositService);
		const projects = await app.container.make(ProjectService);
		const inquiries = await app.container.make(InquiryService);
		const { tenant } = await studioWithOwner("deposits-70");

		const made = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(1),
				createdAt: nov(1, 8),
			});
			const first = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
				status: "booked",
			});
			await makePayment(tenant, first, verifiedOn(nov(3)));
			await makePayment(tenant, first, verifiedOn(nov(20)));

			// The first verification was reversed: the next one counts.
			const reversed = await makeProject(tenant, client, { status: "booked" });
			const mistake = await makePayment(tenant, reversed, verifiedOn(nov(2)));
			await makePayment(tenant, reversed, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: mistake.id,
				...verifiedOn(nov(2, 11)),
			});
			await makePayment(tenant, reversed, verifiedOn(nov(8)));

			// First verified before the window: not this window's.
			const earlier = await makeProject(tenant, client, { status: "booked" });
			await makePayment(
				tenant,
				earlier,
				verifiedOn(DateTime.utc(2026, 10, 28)),
			);
			await makePayment(tenant, earlier, verifiedOn(nov(5)));

			// Waiting, rejected, or not a deposit: nothing.
			const waiting = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makePayment(tenant, waiting);
			await makePayment(tenant, waiting, {
				status: "rejected",
				verifiedAt: nov(4),
			});
			const balance = await makeProject(tenant, client, { status: "booked" });
			await makePayment(tenant, balance, {
				kind: "balance",
				...verifiedOn(nov(6)),
			});
			return { inquiry, first, reversed };
		});

		const rows = await inTenant(tenant, () =>
			deposits.firstVerifiedDeposits(tenant, WINDOW),
		);
		const byProject = new Map(
			rows.map(({ projectId, verifiedAt }) => [
				projectId,
				verifiedAt.toMillis(),
			]),
		);
		assert.deepEqual(
			[...byProject.entries()].sort(),
			[
				[made.first.id, nov(3).toMillis()],
				[made.reversed.id, nov(8).toMillis()],
			].sort(),
		);

		// Which projects came from an inquiry, and when that inquiry arrived.
		const inquiryOf = await inTenant(tenant, () =>
			projects.inquiryIdsFor(tenant, [made.first.id, made.reversed.id]),
		);
		assert.deepEqual([...inquiryOf.entries()], [[made.first.id, made.inquiry.id]]);
		const received = await inTenant(tenant, () =>
			inquiries.receivedAt(tenant, [made.inquiry.id]),
		);
		assert.equal(received.get(made.inquiry.id)?.toMillis(), nov(1, 8).toMillis());
	});
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_service.spec.ts`
Expected: FAIL in both tests (`inquiries.countReceived is not a function`, `deposits.firstVerifiedDeposits is not a function`). If Japa hangs instead, rerun with the `timeout 120` form and read the log.

- [ ] **Step 4: Write the reads**

In `apps/platform/app/modules/inquiries/services/inquiry_service.ts`, after the `countNew` method, add:

```ts
	/**
	 * How many live inquiries arrived in [from, to), whatever became of
	 * them: every inquiry comes through the intake link (TAT-51). The pilot's
	 * link share (TAT-70).
	 */
	async countReceived(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<number> {
		const [row] = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.where("created_at", ">=", from.toJSDate())
			.where("created_at", "<", to.toJSDate())
			// The soft-delete scope is a fetch hook; say it here too, for the aggregate.
			.whereNull("deleted_at")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** When each of these live inquiries arrived, by id (TAT-70). */
	async receivedAt(
		tenant: TenantRef,
		ids: string[],
	): Promise<Map<string, DateTime>> {
		if (ids.length === 0) return new Map();
		const rows = await Inquiry.query()
			.where("tenant_id", tenant.id)
			.whereIn("id", ids)
			.select("id", "created_at");
		return new Map(rows.map((row) => [row.id, row.createdAt]));
	}
```

In `apps/platform/app/modules/projects/services/project_service.ts`, after the `projectIdsForInquiries` method, add:

```ts
	/**
	 * How many live projects were booked at the desk in [from, to): made
	 * directly (TAT-43), with no inquiry. The pilot's link share (TAT-70).
	 */
	async countBookedAtDesk(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<number> {
		const [row] = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereNull("inquiry_id")
			.where("created_at", ">=", from.toJSDate())
			.where("created_at", "<", to.toJSDate())
			// The soft-delete scope is a fetch hook; say it here too, for the aggregate.
			.whereNull("deleted_at")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/** The inquiry each of these live projects was made from, by project id; desk bookings are left out (TAT-70). */
	async inquiryIdsFor(
		tenant: TenantRef,
		projectIds: string[],
	): Promise<Map<string, string>> {
		if (projectIds.length === 0) return new Map();
		const rows = await TattooProject.query()
			.where("tenant_id", tenant.id)
			.whereIn("id", projectIds)
			.whereNotNull("inquiry_id")
			.select("id", "inquiry_id");
		return new Map(rows.map((row) => [row.id, row.inquiryId as string]));
	}
```

In `apps/platform/app/modules/payments/services/deposit_service.ts`, add `import { DateTime } from "luxon";` to the imports (Biome orders it), and after the `countPendingProofs` method add:

```ts
	/**
	 * Each project's first verified deposit, for the projects whose first one
	 * was verified in [from, to): the pilot's inquiry-to-deposit time
	 * (TAT-70). A deposit counts once the studio verified it, a screenshot
	 * from the deposit page or one recorded at the desk (`verified_at` is
	 * when the studio decided); one a correction reverses doesn't count.
	 */
	async firstVerifiedDeposits(
		tenant: TenantRef,
		{ from, to }: { from: DateTime; to: DateTime },
	): Promise<{ projectId: string; verifiedAt: DateTime }[]> {
		const rows = await Payment.query()
			.where("tenant_id", tenant.id)
			.where("kind", "deposit")
			.where("status", "verified")
			.whereRaw(
				"not exists (select 1 from payments as reversals where reversals.corrects_payment_id = payments.id)",
			)
			.select("project_id")
			.min("verified_at as first_verified_at")
			.groupBy("project_id")
			.havingRaw("min(verified_at) >= ? and min(verified_at) < ?", [
				from.toJSDate(),
				to.toJSDate(),
			]);
		return rows.map((row) => ({
			projectId: row.projectId,
			verifiedAt: DateTime.fromJSDate(row.$extras.first_verified_at),
		}));
	}
```

- [ ] **Step 5: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_service.spec.ts --files=inbox.spec.ts --files=session_counts.spec.ts`
Expected: PASS (2 new). Then `typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/inquiries/services/inquiry_service.ts apps/platform/app/modules/projects/services/project_service.ts apps/platform/app/modules/payments/services/deposit_service.ts apps/platform/tests/helpers/pipeline.ts apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts
git -C <repo> add apps/platform/app/modules/inquiries/services/inquiry_service.ts apps/platform/app/modules/projects/services/project_service.ts apps/platform/app/modules/payments/services/deposit_service.ts apps/platform/tests/helpers/pipeline.ts apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts
git -C <repo> commit -m "feat(platform): count inquiries, desk bookings and first verified deposits per window" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `PilotMetricsService`

**Files:**
- Create: `apps/platform/app/modules/reports/services/pilot_metrics_service.ts`
- Test: `apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts` (add a test)

**Interfaces:**
- `PilotMetricsService.forStudio(tenant: { id: string }, window: MetricsWindow): Promise<PilotFacts>` (default export of `#modules/reports/services/pilot_metrics_service`).

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts`, add these imports (Biome orders them):

```ts
import { noFacts } from "#modules/reports/pilot_metrics";
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
import { makeArtist, makeSession } from "#tests/helpers/pipeline";
```

(merge `makeArtist` and `makeSession` into the existing `#tests/helpers/pipeline` import), and at the end of the group add:

```ts
	test("forStudio: the three facts from the studio's own data, and none from another studio's context", async ({
		assert,
	}) => {
		const metrics = await app.container.make(PilotMetricsService);
		const { tenant } = await studioWithOwner("facts-a-70");
		const { tenant: other } = await studioWithOwner("facts-b-70");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const artist = await makeArtist(tenant);
			// Two inquiries that became projects with verified deposits: 48 h and 12 h.
			const slow = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(1, 12),
				createdAt: nov(1, 10),
			});
			const quick = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(2, 6),
				createdAt: nov(2, 0),
			});
			for (const [inquiry, verified] of [
				[slow, nov(3, 10)],
				[quick, nov(2, 12)],
			] as const) {
				const project = await makeProject(tenant, client, {
					inquiryId: inquiry.id,
					status: "booked",
				});
				await makePayment(tenant, project, verifiedOn(verified));
			}
			// A desk booking: counted for the link share, not for the deposit time.
			const desk = await makeProject(tenant, client, {
				status: "booked",
				artistId: artist.id,
				createdAt: nov(4),
			});
			await makePayment(tenant, desk, verifiedOn(nov(5)));
			// Its sessions: one done, one missed, one past without an outcome, one cancelled.
			for (const [day, status] of [
				[6, "completed"],
				[7, "no_show"],
				[8, "scheduled"],
				[9, "cancelled"],
			] as const) {
				await makeSession(tenant, desk, artist, {
					status,
					startsAt: nov(day),
					endsAt: nov(day, 11),
				});
			}
		});

		const facts = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW),
		);
		assert.deepEqual(
			{ ...facts, depositHours: [...facts.depositHours].sort((a, b) => a - b) },
			{
				linkInquiries: 2,
				deskProjects: 1,
				depositHours: [12, 48],
				sessions: { completed: 1, noShow: 1, noOutcome: 1 },
			},
		);
		assert.deepEqual(
			await inTenant(other, () => metrics.forStudio(tenant, WINDOW)),
			noFacts(),
		);
	});
```

- [ ] **Step 2: Run it to see it fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `#modules/reports/services/pilot_metrics_service`.

- [ ] **Step 3: Write the service**

Create `apps/platform/app/modules/reports/services/pilot_metrics_service.ts`:

```ts
import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type {
	MetricsWindow,
	PilotFacts,
} from "#modules/reports/pilot_metrics";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";

/**
 * The pilot's facts for one studio (TAT-70), from what the modules already
 * store: no table of its own. Each module answers for its own rows; every
 * read is a model query in the ambient transaction, so row-level security
 * keeps it to the studio whose context is set (the inbox request's, or the
 * one metrics:pilot sets per studio). TAT-76's reports build on it.
 */
@inject()
export default class PilotMetricsService {
	constructor(
		private inquiries: InquiryService,
		private projects: ProjectService,
		private deposits: DepositService,
		private sessions: SessionService,
	) {}

	async forStudio(
		tenant: { id: string },
		window: MetricsWindow,
	): Promise<PilotFacts> {
		const linkInquiries = await this.inquiries.countReceived(tenant, window);
		const deskProjects = await this.projects.countBookedAtDesk(tenant, window);

		const deposits = await this.deposits.firstVerifiedDeposits(tenant, window);
		const inquiryOf = await this.projects.inquiryIdsFor(
			tenant,
			deposits.map(({ projectId }) => projectId),
		);
		const receivedAt = await this.inquiries.receivedAt(tenant, [
			...inquiryOf.values(),
		]);
		const depositHours = deposits.flatMap(({ projectId, verifiedAt }) => {
			const inquiryId = inquiryOf.get(projectId);
			const received = inquiryId ? receivedAt.get(inquiryId) : undefined;
			if (!received) return [];
			return [Math.max(0, verifiedAt.diff(received, "hours").hours)];
		});

		const { studio } = await this.sessions.countByStatus(tenant, window);
		return {
			linkInquiries,
			deskProjects,
			depositHours,
			sessions: {
				completed: studio.completed,
				noShow: studio.no_show,
				// The window ends now, so a session still scheduled in it has started.
				noOutcome: studio.scheduled,
			},
		};
	}
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_service.spec.ts`
Expected: PASS, 3 tests. Then `typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/reports/services/pilot_metrics_service.ts apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts
git -C <repo> add apps/platform/app/modules/reports/services/pilot_metrics_service.ts apps/platform/tests/functional/reports/pilot_metrics_service.spec.ts
git -C <repo> commit -m "feat(platform): gather a studio's pilot metrics from its own data" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The owners' card under the inbox

**Files:**
- Modify: `apps/platform/app/controllers/inquiries_controller.ts` (constructor, `index`)
- Create: `apps/platform/inertia/components/pilot_metrics_card.tsx`
- Modify: `apps/platform/inertia/components/inquiries.ts` (`InboxListProps`), `apps/platform/inertia/pages/inquiries/index.tsx`
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts` (add 2 tests to "Inbox pages")

**Interfaces:**
- `inquiries/index` gains the prop `pilotMetrics: PilotCardProps` (`{ title: string; tiles: { label: string; value: string; detail: string }[]; note: string | null }`), the server's `pilotCard(…, CARD_DAYS)`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/inquiries/inbox.spec.ts`, inside `test.group("Inbox pages", (group) => {`, after the test "the Decided tab links accepted inquiries to their project", add:

```ts
	test("owners see the last 30 days' pilot numbers under the inbox", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer);
			// Booked at the desk: a project with no inquiry.
			await makeProject(tenant, customer, { status: "booked" });
			// Older than 30 days: not counted.
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
				createdAt: DateTime.utc().minus({ days: 31 }),
			});
		});

		const props = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps;

		assert.deepEqual(props.pilotMetrics, {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "50%",
					detail: "1 inquiry through the link, 1 booking at the desk",
				},
				{
					label: "Inquiry to deposit",
					value: "—",
					detail: "No deposits verified from an inquiry yet.",
				},
				{
					label: "No-shows",
					value: "—",
					detail: "No finished sessions yet.",
				},
			],
			note: null,
		});
	});

	test("the Decided tab shows the same card, with dashes when there is nothing yet", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const props = (
			await client.get(inbox("?view=decided")).withInertia().loginAs(owner)
		).inertiaProps;

		assert.equal(props.pilotMetrics.title, "Last 30 days");
		assert.deepEqual(
			props.pilotMetrics.tiles.map(({ value }: { value: string }) => value),
			["—", "—", "—"],
		);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inbox.spec.ts`
Expected: FAIL in the 2 new tests (`pilotMetrics` is undefined); the others pass.

- [ ] **Step 3: The prop**

In `apps/platform/app/controllers/inquiries_controller.ts`:

(a) Add the imports (Biome orders them):

```ts
import { CARD_DAYS, lastDays, pilotCard } from "#modules/reports/pilot_metrics";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
```

(b) In the constructor, after `private templates: MessageTemplateService,`, add `private metrics: PilotMetricsService,`.

(c) In `index`, in the props passed to `ctx.inertia.render("inquiries/index", { … })`, after `page: { current: page, last: lastPage, total },` add:

```ts
			// The owners' pilot numbers (TAT-70); TAT-107 moves them to Today.
			pilotMetrics: pilotCard(
				await this.metrics.forStudio(tenant, lastDays(CARD_DAYS)),
				CARD_DAYS,
			),
```

- [ ] **Step 4: The card**

Create `apps/platform/inertia/components/pilot_metrics_card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/** The card's props: #modules/reports/pilot_metrics's PilotCard, worded by the server. */
export type PilotCardProps = {
	title: string;
	tiles: { label: string; value: string; detail: string }[];
	note: string | null;
};

/**
 * The studio's pilot numbers for the last 30 days (TAT-70): how much new
 * work comes through the intake link, how long an inquiry takes to become
 * a verified deposit, and how many clients miss their session. Owners only,
 * under the inbox; TAT-107's Today screen takes it over.
 */
export default function PilotMetricsCard({
	metrics,
}: {
	metrics: PilotCardProps;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{metrics.title}</h2>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<dl className="grid gap-4 sm:grid-cols-3">
					{metrics.tiles.map((tile) => (
						<div key={tile.label} className="flex flex-col gap-1">
							<dt className="text-sm text-muted-foreground">{tile.label}</dt>
							<dd className="text-2xl font-semibold">{tile.value}</dd>
							<dd className="text-sm text-muted-foreground">{tile.detail}</dd>
						</div>
					))}
				</dl>
				{metrics.note && (
					<p className="text-sm text-muted-foreground">{metrics.note}</p>
				)}
			</CardContent>
		</Card>
	);
}
```

In `apps/platform/inertia/components/inquiries.ts`, add at the top `import type { PilotCardProps } from "~/components/pilot_metrics_card";` and replace

```ts
export type InboxListProps = {
	view: "new" | "decided";
	newCount: number;
	inquiries: InquiryRow[];
	page: { current: number; last: number; total: number };
};
```

with

```ts
export type InboxListProps = {
	view: "new" | "decided";
	newCount: number;
	inquiries: InquiryRow[];
	page: { current: number; last: number; total: number };
	/** The owners' last 30 days (TAT-70). */
	pilotMetrics: PilotCardProps;
};
```

In `apps/platform/inertia/pages/inquiries/index.tsx`:
(a) add `import PilotMetricsCard from "~/components/pilot_metrics_card";` to the imports;
(b) in the props destructuring, after `page,` add `pilotMetrics,`;
(c) right before the closing `</Page>`, after the `{page.last > 1 && ( … )}` block, add:

```tsx
			<PilotMetricsCard metrics={pilotMetrics} />
```

and change the component's doc comment from `first, and the decided ones. Owners only.` to `first, and the decided ones, with the studio's pilot numbers below (TAT-70). Owners only.`.

- [ ] **Step 5: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inbox.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts`
Expected: PASS, 2 new tests; "artists get a 404 on the inbox and on an inquiry" and the isolation cases unchanged. Then `typecheck` (server and inertia): clean. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and `git -C <repo> status --short apps/platform/.adonisjs`.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/inquiries_controller.ts apps/platform/inertia/components/pilot_metrics_card.tsx apps/platform/inertia/components/inquiries.ts apps/platform/inertia/pages/inquiries/index.tsx apps/platform/tests/functional/inquiries/inbox.spec.ts
git -C <repo> add apps/platform/app/controllers/inquiries_controller.ts apps/platform/inertia/components/pilot_metrics_card.tsx apps/platform/inertia/components/inquiries.ts apps/platform/inertia/pages/inquiries/index.tsx apps/platform/tests/functional/inquiries/inbox.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): show owners their last 30 days' pilot numbers under the inbox" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The team's view: `metrics:pilot`

**Files:**
- Create: `apps/platform/commands/pilot_metrics.ts`
- Test: `apps/platform/tests/functional/reports/pilot_metrics_command.spec.ts` (create)

**Interfaces:**
- `node ace metrics:pilot [--days=42]` (`node build/ace.js metrics:pilot` in production). Default export `PilotMetrics` and `type Studio = { id: string; slug: string; name: string }` from `apps/platform/commands/pilot_metrics.ts`; `protected studios(): Promise<Studio[]>` is the owner-role list a test overrides. Ace loads app commands from `commands/` itself; nothing registers it.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/reports/pilot_metrics_command.spec.ts`:

```ts
import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makeInquiry, makeProject } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
// No #commands alias exists (and package.json stays as it is), so the
// command is imported by path.
import PilotMetrics, { type Studio } from "../../../commands/pilot_metrics.js";

/**
 * The command with the test's studios in place of the owner role's list:
 * the owner connection can't see rows this test's transaction holds.
 */
class TestPilotMetrics extends PilotMetrics {
	static listed: Studio[] = [];

	protected async studios(): Promise<Studio[]> {
		return TestPilotMetrics.listed;
	}
}

const listed = (...tenants: { id: string; slug: string; name: string }[]) =>
	tenants.map(({ id, slug, name }) => ({ id, slug, name }));

test.group("metrics:pilot (TAT-70)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	test("prints each studio's numbers, then all studios together, for the last 42 days by default", async () => {
		const { tenant: a } = await studioWithOwner("metrics-a-70", "Metrics A");
		const { tenant: b } = await studioWithOwner("metrics-b-70", "Metrics B");
		await inTenant(a, async () => {
			const customer = await makeClient(a);
			await makeInquiry(a, customer);
			// 43 days ago: outside the default window.
			await makeInquiry(a, customer, {
				createdAt: DateTime.utc().minus({ days: 43 }),
			});
			await makeProject(a, customer, { status: "booked" });
		});
		TestPilotMetrics.listed = listed(a, b);

		const command = await ace.create(TestPilotMetrics, []);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(
			/Pilot numbers for the last 42 days: \d{4}-\d\d-\d\d \d\d:\d\d to \d{4}-\d\d-\d\d \d\d:\d\d UTC\./,
		);
		command.assertLogMatches(/Metrics A \(metrics-a-70\)/);
		command.assertLogMatches(
			/Through the link: 50% \(1 inquiry through the link, 1 booking at the desk\)/,
		);
		command.assertLogMatches(/Metrics B \(metrics-b-70\)/);
		command.assertLogMatches(
			/Through the link: — \(No inquiries or desk bookings yet\.\)/,
		);
		command.assertLogMatches(/All studios \(2\)/);
	});

	test("counts only the last --days days, and refuses a number outside 1 to 3650", async () => {
		const { tenant } = await studioWithOwner("metrics-days-70", "Metrics Days");
		await inTenant(tenant, async () => {
			await makeInquiry(tenant, await makeClient(tenant), {
				createdAt: DateTime.utc().minus({ days: 10 }),
			});
		});
		TestPilotMetrics.listed = listed(tenant);

		const week = await ace.create(TestPilotMetrics, ["--days=7"]);
		await week.exec();
		week.assertSucceeded();
		week.assertLogMatches(/Pilot numbers for the last 7 days:/);
		week.assertLogMatches(
			/Through the link: — \(No inquiries or desk bookings yet\.\)/,
		);

		for (const days of ["0", "3651", "1.5"]) {
			const refused = await ace.create(TestPilotMetrics, [`--days=${days}`]);
			await refused.exec();
			refused.assertFailed();
			refused.assertLogMatches(/Give --days a whole number from 1 to 3650\./);
		}
	});

	test("says so when there are no studios", async () => {
		TestPilotMetrics.listed = [];

		const command = await ace.create(TestPilotMetrics, []);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(/No studios yet\./);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_command.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and `Cannot find module` for `commands/pilot_metrics.js`.

- [ ] **Step 3: The command**

Create `apps/platform/commands/pilot_metrics.ts`:

```ts
import { BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import type { DateTime } from "luxon";
import {
	combineFacts,
	GATE_DAYS,
	lastDays,
	type PilotFacts,
	pilotLines,
} from "#modules/reports/pilot_metrics";

/** A live studio as the command lists it: no more than it prints. */
export type Studio = { id: string; slug: string; name: string };

/**
 * The team's view of the pilot (TAT-70): every live studio's three numbers
 * (link share, inquiry to verified deposit, no-shows), then all studios
 * together, for the last --days days (42 by default: gate 1's six weeks).
 * Only the list of studios crosses tenants, read as the owner role; each
 * studio's numbers come from PilotMetricsService as the app role inside that
 * studio's row-level security context, exactly as its owners' card does.
 * Prints names, slugs and aggregates only. Run it where the owner role's
 * password is (the migration step's environment), never from the web or
 * the worker:
 *
 *   node ace metrics:pilot --days=42           (development)
 *   node build/ace.js metrics:pilot --days=42  (production)
 */
export default class PilotMetrics extends BaseCommand {
	static commandName = "metrics:pilot";
	static description =
		"Print every studio's pilot numbers: link share, inquiry to deposit, no-shows";
	static options: CommandOptions = { startApp: true };

	@flags.number({
		description: "How many days to count, ending now (gate 1 uses 42)",
		default: GATE_DAYS,
	})
	declare days: number;

	async run() {
		if (!Number.isInteger(this.days) || this.days < 1 || this.days > 3650) {
			this.logger.error("Give --days a whole number from 1 to 3650.");
			this.exitCode = 1;
			return;
		}
		// Imported once the app has started: models need a booted app.
		const { withDbContext } = await import("#services/db_context");
		const { default: PilotMetricsService } = await import(
			"#modules/reports/services/pilot_metrics_service"
		);
		const metrics = await this.app.container.make(PilotMetricsService);
		const window = lastDays(this.days);

		this.logger.log(
			`Pilot numbers for the last ${this.days} days: ${utc(window.from)} to ${utc(window.to)} UTC.`,
		);
		const studios = await this.studios();
		if (studios.length === 0) {
			this.logger.log("No studios yet.");
			return;
		}
		const all: PilotFacts[] = [];
		for (const studio of studios) {
			// The app role, in this studio's context: RLS keeps every number its own.
			const facts = await withDbContext({ tenantId: studio.id }, () =>
				metrics.forStudio(studio, window),
			);
			all.push(facts);
			for (const line of pilotLines(`${studio.name} (${studio.slug})`, facts)) {
				this.logger.log(line);
			}
		}
		for (const line of pilotLines(
			`All studios (${studios.length})`,
			combineFacts(all),
		)) {
			this.logger.log(line);
		}
	}

	/**
	 * The live studios, oldest first: the one read across tenants, as the
	 * owner role (row-level security doesn't apply to it), and only ids,
	 * slugs and names. Protected so a test can list its own studios: the
	 * owner connection can't see rows a test's transaction holds.
	 */
	protected async studios(): Promise<Studio[]> {
		const { default: db } = await import("@adonisjs/lucid/services/db");
		return db
			.connection("owner")
			.from("tenants")
			.whereNull("deleted_at")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc")
			.select("id", "slug", "name");
	}
}

/** "2026-10-20 09:30", in UTC. */
function utc(at: DateTime): string {
	return at.toUTC().toFormat("yyyy-MM-dd HH:mm");
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=pilot_metrics_command.spec.ts --files=verify_account_command.spec.ts`
Expected: PASS, 3 new tests and `account:verify`'s unchanged. Then `typecheck`: clean, and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace list | grep "metrics:pilot"` prints the command with its description. Then run it for real against the isolated database (the owner-role list, which no test covers): `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace metrics:pilot` prints the header, a block for every studio in that database (or "No studios yet."), and exits 0; paste the output (names and numbers only) into your report.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/commands/pilot_metrics.ts apps/platform/tests/functional/reports/pilot_metrics_command.spec.ts
git -C <repo> add apps/platform/commands/pilot_metrics.ts apps/platform/tests/functional/reports/pilot_metrics_command.spec.ts
git -C <repo> commit -m "feat(platform): add metrics:pilot, every studio's pilot numbers for the team" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/requirements.md`, `docs/architecture.md`, `docs/roadmap.md`
- Modify: `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `apps/platform/docs/deploy.md`, `apps/platform/database/README.md`

- [ ] **Step 1: requirements.md**

Replace

```markdown
- [ ] Pilot metrics: share of inquiries arriving through the link, time from inquiry to verified deposit, session no-shows
```

with

```markdown
- [x] Pilot metrics: share of inquiries arriving through the link, time from inquiry to verified deposit, session no-shows
- All three come from what the platform already stores, over a rolling window. Through the link: the inquiries that arrived (any outcome) out of those plus the projects booked at the desk. Inquiry to deposit: the median time from an inquiry to its project's first verified deposit that wasn't reversed (from the deposit page or the desk), counted when it was verified. No-shows: no-shows out of the sessions that were done or missed, by start time; past sessions without an outcome are named, not counted. Owners see their last 30 days under the inbox; the team runs `metrics:pilot` for every studio (42 days by default, gate 1's six weeks).
```

- [ ] **Step 2: architecture.md**

In the module table, after the row `| Notifications | Staff alerts (MVP), click-to-chat templates (MVP), SMS reminders (V1) | MVP |`, add:

```markdown
| Reports | Pilot metrics (MVP), owner reports (V1) | MVP |
```

- [ ] **Step 3: roadmap.md**

After the paragraph that starts `**Gate 1:** for 6 weeks,`, add the paragraph:

```markdown
The numbers come from `node build/ace.js metrics:pilot --days=42` (TAT-70): each studio's share of new work through the link, median time from inquiry to verified deposit and no-show rate. Requests that never reached the platform (quoted in chat, never booked) only show up in the check-ins.
```

- [ ] **Step 4: backend.md**

(a) In the bullet that starts `- Cross-tenant reads: the app role sees one tenant at a time,`, add at its end: ` The operator command \`metrics:pilot\` (TAT-70) is the one other cross-tenant read: it lists the live tenants (ids, slugs, names) through the \`owner\` connection and computes each one's numbers as the app role in that tenant's context; it runs from a shell, never in the web or worker process.`

(b) Before the `## Accounts` heading, add:

```markdown
## Reports

- Pilot metrics (TAT-70): the `reports` module (`app/modules/reports/`) has no table. `PilotMetricsService.forStudio(tenant, window)` (`#modules/reports/services/pilot_metrics_service`) gathers `PilotFacts` from the owning modules: `InquiryService.countReceived` and `receivedAt`, `ProjectService.countBookedAtDesk` and `inquiryIdsFor`, `DepositService.firstVerifiedDeposits` (per project, the first `verified` deposit no correction reverses) and `SessionService.countByStatus`. `#modules/reports/pilot_metrics` holds the arithmetic and the words (`linkShare`, `median`, `noShowRate`, `durationText`, `pilotCard`, `pilotLines`); windows are rolling instants (`lastDays`), so no time zone is involved. The inbox (owners only) renders `pilotCard(…, CARD_DAYS)` as `pilotMetrics`. `node ace metrics:pilot [--days=42]` (`commands/pilot_metrics.ts`) prints every live studio's block and one for all studios; see Cross-tenant reads above for its one owner-role query. TAT-76's reports extend the service.
```

- [ ] **Step 5: ui.md**

After the bullet that starts `- Chat links (TAT-52):`, add:

```markdown
- Pilot numbers (TAT-70): `PilotMetricsCard` (`inertia/components/pilot_metrics_card.tsx`) shows the server's worded `pilotMetrics` under the inbox, for owners: three label, value and detail tiles in a `dl` (stacked on phones, three columns from `sm`), text tokens only, no chart. TAT-107's Today screen takes it over.
```

- [ ] **Step 6: deploy.md**

In `### Processes`, after the bullet `- Before each release: \`node build/ace.js migration:run --connection=owner --force\` …`, add:

```markdown
- Pilot numbers (TAT-70): `node build/ace.js metrics:pilot --days=42` from the migration step's environment (it lists the studios as the owner role, so it needs `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`, plus the app role's `DB_USER` and `DB_PASSWORD` for the numbers). It prints studio names, slugs and aggregates only.
```

- [ ] **Step 7: database/README.md**

In the Row-level security section, replace `- **SECURITY DEFINER functions** are the only way across tenants.` with `- **SECURITY DEFINER functions** are the app role's only way across tenants.`, and after that bullet add:

```markdown
- **The owner connection outside migrations: `metrics:pilot` only (TAT-70).** The operator command lists the live tenants (ids, slugs, names) as the owner role and nothing else; every number it prints is computed as the app role inside each tenant's context. No other app code, and never the web or worker process, uses the `owner` connection.
```

- [ ] **Step 8: Check and commit**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check` → clean.

```bash
git -C <repo> add docs/requirements.md docs/architecture.md docs/roadmap.md apps/platform/docs/backend.md apps/platform/docs/ui.md apps/platform/docs/deploy.md apps/platform/database/README.md
git -C <repo> commit -m "docs: describe the pilot metrics and metrics:pilot" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full suite** (background): `<db-env> PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/final.log 2>&1`. Expected: PASS, the `Tests` line 16 higher than the baseline: unit `pilot_metrics.spec.ts` +8; functional `pilot_metrics_service.spec.ts` +3, `inbox.spec.ts` +2, `pilot_metrics_command.spec.ts` +3.
- [ ] **Step 2: Gates**: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `… pnpm -C <repo> typecheck`, `… pnpm -C <repo> build`: clean. `… pnpm -C <repo>/apps/platform exec node ace codegen` then `git -C <repo> status --short` → nothing uncommitted; `git -C <repo> diff --stat <base>..HEAD -- apps/platform/database` → nothing (no migration, no schema change).
- [ ] **Step 3: Report**: the commits, the `metrics:pilot` output from Task 5 Step 4, any deviation from the plan.

### Task 8: Browser pass

Follow the spec's "Browser pass" (dev server on `PORT=3401` with `<db-env>`). Record what each step showed, at 375 px and 1280 px, light and dark: the card's tiles stack on a phone and sit in three columns on a laptop, the dashes and their reasons read clearly, and the numbers change as you add an inquiry, a desk booking, a verified deposit and session outcomes.
