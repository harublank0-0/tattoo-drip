import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PAGE_CACHE } from "../../src/studio/cache.ts";
import {
	type Closure,
	clockText,
	closedDaysText,
	coverState,
	coverText,
	hoursLines,
	PAGE_MAX_AGE_MS,
	readClosures,
	readWeek,
	steadyCoverState,
	WEEKDAY_KEYS,
	type Week,
	zonedNow,
} from "../../src/studio/hours.ts";

const KTM = "Asia/Kathmandu";

/** The instant that is `local` ("2026-10-30T19:55") on a Kathmandu wall clock (+05:45). */
const at = (local: string) =>
	new Date(Date.parse(`${local}Z`) - (5 * 60 + 45) * 60_000);

/** A week from Sunday: [opens, closes] or null for each day. */
const weekOf = (days: readonly ([string, string] | null)[]): Week =>
	days.map((day) => (day ? { opens: day[0], closes: day[1] } : null));

const OPEN: [string, string] = ["11:00", "20:00"];
const EMPTY_WEEK = weekOf([null, null, null, null, null, null, null]);
// Sunday to Friday 11:00 to 20:00, Saturday closed. 2026-10-30 is a Friday.
const W = weekOf([OPEN, OPEN, OPEN, OPEN, OPEN, OPEN, null]);
// Dashain: Monday 2 to Wednesday 4 November 2026.
const DASHAIN: Closure[] = [
	{ from: "2026-11-02", to: "2026-11-04", note: "दशैं बिदा, back on 5 November" },
];

const text = (state: ReturnType<typeof coverState>) =>
	state ? coverText(state) : null;

describe("zonedNow", () => {
	test("+05:45 is honoured: 18:14:59Z is Friday 23:59, 18:15Z is Saturday 00:00", () => {
		assert.deepEqual(zonedNow(new Date("2026-10-30T18:14:59Z"), KTM), {
			date: "2026-10-30",
			weekday: 5,
			minutes: 23 * 60 + 59,
		});
		assert.deepEqual(zonedNow(new Date("2026-10-30T18:15:00Z"), KTM), {
			date: "2026-10-31",
			weekday: 6,
			minutes: 0,
		});
	});

	test("another zone and a Sunday", () => {
		assert.deepEqual(zonedNow(new Date("2026-11-01T12:00:00Z"), "UTC"), {
			date: "2026-11-01",
			weekday: 0,
			minutes: 12 * 60,
		});
	});

	test("an unknown timezone is null", () => {
		assert.equal(zonedNow(new Date(), "Mars/Olympus"), null);
		assert.equal(zonedNow(new Date(), ""), null);
	});

	test("an invalid Date is null", () => {
		assert.equal(zonedNow(new Date("nonsense"), KTM), null);
	});
});

describe("coverState and coverText", () => {
	test("Friday 19:55 is open till 8 pm", () => {
		assert.deepEqual(text(coverState(W, [], KTM, at("2026-10-30T19:55"))), {
			lead: "Open now",
			detail: "till 8 pm",
		});
	});

	test("Friday 20:00 is closed, opening Sunday (Saturday is closed)", () => {
		assert.deepEqual(text(coverState(W, [], KTM, at("2026-10-30T20:00"))), {
			lead: "Closed now",
			detail: "opens Sunday at 11 am",
		});
	});

	test("a closed weekday says closed today and opens tomorrow", () => {
		assert.deepEqual(text(coverState(W, [], KTM, at("2026-10-31T10:00"))), {
			lead: "Closed today",
			detail: "opens tomorrow at 11 am",
		});
	});

	test("before opening says when it opens today", () => {
		assert.deepEqual(text(coverState(W, [], KTM, at("2026-11-01T09:00"))), {
			lead: "Closed now",
			detail: "opens at 11 am",
		});
	});

	test("opens exactly at the opening minute and is closed exactly at closing", () => {
		assert.equal(coverState(W, [], KTM, at("2026-11-01T11:00"))?.kind, "open");
		assert.equal(coverState(W, [], KTM, at("2026-11-01T10:59"))?.kind, "later");
		assert.equal(coverState(W, [], KTM, at("2026-11-01T19:59"))?.kind, "open");
		assert.equal(
			coverState(W, [], KTM, at("2026-11-01T20:00"))?.kind,
			"closed",
		);
	});

	test("inside a closure it says closed today with the note, never open", () => {
		for (const local of [
			"2026-11-02T00:00",
			"2026-11-02T12:00",
			"2026-11-04T23:59",
		]) {
			assert.deepEqual(text(coverState(W, DASHAIN, KTM, at(local))), {
				lead: "Closed today",
				detail: "दशैं बिदा, back on 5 November",
			});
		}
		assert.equal(
			coverState(W, DASHAIN, KTM, at("2026-11-05T12:00"))?.kind,
			"open",
		);
	});

	test("the day before a closure skips the closed days when it names the next opening", () => {
		// Sunday 21:00, then Monday to Wednesday are closed: Thursday.
		assert.deepEqual(
			text(coverState(W, DASHAIN, KTM, at("2026-11-01T21:00"))),
			{
				lead: "Closed now",
				detail: "opens Thursday at 11 am",
			},
		);
	});

	test("a closure with no note has no detail", () => {
		const bare: Closure[] = [
			{ from: "2026-11-02", to: "2026-11-02", note: null },
		];

		assert.deepEqual(text(coverState(W, bare, KTM, at("2026-11-02T12:00"))), {
			lead: "Closed today",
			detail: null,
		});
	});

	test("no open weekday and no closure says nothing", () => {
		assert.equal(coverState(EMPTY_WEEK, [], KTM, at("2026-10-30T12:00")), null);
		// A closure elsewhere in time doesn't make today worth a line.
		assert.equal(
			coverState(EMPTY_WEEK, DASHAIN, KTM, at("2026-10-30T12:00")),
			null,
		);
	});

	test("a closure with no weekly hours is still closed today with its note", () => {
		assert.deepEqual(
			text(coverState(EMPTY_WEEK, DASHAIN, KTM, at("2026-11-03T12:00"))),
			{ lead: "Closed today", detail: "दशैं बिदा, back on 5 November" },
		);
	});

	test("nothing opens within seven days: closed with no detail", () => {
		// Only Mondays open; the next Monday is closed for a closure.
		const mondays = weekOf([null, OPEN, null, null, null, null, null]);
		const closure: Closure[] = [
			{ from: "2026-11-09", to: "2026-11-09", note: null },
		];

		assert.deepEqual(
			text(coverState(mondays, closure, KTM, at("2026-11-02T21:00"))),
			{ lead: "Closed now", detail: null },
		);
	});

	test("an unknown timezone is no state", () => {
		assert.equal(
			coverState(W, [], "Mars/Olympus", at("2026-10-30T12:00")),
			null,
		);
	});
});

