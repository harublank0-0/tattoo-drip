# Artist calendar: day and week (TAT-50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only calendar at `/t/:tenant/calendar`: a day or a Sunday-to-Saturday week of active sessions in the studio's timezone, for the whole studio or one artist (owners) or the member's own profile (artists), each session linking to its project, plus a Calendar tab and a "Book session" link into TAT-43's booking page on the day shown.

**Architecture:** Pure date helpers (`#modules/scheduling/calendar`) turn `?view=` / `?date=` into local days and instants. `SessionService.listInRange` reads active sessions overlapping a window with the no-overlap constraint's own `tstzrange` expression. A new `CalendarService` (scheduling module) decides whose sessions a member sees and loads them with one query per module (artists, sessions, `ProjectService.findManyFor`, `ClientService.findMany`). A thin `CalendarController` shapes the props; `inertia/pages/calendar/index.tsx` renders agenda lists.

**Tech Stack:** AdonisJS 7, Lucid (PostgreSQL, RLS), Luxon, Inertia + React, shadcn/ui, Tailwind v4, lucide-react, Tuyau `urlFor`, Japa.

**Spec:** `docs/superpowers/specs/2026-10-17-tat-50-artist-calendar-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- No migration; no API, SDK or OpenAPI change. `database/schema.ts` must not change.
- Route: `GET /t/:tenant/calendar` named `tenant.calendar.index`, in a new `/calendar` group with `middleware.role({ allow: ["owner", "artist"] })`; one isolation case; the role guard's area list gains `calendar`.
- Days are the studio's local days (`tenant.timezone`); weeks run Sunday to Saturday; a session shows on every day it overlaps (half-open). Only active sessions (`where active`).
- Owners: the whole studio by default, one live artist with `?artist=`. Artist members: only the live profile linked to them; none linked = `scope: "unlinked"`. Any other `artist` value is a 404 (E_ROW_NOT_FOUND), compared in memory, never sent to the database.
- A row's client name and brief appear only when the member may open the project (`ProjectService.findManyFor`, the `findFor` rule).
- Copy, verbatim: title "Calendar"; artists' description "Your sessions"; "Day", "Week", "Today", aria-labels "Previous day" / "Next day" / "Previous week" / "Next week"; nav label "Calendar"; picker label "Artist", first option "All artists", button "Show"; no-artist line "Every session belongs to an artist." + link "Add an artist" + " to start booking."; empty day "No sessions."; badges "Today", "Completed"; marker "Now {HH:mm}"; rows "{Kind}" or "{Kind} with {Artist}", "Unknown artist", "Unknown client", "Not assigned to you" (artists), "Project not available" (owners); unlinked "Your calendar shows the sessions booked with your artist profile, and your account isn't linked to one yet."; header action "Book session"; tab "Calendar".
- Every query is scoped by `tenant_id`; no module reads another module's tables. `@inject()` dependencies are value imports with the comment `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only); touch targets 44px (`h-11` / `min-h-11` / `size-11`), merged with `cn` from `cn`.
- Commands run from `apps/platform` unless stated; tests use `PORT=3402`. A spec that imports a missing module hangs Japa after the error: run those RED steps as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" is the expected RED). Never `sh -c`. Never read `apps/platform/.env`. `pnpm typecheck` is the authority over editor diagnostics. After route, page or controller changes run `node ace codegen` and commit `.adonisjs/`. The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again.
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder. Never push, never open a PR.

## Review Focus

1. An artist's own session on a project reassigned to another artist must show its time and kind but no client, brief or link; another artist's sessions must never appear. Tests: Task 4 "a session shows its project's client and brief only to members who may open it"; Task 5 "an artist sees only their own sessions…".
2. A malformed, deleted or other studio's `?artist=` must be a 404, never a 500 (a uuid cast error would abort the request transaction). Tests: Task 4 "any other artist id is not found…"; Task 5 "another studio's artist, a deleted artist or a malformed id is a 404".
3. On a clock-change day (New York, 1 November 2026, 25 hours) a session at 23:30 belongs to that day; a 24-hour day would drop it. Test: Task 1 "a session belongs to every local day it takes time from".
4. A Kathmandu session at 00:15 is on the next local day although its UTC date is the day before; a session from 22:30 to 01:30 shows on both days with weekday times. Tests: Task 5 "a day lists the sessions that take its local time…" and "a week runs Sunday to Saturday…".
5. Repeated or odd query values (`?view=week&view=day`, `?artist=a&artist=b`, `?artist=`, `?date=2026-02-30`) fall back quietly instead of erroring. Test: Task 5 "an unknown view or date is today's day view…".

---

## Before Task 1: preconditions

- [ ] TAT-43 is finished (ledger row 4: 3bc345b). This branch (`harublank00/tat-50-artist-calendar-of-sessions-day-and-week`) must contain it: `git merge-base --is-ancestor 3bc345b HEAD && echo ok`. If TAT-43 moved on after 3bc345b, rebase onto its new tip first (`git rebase harublank00/tat-43-create-a-project-and-session-directly-walk-in-phone-dm`; only the spec and plan commit sits on top) and re-read the files Task 7 touches.
- [ ] Clean tree: `git status -sb`.
- [ ] Baseline: `PORT=3402 pnpm test functional --files=session_service.spec.ts --files=project_service.spec.ts --files=bookings_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts` and `PORT=3402 pnpm test unit --files=nav_items.spec.ts`. Expected: PASS. Full suite on 3bc345b: 807 tests.

**TAT-43 dependency per task:** Tasks 1 to 6 use only code that existed before TAT-43's booking page (they stand alone). **Task 7 needs TAT-43's booking page** (`BookingsController.create`, `inertia/pages/projects/new.tsx`, `inertia/components/bookings.ts`, `lastBookableDay`, `tests/functional/projects/bookings_http.spec.ts`), and **Task 8 edits docs next to TAT-43's** Direct bookings bullet and requirements line. Both are present at 3bc345b.

---

### Task 1: Calendar date helpers

**Files:**
- Create: `apps/platform/app/modules/scheduling/calendar.ts`
- Test: `apps/platform/tests/unit/modules/scheduling/calendar.spec.ts`

**Interfaces:**
- Produces, from `#modules/scheduling/calendar`: `type CalendarView = "day" | "week"`; `toCalendarView(value: unknown): CalendarView`; `toCalendarDate(value: unknown, today: string): string`; `calendarDays(view: CalendarView, date: string): string[]`; `shiftDate(view: CalendarView, date: string, steps: number): string`; `dayBounds(day: string, timezone: string): { from: DateTime; to: DateTime }`; `overlapsDay(startsAt: DateTime, endsAt: DateTime, day: string, timezone: string): boolean`; `timesOnDay(startsAt: DateTime, endsAt: DateTime, day: string, timezone: string): { startText: string; endText: string }`; `dayLabel(day: string): string`; `rangeText(days: string[]): string`; `briefPreview(brief: string): string`; `BRIEF_PREVIEW_LENGTH = 100`. Dates are `yyyy-MM-dd` strings.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/scheduling/calendar.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	briefPreview,
	calendarDays,
	dayBounds,
	dayLabel,
	overlapsDay,
	rangeText,
	shiftDate,
	timesOnDay,
	toCalendarDate,
	toCalendarView,
} from "#modules/scheduling/calendar";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
const TODAY = "2026-10-17";

/** `time` on `day` in `zone`. */
const local = (day: string, time: string, zone = KTM) =>
	DateTime.fromISO(`${day}T${time}`, { zone });

const utcIso = (at: DateTime) => at.toUTC().toISO();

test.group("calendar query values", () => {
	test("the week view only when asked for, the day view otherwise", ({
		assert,
	}) => {
		assert.equal(toCalendarView("week"), "week");
		for (const value of ["day", "month", "", undefined, ["week"]]) {
			assert.equal(toCalendarView(value), "day", String(value));
		}
	});

	test("a real yyyy-MM-dd date, or today", ({ assert }) => {
		assert.equal(toCalendarDate("2026-11-04", TODAY), "2026-11-04");
		for (const value of [
			"2026-02-30",
			"2026-11-04T10:00",
			"4 Nov 2026",
			"2026-W45",
			"",
			undefined,
			["2026-11-04"],
		]) {
			assert.equal(toCalendarDate(value, TODAY), TODAY, String(value));
		}
	});
});

test.group("calendarDays and shiftDate", () => {
	test("the day view shows that day", ({ assert }) => {
		assert.deepEqual(calendarDays("day", "2026-11-04"), ["2026-11-04"]);
	});

	test("a week runs Sunday to Saturday, whichever of its days is asked for", ({
		assert,
	}) => {
		const week = [
			"2026-11-01",
			"2026-11-02",
			"2026-11-03",
			"2026-11-04",
			"2026-11-05",
			"2026-11-06",
			"2026-11-07",
		];
		for (const date of ["2026-11-01", "2026-11-04", "2026-11-07"]) {
			assert.deepEqual(calendarDays("week", date), week, date);
		}
		assert.deepEqual(calendarDays("week", "2026-12-31"), [
			"2026-12-27",
			"2026-12-28",
			"2026-12-29",
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
			"2027-01-02",
		]);
	});

	test("one step is a day or a week", ({ assert }) => {
		assert.equal(shiftDate("day", "2026-11-01", -1), "2026-10-31");
		assert.equal(shiftDate("day", "2026-12-31", 1), "2027-01-01");
		assert.equal(shiftDate("week", "2026-11-04", 1), "2026-11-11");
		assert.equal(shiftDate("week", "2026-11-04", -1), "2026-10-28");
	});
});

test.group("dayBounds and overlapsDay", () => {
	test("a day runs from local midnight to local midnight", ({ assert }) => {
		const { from, to } = dayBounds("2026-10-18", KTM);
		assert.equal(utcIso(from), "2026-10-17T18:15:00.000Z");
		assert.equal(utcIso(to), "2026-10-18T18:15:00.000Z");
	});

	test("a clock-change day is 25 or 23 hours long", ({ assert }) => {
		// 1 November 2026: New York's clocks go back an hour.
		const autumn = dayBounds("2026-11-01", NY);
		assert.equal(utcIso(autumn.from), "2026-11-01T04:00:00.000Z");
		assert.equal(utcIso(autumn.to), "2026-11-02T05:00:00.000Z");
		// 8 March 2026: they go forward an hour.
		const spring = dayBounds("2026-03-08", NY);
		assert.equal(utcIso(spring.from), "2026-03-08T05:00:00.000Z");
		assert.equal(utcIso(spring.to), "2026-03-09T04:00:00.000Z");
	});

	test("a session belongs to every local day it takes time from", ({
		assert,
	}) => {
		const lateStart = local("2026-11-02", "22:30");
		const lateEnd = local("2026-11-03", "01:30");
		assert.isTrue(overlapsDay(lateStart, lateEnd, "2026-11-02", KTM));
		assert.isTrue(overlapsDay(lateStart, lateEnd, "2026-11-03", KTM));
		assert.isFalse(overlapsDay(lateStart, lateEnd, "2026-11-04", KTM));

		// Ending at midnight leaves the next day free (half-open, like the constraint).
		const toMidnightStart = local("2026-11-02", "22:00");
		const midnight = local("2026-11-03", "00:00");
		assert.isTrue(overlapsDay(toMidnightStart, midnight, "2026-11-02", KTM));
		assert.isFalse(overlapsDay(toMidnightStart, midnight, "2026-11-03", KTM));

		// 23:30 on New York's 25-hour day is 04:30 UTC the next day: a day
		// counted as 24 hours from midnight would miss it.
		const autumnStart = local("2026-11-01", "23:30", NY);
		const autumnEnd = local("2026-11-02", "00:30", NY);
		assert.isTrue(overlapsDay(autumnStart, autumnEnd, "2026-11-01", NY));
		assert.isTrue(overlapsDay(autumnStart, autumnEnd, "2026-11-02", NY));
	});
});

