import { test } from "@japa/runner";
import {
	CLOSED_DAYS_ADDED,
	CLOSED_DAYS_REMOVED,
	DEFAULT_CLOSES,
	DEFAULT_OPENS,
	HOURS_SAVED,
	TEXTS_SAVED,
	WEEKDAYS,
} from "#modules/scheduling/opening_hours";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `GoodToKnowModule` below restates its shape and the inertia project type-checks the real one.
import * as goodToKnowModule from "../../../inertia/components/good_to_know.js";

type Row = { day: string; open: boolean; opens: string; closes: string };
type GoodToKnowModule = {
	DAY_NAMES: Record<string, string>;
	weekRows(week: Row[]): Row[];
	tickDay(rows: Row[], index: number, checked: boolean): Row[];
	removeLabel(when: string): string;
	depositLine(hasPolicy: boolean): string;
	HOURS_INTRO(timezone: string): string;
	CLOSED_INTRO: string;
	TEXTS_INTRO: string;
	NO_CLOSED_DAYS: string;
	HIDDEN_NOTE: string;
};
const words = goodToKnowModule as GoodToKnowModule;

const week = (open: Record<string, [string, string]>): Row[] =>
	WEEKDAYS.map((day) => ({
		day,
		open: day in open,
		opens: open[day]?.[0] ?? DEFAULT_OPENS,
		closes: open[day]?.[1] ?? DEFAULT_CLOSES,
	}));

test.group("Good to know words (TAT-128)", () => {
	test("the day names are the server's weekdays, Sunday first, in full", ({
		assert,
	}) => {
		assert.deepEqual(Object.keys(words.DAY_NAMES), [...WEEKDAYS]);
		assert.equal(words.DAY_NAMES.sun, "Sunday");
		assert.equal(words.DAY_NAMES.wed, "Wednesday");
		assert.equal(words.DAY_NAMES.sat, "Saturday");
	});

	test("weekRows keeps the page's seven rows as they are", ({ assert }) => {
		const rows = week({ sun: ["10:00", "18:00"] });

		assert.deepEqual(words.weekRows(rows), rows);
		assert.lengthOf(words.weekRows(rows), 7);
	});

	test("ticking a day copies the times of the nearest open day above it", ({
		assert,
	}) => {
		const rows = week({ sun: ["10:00", "18:00"], fri: ["12:00", "19:00"] });

		const ticked = words.tickDay(rows, 2, true);

		assert.deepEqual(ticked[2], {
			day: "tue",
			open: true,
			opens: "10:00",
			closes: "18:00",
		});
		// Nothing else moved, and the input is untouched.
		assert.deepEqual(
			ticked.filter((_, i) => i !== 2),
			rows.filter((_, i) => i !== 2),
		);
		assert.isFalse(rows[2].open);
	});

	test("with nothing open above it takes the nearest open day below", ({
		assert,
	}) => {
		const rows = week({ fri: ["12:00", "19:00"] });

		assert.deepEqual(words.tickDay(rows, 1, true)[1], {
			day: "mon",
			open: true,
			opens: "12:00",
			closes: "19:00",
		});
	});

	test("with no open day it keeps the row's own times", ({ assert }) => {
		const rows = week({});

		assert.deepEqual(words.tickDay(rows, 3, true)[3], {
			day: "wed",
			open: true,
			opens: DEFAULT_OPENS,
			closes: DEFAULT_CLOSES,
		});
	});

	test("unticking a day closes it and keeps its times", ({ assert }) => {
		const rows = week({ sun: ["10:00", "18:00"], mon: ["11:00", "20:00"] });

		assert.deepEqual(words.tickDay(rows, 0, false)[0], {
			day: "sun",
			open: false,
			opens: "10:00",
			closes: "18:00",
		});
	});

	test("a Remove button names its dates", ({ assert }) => {
		assert.equal(
			words.removeLabel("Tue 20 Oct 2026"),
			"Remove closed days Tue 20 Oct 2026",
		);
	});

	test("the deposit line points to Payments either way", ({ assert }) => {
		assert.equal(
			words.depositLine(true),
			"Your deposit policy shows here too. Change it in Payments.",
		);
		assert.equal(
			words.depositLine(false),
			"Add a deposit policy in Payments and it shows here too.",
		);
	});

	test("the introductions", ({ assert }) => {
		assert.equal(
			words.HOURS_INTRO("Asia/Kathmandu"),
			`Your page shows them in Good to know, and today's on its cover, like "Open now · till 8 pm". Times are Asia/Kathmandu time.`,
		);
		assert.equal(
			words.CLOSED_INTRO,
			"Holidays and days off, like Dashain or Tihar. On those days your cover says you're closed and shows your note.",
		);
		assert.equal(
			words.TEXTS_INTRO,
			"Short answers to what clients ask before they come. Your page shows each one you fill in and leaves out the rest.",
		);
		assert.equal(words.NO_CLOSED_DAYS, "No closed days ahead.");
		assert.equal(
			words.HIDDEN_NOTE,
			"Good to know is hidden on your page. Show it in Page look.",
		);
	});
});

test.group("Good to know messages (TAT-128)", () => {
	test("the sentences a save sends, with the public cache's 15 minutes", ({
		assert,
	}) => {
		assert.equal(
			HOURS_SAVED,
			"Opening hours saved. They can take up to 15 minutes to show on your page.",
		);
		assert.equal(
			CLOSED_DAYS_ADDED,
			"Closed days added. They can take up to 15 minutes to show on your page.",
		);
		assert.equal(CLOSED_DAYS_REMOVED, "Closed days removed.");
		assert.equal(
			TEXTS_SAVED,
			"Saved. It can take up to 15 minutes to show on your page.",
		);
	});
});