describe("steadyCoverState", () => {
	test("Friday 19:48 stays open through 19:59", () => {
		const state = steadyCoverState(W, [], KTM, at("2026-10-30T19:48"));

		assert.deepEqual(state, { kind: "open", closes: "20:00" });
	});

	test("Friday 19:49 closes inside 11 minutes: no steady state", () => {
		assert.equal(steadyCoverState(W, [], KTM, at("2026-10-30T19:49")), null);
	});

	test("Friday 23:50 is near midnight, which changes the words: no steady state", () => {
		assert.equal(steadyCoverState(W, [], KTM, at("2026-10-30T23:50")), null);
	});

	test("midday states hold", () => {
		assert.equal(
			steadyCoverState(W, [], KTM, at("2026-10-30T13:00"))?.kind,
			"open",
		);
		assert.equal(
			steadyCoverState(W, [], KTM, at("2026-10-31T13:00"))?.kind,
			"closed",
		);
		assert.equal(
			steadyCoverState(W, DASHAIN, KTM, at("2026-11-03T13:00"))?.kind,
			"closure",
		);
	});

	test("nothing to say is null", () => {
		assert.equal(
			steadyCoverState(EMPTY_WEEK, [], KTM, at("2026-10-30T13:00")),
			null,
		);
	});

	test("PAGE_MAX_AGE_MS is s-maxage plus stale-while-revalidate, so a cache change fails here", () => {
		const seconds = (name: string) =>
			Number(new RegExp(`${name}=(\\d+)`).exec(PAGE_CACHE)?.[1]);

		assert.equal(
			PAGE_MAX_AGE_MS,
			(seconds("s-maxage") + seconds("stale-while-revalidate")) * 1000,
		);
		assert.equal(PAGE_MAX_AGE_MS, 11 * 60 * 1000);
	});
});

describe("clockText", () => {
	test("12-hour, minutes only when they are not zero", () => {
		assert.equal(clockText("00:30"), "12:30 am");
		assert.equal(clockText("09:05"), "9:05 am");
		assert.equal(clockText("11:00"), "11 am");
		assert.equal(clockText("12:00"), "12 pm");
		assert.equal(clockText("12:30"), "12:30 pm");
		assert.equal(clockText("20:00"), "8 pm");
		assert.equal(clockText("23:59"), "11:59 pm");
	});
});

describe("hoursLines", () => {
	test("Sunday to Friday together, Saturday closed", () => {
		assert.deepEqual(hoursLines(W), [
			{ days: "Sun – Fri", hours: "11 am – 8 pm" },
			{ days: "Sat", hours: "Closed" },
		]);
	});

	test("equal neighbours are grouped and different ones are not", () => {
		const week = weekOf([
			null,
			OPEN,
			OPEN,
			["10:30", "18:00"],
			OPEN,
			OPEN,
			OPEN,
		]);

		assert.deepEqual(hoursLines(week), [
			{ days: "Sun", hours: "Closed" },
			{ days: "Mon – Tue", hours: "11 am – 8 pm" },
			{ days: "Wed", hours: "10:30 am – 6 pm" },
			{ days: "Thu – Sat", hours: "11 am – 8 pm" },
		]);
	});

	test("every day the same", () => {
		assert.deepEqual(hoursLines(weekOf(Array(7).fill(OPEN))), [
			{ days: "Every day", hours: "11 am – 8 pm" },
		]);
	});

	test("all closed is no lines", () => {
		assert.deepEqual(hoursLines(EMPTY_WEEK), []);
	});
});

