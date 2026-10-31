import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import { closedDaysWhen } from "#modules/scheduling/opening_hours";
import {
	closedDaysValidator,
	openingHoursValidator,
	toClosure,
	toOpeningWeek,
} from "#modules/scheduling/validators/opening_hours";

const KTM = "Asia/Kathmandu";
// 10:00 on Friday 30 October 2026 in Kathmandu.
const NOW = DateTime.fromISO("2026-10-30T10:00:00", { zone: KTM });

const TIMES = "Enter both times, like 11:00 and 20:00.";
const ORDER = "Close after you open. Hours can't run past midnight.";
const FROM = "Pick a day from today to a year from now.";
const TO = "Pick the same day or a later one, at most 60 days after the first.";
const NOTE = "Keep the note to one line of 120 characters or fewer.";

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

test.group("toOpeningWeek (TAT-128)", () => {
	test("ticked days come in week order, Sunday first, with the times as given", ({
		assert,
	}) => {
		assert.deepEqual(
			toOpeningWeek({
				hours: {
					mon: { open: true, opens: "11:00", closes: "20:00" },
					sun: { open: true, opens: "10:30", closes: "18:00" },
				},
			}),
			[
				{ day: "sun", opens: "10:30", closes: "18:00" },
				{ day: "mon", opens: "11:00", closes: "20:00" },
			],
		);
	});

	test("an unticked day is closed whatever times it sent", ({ assert }) => {
		assert.deepEqual(
			toOpeningWeek({
				hours: {
					sun: { open: false, opens: "10:00", closes: "09:00" },
					mon: { opens: "garbage", closes: null },
					tue: { open: true, opens: "11:00", closes: "20:00" },
				},
			}),
			[{ day: "tue", opens: "11:00", closes: "20:00" }],
		);
	});

	test("no hours at all is a closed week", ({ assert }) => {
		assert.deepEqual(toOpeningWeek({}), []);
		assert.deepEqual(toOpeningWeek({ hours: {} }), []);
	});

	test("a missing or malformed time is an error on that day", async ({
		assert,
	}) => {
		for (const day of [
			{ open: true, opens: "25:00", closes: "20:00" },
			{ open: true, opens: "9:00", closes: "20:00" },
			{ open: true, opens: "11:00" },
			{ open: true, opens: null, closes: null },
		]) {
			assert.deepEqual(
				await problems(() => toOpeningWeek({ hours: { tue: day } })),
				{ "hours.tue": TIMES },
				JSON.stringify(day),
			);
		}
	});

	test("closing at or before opening is an error on that day", async ({
		assert,
	}) => {
		for (const closes of ["11:00", "10:59", "00:00"]) {
			assert.deepEqual(
				await problems(() =>
					toOpeningWeek({
						hours: { wed: { open: true, opens: "11:00", closes } },
					}),
				),
				{ "hours.wed": ORDER },
				closes,
			);
		}
	});

	test("two bad days give two errors", async ({ assert }) => {
		assert.deepEqual(
			await problems(() =>
				toOpeningWeek({
					hours: {
						mon: { open: true, opens: "12:00", closes: "11:00" },
						fri: { open: true, opens: "11:00" },
						sat: { open: true, opens: "11:00", closes: "20:00" },
					},
				}),
			),
			{ "hours.mon": ORDER, "hours.fri": TIMES },
		);
	});
});

test.group("openingHoursValidator (TAT-128)", () => {
	test("accepts the form's shape, an emptied time box as null, and nothing at all", async ({
		assert,
	}) => {
		assert.deepEqual(
			await openingHoursValidator.validate({
				hours: {
					sun: { open: "1", opens: "10:00", closes: "18:00" },
					mon: { opens: null, closes: null },
				},
			}),
			{
				hours: {
					sun: { open: true, opens: "10:00", closes: "18:00" },
					mon: { opens: null, closes: null },
				},
			},
		);
		assert.deepEqual(await openingHoursValidator.validate({}), {});
	});
});

