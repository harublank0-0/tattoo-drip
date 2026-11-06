import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `CalendarModule` below restates its shape and the inertia project type-checks the real one.
import * as calendarModule from "../../../inertia/components/calendar.js";

type Span = { id: string; startMinute: number; endMinute: number };
type Query = {
	view: string;
	date: string;
	artist: string | null;
	status: string;
	session?: string | null;
};
type CalendarModule = {
	layoutLanes(items: Span[]): { item: Span; lane: number; lanes: number }[];
	gridHours(
		days: {
			hours?: { opens: string; closes: string } | null;
			sessions: { startMinute: number; endMinute: number }[];
		}[],
	): { first: number; last: number };
	calendarHref(base: string, query: Query): string;
	minuteOfDay(now: number, timezone: string): number;
};
const { layoutLanes, gridHours, calendarHref, minuteOfDay } =
	calendarModule as CalendarModule;

const span = (id: string, from: number, to: number): Span => ({
	id,
	startMinute: from * 60,
	endMinute: to * 60,
});
const lanesOf = (items: Span[]) =>
	Object.fromEntries(
		layoutLanes(items).map(({ item, lane, lanes }) => [item.id, [lane, lanes]]),
	);

test.group("Calendar time grid: lanes", () => {
	test("sessions that don't overlap each take the whole width", ({
		assert,
	}) => {
		assert.deepEqual(lanesOf([span("a", 10, 12), span("b", 12, 14)]), {
			a: [0, 1],
			b: [0, 1],
		});
	});

	test("overlapping sessions sit side by side, as narrow as their cluster", ({
		assert,
	}) => {
		// a and b overlap; c overlaps b only, and takes a's lane once a ends.
		assert.deepEqual(
			lanesOf([span("a", 10, 12), span("b", 11, 15), span("c", 12, 13)]),
			{ a: [0, 2], b: [1, 2], c: [0, 2] },
		);
	});

	test("three at once take three lanes; a later session starts a new cluster", ({
		assert,
	}) => {
		assert.deepEqual(
			lanesOf([
				span("a", 9, 11),
				span("b", 9, 11),
				span("c", 10, 12),
				span("d", 13, 14),
			]),
			{ a: [0, 3], b: [1, 3], c: [2, 3], d: [0, 1] },
		);
	});

	test("the order given does not change the layout", ({ assert }) => {
		const items = [span("a", 10, 12), span("b", 11, 15), span("c", 12, 13)];
		assert.deepEqual(lanesOf([...items].reverse()), lanesOf(items));
	});
});

test.group("Calendar time grid: hours", () => {
	test("8 to 20 when nothing says otherwise", ({ assert }) => {
		assert.deepEqual(gridHours([{ sessions: [] }]), { first: 8, last: 20 });
	});

	test("widens to the opening hours and to every session, in whole hours", ({
		assert,
	}) => {
		assert.deepEqual(
			gridHours([
				{ hours: { opens: "07:30", closes: "21:15" }, sessions: [] },
				{
					hours: null,
					sessions: [{ startMinute: 22 * 60, endMinute: 23 * 60 + 30 }],
				},
			]),
			{ first: 7, last: 24 },
		);
	});
});

test.group("Calendar addresses", () => {
	test("keep the view and the date, and the artist, status and session only when set", ({
		assert,
	}) => {
		const base = "/t/bn/calendar";
		assert.equal(
			calendarHref(base, {
				view: "week",
				date: "2026-11-02",
				artist: null,
				status: "active",
			}),
			"/t/bn/calendar?view=week&date=2026-11-02",
		);
		assert.equal(
			calendarHref(base, {
				view: "day",
				date: "2026-11-02",
				artist: "a1",
				status: "cancelled",
				session: "s1",
			}),
			"/t/bn/calendar?view=day&date=2026-11-02&artist=a1&status=cancelled&session=s1",
		);
	});

	test("the Now line is the studio's wall clock", ({ assert }) => {
		// 08:15 UTC is 14:00 in Kathmandu (UTC+5:45).
		assert.equal(
			minuteOfDay(Date.UTC(2026, 10, 6, 8, 15), "Asia/Kathmandu"),
			840,
		);
	});
});
