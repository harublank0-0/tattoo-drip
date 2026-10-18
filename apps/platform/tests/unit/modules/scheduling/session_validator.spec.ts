import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import {
	outcomeValidator,
	type SessionTimeForm,
	scheduleValidator,
	sessionTimeValidator,
	toNewSession,
	toSessionTimes,
} from "#modules/scheduling/validators/session";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
// 20:00 UTC is already 01:45 on 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");

const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";

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

const form = (over: Partial<SessionTimeForm> = {}): SessionTimeForm => ({
	date: "2026-10-20",
	startTime: "14:00",
	hours: 3,
	...over,
});

test.group("sessionTimeValidator and outcomeValidator", () => {
	test("the move form's shape, in the booking form's words", async ({
		assert,
	}) => {
		assert.deepEqual(
			await sessionTimeValidator.validate({
				date: "2026-10-20",
				startTime: "14:00",
				hours: "2.5",
			}),
			{ date: "2026-10-20", startTime: "14:00", hours: 2.5 },
		);
		const wrong = { date: DAY, startTime: TIME, hours: LENGTH };
		assert.deepEqual(
			await problems(() =>
				sessionTimeValidator.validate({
					date: "20/10/2026",
					startTime: "2pm",
					hours: "13",
				}),
			),
			wrong,
		);
		assert.deepEqual(
			await problems(() => sessionTimeValidator.validate({})),
			wrong,
		);
	});

	test("an outcome is done, no-show or cancelled", async ({ assert }) => {
		for (const status of ["completed", "no_show", "cancelled"]) {
			assert.deepEqual(await outcomeValidator.validate({ status }), {
				status,
			});
		}
		for (const body of [{ status: "done" }, { status: "scheduled" }, {}]) {
			assert.deepEqual(
				await problems(() => outcomeValidator.validate(body)),
				{ status: "Choose done, no-show or cancelled." },
				JSON.stringify(body),
			);
		}
	});
});

test.group("toSessionTimes", () => {
	test("a local date and time in the studio's timezone, the length as elapsed time", ({
		assert,
	}) => {
		const times = toSessionTimes(form(), KTM, NOW);
		assert.equal(times.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(times.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
	});

	test("from today to a year ahead; earlier today is fine", async ({
		assert,
	}) => {
		// Today in Kathmandu is 15 Oct 2026.
		for (const date of ["2026-10-14", "2027-10-16", "2026-11-31"]) {
			assert.deepEqual(
				await problems(() => toSessionTimes(form({ date }), KTM, NOW)),
				{ date: DAY },
				date,
			);
		}
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(form({ date: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		const early = toSessionTimes(
			form({ date: "2026-10-15", startTime: "00:15" }),
			KTM,
			NOW,
		);
		assert.isBelow(early.startsAt.toMillis(), NOW.toMillis());
	});

	test("clock changes: a skipped time is refused, a repeated one is its first, the length is elapsed", async ({
		assert,
	}) => {
		// 14 March 2027: New York's clocks jump from 02:00 to 03:00.
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(
					form({ date: "2027-03-14", startTime: "02:30" }),
					NY,
					NOW,
				),
			),
			{
				startTime:
					"That time doesn't exist on this day because the clocks change. Pick another.",
			},
		);
		// 1 November 2026: New York passes 01:00–02:00 twice; 01:30 is the
		// first one (EDT, UTC−4), and an hour later is 01:30 EST.
		const repeated = toSessionTimes(
			form({ date: "2026-11-01", startTime: "01:30", hours: 1 }),
			NY,
			NOW,
		);
		assert.equal(repeated.startsAt.toUTC().toISO(), "2026-11-01T05:30:00.000Z");
		assert.equal(repeated.endsAt.toUTC().toISO(), "2026-11-01T06:30:00.000Z");
	});

	test("quarter hours, and every problem at once", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toSessionTimes(form({ hours: 2.1 }), KTM, NOW)),
			{ hours: QUARTERS },
		);
		assert.deepEqual(
			await problems(() =>
				toSessionTimes(form({ date: "2026-10-01", hours: 0.3 }), KTM, NOW),
			),
			{ date: DAY, hours: QUARTERS },
		);
		const short = toSessionTimes(form({ hours: 0.25 }), KTM, NOW);
		assert.equal(short.endsAt.diff(short.startsAt, "minutes").minutes, 15);
	});
});

test.group("scheduleValidator and toNewSession", () => {
	const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000002";

	test("the schedule form's shape, with its own field names", async ({
		assert,
	}) => {
		assert.deepEqual(
			await scheduleValidator.validate({
				sessionKind: "consultation",
				sessionArtistId: ARTIST_ID,
				date: "2026-10-20",
				startTime: "14:00",
				hours: "1",
			}),
			{
				sessionKind: "consultation",
				sessionArtistId: ARTIST_ID,
				date: "2026-10-20",
				startTime: "14:00",
				hours: 1,
			},
		);
		assert.deepEqual(
			await problems(() =>
				scheduleValidator.validate({
					sessionKind: "flash",
					sessionArtistId: "sita",
					date: "2026-10-20",
					startTime: "14:00",
					hours: "1",
				}),
			),
			{
				sessionKind: "Choose tattoo, consultation or touch-up.",
				sessionArtistId: "Choose an artist from the list.",
			},
		);
	});

	test("a new session from the form, by the shared time rules", async ({
		assert,
	}) => {
		const session = toNewSession(
			{ sessionKind: "tattoo", sessionArtistId: ARTIST_ID, ...form() },
			KTM,
			NOW,
		);
		assert.deepEqual([session.kind, session.artistId], ["tattoo", ARTIST_ID]);
		assert.equal(session.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(session.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
		assert.deepEqual(
			await problems(() =>
				toNewSession(
					{
						sessionKind: "tattoo",
						sessionArtistId: ARTIST_ID,
						...form({ date: "2026-10-14" }),
					},
					KTM,
					NOW,
				),
			),
			{ date: DAY },
		);
	});
});
