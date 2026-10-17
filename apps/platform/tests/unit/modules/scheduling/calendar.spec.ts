import { test } from "@japa/runner";
import { DateTime, Settings } from "luxon";
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
import { localDateTime } from "#modules/scheduling/times";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
const HAVANA = "America/Havana";
const AZORES = "Atlantic/Azores";
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

	test("years 1900 to 2100 only, so a week never leaves four-digit years", ({
		assert,
	}) => {
		for (const value of ["1900-01-01", "2100-12-31"]) {
			assert.equal(toCalendarDate(value, TODAY), value, value);
		}
		for (const value of [
			"0000-01-03",
			"1899-12-31",
			"2101-01-01",
			"9999-12-28",
			"9999-12-31",
		]) {
			assert.equal(toCalendarDate(value, TODAY), TODAY, value);
		}
		// The weeks around the accepted ends are made of real days.
		for (const date of ["1900-01-01", "2100-12-31"]) {
			for (const day of calendarDays("week", date)) {
				const { from, to } = dayBounds(day, KTM);
				assert.isTrue(from.isValid && to.isValid, day);
				assert.isTrue(dayLabel(day) !== "Invalid DateTime", day);
			}
			assert.notInclude(rangeText(calendarDays("week", date)), "Invalid");
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

	// Havana and the Azores pass their local midnight twice on the night the
	// clocks go back. Luxon settles a repeated time by the zone's offset at
	// `Settings.now`, so these run under a clock before and one after the change.
	for (const [clock, now] of [
		["before the clocks go back", "2026-10-10T12:00:00Z"],
		["after the clocks go back", "2026-11-05T12:00:00Z"],
	] as const) {
		for (const [zone, day, first, last] of [
			[
				HAVANA,
				"2026-11-01",
				"2026-11-01T04:00:00.000Z",
				"2026-11-02T05:00:00.000Z",
			],
			[
				AZORES,
				"2026-10-25",
				"2026-10-25T00:00:00.000Z",
				"2026-10-26T01:00:00.000Z",
			],
		] as const) {
			test(`a day with a repeated midnight starts at the first one, in ${zone} (${clock})`, ({
				assert,
				cleanup,
			}) => {
				const realNow = Settings.now;
				cleanup(() => {
					Settings.now = realNow;
				});
				const frozen = new Date(now).getTime();
				Settings.now = () => frozen;

				const { from, to } = dayBounds(day, zone);
				assert.equal(utcIso(from), first);
				assert.equal(utcIso(to), last);
				assert.equal(to.diff(from, "hours").hours, 25);
				// No hour belongs to no day, or to two.
				const before = shiftDate("day", day, -1);
				const after = shiftDate("day", day, 1);
				assert.equal(dayBounds(before, zone).to.toMillis(), from.toMillis());
				assert.equal(dayBounds(after, zone).from.toMillis(), to.toMillis());

				// A session in the repeated hour, as booking stores it (the first time).
				const startsAt = localDateTime(day, "00:15", zone);
				const endsAt = localDateTime(day, "00:45", zone);
				assert.exists(startsAt);
				assert.exists(endsAt);
				if (!startsAt || !endsAt) return;
				assert.isTrue(overlapsDay(startsAt, endsAt, day, zone));
				assert.isFalse(overlapsDay(startsAt, endsAt, before, zone));
				assert.isFalse(overlapsDay(startsAt, endsAt, after, zone));
			});
		}
	}

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
