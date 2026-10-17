import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import type {
	BookingClient,
	DirectBooking,
	QuickQuote,
} from "#modules/projects/services/booking_service";
import {
	PRICE_MESSAGES,
	priceFields,
} from "#modules/projects/validators/quote";
import { localDateTime } from "#modules/scheduling/times";
import { phoneNumber } from "#validators/phone";

/** What the booking form can say about the price. */
export const PRICE_KINDS = ["none", "fixed", "hourly"] as const;

/**
 * The booking form's shape (TAT-43), in the form's units: whole rupees,
 * hours, and the studio's local date (yyyy-MM-dd) and time (HH:mm). A
 * returning client comes as `clientId`; a new one as the looked-up `phone`
 * (stored in E.164) with `name` and `email`. Empty fields arrive as null.
 * What depends on another field or on the studio's timezone is checked by
 * toBookingInput.
 */
export const bookingValidator = vine.create({
	clientId: vine.string().uuid().nullable().optional(),
	phone: vine.string().trim().use(phoneNumber()).nullable().optional(),
	name: vine.string().trim().maxLength(120).nullable().optional(),
	email: vine.string().trim().maxLength(254).email().nullable().optional(),
	artistId: vine.string().uuid(),
	date: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
	hours: vine.number().range([0.25, 12]),
	brief: vine.string().trim().minLength(1).maxLength(4000),
	priceKind: vine.enum(PRICE_KINDS),
	...priceFields(),
});

export type BookingForm = Infer<typeof bookingValidator>;

const LOOKUP = "Look the client's phone up first.";
const EMAIL = "Enter a valid email address.";
const ARTIST = "Choose an artist from the list.";
const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const BRIEF = "Describe the tattoo.";
const PRICE_KIND = "Choose no price, fixed or hourly.";
const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";
const SKIPPED =
	"That time doesn't exist on this day because the clocks change. Pick another.";

bookingValidator.messagesProvider = new SimpleMessagesProvider({
	"clientId.uuid": LOOKUP,
	"name.maxLength": "Keep the name under 120 characters.",
	"email.email": EMAIL,
	"email.maxLength": EMAIL,
	"artistId.required": ARTIST,
	"artistId.uuid": ARTIST,
	"date.required": DAY,
	"date.regex": DAY,
	"startTime.required": TIME,
	"startTime.regex": TIME,
	"hours.required": LENGTH,
	"hours.number": LENGTH,
	"hours.range": LENGTH,
	"brief.required": BRIEF,
	"brief.minLength": BRIEF,
	"brief.maxLength": "Keep it under 4,000 characters.",
	"priceKind.required": PRICE_KIND,
	"priceKind.enum": PRICE_KIND,
	...PRICE_MESSAGES,
});

type Fail = (field: string, message: string, rule: string) => void;

/**
 * BookingService's input from the validated form, in stored units: paisa,
 * minutes and instants. Throws E_VALIDATION_ERROR, shown next to the field,
 * for what the shape can't check: who the client is (a found client's id,
 * else the looked-up phone and a name), a day from today to a year ahead
 * in the studio's timezone (a time earlier today is fine: the walk-in is
 * in the chair), a start time that exists on that day, quarter hours, and
 * the price fields of the chosen kind.
 */
export function toBookingInput(
	form: BookingForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): DirectBooking {
	const problems: { field: string; message: string; rule: string }[] = [];
	const fail: Fail = (field, message, rule) => {
		problems.push({ field, message, rule });
	};

	const client = clientOf(form, fail);
	const startsAt = startOf(form, timezone, now, fail);
	if (!Number.isInteger(form.hours * 4))
		fail("hours", QUARTERS, "quarterHours");
	const quote = quoteOf(form, fail);

	if (problems.length || !client || !startsAt) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		client,
		artistId: form.artistId,
		brief: form.brief,
		startsAt,
		endsAt: startsAt.plus({ minutes: form.hours * 60 }),
		quote,
	};
}

/** The returning client's id, or a new client from the lookup's phone. */
function clientOf(form: BookingForm, fail: Fail): BookingClient | null {
	if (form.clientId) return { kind: "existing", id: form.clientId };
	if (!form.phone) {
		fail("phone", LOOKUP, "required");
		return null;
	}
	if (!form.name) {
		fail("name", "Enter the client's name.", "required");
		return null;
	}
	return {
		kind: "new",
		name: form.name,
		phone: form.phone,
		email: form.email ?? null,
	};
}

/**
 * The session's start: a real day from the studio's today to a year ahead
 * (yyyy-MM-dd strings compare as text), at a time that exists that day.
 */
function startOf(
	form: BookingForm,
	timezone: string,
	now: DateTime,
	fail: Fail,
): DateTime | null {
	const today = todayIn(timezone, now);
	const last = lastBookableDay(today);
	const real = DateTime.fromISO(form.date, { zone: "utc" }).isValid;
	if (!real || form.date < today || form.date > last) {
		fail("date", DAY, "range");
		return null;
	}
	const start = localDateTime(form.date, form.startTime, timezone);
	if (!start) fail("startTime", SKIPPED, "time");
	return start;
}

/** The quick quote of the chosen kind, or null for "No price". */
function quoteOf(form: BookingForm, fail: Fail): QuickQuote | null {
	if (form.priceKind === "none") return null;
	if (form.priceKind === "fixed") {
		if (form.fixedPrice == null) {
			fail("fixedPrice", "Enter the price.", "required");
			return null;
		}
		return { kind: "fixed", fixedPrice: form.fixedPrice * 100 };
	}
	const rate = form.hourlyRate;
	const hours = form.estimatedHours;
	if (rate == null) fail("hourlyRate", "Enter the hourly rate.", "required");
	if (hours == null) {
		fail("estimatedHours", "Enter the estimated hours.", "required");
	} else if (!Number.isInteger(hours * 4)) {
		fail("estimatedHours", QUARTERS, "quarterHours");
	}
	if (rate == null || hours == null || !Number.isInteger(hours * 4)) {
		return null;
	}
	return {
		kind: "hourly",
		hourlyRate: rate * 100,
		estimatedMinutes: hours * 60,
	};
}