test.group("timesOnDay", () => {
	test("times on the day itself, with the weekday for a time on another day", ({
		assert,
	}) => {
		assert.deepEqual(
			timesOnDay(
				local("2026-11-02", "15:45"),
				local("2026-11-02", "17:45"),
				"2026-11-02",
				KTM,
			),
			{ startText: "15:45", endText: "17:45" },
		);
		const start = local("2026-11-02", "22:30");
		const end = local("2026-11-03", "01:30");
		assert.deepEqual(timesOnDay(start, end, "2026-11-02", KTM), {
			startText: "22:30",
			endText: "Tue 01:30",
		});
		assert.deepEqual(timesOnDay(start, end, "2026-11-03", KTM), {
			startText: "Mon 22:30",
			endText: "01:30",
		});
		// Midnight closes the day the session ends on.
		assert.deepEqual(
			timesOnDay(
				local("2026-11-02", "22:00"),
				local("2026-11-03", "00:00"),
				"2026-11-02",
				KTM,
			),
			{ startText: "22:00", endText: "00:00" },
		);
	});

	test("instants from any zone show in the studio's", ({ assert }) => {
		assert.deepEqual(
			timesOnDay(
				DateTime.utc(2026, 11, 2, 10),
				DateTime.utc(2026, 11, 2, 12),
				"2026-11-02",
				KTM,
			),
			{ startText: "15:45", endText: "17:45" },
		);
	});
});