describe("closedDaysText", () => {
	test("a year only when the range crosses one", () => {
		assert.equal(closedDaysText("2026-10-20", "2026-10-20"), "Tue 20 Oct");
		assert.equal(closedDaysText("2026-10-20", "2026-10-28"), "20 – 28 Oct");
		assert.equal(closedDaysText("2026-10-30", "2026-11-02"), "30 Oct – 2 Nov");
		assert.equal(
			closedDaysText("2026-12-30", "2027-01-02"),
			"30 Dec 2026 – 2 Jan 2027",
		);
	});
});

describe("readWeek", () => {
	test("reads the API's days into Sunday-first slots", () => {
		const week = readWeek([
			{ day: "mon", opens: "10:00", closes: "18:00" },
			{ day: "sun", opens: "11:00", closes: "20:00" },
		]);

		assert.equal(week.length, 7);
		assert.deepEqual(week[0], { opens: "11:00", closes: "20:00" });
		assert.deepEqual(week[1], { opens: "10:00", closes: "18:00" });
		assert.deepEqual(week.slice(2), [null, null, null, null, null]);
		assert.deepEqual(
			[...WEEKDAY_KEYS],
			["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
		);
	});

	test("anything but an array is a closed week", () => {
		for (const value of [undefined, null, "mon", 5, {}, { day: "mon" }]) {
			assert.deepEqual(readWeek(value), EMPTY_WEEK);
		}
	});

	test("an unknown day, a malformed time, closing at or before opening and a second entry for a day are dropped", () => {
		const week = readWeek([
			{ day: "funday", opens: "11:00", closes: "20:00" },
			{ day: "mon", opens: "9:00", closes: "20:00" },
			{ day: "tue", opens: "11:00", closes: "25:00" },
			{ day: "wed", opens: "20:00", closes: "20:00" },
			{ day: "thu", opens: "20:00", closes: "11:00" },
			{ day: "fri", opens: "11:00", closes: "20:00" },
			{ day: "fri", opens: "12:00", closes: "19:00" },
			null,
			"junk",
			{ day: "sat", opens: 1100, closes: "20:00" },
		]);

		assert.deepEqual(week, weekOf([null, null, null, null, null, OPEN, null]));
	});
});

describe("readClosures", () => {
	test("reads dates and a note, which passes through cleanLine", () => {
		assert.deepEqual(
			readClosures([
				{ from: "2026-11-02", to: "2026-11-04", note: "  दशैं\n बिदा " },
				{ from: "2026-11-09", to: "2026-11-09", note: null },
			]),
			[
				{ from: "2026-11-02", to: "2026-11-04", note: "दशैं बिदा" },
				{ from: "2026-11-09", to: "2026-11-09", note: null },
			],
		);
	});

	test("anything but an array is none", () => {
		for (const value of [undefined, null, "x", 5, {}]) {
			assert.deepEqual(readClosures(value), []);
		}
	});

	test("a malformed or impossible date, or a last day before the first, is dropped", () => {
		assert.deepEqual(
			readClosures([
				{ from: "2026-11-2", to: "2026-11-04", note: null },
				{ from: "2026-02-30", to: "2026-03-01", note: null },
				{ from: "2026-11-04", to: "2026-11-02", note: null },
				{ from: "2026-11-02", to: "later", note: null },
				{ from: 20261102, to: "2026-11-04", note: null },
				null,
				{ from: "2026-12-01", to: "2026-12-01", note: null },
			]),
			[{ from: "2026-12-01", to: "2026-12-01", note: null }],
		);
	});

	test("a note over 120 graphemes becomes null, 120 Devanagari ones stay", () => {
		const long = "क्ष".repeat(121);
		const fits = "क्ष".repeat(120);

		assert.deepEqual(
			readClosures([
				{ from: "2026-11-02", to: "2026-11-02", note: long },
				{ from: "2026-11-03", to: "2026-11-03", note: fits },
			]),
			[
				{ from: "2026-11-02", to: "2026-11-02", note: null },
				{ from: "2026-11-03", to: "2026-11-03", note: fits },
			],
		);
	});

	test("at most 20 are kept", () => {
		const many = Array.from({ length: 30 }, () => ({
			from: "2026-11-02",
			to: "2026-11-02",
			note: null,
		}));

		assert.equal(readClosures(many).length, 20);
	});
});
