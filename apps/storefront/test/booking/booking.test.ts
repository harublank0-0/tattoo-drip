import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isRedirect } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NO_AVAILABILITY } from "../../src/booking/availability.ts";
import {
	type BookingContext,
	type BookingValues,
	bookingSteps,
	bookingValues,
	EMPTY_CALENDAR,
	ideaText,
	intakeValuesOf,
	namedDays,
	preferredDatesText,
	STEP_FIELDS,
	sizeText,
} from "../../src/booking/booking.ts";
import {
	type CalendarRules,
	dayState,
	monthWeeks,
	shiftMonth,
} from "../../src/booking/calendar.ts";
import { BookingSent } from "../../src/booking/components/booking-review.tsx";
import { bookingErrors } from "../../src/intake/components/intake-form.tsx";
import { initialValues } from "../../src/intake/rules.ts";
import { Route as RequestRedirect } from "../../src/routes/request.tsx";
import type { Week } from "../../src/studio/hours.ts";

/**
 * Prompt 6's booking flow: what it offers, what it sends and what it never
 * claims. The dates are preferences on days the studio's published week
 * opens; the request is what the client chose, written into the existing
 * inquiry; nothing confirms an appointment.
 */

const TODAY = "2026-11-05"; // a Thursday
const OPEN_WEEKDAYS: Week = [
	{ opens: "11:00", closes: "20:00" }, // Sun
	{ opens: "11:00", closes: "20:00" },
	{ opens: "11:00", closes: "20:00" },
	{ opens: "11:00", closes: "20:00" },
	{ opens: "11:00", closes: "20:00" },
	{ opens: "11:00", closes: "20:00" }, // Fri
	null, // Sat: closed
];
const RULES: CalendarRules = {
	week: OPEN_WEEKDAYS,
	closures: [{ from: "2026-11-10", to: "2026-11-12", note: "Tihar" }],
};
const CONTEXT: BookingContext = {
	artists: [],
	styles: [],
	calendar: { ...RULES, timeZone: "Asia/Kathmandu" },
	artwork: null,
};
const SITA_ID = "0199f000-0000-7000-8000-000000000048";

const values = (over: Partial<BookingValues> = {}): BookingValues => ({
	...bookingValues(initialValues(null)),
	idea: "A fine-line peony",
	placement: "Left forearm",
	size: "medium",
	days: ["2026-11-06"],
	sourceChannel: "instagram",
	contactName: "Asha",
	contactPhone: "9800000000",
	...over,
});

describe("the preference calendar", () => {
	test("offers a day from tomorrow to a year ahead, only where the studio's week opens and no closure covers it", () => {
		assert.equal(dayState("2026-11-05", TODAY, RULES), "past");
		assert.equal(dayState("2026-11-04", TODAY, RULES), "past");
		assert.equal(dayState("2026-11-06", TODAY, RULES), "open");
		assert.equal(dayState("2026-11-07", TODAY, RULES), "closed"); // a Saturday
		assert.equal(dayState("2026-11-11", TODAY, RULES), "closure");
		assert.equal(dayState("2027-11-05", TODAY, RULES), "open");
		assert.equal(dayState("2027-11-06", TODAY, RULES), "beyond");
		// A studio that published no hours: nothing says it is closed.
		assert.equal(
			dayState("2026-11-07", TODAY, {
				week: EMPTY_CALENDAR.week,
				closures: [],
			}),
			"open",
		);
	});

	test("lays a month out in Sunday-first weeks, and steps across years", () => {
		const weeks = monthWeeks({ year: 2026, month: 11 });
		assert.equal(weeks[0][0], "2026-11-01"); // 1 November 2026 is a Sunday
		assert.equal(weeks.flat().filter(Boolean).length, 30);
		for (const week of weeks) assert.equal(week.length, 7);
		assert.deepEqual(shiftMonth({ year: 2026, month: 12 }, 1), {
			year: 2027,
			month: 1,
		});
		assert.deepEqual(shiftMonth({ year: 2026, month: 1 }, -1), {
			year: 2025,
			month: 12,
		});
	});
});

