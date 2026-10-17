import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `CalendarModule` below restates its shape and the inertia project type-checks the real one.
import * as calendarModule from "../../../inertia/components/calendar.js";

type CalendarModule = {
	nowIndex(sessions: { startsAt: number }[], now: number): number;
	studioDate(now: number, timezone: string): string;
};
const { nowIndex, studioDate } = calendarModule as CalendarModule;

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

test.group("studioDate", () => {
	test("today in the studio's timezone, rolling over at its local midnight", ({
		assert,
	}) => {
		const at = (iso: string) => Date.parse(iso);

		// Kathmandu is UTC+5:45: its midnight is 18:15Z.
		assert.equal(
			studioDate(at("2026-10-17T18:14:59Z"), "Asia/Kathmandu"),
			"2026-10-17",
		);
		assert.equal(
			studioDate(at("2026-10-17T18:15:00Z"), "Asia/Kathmandu"),
			"2026-10-18",
		);
		// The same instant is still the day before in New York.
		assert.equal(
			studioDate(at("2026-10-17T18:15:00Z"), "America/New_York"),
			"2026-10-17",
		);
		// A 25-hour day: 1 November 2026 starts at 04:00Z and ends at 05:00Z the next day.
		assert.equal(
			studioDate(at("2026-11-02T04:59:59Z"), "America/New_York"),
			"2026-11-01",
		);
		assert.equal(
			studioDate(at("2026-11-02T05:00:00Z"), "America/New_York"),
			"2026-11-02",
		);
	});
});
