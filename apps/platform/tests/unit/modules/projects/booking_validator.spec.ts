import { test } from "@japa/runner";
import { errors } from "@vinejs/vine";
import { DateTime } from "luxon";
import {
	type BookingForm,
	bookingValidator,
	toBookingInput,
} from "#modules/projects/validators/booking";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";
// 20:00 UTC is already 01:45 on 15 Oct in Kathmandu (UTC+5:45).
const NOW = DateTime.fromISO("2026-10-14T20:00:00Z");
const CLIENT_ID = "0195f3a0-0000-7000-8000-000000000001";
const ARTIST_ID = "0195f3a0-0000-7000-8000-000000000002";

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

/** What the body parser hands over for a new client: strings, null for empty fields. */
const body = (over: Record<string, unknown> = {}) => ({
	clientId: null,
	phone: "9812345678",
	name: "Maya Gurung",
	email: null,
	artistId: ARTIST_ID,
	date: "2026-10-20",
	startTime: "14:00",
	hours: "3",
	brief: "A small rose on the wrist",
	priceKind: "none",
	fixedPrice: null,
	hourlyRate: null,
	estimatedHours: null,
	...over,
});

/** A validated form for a new client. */
const form = (over: Partial<BookingForm> = {}): BookingForm => ({
	clientId: null,
	phone: "+9779812345678",
	name: "Maya Gurung",
	email: null,
	artistId: ARTIST_ID,
	date: "2026-10-20",
	startTime: "14:00",
	hours: 3,
	brief: "A small rose on the wrist",
	priceKind: "none",
	fixedPrice: null,
	hourlyRate: null,
	estimatedHours: null,
	...over,
});

test.group("bookingValidator", () => {
	test("accepts a new client's booking and stores the phone in E.164", async ({
		assert,
	}) => {
		const out = await bookingValidator.validate(body());
		assert.equal(out.phone, "+9779812345678");
		assert.equal(out.hours, 3);
		assert.equal(out.priceKind, "none");
	});

	test("reports what the shape can check, in the form's words", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(() =>
				bookingValidator.validate(
					body({
						phone: "12ab",
						email: "maya@",
						artistId: "sita",
						date: "20/10/2026",
						startTime: "2pm",
						hours: "13",
						// Only spaces: trimmed to nothing.
						brief: "   ",
						priceKind: "cheap",
					}),
				),
			),
			{
				phone: "Enter a phone number, like 9812345678 or +977 1 4123456.",
				email: "Enter a valid email address.",
				artistId: "Choose an artist from the list.",
				date: "Pick a date from today to a year from now.",
				startTime: "Enter the start time, like 14:00.",
				hours: "Enter a length from 0.25 to 12 hours.",
				brief: "Describe the tattoo.",
				priceKind: "Choose no price, fixed or hourly.",
			},
		);
	});
});

test.group("toBookingInput", () => {
	test("a returning client is booked by id, at the studio's local time", ({
		assert,
	}) => {
		const input = toBookingInput(
			form({ clientId: CLIENT_ID, phone: null, name: null }),
			KTM,
			NOW,
		);
		assert.deepEqual(input.client, { kind: "existing", id: CLIENT_ID });
		assert.equal(input.artistId, ARTIST_ID);
		assert.equal(input.brief, "A small rose on the wrist");
		assert.equal(input.startsAt.toUTC().toISO(), "2026-10-20T08:15:00.000Z");
		assert.equal(input.endsAt.toUTC().toISO(), "2026-10-20T11:15:00.000Z");
		assert.isNull(input.quote);
	});

	test("a new client needs the looked-up phone and a name", async ({
		assert,
	}) => {
		assert.deepEqual(
			toBookingInput(form({ email: "maya@example.com" }), KTM, NOW).client,
			{
				kind: "new",
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
			},
		);
		assert.deepEqual(
			await problems(() => toBookingInput(form({ name: null }), KTM, NOW)),
			{ name: "Enter the client's name." },
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ phone: null, name: null }), KTM, NOW),
			),
			{ phone: "Look the client's phone up first." },
		);
		// A name of spaces is trimmed to nothing by the validator: missing too.
		const spaces = await bookingValidator.validate(body({ name: "   " }));
		assert.deepEqual(await problems(() => toBookingInput(spaces, KTM, NOW)), {
			name: "Enter the client's name.",
		});
	});

	test("the day is from today to a year ahead in the studio's timezone; earlier today is fine", async ({
		assert,
	}) => {
		const DAY = { date: "Pick a date from today to a year from now." };
		// Today in Kathmandu is 15 Oct 2026.
		for (const date of ["2026-10-14", "2027-10-16", "2026-11-31"]) {
			assert.deepEqual(
				await problems(() => toBookingInput(form({ date }), KTM, NOW)),
				DAY,
				date,
			);
		}
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ date: "2027-10-15" }), KTM, NOW),
			),
			{},
		);
		// A walk-in already in the chair: 00:15 today is before NOW (01:45).
		const early = toBookingInput(
			form({ date: "2026-10-15", startTime: "00:15" }),
			KTM,
			NOW,
		);
		assert.isBelow(early.startsAt.toMillis(), NOW.toMillis());
	});

	test("a time the clocks skip is refused; a session can run past midnight", async ({
		assert,
	}) => {
		assert.deepEqual(
			await problems(() =>
				toBookingInput(
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
		const late = toBookingInput(
			form({ startTime: "22:30", hours: 3 }),
			KTM,
			NOW,
		);
		assert.equal(
			late.endsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			"2026-10-21 01:30",
		);
	});

	test("the length comes in quarter hours", async ({ assert }) => {
		assert.deepEqual(
			await problems(() => toBookingInput(form({ hours: 2.1 }), KTM, NOW)),
			{ hours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
		const input = toBookingInput(form({ hours: 2.75 }), KTM, NOW);
		assert.equal(input.endsAt.diff(input.startsAt, "minutes").minutes, 165);
	});

	test("a quick quote is a fixed price or an hourly rate, in paisa and minutes", async ({
		assert,
	}) => {
		assert.deepEqual(
			toBookingInput(form({ priceKind: "fixed", fixedPrice: 15_000 }), KTM, NOW)
				.quote,
			{ kind: "fixed", fixedPrice: 1_500_000 },
		);
		assert.deepEqual(
			toBookingInput(
				form({ priceKind: "hourly", hourlyRate: 3_000, estimatedHours: 4.5 }),
				KTM,
				NOW,
			).quote,
			{ kind: "hourly", hourlyRate: 300_000, estimatedMinutes: 270 },
		);
		// "No price" ignores stray price fields.
		assert.isNull(
			toBookingInput(form({ priceKind: "none", fixedPrice: 15_000 }), KTM, NOW)
				.quote,
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ priceKind: "fixed" }), KTM, NOW),
			),
			{ fixedPrice: "Enter the price." },
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(form({ priceKind: "hourly" }), KTM, NOW),
			),
			{
				hourlyRate: "Enter the hourly rate.",
				estimatedHours: "Enter the estimated hours.",
			},
		);
		assert.deepEqual(
			await problems(() =>
				toBookingInput(
					form({ priceKind: "hourly", hourlyRate: 3_000, estimatedHours: 2.1 }),
					KTM,
					NOW,
				),
			),
			{ estimatedHours: "Use quarter hours: 0.25, 0.5, 0.75 and so on." },
		);
	});
});