test.group("calendar labels", () => {
	test("a day heading and the range a view shows", ({ assert }) => {
		assert.equal(dayLabel("2026-11-01"), "Sun 1 Nov");
		assert.equal(rangeText(["2026-11-02"]), "Mon 2 Nov 2026");
		assert.equal(rangeText(calendarDays("week", "2026-11-04")), "1–7 Nov 2026");
		assert.equal(
			rangeText(calendarDays("week", "2026-12-01")),
			"29 Nov – 5 Dec 2026",
		);
		assert.equal(
			rangeText(calendarDays("week", "2026-12-31")),
			"27 Dec 2026 – 2 Jan 2027",
		);
	});

	test("a brief preview is its first line, cut at 100 characters", ({
		assert,
	}) => {
		assert.equal(briefPreview("Koi fish\nfull sleeve, colour"), "Koi fish");
		assert.equal(briefPreview("Koi fish\r\nfull sleeve"), "Koi fish");
		assert.equal(briefPreview("\n\n  A rose  \nleft wrist"), "A rose");
		assert.equal(briefPreview("x".repeat(100)), "x".repeat(100));
		assert.equal(briefPreview("x".repeat(101)), `${"x".repeat(99)}…`);
		assert.equal(briefPreview(""), "");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=calendar.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log shows "Cannot find module" for `#modules/scheduling/calendar`.

- [ ] **Step 3: Write the helpers**

Create `apps/platform/app/modules/scheduling/calendar.ts`:

```ts
import { DateTime } from "luxon";

/**
 * The calendar's dates (TAT-50). A calendar date is a plain yyyy-MM-dd,
 * computed in UTC so date arithmetic never meets a clock change; only
 * `dayBounds` turns a date into instants, in the studio's timezone. Weeks
 * run Sunday to Saturday (the launch market's week).
 */

export type CalendarView = "day" | "week";

/** The longest brief preview a calendar row shows, in characters. */
export const BRIEF_PREVIEW_LENGTH = 100;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const plain = (date: string) =>
	DateTime.fromISO(date, { zone: "utc", locale: "en-GB" });
const iso = (date: DateTime) => date.toFormat("yyyy-MM-dd");

/** `?view=`: the week view when asked for, else the day view. */
export function toCalendarView(value: unknown): CalendarView {
	return value === "week" ? "week" : "day";
}

/** `?date=`: a real yyyy-MM-dd date, else `today`. */
export function toCalendarDate(value: unknown, today: string): string {
	if (typeof value !== "string" || !DATE.test(value)) return today;
	return DateTime.fromFormat(value, "yyyy-MM-dd", { zone: "utc" }).isValid
		? value
		: today;
}

/** The days a view shows: the day itself, or its week from Sunday to Saturday. */
export function calendarDays(view: CalendarView, date: string): string[] {
	if (view === "day") return [date];
	const day = plain(date);
	// Luxon numbers weekdays from Monday (1) to Sunday (7).
	const sunday = day.minus({ days: day.weekday % 7 });
	return Array.from({ length: 7 }, (_, offset) =>
		iso(sunday.plus({ days: offset })),
	);
}

/** The same view `steps` days or weeks away. */
export function shiftDate(
	view: CalendarView,
	date: string,
	steps: number,
): string {
	return iso(plain(date).plus({ days: steps * (view === "week" ? 7 : 1) }));
}

/**
 * A local day of the studio as instants, half-open: from its midnight to
 * the next. 23 or 25 hours long on a clock-change day.
 */
export function dayBounds(
	day: string,
	timezone: string,
): { from: DateTime; to: DateTime } {
	const start = DateTime.fromISO(day, { zone: timezone });
	return {
		from: start.startOf("day"),
		to: start.plus({ days: 1 }).startOf("day"),
	};
}

/** Whether a session (half-open, like the constraint) takes any of `day`'s time. */
export function overlapsDay(
	startsAt: DateTime,
	endsAt: DateTime,
	day: string,
	timezone: string,
): boolean {
	const { from, to } = dayBounds(day, timezone);
	return (
		startsAt.toMillis() < to.toMillis() && endsAt.toMillis() > from.toMillis()
	);
}

/**
 * A session's start and end as a row on `day` shows them, in the studio's
 * timezone: "14:00", or "Mon 01:30" for a time on another day. An end at
 * the next midnight is still this day's "00:00".
 */
export function timesOnDay(
	startsAt: DateTime,
	endsAt: DateTime,
	day: string,
	timezone: string,
): { startText: string; endText: string } {
	const { from, to } = dayBounds(day, timezone);
	const text = (at: DateTime, onThisDay: boolean) =>
		at
			.setZone(timezone)
			.setLocale("en-GB")
			.toFormat(onThisDay ? "HH:mm" : "ccc HH:mm");
	return {
		startText: text(startsAt, startsAt.toMillis() >= from.toMillis()),
		endText: text(endsAt, endsAt.toMillis() <= to.toMillis()),
	};
}

/** A day as the week view heads it: "Sun 1 Nov". */
export function dayLabel(day: string): string {
	return plain(day).toFormat("ccc d LLL");
}

/**
 * The range a view shows: "Mon 2 Nov 2026" for a day; a week as "1–7 Nov
 * 2026", "29 Nov – 5 Dec 2026" or "27 Dec 2026 – 2 Jan 2027".
 */
export function rangeText(days: string[]): string {
	const first = plain(days[0]);
	const last = plain(days[days.length - 1]);
	if (days.length === 1) return first.toFormat("ccc d LLL yyyy");
	if (first.year !== last.year) {
		return `${first.toFormat("d LLL yyyy")} – ${last.toFormat("d LLL yyyy")}`;
	}
	if (first.month !== last.month) {
		return `${first.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")}`;
	}
	return `${first.toFormat("d")}–${last.toFormat("d LLL yyyy")}`;
}

/** A brief's first non-empty line, cut to BRIEF_PREVIEW_LENGTH characters with "…". */
export function briefPreview(brief: string): string {
	const line =
		brief
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part !== "") ?? "";
	return line.length > BRIEF_PREVIEW_LENGTH
		? `${line.slice(0, BRIEF_PREVIEW_LENGTH - 1).trimEnd()}…`
		: line;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=calendar.spec.ts`
Expected: PASS (12 tests). If a month name fails, check the locale: `en-GB` writes September as "Sept", which is why no test uses September.

- [ ] **Step 5: Commit**

```bash
git add app/modules/scheduling/calendar.ts tests/unit/modules/scheduling/calendar.spec.ts
git commit -m "feat(platform): compute calendar days and times in the studio's timezone"
```

---

### Task 2: `SessionService.listInRange`

**Files:**
- Modify: `apps/platform/app/modules/scheduling/services/session_service.ts` (a type after `NewSession`, a method after `listForProject`)
- Test: `apps/platform/tests/functional/scheduling/session_range.spec.ts`

**Interfaces:**
- Produces: `type SessionWindow = { from: DateTime; to: DateTime; artistId: string | null }` and `SessionService.listInRange(tenant: TenantRef, window: SessionWindow): Promise<ProjectSession[]>` (active sessions overlapping `[from, to)`, ordered by `starts_at`, then `id`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/scheduling/session_range.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
import ProjectSession, {
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(new QuoteService()),
);

/** 2 November 2026 at `hour`:00 UTC. */
const at = (hour: number) => DateTime.utc(2026, 11, 2, hour);

const ids = (rows: { id: string }[]) => rows.map(({ id }) => id);

test.group("SessionService.listInRange", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the active sessions that take time in the window, earliest first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const ram = await makeArtist(tenant, "ram");
			const slot = (
				artist: Artist,
				from: number,
				to: number,
				status: SessionStatus = "scheduled",
			) =>
				makeSession(tenant, project, artist, {
					startsAt: at(from),
					endsAt: at(to),
					status,
				});

			// The window is 10:00 to 14:00.
			await slot(ram, 8, 10); // ends as it opens
			await slot(ram, 14, 16); // starts as it closes
			const before = await slot(sita, 9, 11);
			const inside = await slot(sita, 11, 12, "completed");
			const after = await slot(sita, 13, 15);
			await slot(sita, 12, 13, "cancelled");
			await slot(anu, 12, 13, "no_show");
			const deleted = await slot(anu, 12, 13);
			await (await ProjectSession.findOrFail(deleted.id)).softDelete();
			const around = await slot(anu, 8, 16);

			const window = { from: at(10), to: at(14) };
			assert.deepEqual(
				ids(await sessions.listInRange(tenant, { ...window, artistId: null })),
				[around.id, before.id, inside.id, after.id],
			);
			assert.deepEqual(
				ids(
					await sessions.listInRange(tenant, { ...window, artistId: sita.id }),
				),
				[before.id, inside.id, after.id],
			);
			assert.deepEqual(
				await sessions.listInRange(tenant, { ...window, artistId: ram.id }),
				[],
			);
		});
	});

	test("only the tenant's sessions, even where row-level security shows another's", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const mine = await inTenant(tenant, async () =>
			makeSession(
				tenant,
				await makeProject(tenant, await makeClient(tenant)),
				await makeArtist(tenant),
			),
		);
		const theirs = await inTenant(other, async () =>
			makeSession(
				other,
				await makeProject(other, await makeClient(other)),
				await makeArtist(other),
			),
		);
		const wholeDay = { from: at(0), to: at(23), artistId: null };

		await inTenant(tenant, async () => {
			assert.deepEqual(ids(await sessions.listInRange(tenant, wholeDay)), [
				mine.id,
			]);
		});
		await inTenant(other, async () => {
			assert.deepEqual(ids(await sessions.listInRange(other, wholeDay)), [
				theirs.id,
			]);
			// Visible to row-level security here, but asked for as black-needle.
			assert.deepEqual(await sessions.listInRange(tenant, wholeDay), []);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=session_range.spec.ts`
Expected: FAIL, 2 tests: "sessions.listInRange is not a function".

- [ ] **Step 3: Write the read**

In `apps/platform/app/modules/scheduling/services/session_service.ts`, after the `NewSession` type, add:

```ts
/** A calendar window: half-open [from, to), one artist or (null) all. */
export type SessionWindow = {
	from: DateTime;
	to: DateTime;
	artistId: string | null;
};
```

and after `listForProject`, add:

```ts
	/**
	 * The tenant's active sessions (scheduled or completed, not deleted) that
	 * take time in the half-open window, earliest first: the calendar
	 * (TAT-50). The overlap is the no-overlap constraint's own expression, so
	 * its gist index (artist, time range, where active) serves one artist's
	 * window; no other index was added.
	 */
	async listInRange(
		tenant: TenantRef,
		{ from, to, artistId }: SessionWindow,
	): Promise<ProjectSession[]> {
		const query = ProjectSession.query()
			.where("tenant_id", tenant.id)
			.where("active", true)
			.whereRaw(
				"tstzrange(starts_at, ends_at) && tstzrange(?::timestamptz, ?::timestamptz)",
				[from.toJSDate(), to.toJSDate()],
			);
		if (artistId !== null) query.where("artist_id", artistId);
		return query.orderBy("starts_at", "asc").orderBy("id", "asc");
	}
```

`DateTime` is already imported as a type at the top of the file; `toJSDate()` needs no value import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=session_range.spec.ts --files=session_service.spec.ts`
Expected: PASS (the 2 new tests, and the existing session tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/modules/scheduling/services/session_service.ts tests/functional/scheduling/session_range.spec.ts
git commit -m "feat(platform): list the active sessions in a time window"
```

---

### Task 3: `ProjectService.findManyFor`

**Files:**
- Modify: `apps/platform/app/modules/projects/services/project_service.ts` (a method after `findFor`)
- Test: `apps/platform/tests/functional/projects/project_service.spec.ts` (a new group right after "ProjectService.findFor")

**Interfaces:**
- Consumes: the private `scopeTo(query, tenant, member)` already in `ProjectService`.
- Produces: `ProjectService.findManyFor(tenant: TenantRef, member: Member, ids: string[]): Promise<TattooProject[]>` (live projects among `ids` the member may open, no order; `[]` with no query for no ids).

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/functional/projects/project_service.spec.ts`, change the import `import ProjectService, { PROJECTS_PER_PAGE } from …` to:

```ts
import ProjectService, {
	type Member,
	PROJECTS_PER_PAGE,
} from "#modules/projects/services/project_service";
```

and add this group right after the "ProjectService.findFor" group:

```ts
test.group("ProjectService.findManyFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the live projects among the ids; artists only those assigned to them", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const other = await makeArtist(tenant, "sita");
			const client = await makeClient(tenant);
			const assigned = await makeProject(tenant, client, { artistId: mine.id });
			const elsewhere = await makeProject(tenant, client, {
				artistId: other.id,
			});
			const deleted = await makeProject(tenant, client, { artistId: mine.id });
			await deleted.softDelete();
			const ids = [assigned.id, elsewhere.id, deleted.id, randomUUID()];
			const found = async (member: Member) =>
				(await projects.findManyFor(tenant, member, ids))
					.map(({ id }) => id)
					.sort();

			assert.deepEqual(
				await found({ userId: owner.id, role: "owner" }),
				[assigned.id, elsewhere.id].sort(),
			);
			assert.deepEqual(await found({ userId: user.id, role: "artist" }), [
				assigned.id,
			]);
			// No profile of their own: nothing.
			assert.deepEqual(await found({ userId: stranger.id, role: "artist" }), []);
			assert.deepEqual(
				await projects.findManyFor(
					tenant,
					{ userId: owner.id, role: "owner" },
					[],
				),
				[],
			);
		});
	});

	test("another tenant's projects are never found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const theirs = await inTenant(b, async () =>
			makeProject(b, await makeClient(b)),
		);

		await inTenant(b, async () => {
			// Visible to row-level security here, but asked for as studio A's.
			assert.deepEqual(
				await projects.findManyFor(
					a,
					{ userId: ownerB.id, role: "owner" },
					[theirs.id],
				),
				[],
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: FAIL, the 2 new tests: "projects.findManyFor is not a function"; every other test passes.

- [ ] **Step 3: Write the read**

In `apps/platform/app/modules/projects/services/project_service.ts`, after `findFor`, add:

```ts
	/**
	 * The live projects among `ids` that `member` may open (the `findFor`
	 * rule), in no particular order: the calendar shows a session's client
	 * and brief only for these (TAT-50).
	 */
	async findManyFor(
		tenant: TenantRef,
		member: Member,
		ids: string[],
	): Promise<TattooProject[]> {
		if (ids.length === 0) return [];
		const query = TattooProject.query().whereIn("id", ids);
		await this.scopeTo(query, tenant, member);
		return query;
	}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=project_service.spec.ts`
Expected: PASS (all, including the 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add app/modules/projects/services/project_service.ts tests/functional/projects/project_service.spec.ts
git commit -m "feat(platform): find the projects among many ids a member may open"
```

---

### Task 4: `CalendarService`

**Files:**
- Create: `apps/platform/app/modules/scheduling/services/calendar_service.ts`
- Test: `apps/platform/tests/functional/scheduling/calendar_service.spec.ts`

**Interfaces:**
- Consumes: `ArtistService.list`, `SessionService.listInRange` (Task 2), `ProjectService.findManyFor` and `type Member` (Task 3), `ClientService.findMany`.
- Produces, from `#modules/scheduling/services/calendar_service`: `type CalendarScope = { kind: "studio" } | { kind: "artist"; artist: Artist } | { kind: "unlinked" }`; `type CalendarEntry = { session: ProjectSession; artistName: string | null; project: { id: string; brief: string; clientName: string | null } | null }`; `type Calendar = { scope: CalendarScope; artists: Artist[]; entries: CalendarEntry[] }`; `CalendarService.load(tenant: TenantRef, member: Member, query: { artistId: string | null; from: DateTime; to: DateTime }): Promise<Calendar>` (E_ROW_NOT_FOUND for a refused `artistId`).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/functional/scheduling/calendar_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ClientService from "#modules/clients/services/client_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import CalendarService, {
	type CalendarEntry,
	type CalendarScope,
} from "#modules/scheduling/services/calendar_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);
const calendar = new CalendarService(
	artists,
	sessions,
	projects,
	new ClientService(),
);

const BRIEF = "A small fine-line moth on the forearm";

/** Monday 2 November 2026 in UTC: the window every test reads. */
const day = {
	from: DateTime.utc(2026, 11, 2),
	to: DateTime.utc(2026, 11, 3),
};
const hour = (h: number) => DateTime.utc(2026, 11, 2, h);

/** A scope as one comparable value: "studio", "unlinked" or the artist's id. */
const scopeOf = (scope: CalendarScope) =>
	scope.kind === "artist" ? scope.artist.id : scope.kind;

/**
 * Asha (an artist member linked to her profile), Sita (a profile without
 * an account) and Maya's booked project, assigned to Sita.
 */
async function studio() {
	const { owner, tenant } = await studioWithOwner();
	const user = await artistIn(tenant, "asha@example.com");
	const parts = await inTenant(tenant, async () => {
		const asha = await Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: user.id,
		});
		const sita = await makeArtist(tenant);
		const maya = await makeClient(tenant, { name: "Maya Gurung" });
		const project = await makeProject(tenant, maya, {
			artistId: sita.id,
			status: "booked",
		});
		return { asha, sita, project };
	});
	const ownerMember: Member = { userId: owner.id, role: "owner" };
	const ashaMember: Member = { userId: user.id, role: "artist" };
	return { tenant, ownerMember, ashaMember, ...parts };
}

test.group("CalendarService scopes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners see the studio or one live artist; artists their own profile", async ({
		assert,
	}) => {
		const { tenant, asha, sita, ownerMember, ashaMember } = await studio();
		const stranger: Member = {
			userId: (await artistIn(tenant, "ram@example.com")).id,
			role: "artist",
		};

		await inTenant(tenant, async () => {
			const load = (member: Member, artistId: string | null) =>
				calendar.load(tenant, member, { artistId, ...day });

			const whole = await load(ownerMember, null);
			assert.equal(scopeOf(whole.scope), "studio");
			assert.deepEqual(
				whole.artists.map(({ name }) => name),
				["Asha", "Sita"],
			);
			assert.equal(scopeOf((await load(ownerMember, sita.id)).scope), sita.id);

			const own = await load(ashaMember, null);
			assert.equal(scopeOf(own.scope), asha.id);
			assert.deepEqual(own.artists, []);
			assert.equal(scopeOf((await load(ashaMember, asha.id)).scope), asha.id);

			// No linked profile: nothing to show, and no error.
			const none = await load(stranger, null);
			assert.equal(scopeOf(none.scope), "unlinked");
			assert.deepEqual(none.entries, []);
		});
	});

	test("any other artist id is not found, malformed ones included", async ({
		assert,
	}) => {
		const { tenant, sita, ownerMember, ashaMember } = await studio();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other));
		const stranger: Member = {
			userId: (await artistIn(tenant, "ram@example.com")).id,
			role: "artist",
		};
		const gone = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant, "gone");
			await artist.softDelete();
			return artist;
		});

		await inTenant(tenant, async () => {
			for (const [member, artistId] of [
				[ownerMember, theirs.id],
				[ownerMember, gone.id],
				[ownerMember, "not-a-uuid"],
				[ashaMember, sita.id],
				[stranger, sita.id],
			] as const) {
				await assert.rejects(
					() => calendar.load(tenant, member, { artistId, ...day }),
					/Row not found/,
				);
			}
		});
	});
});