describe("what the request says", () => {
	test("the dates are the named days in order with the time of day, or the flexible line; a day no longer open is dropped", () => {
		assert.equal(
			preferredDatesText(
				{
					days: ["2026-11-09", "2026-11-06"],
					timeOfDay: "afternoon",
					flexible: false,
				},
				TODAY,
				RULES,
			),
			"Friday, 6 November 2026; Monday, 9 November 2026 (afternoons)",
		);
		assert.equal(
			preferredDatesText(
				{ days: [], timeOfDay: "any", flexible: true },
				TODAY,
				RULES,
			),
			"Any date that suits the studio",
		);
		// A closed Saturday, a closure, the past: never sent, so never "chosen".
		assert.deepEqual(
			namedDays(
				{ days: ["2026-11-07", "2026-11-11", "2026-11-01", "2026-11-06"] },
				TODAY,
				RULES,
			),
			["2026-11-06"],
		);
		assert.equal(
			preferredDatesText(
				{ days: ["2026-11-07"], timeOfDay: "any", flexible: false },
				TODAY,
				RULES,
			),
			"",
		);
	});

	test("the idea is the client's own words; style, colour and notes are their own fields; the size is the choice and the client's words", () => {
		const chosen = values({
			style: "fine-line",
			colour: "black-grey",
			notes: " A cover-up ",
		});
		assert.equal(ideaText(chosen), "A fine-line peony");
		const sent = intakeValuesOf(chosen, TODAY, RULES);
		assert.equal(sent.idea, "A fine-line peony");
		assert.equal(sent.style, "fine-line");
		assert.equal(sent.colour, "black-grey");
		assert.equal(sent.notes, "A cover-up");
		const plain = intakeValuesOf(values(), TODAY, RULES);
		for (const key of ["style", "colour", "notes"]) {
			assert.equal(key in plain, false, key);
		}
		assert.equal(
			sizeText(values({ approximateSize: "about 12 cm" })),
			"Medium: about a hand, about 12 cm",
		);
		assert.equal(
			sizeText(values({ size: "", approximateSize: "10 cm" })),
			"10 cm",
		);
		assert.equal(sizeText(values({ size: "" })), "");
	});

	test("the inquiry sent is the intake's own fields, so the API, its rules and its errors are unchanged", () => {
		const sent = intakeValuesOf(
			values({ preferredArtistId: SITA_ID, style: "fine-line" }),
			TODAY,
			RULES,
		);
		assert.deepEqual(Object.keys(sent).sort(), [
			"approximateSize",
			"budget",
			"contactEmail",
			"contactName",
			"contactPhone",
			"idea",
			"placement",
			"preferredArtistId",
			"preferredDates",
			"sourceChannel",
			"style",
		]);
		assert.equal(sent.preferredDates, "Friday, 6 November 2026");
		assert.equal(sent.approximateSize, "Medium: about a hand");
		// The slug is sent, not the name the client saw.
		assert.equal(sent.style, "fine-line");
		assert.equal(sent.idea, "A fine-line peony");
	});
});

