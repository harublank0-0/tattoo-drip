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