test.group("CalendarService entries", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a session shows its project's client and brief only to members who may open it", async ({
		assert,
	}) => {
		const { tenant, asha, sita, project, ownerMember, ashaMember } =
			await studio();
		const rows = await inTenant(tenant, async () => {
			const nimas = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Nima" }),
				{ artistId: asha.id, status: "booked" },
			);
			return {
				nimas,
				own: await makeSession(tenant, nimas, asha, {
					startsAt: hour(4),
					endsAt: hour(5),
				}),
				// Booked with Asha, then the project went to Sita: the time stays Asha's.
				reassigned: await makeSession(tenant, project, asha, {
					startsAt: hour(6),
					endsAt: hour(7),
				}),
				sitas: await makeSession(tenant, project, sita),
			};
		});
		const maya = { id: project.id, brief: BRIEF, clientName: "Maya Gurung" };
		const nima = { id: rows.nimas.id, brief: BRIEF, clientName: "Nima" };
		const shown = (entries: CalendarEntry[]) =>
			entries.map(({ session, artistName, project: details }) => [
				session.id,
				artistName,
				details,
			]);

		await inTenant(tenant, async () => {
			const owners = await calendar.load(tenant, ownerMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(shown(owners.entries), [
				[rows.own.id, "Asha", nima],
				[rows.reassigned.id, "Asha", maya],
				[rows.sitas.id, "Sita", maya],
			]);
			const ashas = await calendar.load(tenant, ashaMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(shown(ashas.entries), [
				[rows.own.id, "Asha", nima],
				[rows.reassigned.id, "Asha", null],
			]);
		});
	});

	test("a deleted artist's sessions stay, without a name", async ({
		assert,
	}) => {
		const { tenant, sita, project, ownerMember } = await studio();
		const session = await inTenant(tenant, () =>
			makeSession(tenant, project, sita),
		);

		await inTenant(tenant, async () => {
			await (await Artist.findOrFail(sita.id)).softDelete();
			const { entries } = await calendar.load(tenant, ownerMember, {
				artistId: null,
				...day,
			});
			assert.deepEqual(
				entries.map(({ session: { id }, artistName }) => [id, artistName]),
				[[session.id, null]],
			);
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test functional --files=calendar_service.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log shows "Cannot find module" for `calendar_service`.

- [ ] **Step 3: Write the service**

Create `apps/platform/app/modules/scheduling/services/calendar_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import type ProjectSession from "#modules/scheduling/models/project_session";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/** Whose sessions a calendar shows. */
export type CalendarScope =
	| { kind: "studio" }
	| { kind: "artist"; artist: Artist }
	| { kind: "unlinked" };

/** One session, with what the member may see around it. */
export type CalendarEntry = {
	session: ProjectSession;
	/** The session's artist; null when their profile was deleted. */
	artistName: string | null;
	/** Null when the member can't open the project (ProjectService.findManyFor). */
	project: { id: string; brief: string; clientName: string | null } | null;
};

export type Calendar = {
	scope: CalendarScope;
	/** Owners: the studio's live artists, by name (the picker). Artists: none. */
	artists: Artist[];
	entries: CalendarEntry[];
};

/**
 * The calendar's read (TAT-50): whose sessions a member sees in a window,
 * and how much of each project. One query per module, whatever the number
 * of sessions. Owners see the whole studio or one live artist; an artist
 * member sees only the live profile linked to them, and a client and brief
 * only for projects they may open.
 */
@inject()
export default class CalendarService {
	constructor(
		private artists: ArtistService,
		private sessions: SessionService,
		private projects: ProjectService,
		private clients: ClientService,
	) {}

	/**
	 * The calendar for `member` between `from` and `to`. `artistId` (the
	 * page's `?artist=`) must be a live artist of the tenant for an owner and
	 * the member's own profile for an artist; anything else, a malformed id
	 * included, throws E_ROW_NOT_FOUND (a 404). It is compared with the
	 * artist list in memory, so it never reaches the database.
	 */
	async load(
		tenant: TenantRef,
		member: Member,
		{
			artistId,
			from,
			to,
		}: { artistId: string | null; from: DateTime; to: DateTime },
	): Promise<Calendar> {
		const all = await this.artists.list(tenant);
		const scope = scopeFor(all, member, artistId);
		const artists = member.role === "owner" ? all : [];
		if (scope.kind === "unlinked") return { scope, artists, entries: [] };

		const sessions = await this.sessions.listInRange(tenant, {
			from,
			to,
			artistId: scope.kind === "artist" ? scope.artist.id : null,
		});
		const projects = await this.projects.findManyFor(
			tenant,
			member,
			unique(sessions.map(({ projectId }) => projectId)),
		);
		const clients = await this.clients.findMany(
			tenant,
			unique(projects.map(({ clientId }) => clientId)),
		);
		const artistName = new Map(all.map(({ id, name }) => [id, name]));
		const clientName = new Map(clients.map(({ id, name }) => [id, name]));
		const details = new Map(
			projects.map((project) => [
				project.id,
				{
					id: project.id,
					brief: project.brief,
					clientName: clientName.get(project.clientId) ?? null,
				},
			]),
		);

		return {
			scope,
			artists,
			entries: sessions.map((session) => ({
				session,
				artistName: artistName.get(session.artistId) ?? null,
				project: details.get(session.projectId) ?? null,
			})),
		};
	}
}

/** Whose calendar `member` asked for, or E_ROW_NOT_FOUND. */
function scopeFor(
	all: Artist[],
	member: Member,
	artistId: string | null,
): CalendarScope {
	if (member.role === "owner") {
		if (artistId === null) return { kind: "studio" };
		const artist = all.find(({ id }) => id === artistId);
		if (!artist) throw new lucidErrors.E_ROW_NOT_FOUND();
		return { kind: "artist", artist };
	}
	const mine = all.find(({ userId }) => userId === member.userId);
	if (artistId !== null && artistId !== mine?.id) {
		throw new lucidErrors.E_ROW_NOT_FOUND();
	}
	return mine ? { kind: "artist", artist: mine } : { kind: "unlinked" };
}

function unique(ids: string[]): string[] {
	return [...new Set(ids)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test functional --files=calendar_service.spec.ts`
Expected: PASS (4 tests). Then `pnpm typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
git add app/modules/scheduling/services/calendar_service.ts tests/functional/scheduling/calendar_service.spec.ts
git commit -m "feat(platform): load a member's calendar of sessions"
```

---

### Task 5: The calendar page and route

**Files:**
- Create: `apps/platform/inertia/components/calendar.ts`
- Create: `apps/platform/inertia/pages/calendar/index.tsx`
- Create: `apps/platform/app/controllers/calendar_controller.ts`
- Modify: `apps/platform/start/routes.ts` (a new group after the projects group)
- Modify: `apps/platform/tests/isolation/cases.ts` (one case at the end)
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` (the role-guard area list)
- Generated: `apps/platform/.adonisjs/` (`node ace codegen`)
- Test: `apps/platform/tests/functional/scheduling/calendar_page.spec.ts`
- Test: `apps/platform/tests/unit/inertia/now_marker.spec.ts`

**Interfaces:**
- Consumes: Task 1's helpers; `CalendarService.load`, `type CalendarEntry` (Task 4); `todayIn` from `#modules/projects/quotes`; `SESSION_KIND_LABELS`, `SESSION_STATUS_LABELS` from `~/components/projects` (TAT-43).
- Produces: route `tenant.calendar.index` (`GET /t/:tenant/calendar`); controller `controllers.Calendar` with `index`; page `calendar/index` with props `CalendarPageProps` and helper `nowIndex(sessions: { startsAt: number }[], now: number): number` from `~/components/calendar`. Task 7 adds `canBook` to the props.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/inertia/now_marker.spec.ts`:

```ts
import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `CalendarModule` below restates its shape and the inertia project type-checks the real one.
import * as calendarModule from "../../../inertia/components/calendar.js";

type CalendarModule = {
	nowIndex(sessions: { startsAt: number }[], now: number): number;
};
const { nowIndex } = calendarModule as CalendarModule;

test.group("nowIndex", () => {
	test("the Now marker goes before the first session that starts later", ({
		assert,
	}) => {
		const sessions = [{ startsAt: 100 }, { startsAt: 200 }, { startsAt: 300 }];
		assert.equal(nowIndex(sessions, 50), 0);
		// A session that started at 100 is under way: the marker goes after it.
		assert.equal(nowIndex(sessions, 100), 1);
		assert.equal(nowIndex(sessions, 250), 2);
		assert.equal(nowIndex(sessions, 300), 3);
		assert.equal(nowIndex([], 300), 0);
	});
});
```

Create `apps/platform/tests/functional/scheduling/calendar_page.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import { todayIn } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const KTM = "Asia/Kathmandu";
const BRIEF = "A small fine-line moth on the forearm";
const calendarUrl = (query = "") => `/t/black-needle/calendar${query}`;

type Row = {
	id: string;
	startText: string;
	endText: string;
	status: string;
	project: unknown;
};
type Day = { date: string; label: string; sessions: Row[] };

/** `time` on `day` in Kathmandu (the test studios' zone). */
const at = (day: string, time: string) =>
	DateTime.fromISO(`${day}T${time}`, { zone: KTM });

/** yyyy-MM-dd, `days` after `date`. */
const plusDays = (date: string, days: number) =>
	DateTime.fromISO(date).plus({ days }).toFormat("yyyy-MM-dd");

/** Ram and Sita, and Maya's booked project assigned to Sita. */
async function studio() {
	const { owner, tenant } = await studioWithOwner();
	const parts = await inTenant(tenant, async () => {
		const ram = await Artist.create({
			tenantId: tenant.id,
			name: "Ram",
			slug: "ram",
		});
		const sita = await makeArtist(tenant);
		const maya = await makeClient(tenant, { name: "Maya Gurung" });
		const project = await makeProject(tenant, maya, {
			artistId: sita.id,
			status: "booked",
		});
		return { ram, sita, project };
	});
	return { owner, tenant, ...parts };
}

/** An artist member with a live profile ("Asha") linked to their account. */
async function linkedArtist(tenant: Tenant) {
	const user = await artistIn(tenant, "asha@example.com");
	const profile = await inTenant(tenant, () =>
		Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: user.id,
		}),
	);
	return { user, profile };
}

test.group("Calendar page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner opens today's day view of the whole studio", async ({
		client,
		assert,
	}) => {
		const { owner, ram, sita } = await studio();
		const today = todayIn(KTM);

		const response = await client
			.get(calendarUrl())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("calendar/index");
		const props = response.inertiaProps;
		assert.include(props, {
			view: "day",
			date: today,
			today,
			timezone: KTM,
			scope: "studio",
			previous: plusDays(today, -1),
			next: plusDays(today, 1),
		});
		assert.deepEqual(props.artistFilter, {
			selected: null,
			artists: [
				{ id: ram.id, name: "Ram" },
				{ id: sita.id, name: "Sita" },
			],
		});
		assert.deepEqual(
			props.days.map(({ date }: Day) => date),
			[today],
		);
	});

	test("a day lists the sessions that take its local time, with what the project page shows", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, ram, sita, project } = await studio();
		const rows = await inTenant(tenant, async () => {
			const koi = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Bikash" }),
				{
					artistId: ram.id,
					status: "booked",
					brief: "Koi fish\nfull sleeve, colour",
				},
			);
			// 00:15 on 3 November in Kathmandu is still 2 November in UTC: not this day.
			await makeSession(tenant, project, sita, {
				startsAt: at("2026-11-03", "00:15"),
				endsAt: at("2026-11-03", "02:00"),
			});
			return {
				koi,
				consultation: await makeSession(tenant, koi, ram, {
					kind: "consultation",
					startsAt: at("2026-11-02", "09:00"),
					endsAt: at("2026-11-02", "09:30"),
				}),
				// 10:00 to 12:00 UTC: 15:45 to 17:45 in Kathmandu.
				tattoo: await makeSession(tenant, project, sita),
			};
		});

		const props = (
			await client
				.get(calendarUrl("?date=2026-11-02"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.rangeText, "Mon 2 Nov 2026");
		assert.deepEqual(props.days[0].sessions, [
			{
				id: rows.consultation.id,
				startsAt: at("2026-11-02", "09:00").toMillis(),
				endsAt: at("2026-11-02", "09:30").toMillis(),
				startText: "09:00",
				endText: "09:30",
				kind: "consultation",
				status: "scheduled",
				artistName: "Ram",
				project: { id: rows.koi.id, clientName: "Bikash", brief: "Koi fish" },
			},
			{
				id: rows.tattoo.id,
				startsAt: DateTime.utc(2026, 11, 2, 10).toMillis(),
				endsAt: DateTime.utc(2026, 11, 2, 12).toMillis(),
				startText: "15:45",
				endText: "17:45",
				kind: "tattoo",
				status: "scheduled",
				artistName: "Sita",
				project: { id: project.id, clientName: "Maya Gurung", brief: BRIEF },
			},
		]);
	});

	test("a week runs Sunday to Saturday, and a session past midnight shows on both days", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, project } = await studio();
		const late = await inTenant(tenant, () =>
			makeSession(tenant, project, sita, {
				startsAt: at("2026-11-02", "22:30"),
				endsAt: at("2026-11-03", "01:30"),
			}),
		);

		const props = (
			await client
				.get(calendarUrl("?view=week&date=2026-11-04"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.include(props, {
			view: "week",
			date: "2026-11-04",
			rangeText: "1–7 Nov 2026",
			previous: "2026-10-28",
			next: "2026-11-11",
		});
		assert.deepEqual(
			props.days.map(({ date, label, sessions }: Day) => [
				date,
				label,
				sessions.map(({ id, startText, endText }) => [id, startText, endText]),
			]),
			[
				["2026-11-01", "Sun 1 Nov", []],
				["2026-11-02", "Mon 2 Nov", [[late.id, "22:30", "Tue 01:30"]]],
				["2026-11-03", "Tue 3 Nov", [[late.id, "Mon 22:30", "01:30"]]],
				["2026-11-04", "Wed 4 Nov", []],
				["2026-11-05", "Thu 5 Nov", []],
				["2026-11-06", "Fri 6 Nov", []],
				["2026-11-07", "Sat 7 Nov", []],
			],
		);
	});

	test("cancelled and no-show sessions are left out; a completed one stays and says so", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, project } = await studio();
		const done = await inTenant(tenant, async () => {
			await makeSession(tenant, project, sita, {
				status: "cancelled",
				startsAt: at("2026-11-02", "10:00"),
				endsAt: at("2026-11-02", "11:00"),
			});
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: at("2026-11-02", "10:00"),
				endsAt: at("2026-11-02", "11:00"),
			});
			return makeSession(tenant, project, sita, {
				status: "completed",
				startsAt: at("2026-11-02", "12:00"),
				endsAt: at("2026-11-02", "13:00"),
			});
		});

		const props = (
			await client
				.get(calendarUrl("?date=2026-11-02"))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.days[0].sessions.map(({ id, status }: Row) => [id, status]),
			[[done.id, "completed"]],
		);
	});

	test("an unknown view or date is today's day view; a repeated or empty artist is the whole studio", async ({
		client,
		assert,
	}) => {
		const { owner, ram, sita } = await studio();
		const today = todayIn(KTM);

		for (const query of [
			"?view=month&date=2026-02-30",
			"?view=week&view=day&date=soon",
			`?artist=${ram.id}&artist=${sita.id}`,
			"?artist=",
		]) {
			const response = await client
				.get(calendarUrl(query))
				.withInertia()
				.loginAs(owner);
			response.assertStatus(200);
			assert.include(
				response.inertiaProps,
				{ view: "day", date: today, scope: "studio" },
				query,
			);
		}
	});

	test("an owner can show one artist's sessions", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, ram, sita, project } = await studio();
		const rams = await inTenant(tenant, async () => {
			await makeSession(tenant, project, sita);
			return makeSession(tenant, project, ram, {
				startsAt: at("2026-11-02", "09:00"),
				endsAt: at("2026-11-02", "10:00"),
			});
		});

		const props = (
			await client
				.get(calendarUrl(`?date=2026-11-02&artist=${ram.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.scope, "artist");
		assert.equal(props.artistFilter.selected, ram.id);
		assert.deepEqual(
			props.days[0].sessions.map(({ id }: Row) => id),
			[rams.id],
		);
	});

	test("another studio's artist, a deleted artist or a malformed id is a 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await studio();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, async () => {
			const artist = await makeArtist(other);
			// Studio B's session on the day studio A looks at.
			await makeSession(
				other,
				await makeProject(other, await makeClient(other)),
				artist,
			);
			return artist;
		});
		const gone = await inTenant(tenant, async () => {
			const artist = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await artist.softDelete();
			return artist;
		});

		// The controls: this studio's artist opens, and studio B's session is
		// not on this studio's calendar.
		const own = await client
			.get(calendarUrl(`?date=2026-11-02&artist=${sita.id}`))
			.withInertia()
			.loginAs(owner);
		own.assertStatus(200);
		const whole = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(owner);
		assert.deepEqual(whole.inertiaProps.days[0].sessions, []);

		for (const id of [theirs.id, gone.id, "not-a-uuid"]) {
			const response = await client
				.get(calendarUrl(`?artist=${id}`))
				.withInertia()
				.loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("an artist sees only their own sessions, and no details of a project that isn't theirs", async ({
		client,
		assert,
	}) => {
		const { tenant, sita, project } = await studio();
		const { user, profile } = await linkedArtist(tenant);
		const rows = await inTenant(tenant, async () => {
			const nimas = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Nima" }),
				{ artistId: profile.id, status: "booked" },
			);
			// Sita's own session: not on Asha's calendar.
			await makeSession(tenant, project, sita);
			return {
				nimas,
				own: await makeSession(tenant, nimas, profile, {
					startsAt: at("2026-11-02", "10:00"),
					endsAt: at("2026-11-02", "11:00"),
				}),
				// Booked with Asha, then the project went to Sita: the time stays Asha's.
				reassigned: await makeSession(tenant, project, profile, {
					startsAt: at("2026-11-02", "12:00"),
					endsAt: at("2026-11-02", "13:00"),
				}),
			};
		});

		const response = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(user);

		response.assertStatus(200);
		const props = response.inertiaProps;
		assert.equal(props.scope, "artist");
		assert.isNull(props.artistFilter);
		assert.deepEqual(
			props.days[0].sessions.map(({ id, project: details }: Row) => [
				id,
				details,
			]),
			[
				[rows.own.id, { id: rows.nimas.id, clientName: "Nima", brief: BRIEF }],
				[rows.reassigned.id, null],
			],
		);
		const own = await client
			.get(calendarUrl(`?artist=${profile.id}`))
			.withInertia()
			.loginAs(user);
		own.assertStatus(200);
		const sitas = await client
			.get(calendarUrl(`?artist=${sita.id}`))
			.withInertia()
			.loginAs(user);
		sitas.assertStatus(404);
	});

	test("an artist without a profile gets an explanation, not an error", async ({
		client,
		assert,
	}) => {
		const { tenant, sita, project } = await studio();
		await inTenant(tenant, () => makeSession(tenant, project, sita));
		const user = await artistIn(tenant, "ram@example.com");

		const response = await client
			.get(calendarUrl("?date=2026-11-02"))
			.withInertia()
			.loginAs(user);

		response.assertStatus(200);
		assert.equal(response.inertiaProps.scope, "unlinked");
		assert.isNull(response.inertiaProps.artistFilter);
		assert.deepEqual(response.inertiaProps.days[0].sessions, []);
		const other = await client
			.get(calendarUrl(`?artist=${sita.id}`))
			.withInertia()
			.loginAs(user);
		other.assertStatus(404);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=calendar_page.spec.ts`
Expected: FAIL, 9 tests: every request gets 404 (no `/calendar` route), so the 404 tests fail on their 200 controls.

Run: `PORT=3402 timeout 90 pnpm test unit --files=now_marker.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124` and "Cannot find module" for `inertia/components/calendar.js`.

- [ ] **Step 3: The page's prop types and the Now marker's position**

Create `apps/platform/inertia/components/calendar.ts`:

```ts
/**
 * The calendar page's props (TAT-50) and where its Now marker goes. Plain
 * types and one function with no imports, so the unit tests can load it.
 */

export type CalendarView = "day" | "week";

/** One session as a row on one day. */
export type CalendarSession = {
	id: string;
	/** Epoch milliseconds, for the Now marker. */
	startsAt: number;
	endsAt: number;
	/** "14:00", or "Mon 01:30" for a time on another day. */
	startText: string;
	endText: string;
	kind: string;
	/** "scheduled" or "completed": the calendar shows active sessions only. */
	status: string;
	/** The session's artist; null when their profile was deleted. */
	artistName: string | null;
	/** Null when this member can't open the project. */
	project: { id: string; clientName: string | null; brief: string } | null;
};

export type CalendarDay = {
	/** yyyy-MM-dd, a day of the studio. */
	date: string;
	/** "Sun 1 Nov". */
	label: string;
	sessions: CalendarSession[];
};

export type CalendarPageProps = {
	view: CalendarView;
	/** yyyy-MM-dd: the day shown, or a day of the week shown. */
	date: string;
	/** yyyy-MM-dd: today in the studio's timezone. */
	today: string;
	/** The studio's timezone, for the Now marker's time. */
	timezone: string;
	/** "Mon 2 Nov 2026", or "1–7 Nov 2026" for a week. */
	rangeText: string;
	/** yyyy-MM-dd: one day or one week back, and on. */
	previous: string;
	next: string;
	/** The whole studio (owners), one artist, or nobody (an artist member without a profile). */
	scope: "studio" | "artist" | "unlinked";
	/** Owners: the artist picker. Null for artist members. */
	artistFilter: {
		selected: string | null;
		artists: { id: string; name: string }[];
	} | null;
	days: CalendarDay[];
};

/**
 * Where the Now marker goes among a day's sessions (in time order): before
 * the first that starts after `now`, or after the last when all have started.
 */
export function nowIndex(
	sessions: { startsAt: number }[],
	now: number,
): number {
	const index = sessions.findIndex(({ startsAt }) => startsAt > now);
	return index === -1 ? sessions.length : index;
}
```

- [ ] **Step 4: The controller**

Create `apps/platform/app/controllers/calendar_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { todayIn } from "#modules/projects/quotes";
import {
	briefPreview,
	calendarDays,
	dayBounds,
	dayLabel,
	overlapsDay,
	rangeText,
	shiftDate,
	timesOnDay,
	toCalendarDate,
	toCalendarView,
} from "#modules/scheduling/calendar";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CalendarService, {
	type CalendarEntry,
} from "#modules/scheduling/services/calendar_service";

/**
 * The calendar (TAT-50): a day or a week of sessions in the studio's
 * timezone, for the whole studio or one artist. Owners and artists (the
 * route group); what each member sees is CalendarService's. Read-only.
 */
@inject()
export default class CalendarController {
	constructor(private calendar: CalendarService) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { timezone } = tenant;
		const query = ctx.request.qs();
		const today = todayIn(timezone);
		const view = toCalendarView(query.view);
		const date = toCalendarDate(query.date, today);
		const artistId =
			typeof query.artist === "string" && query.artist !== ""
				? query.artist
				: null;
		const days = calendarDays(view, date);
		const { scope, artists, entries } = await this.calendar.load(
			tenant,
			membership,
			{
				artistId,
				from: dayBounds(days[0], timezone).from,
				to: dayBounds(days[days.length - 1], timezone).to,
			},
		);

		return ctx.inertia.render("calendar/index", {
			view,
			date,
			today,
			timezone,
			rangeText: rangeText(days),
			previous: shiftDate(view, date, -1),
			next: shiftDate(view, date, 1),
			scope: scope.kind,
			artistFilter:
				membership.role === "owner"
					? {
							selected: scope.kind === "artist" ? scope.artist.id : null,
							artists: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			days: days.map((day) => ({
				date: day,
				label: dayLabel(day),
				sessions: entries
					.filter(({ session }) =>
						overlapsDay(session.startsAt, session.endsAt, day, timezone),
					)
					.map((entry) => sessionRow(entry, day, timezone)),
			})),
		});
	}
}

/** One session as a row on `day`: times on that day, a preview of the brief. */
function sessionRow(
	{ session, artistName, project }: CalendarEntry,
	day: string,
	timezone: string,
) {
	return {
		id: session.id,
		startsAt: session.startsAt.toMillis(),
		endsAt: session.endsAt.toMillis(),
		...timesOnDay(session.startsAt, session.endsAt, day, timezone),
		kind: session.kind,
		status: session.status,
		artistName,
		project: project && {
			id: project.id,
			clientName: project.clientName,
			brief: briefPreview(project.brief),
		},
	};
}
```

- [ ] **Step 5: The page**

Create `apps/platform/inertia/pages/calendar/index.tsx`:

```tsx
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { urlFor } from "~/client";
import {
	type CalendarDay,
	type CalendarPageProps,
	type CalendarSession,
	type CalendarView,
	nowIndex,
} from "~/components/calendar";
import Page from "~/components/page";
import {
	SESSION_KIND_LABELS,
	SESSION_STATUS_LABELS,
} from "~/components/projects";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** A URL for this page with some of its state changed. */
type HrefFor = (change: { view?: CalendarView; date?: string }) => string;

/** The current time, moved on every minute: where the Now marker sits. */
function useNow(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/**
 * A day or a week of sessions (TAT-50), for the whole studio or one artist:
 * owners pick, artists see their own. Read-only; a session opens its
 * project.
 */
export default function CalendarIndex({
	view,
	date,
	today,
	timezone,
	rangeText,
	previous,
	next,
	scope,
	artistFilter,
	days,
}: CalendarPageProps) {
	const tenant = useTenant();
	const now = useNow();
	const isOwner = tenant.role === "owner";
	const base = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const hrefFor: HrefFor = (change) => {
		const params = new URLSearchParams({
			view: change.view ?? view,
			date: change.date ?? date,
		});
		if (artistFilter?.selected) params.set("artist", artistFilter.selected);
		return `${base}?${params.toString()}`;
	};

	if (scope === "unlinked") {
		return (
			<Page title="Calendar">
				<p className="max-w-prose text-sm text-muted-foreground">
					Your calendar shows the sessions booked with your artist profile, and
					your account isn&apos;t linked to one yet.
				</p>
			</Page>
		);
	}

	const agenda = (day: CalendarDay) => (
		<DayAgenda
			day={day}
			isToday={day.date === today}
			now={now}
			timezone={timezone}
			showArtist={scope === "studio"}
			isOwner={isOwner}
			tenantSlug={tenant.slug}
		/>
	);

	return (
		<Page title="Calendar" description={isOwner ? undefined : "Your sessions"}>
			<div className="flex max-w-3xl flex-col gap-6">
				<Toolbar
					view={view}
					today={today}
					previous={previous}
					next={next}
					hrefFor={hrefFor}
				/>
				{artistFilter &&
					(artistFilter.artists.length > 0 ? (
						<ArtistPicker
							base={base}
							view={view}
							date={date}
							filter={artistFilter}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							Every session belongs to an artist.{" "}
							<Link
								href={urlFor("tenant.artists.create", { tenant: tenant.slug })}
								className="font-medium text-foreground underline"
							>
								Add an artist
							</Link>{" "}
							to start booking.
						</p>
					))}
				<h2
					aria-live="polite"
					className="flex flex-wrap items-center gap-2 text-lg font-semibold"
				>
					{rangeText}
					{view === "day" && date === today && (
						<Badge variant="secondary">Today</Badge>
					)}
				</h2>
				{view === "day"
					? agenda(days[0])
					: days.map((day) => (
							<section
								key={day.date}
								aria-labelledby={`day-${day.date}`}
								className="flex flex-col gap-2"
							>
								<h3
									id={`day-${day.date}`}
									className="flex items-center gap-2 text-sm font-semibold"
								>
									{day.label}
									{day.date === today && (
										<Badge variant="secondary">Today</Badge>
									)}
								</h3>
								{agenda(day)}
							</section>
						))}
			</div>
		</Page>
	);
}

CalendarIndex.layout = [AppLayout];

/** Day or week, and one step back, today, one step on. */
function Toolbar({
	view,
	today,
	previous,
	next,
	hrefFor,
}: {
	view: CalendarView;
	today: string;
	previous: string;
	next: string;
	hrefFor: HrefFor;
}) {
	const unit = view === "day" ? "day" : "week";
	const step = cn(buttonVariants({ variant: "outline", size: "icon" }), "size-11");

	return (
		<nav
			aria-label="Calendar"
			className="flex flex-wrap items-center justify-between gap-2"
		>
			<div className="inline-flex overflow-hidden rounded-md border bg-background">
				{(["day", "week"] as const).map((option) => (
					<Link
						key={option}
						href={hrefFor({ view: option })}
						aria-current={option === view ? "page" : undefined}
						className={cn(
							buttonVariants({
								variant: option === view ? "secondary" : "ghost",
							}),
							"min-h-11 rounded-none px-4 aria-[current=page]:font-semibold",
						)}
					>
						{option === "day" ? "Day" : "Week"}
					</Link>
				))}
			</div>
			<div className="flex items-center gap-2">
				<Link
					href={hrefFor({ date: previous })}
					aria-label={`Previous ${unit}`}
					className={step}
				>
					<ChevronLeft aria-hidden="true" />
				</Link>
				<Link
					href={hrefFor({ date: today })}
					className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
				>
					Today
				</Link>
				<Link
					href={hrefFor({ date: next })}
					aria-label={`Next ${unit}`}
					className={step}
				>
					<ChevronRight aria-hidden="true" />
				</Link>
			</div>
		</nav>
	);
}

/** Owners: one artist or all. A GET form with a button, no change-to-submit. */
function ArtistPicker({
	base,
	view,
	date,
	filter,
}: {
	base: string;
	view: CalendarView;
	date: string;
	filter: NonNullable<CalendarPageProps["artistFilter"]>;
}) {
	return (
		<form method="get" action={base} className="flex flex-wrap items-end gap-2">
			<input type="hidden" name="view" value={view} />
			<input type="hidden" name="date" value={date} />
			<Field className="min-w-0 flex-1 basis-48">
				<FieldLabel htmlFor="artist">Artist</FieldLabel>
				<select
					key={filter.selected ?? "all"}
					id="artist"
					name="artist"
					defaultValue={filter.selected ?? ""}
					className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm"
				>
					<option value="">All artists</option>
					{filter.artists.map(({ id, name }) => (
						<option key={id} value={id}>
							{name}
						</option>
					))}
				</select>
			</Field>
			<Button type="submit" variant="outline" className="min-h-11">
				Show
			</Button>
		</form>
	);
}

/** One day's sessions in time order, with the Now marker on today. */
function DayAgenda({
	day,
	isToday,
	now,
	timezone,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	day: CalendarDay;
	isToday: boolean;
	now: number;
	timezone: string;
	showArtist: boolean;
	isOwner: boolean;
	tenantSlug: string;
}) {
	if (day.sessions.length === 0) {
		return <p className="text-sm text-muted-foreground">No sessions.</p>;
	}
	const marker = isToday ? nowIndex(day.sessions, now) : -1;

	return (
		<ul className="flex flex-col divide-y rounded-md border bg-card">
			{day.sessions.map((session, index) => (
				<Fragment key={session.id}>
					{index === marker && <NowMarker now={now} timezone={timezone} />}
					<SessionItem
						session={session}
						showArtist={showArtist}
						isOwner={isOwner}
						tenantSlug={tenantSlug}
					/>
				</Fragment>
			))}
			{marker === day.sessions.length && (
				<NowMarker now={now} timezone={timezone} />
			)}
		</ul>
	);
}

/** "Now 13:05" and a rule: text, not colour, says where now is. */
function NowMarker({ now, timezone }: { now: number; timezone: string }) {
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(now);

	return (
		<li className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold">
			<span>Now {time}</span>
			<span aria-hidden="true" className="h-px flex-1 bg-foreground" />
		</li>
	);
}

/**
 * One session: the times in a fixed column, then who, what and the brief.
 * A link to the project, unless this member can't open it.
 */
function SessionItem({
	session,
	showArtist,
	isOwner,
	tenantSlug,
}: {
	session: CalendarSession;
	showArtist: boolean;
	isOwner: boolean;
	tenantSlug: string;
}) {
	const { project } = session;
	const kind = SESSION_KIND_LABELS[session.kind] ?? session.kind;
	const hidden = isOwner ? "Project not available" : "Not assigned to you";
	const content = (
		<>
			<span className="flex w-18 shrink-0 flex-col tabular-nums">
				<span className="font-semibold">{session.startText}</span>
				<span className="sr-only">to</span>
				<span className="text-sm text-muted-foreground">{session.endText}</span>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex items-start justify-between gap-2">
					<span
						className={cn(
							"truncate font-medium",
							!project && "text-muted-foreground",
						)}
					>
						{project ? (project.clientName ?? "Unknown client") : hidden}
					</span>
					{session.status === "completed" && (
						<Badge variant="outline">{SESSION_STATUS_LABELS.completed}</Badge>
					)}
				</span>
				<span className="text-sm">
					{showArtist
						? `${kind} with ${session.artistName ?? "Unknown artist"}`
						: kind}
				</span>
				{project?.brief && (
					<span className="truncate text-sm text-muted-foreground">
						{project.brief}
					</span>
				)}
			</span>
		</>
	);

	return (
		<li>
			{project ? (
				<Link
					href={urlFor("tenant.projects.show", {
						tenant: tenantSlug,
						id: project.id,
					})}
					className="flex min-h-11 gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{content}
				</Link>
			) : (
				<div className="flex gap-3 px-4 py-3">{content}</div>
			)}
		</li>
	);
}
```

- [ ] **Step 6: The route**

In `apps/platform/start/routes.ts`, right after the projects group (after its closing `.prefix("/projects")` / `.use(middleware.role({ allow: ["owner", "artist"] }));`) and before the tenant group closes, add:

```ts
		/**
		 * The calendar: owners (the whole studio or one artist) and artists
		 * (their own sessions); CalendarService decides what each member
		 * sees. Every calendar route goes in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Calendar, "index"])
					.as("tenant.calendar.index");
			})
			.prefix("/calendar")
			.use(middleware.role({ allow: ["owner", "artist"] }));
```

- [ ] **Step 7: The isolation case and the role guard**

In `apps/platform/tests/isolation/cases.ts`, add this case at the end of `isolationCases` (after the `PUT /t/:tenant/clients/:id` case):

```ts
	{
		method: "GET",
		pattern: "/t/:tenant/calendar",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, add `{ area: "calendar", allow: ["owner", "artist"] },` to the area list after the `projects` entry.

- [ ] **Step 8: Regenerate types**

Run: `node ace codegen`
Expected: `.adonisjs/server/controllers.ts` gains `Calendar`, `.adonisjs/server/pages.d.ts` gains `calendar/index`, and the route registry gains `tenant.calendar.index`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=calendar_page.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts` and `PORT=3402 pnpm test unit --files=now_marker.spec.ts`
Expected: PASS (9 page tests, the calendar role guard, the new isolation case, 1 unit test). Then `pnpm typecheck`: clean (the controller's props must match `CalendarPageProps` exactly). Then from the repo root: `pnpm exec biome check --write apps/platform/app/controllers/calendar_controller.ts apps/platform/inertia/pages/calendar/index.tsx apps/platform/inertia/components/calendar.ts apps/platform/start/routes.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/tests/functional/scheduling/calendar_page.spec.ts apps/platform/tests/unit/inertia/now_marker.spec.ts`: clean.

- [ ] **Step 10: Commit**

```bash
git add app/controllers/calendar_controller.ts inertia/components/calendar.ts inertia/pages/calendar/index.tsx start/routes.ts tests/isolation/cases.ts tests/functional/tenancy/tenant_routes.spec.ts tests/functional/scheduling/calendar_page.spec.ts tests/unit/inertia/now_marker.spec.ts .adonisjs
git commit -m "feat(platform): show a day or week of sessions on the calendar"
```

---

### Task 6: The Calendar tab

**Files:**
- Modify: `apps/platform/inertia/components/shell/nav_items.ts`
- Modify: `apps/platform/inertia/components/shell/nav_icons.ts`
- Test: `apps/platform/tests/unit/inertia/nav_items.spec.ts`

**Interfaces:**
- Consumes: the `tenant.calendar.index` route (Task 5).
- Produces: `NavKey` gains `"calendar"`; `navItems` puts Calendar after Projects for every member.

- [ ] **Step 1: Write the failing test**

In `apps/platform/tests/unit/inertia/nav_items.spec.ts`, replace the first test of the "navItems" group with:

```ts
	test("owners get Inbox, Projects, Calendar, Clients and Settings; artists get Projects and Calendar", ({
		assert,
	}) => {
		assert.deepEqual(
			navItems(owner, 0).map(({ key }) => key),
			["inbox", "projects", "calendar", "clients", "settings"],
		);
		assert.deepEqual(
			navItems(artist, null).map(({ key }) => key),
			["projects", "calendar"],
		);
		assert.deepEqual(
			navItems(artist, null).find(({ key }) => key === "calendar"),
			{ key: "calendar", label: "Calendar", route: "tenant.calendar.index" },
		);
	});
```

and replace "the tab bar needs two or more destinations" with:

```ts
	test("the tab bar needs two or more destinations", ({ assert }) => {
		assert.isTrue(showTabBar(navItems(owner, 0)));
		// Calendar is the artists' second destination (TAT-50): their bar shows.
		assert.isTrue(showTabBar(navItems(artist, 0)));
		assert.isFalse(showTabBar(navItems(artist, 0).slice(0, 1)));
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 pnpm test unit --files=nav_items.spec.ts`
Expected: FAIL, 2 tests (no `calendar` key; the artists' tab bar is still hidden).

- [ ] **Step 3: Add the destination**

In `apps/platform/inertia/components/shell/nav_items.ts`:

- In the file comment, replace "Calendar (TAT-50) and Clients (TAT-41) each become one more entry here." with "A new area is one more entry here.".
- `export type NavKey = "inbox" | "projects" | "calendar" | "clients" | "settings";`
- In `ShellNavItem.route`, add `| "tenant.calendar.index"` after `| "tenant.projects.index"`.
- Replace the `navItems` doc comment with: "What `tenant`'s member sees: owners get Inbox, Projects, Calendar, Clients and Settings (the artist pages count as Settings); artists get Projects and Calendar. The server 404s the rest anyway."
- Right after the `projects` push, add:

```ts
	items.push({
		key: "calendar",
		label: "Calendar",
		route: "tenant.calendar.index",
	});
```

In `apps/platform/inertia/components/shell/nav_icons.ts`, import `CalendarDays` from `lucide-react` (alphabetical, before `ClipboardList`) and add `calendar: CalendarDays,` after `projects: ClipboardList,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=nav_items.spec.ts`
Expected: PASS. Then `pnpm typecheck`: clean (`NAV_ICONS` must cover every `NavKey`).

- [ ] **Step 5: Commit**

```bash
git add inertia/components/shell/nav_items.ts inertia/components/shell/nav_icons.ts tests/unit/inertia/nav_items.spec.ts
git commit -m "feat(platform): add the Calendar tab for owners and artists"
```

---

### Task 7: "Book session" on the day shown (needs TAT-43's booking page)

**Depends on TAT-43** (present at 3bc345b): `BookingsController.create`, `inertia/components/bookings.ts`, `inertia/pages/projects/new.tsx` (`PhoneLookup`, `ClientCard`, `SessionCard`), `lastBookableDay`, `tests/functional/projects/bookings_http.spec.ts` (`newUrl`, `dayFromNow`). Read those files before editing; if they differ from the snippets below, make the equivalent change.

**Files:**
- Modify: `apps/platform/app/controllers/bookings_controller.ts` (`create`)
- Modify: `apps/platform/inertia/components/bookings.ts` (`dates`)
- Modify: `apps/platform/inertia/pages/projects/new.tsx`
- Modify: `apps/platform/app/controllers/calendar_controller.ts` (`canBook`)
- Modify: `apps/platform/inertia/components/calendar.ts` (`canBook`)
- Modify: `apps/platform/inertia/pages/calendar/index.tsx` (header action)
- Test: `apps/platform/tests/functional/projects/bookings_http.spec.ts`
- Test: `apps/platform/tests/functional/scheduling/calendar_page.spec.ts`

**Interfaces:**
- Consumes: `toCalendarDate` (Task 1); the calendar page (Task 5).
- Produces: `BookingPageProps.dates.initial: string` (the Date field's default); `CalendarPageProps.canBook: boolean`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/projects/bookings_http.spec.ts`, in "an owner starts at the lookup with the studio's artists", change the `props.dates` assertion to:

```ts
		assert.deepEqual(props.dates, {
			today: dayFromNow(0),
			max: DateTime.fromISO(dayFromNow(0))
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
			initial: dayFromNow(0),
		});
```

and add this test at the end of the "Booking page" group:

```ts
	test("?date= sets the session day when it is bookable, else today", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () => makeArtist(tenant));
		const initial = async (query: string) =>
			(
				await client
					.get(`/t/black-needle/projects/new${query}`)
					.withInertia()
					.loginAs(owner)
			).inertiaProps.dates.initial;
		const today = dayFromNow(0);
		const lastDay = DateTime.fromISO(today)
			.plus({ years: 1 })
			.toFormat("yyyy-MM-dd");

		assert.equal(await initial(`?date=${dayFromNow(3)}`), dayFromNow(3));
		assert.equal(await initial(`?date=${lastDay}`), lastDay);
		// The phone lookup keeps it.
		assert.equal(
			await initial(`?phone=9812345678&date=${dayFromNow(3)}`),
			dayFromNow(3),
		);
		for (const date of [
			dayFromNow(-1),
			DateTime.fromISO(lastDay).plus({ days: 1 }).toFormat("yyyy-MM-dd"),
			"2026-02-30",
			"soon",
		]) {
			assert.equal(await initial(`?date=${date}`), today, date);
		}
		assert.equal(await initial(""), today);
	});
```

In `apps/platform/tests/functional/scheduling/calendar_page.spec.ts`, add `import type User from "#models/user";` to the imports and this test at the end of the group:

```ts
	test("Book session shows for owners and for artists with a profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio();
		const { user } = await linkedArtist(tenant);
		const unlinked = await artistIn(tenant, "ram@example.com");
		const canBook = async (member: User) =>
			(await client.get(calendarUrl()).withInertia().loginAs(member))
				.inertiaProps.canBook;

		assert.isTrue(await canBook(owner));
		assert.isTrue(await canBook(user));
		assert.isFalse(await canBook(unlinked));
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts --files=calendar_page.spec.ts`
Expected: FAIL, 3 tests: the `dates` deepEqual (no `initial`), the `?date=` test (`initial` undefined), and `canBook` (undefined, not true).

- [ ] **Step 3: The booking page reads `?date=`**

In `apps/platform/app/controllers/bookings_controller.ts`, add `import { toCalendarDate } from "#modules/scheduling/calendar";` (after the `#modules/scheduling/errors` import), and in `create` replace `const today = todayIn(tenant.timezone);` and the `dates:` line with:

```ts
		const today = todayIn(tenant.timezone);
		const max = lastBookableDay(today);
		// The calendar's "Book session" sends the day it shows (TAT-50).
		const wanted = toCalendarDate(ctx.request.qs().date, today);
```

```ts
			dates: {
				today,
				max,
				initial: wanted >= today && wanted <= max ? wanted : today,
			},
```

In `apps/platform/inertia/components/bookings.ts`, replace the `dates` property with:

```ts
	/**
	 * yyyy-MM-dd in the studio's timezone: the first and last bookable day,
	 * and the Date field's default (`?date=` when it is bookable, as the
	 * calendar sends it; else today).
	 */
	dates: { today: string; max: string; initial: string };
```

In `apps/platform/inertia/pages/projects/new.tsx`:

- After the `errorId` helper, add:

```ts
/** The day to carry through the lookup: only one the calendar chose. */
const carriedDate = (dates: BookingPageProps["dates"]) =>
	dates.initial === dates.today ? null : dates.initial;
```

- In `BookingNew`, render `<PhoneLookup invalid={lookup} date={carriedDate(dates)} />`.
- `PhoneLookup` takes `{ invalid, date }: { invalid: Invalid | null; date: string | null }` and, inside its `<form>` before the `Field`, renders `{date && <input type="hidden" name="date" value={date} />}`.
- In `BookingForm`, render `<ClientCard lookup={lookup} isOwner={isOwner} errors={errors} date={carriedDate(dates)} />`; `ClientCard` takes `date: string | null` too, and its "Change number" link becomes:

```tsx
						<Link
							href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}${date ? `?date=${date}` : ""}`}
							aria-describedby={problem ? "client-error" : undefined}
							className={buttonVariants({
								variant: "outline",
								className: TARGET,
							})}
						>
							Change number
						</Link>
```

- In `SessionCard`, the Date input's `defaultValue={dates.today}` becomes `defaultValue={dates.initial}`.

- [ ] **Step 4: The calendar links to it**

In `apps/platform/inertia/components/calendar.ts`, add to `CalendarPageProps` after `artistFilter`:

```ts
	/** Whether "Book session" shows: owners, and artists with a profile. */
	canBook: boolean;
```

In `apps/platform/app/controllers/calendar_controller.ts`, add after `artistFilter` in the props:

```ts
			canBook: membership.role === "owner" || scope.kind === "artist",
```

In `apps/platform/inertia/pages/calendar/index.tsx`, add `canBook` to the destructured props and give the main `Page` (not the unlinked one) an `actions` prop:

```tsx
		<Page
			title="Calendar"
			description={isOwner ? undefined : "Your sessions"}
			actions={
				canBook ? (
					<Link
						href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?date=${date}`}
						className={cn(buttonVariants(), "h-11")}
					>
						Book session
					</Link>
				) : undefined
			}
		>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=bookings_http.spec.ts --files=calendar_page.spec.ts`
Expected: PASS (every booking test, the new `?date=` test, 10 calendar tests). Then `pnpm typecheck`: clean. Then from the repo root: `pnpm exec biome check --write apps/platform/app/controllers/bookings_controller.ts apps/platform/inertia/components/bookings.ts apps/platform/inertia/pages/projects/new.tsx apps/platform/app/controllers/calendar_controller.ts apps/platform/inertia/components/calendar.ts apps/platform/inertia/pages/calendar/index.tsx apps/platform/tests/functional/projects/bookings_http.spec.ts apps/platform/tests/functional/scheduling/calendar_page.spec.ts`: clean.

- [ ] **Step 6: Commit**

```bash
git add app/controllers/bookings_controller.ts inertia/components/bookings.ts inertia/pages/projects/new.tsx app/controllers/calendar_controller.ts inertia/components/calendar.ts inertia/pages/calendar/index.tsx tests/functional/projects/bookings_http.spec.ts tests/functional/scheduling/calendar_page.spec.ts
git commit -m "feat(platform): book a session from the calendar on the day it shows"
```

---

### Task 8: Docs (next to TAT-43's)

**Files:**
- Modify: `apps/platform/docs/backend.md` (Scheduling: the TAT-36 bullet, a new Calendar bullet; the Projects and quotes bullet)
- Modify: `apps/platform/docs/ui.md` (Phones and slow connections)
- Modify: `docs/requirements.md` (Sessions)

`docs/README.md` needs no change (no new document).

- [ ] **Step 1: Backend conventions**

In `apps/platform/docs/backend.md`, Scheduling, first bullet: replace "`findFor` and `listForProject`; calendar range queries are TAT-50's." with "`findFor`, `listForProject` and `listInRange` (the calendar's read: active sessions overlapping a half-open window, for one artist or all, written as the no-overlap constraint's own `tstzrange(starts_at, ends_at) &&` expression so its gist index serves one artist's window; no index was added for it)."

Add this bullet right after the "Direct bookings (TAT-43)" bullet:

```markdown
- Calendar (TAT-50): `CalendarService` (`#modules/scheduling/services/calendar_service`) `load(tenant, member, { artistId, from, to })` decides whose sessions a member sees and reads them with one query per module (`ArtistService.list`, `SessionService.listInRange`, `ProjectService.findManyFor`, `ClientService.findMany`). Owners see the whole studio, or one live artist with `artistId`; an artist member sees only the live profile linked to them (none: `scope` `unlinked`, an explanation on the page). Any other `artistId` is E_ROW_NOT_FOUND (a 404), compared with the artist list in memory so a malformed id never reaches the database. A session's client and brief are shown only when the member may open its project (`findManyFor`, the `findFor` rule): an artist's session on a project assigned to someone else shows its time and kind only. Only active sessions show. Days are the studio's local days (`#modules/scheduling/calendar`: `dayBounds` runs from local midnight to the next, 23 or 25 hours on clock-change days; dates are plain yyyy-MM-dd computed in UTC; weeks run Sunday to Saturday; a session shows on every day it overlaps). The page is `/t/:tenant/calendar?view=day|week&date=yyyy-MM-dd&artist=` (owners and artists), read-only; its "Book session" opens `/t/:tenant/projects/new?date=`, which preselects that day when it is bookable.
```

In the "Projects and quotes (TAT-64)" bullet, after "`findFor(tenant, member, id)` (owners see every live project, an artist only those assigned to their own live artist profile, anyone else a 404)," insert "`findManyFor(tenant, member, ids)` (the same rule for many ids at once, no order: the calendar's project details, TAT-50),".

- [ ] **Step 2: UI conventions**

In `apps/platform/docs/ui.md`, "Phones and slow connections", replace "- Lists are paginated (25 per page) and props carry only what the screen shows." with:

```markdown
- Open-ended lists are paginated (25 per page); a view bounded by a range (the calendar's day or week) lists the whole range instead. Props carry only what the screen shows.
```

- [ ] **Step 3: Requirements**

In `docs/requirements.md`, under **Sessions**, after the line "- A direct booking looks the client up by phone first…", add:

```markdown
- The calendar shows active sessions (scheduled or completed) by the studio's local day, a day or a Sunday-to-Saturday week at a time, each opening its project. Owners see the whole studio or one artist; artists see their own sessions, and one on a project that isn't theirs shows only its time and kind.
```

- [ ] **Step 4: Commit (from the repo root)**

```bash
git add apps/platform/docs/backend.md apps/platform/docs/ui.md docs/requirements.md
git commit -m "docs(platform): document the artist calendar"
```

---

### Task 9: Final verification

- [ ] **Step 1: Generated files are current**

Run in `apps/platform`: `node ace codegen`, then `git status --short`.
Expected: no changes (Task 5 committed `.adonisjs/`). If `.adonisjs/` changed, commit it with `chore(platform): regenerate types`.

- [ ] **Step 2: Root gates**

From the repo root: `pnpm check`, `pnpm typecheck`, `pnpm build`.
Expected: all clean (`pnpm check` keeps its 2 pre-existing warnings in `inertia/ssr.tsx` and `inertia/types.ts`). If `pnpm check` fails with "nested root configuration" because of another agent's `.claude/worktrees/*` checkout, run `pnpm exec biome check apps packages` instead and say so in the report.

- [ ] **Step 3: Full suite**

In `apps/platform`: `PORT=3402 node ace test` with `run_in_background`, and wait for the notification (about 2 minutes).
Expected: all pass, about 34 more than the 807 on 3bc345b (Task 1: 12, Task 2: 2, Task 3: 2, Task 4: 4, Task 5: 9 + 1 unit + 1 isolation case + 1 role guard, Task 7: 2). Report the exact count.

- [ ] **Step 4: Schema untouched, tree clean**

Run: `git diff 3bc345b --stat -- apps/platform/database` (expected: empty) and `git status -sb` (expected: clean). `git log --oneline 3bc345b..HEAD` lists the spec/plan commit and the tasks' commits.

- [ ] **Step 5: PR text (not committed)**

Write the PR text to the scratchpad (`pr-tat-50.md`): a few "what and why" bullets per change (mentor mode), the rulings the user should see first (Sunday weeks, sessions on every day they overlap, artists see only their own sessions and no details of a reassigned project, no migration thanks to the constraint's gist index, the booking page's new `?date=`), and the spec's browser pass as a checklist for the user. Do not push and do not open a PR. Carry-forward comments (TAT-30, TAT-33, TAT-42, TAT-35/45, TAT-74, as in the spec) and the suggested ticket for completing sessions are for when the PR is ready, not this run.