describe("the steps", () => {
	test("a single artist, or a flash request, skips the artist step", () => {
		assert.deepEqual(bookingSteps(true), [
			"artist",
			"when",
			"tattoo",
			"details",
			"review",
		]);
		assert.deepEqual(bookingSteps(false), [
			"when",
			"tattoo",
			"details",
			"review",
		]);
	});

	test("each step's problems are its own: no day, no size, a missing contact; the review checks them all", () => {
		const rules = { studioName: "Black Needle", artistIds: [SITA_ID] };
		assert.deepEqual(bookingErrors(values(), TODAY, CONTEXT, rules), {});
		const missing = bookingErrors(
			values({ days: [], size: "", contactPhone: "" }),
			TODAY,
			CONTEXT,
			rules,
		);
		assert.deepEqual(Object.keys(missing).sort(), [
			"contactPhone",
			"days",
			"size",
		]);
		assert.ok(STEP_FIELDS.when.includes("days"));
		assert.ok(STEP_FIELDS.tattoo.includes("size"));
		assert.ok(STEP_FIELDS.details.includes("contactPhone"));
		// Flexible needs no day; a size in the client's words needs no choice.
		assert.deepEqual(
			bookingErrors(
				values({
					days: [],
					flexible: true,
					size: "",
					approximateSize: "10 cm",
				}),
				TODAY,
				CONTEXT,
				rules,
			),
			{},
		);
		// A day the studio is closed is no day at all.
		assert.ok(
			bookingErrors(values({ days: ["2026-11-07"] }), TODAY, CONTEXT, rules)
				.days,
		);
		// An artist the studio's list doesn't have is refused before it is sent.
		assert.ok(
			bookingErrors(
				values({ preferredArtistId: "0199f000-0000-7000-8000-000000000999" }),
				TODAY,
				CONTEXT,
				rules,
			).preferredArtistId,
		);
	});

	test("the idea alone must fit the API's 4000 characters; the notes don't count against it", () => {
		const rules = { studioName: "Black Needle", artistIds: [] };
		const fits = values({ idea: "x".repeat(3990), notes: "y".repeat(40) });
		assert.equal(bookingErrors(fits, TODAY, CONTEXT, rules).idea, undefined);
		const long = values({ idea: "x".repeat(4001) });
		assert.match(bookingErrors(long, TODAY, CONTEXT, rules).idea ?? "", /4000/);
	});
});

describe("review fixes (Prompt 6)", () => {
	test("a size too long with its choice is the client's words to shorten, not the choice", () => {
		const rules = { studioName: "Black Needle", artistIds: [] };
		const long = values({
			size: "extra-large",
			approximateSize: "x".repeat(100),
		});
		const errors = bookingErrors(long, TODAY, CONTEXT, rules);
		assert.ok(errors.approximateSize);
		assert.equal(errors.size, undefined);
		assert.ok(STEP_FIELDS.tattoo.includes("approximateSize"));
		// Nothing at all: the choice is what is missing.
		const none = bookingErrors(
			values({ size: "", approximateSize: "" }),
			TODAY,
			CONTEXT,
			rules,
		);
		assert.ok(none.size);
		assert.equal(none.approximateSize, undefined);
	});
});

describe("what it never claims", () => {
	test("no appointment slots are offered: the platform serves none, and there is no mock", async () => {
		assert.equal(NO_AVAILABILITY.supported, false);
		assert.deepEqual(
			await NO_AVAILABILITY.slots({
				artistId: SITA_ID,
				serviceId: SITA_ID,
				from: TODAY,
				to: TODAY,
			}),
			[],
		);
	});

	test("the received screen says received and not confirmed, shows what was asked and the API's reference", () => {
		const html = renderToStaticMarkup(
			createElement(BookingSent, {
				studioName: "Black Needle",
				phone: "9800000000",
				artistName: "Sita Rai",
				dates: "Friday, 6 November 2026",
				reference: "K7MP3Q",
			}),
		);
		assert.match(html, />Your story starts here\.</);
		assert.match(html, /Your session request has been received\./);
		assert.match(
			html,
			/Not confirmed yet: <bdi>Black Needle<\/bdi> replies with a time\./,
		);
		assert.match(html, /<dd dir="auto">Sita Rai<\/dd>/);
		assert.match(html, /<dd>Friday, 6 November 2026<\/dd>/);
		assert.match(
			html,
			/Your request reference: <strong>K7MP3Q<\/strong>\. Quote it when you message <bdi>Black Needle<\/bdi>\./,
		);
		assert.doesNotMatch(html, /confirmed!|Booked|#\d|0199f000/i);
	});

	test("/request is a permanent redirect to /book with its query as it was", () => {
		const beforeLoad = RequestRedirect.options
			.beforeLoad as unknown as (input: {
			location: { searchStr: string };
		}) => void;
		try {
			beforeLoad({ location: { searchStr: "?artist=sita&flash=x" } });
			assert.fail("it redirects");
		} catch (error) {
			assert.ok(isRedirect(error));
			assert.equal(error.options.href, "/book?artist=sita&flash=x");
			assert.equal(error.status, 301);
		}
	});
});