test.group("toClosure (TAT-128)", () => {
	test("one day when the last day is empty", ({ assert }) => {
		for (const closedTo of [null, undefined, ""]) {
			assert.deepEqual(
				toClosure({ closedFrom: "2026-11-02", closedTo }, KTM, NOW),
				{ startsOn: "2026-11-02", endsOn: "2026-11-02", note: null },
			);
		}
	});

	test("a range with a trimmed note, Devanagari kept whole", ({ assert }) => {
		assert.deepEqual(
			toClosure(
				{
					closedFrom: "2026-11-02",
					closedTo: "2026-11-04",
					closedNote: "  दशैं बिदा, back on 5 November ",
				},
				KTM,
				NOW,
			),
			{
				startsOn: "2026-11-02",
				endsOn: "2026-11-04",
				note: "दशैं बिदा, back on 5 November",
			},
		);
		assert.isNull(
			toClosure({ closedFrom: "2026-11-02", closedNote: "   " }, KTM, NOW).note,
		);
	});

	test("today is fine, yesterday, an impossible date and a day over a year ahead are refused on closedFrom", async ({
		assert,
	}) => {
		const from = (closedFrom: string) =>
			problems(() => toClosure({ closedFrom }, KTM, NOW));

		assert.deepEqual(await from("2026-10-30"), {});
		assert.deepEqual(await from("2027-10-30"), {});
		for (const bad of ["2026-10-29", "2026-02-30", "2027-10-31"]) {
			assert.deepEqual(await from(bad), { closedFrom: FROM }, bad);
		}
	});

	test("today is the studio's today, not the server's", async ({ assert }) => {
		// 20:00 UTC on 29 October is already 30 October in Kathmandu.
		const late = DateTime.fromISO("2026-10-29T20:00:00Z");

		assert.deepEqual(
			await problems(() => toClosure({ closedFrom: "2026-10-30" }, KTM, late)),
			{},
		);
		assert.deepEqual(
			await problems(() => toClosure({ closedFrom: "2026-10-29" }, KTM, late)),
			{ closedFrom: FROM },
		);
	});

	test("a last day before the first, or 60 days after it, is refused on closedTo; 59 days after is fine", async ({
		assert,
	}) => {
		const to = (closedTo: string) =>
			problems(() =>
				toClosure({ closedFrom: "2026-11-02", closedTo }, KTM, NOW),
			);

		assert.deepEqual(await to("2026-11-02"), {});
		assert.deepEqual(await to("2026-12-31"), {}); // 59 days after
		assert.deepEqual(await to("2026-11-01"), { closedTo: TO });
		assert.deepEqual(await to("2027-01-01"), { closedTo: TO }); // 60 days after
		assert.deepEqual(await to("2026-02-30"), { closedTo: TO });
	});
});

test.group("closedDaysValidator (TAT-128)", () => {
	test("takes a day, an optional last day and an optional one-line note", async ({
		assert,
	}) => {
		assert.deepEqual(
			await closedDaysValidator.validate({
				closedFrom: "2026-11-02",
				closedTo: null,
				closedNote: null,
			}),
			{ closedFrom: "2026-11-02", closedTo: null, closedNote: null },
		);
		assert.deepEqual(
			await closedDaysValidator.validate({ closedFrom: "2026-11-02" }),
			{ closedFrom: "2026-11-02" },
		);
	});

	test("says what is wrong in the form's words", async ({ assert }) => {
		assert.deepEqual(await problems(() => closedDaysValidator.validate({})), {
			closedFrom: FROM,
		});
		assert.deepEqual(
			await problems(() =>
				closedDaysValidator.validate({
					closedFrom: "next week",
					closedTo: "soon",
					closedNote: "x".repeat(121),
				}),
			),
			{ closedFrom: FROM, closedTo: TO, closedNote: NOTE },
		);
		assert.deepEqual(
			await problems(() =>
				closedDaysValidator.validate({
					closedFrom: "2026-11-02",
					closedNote: "two\nlines",
				}),
			),
			{ closedNote: NOTE },
		);
	});

	test("120 Devanagari characters are one note", async ({ assert }) => {
		const closedNote = "ब".repeat(120);

		assert.deepEqual(
			await closedDaysValidator.validate({
				closedFrom: "2026-11-02",
				closedNote,
			}),
			{ closedFrom: "2026-11-02", closedNote },
		);
	});
});

test.group("closedDaysWhen (TAT-128)", () => {
	test("always names the year", ({ assert }) => {
		assert.equal(closedDaysWhen("2026-10-20", "2026-10-20"), "Tue 20 Oct 2026");
		assert.equal(
			closedDaysWhen("2026-10-20", "2026-10-28"),
			"20 – 28 Oct 2026",
		);
		assert.equal(
			closedDaysWhen("2026-10-30", "2026-11-02"),
			"30 Oct – 2 Nov 2026",
		);
		assert.equal(
			closedDaysWhen("2026-12-30", "2027-01-02"),
			"30 Dec 2026 – 2 Jan 2027",
		);
	});
});
