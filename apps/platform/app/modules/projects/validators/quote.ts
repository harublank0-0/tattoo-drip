import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DateTime } from "luxon";
import { QUOTE_KINDS } from "#modules/projects/models/quote";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import type { NewQuote } from "#modules/projects/services/quote_service";

const PRICE = "Enter whole rupees from 1 to 1,00,00,000.";
const RATE = "Enter whole rupees from 1 to 1,00,000 an hour.";
const HOURS = "Enter hours from 0.25 to 100.";
const DEPOSIT = "Enter the deposit in whole rupees (0 for none).";
const EXPIRY = "Pick the last day the quote is valid.";

/**
 * The price fields the quote form and the booking form (TAT-43) share, in
 * the form's units: whole rupees and hours; empty fields arrive as null.
 * The caps keep rate × hours far below 2^53 (see toQuoteInput). A function,
 * so each validator gets its own schema objects.
 */
export function priceFields() {
	return {
		fixedPrice: vine
			.number()
			.withoutDecimals()
			.range([1, 10_000_000])
			.nullable()
			.optional(),
		hourlyRate: vine
			.number()
			.withoutDecimals()
			.range([1, 100_000])
			.nullable()
			.optional(),
		estimatedHours: vine.number().range([0.25, 100]).nullable().optional(),
	};
}

/** The messages for priceFields(). */
export const PRICE_MESSAGES = {
	"fixedPrice.number": PRICE,
	"fixedPrice.withoutDecimals": PRICE,
	"fixedPrice.range": PRICE,
	"hourlyRate.number": RATE,
	"hourlyRate.withoutDecimals": RATE,
	"hourlyRate.range": RATE,
	"estimatedHours.number": HOURS,
	"estimatedHours.range": HOURS,
};

/**
 * The quote form's shape, in the form's units: whole rupees, hours and the
 * last valid day (yyyy-MM-dd, the studio's local date). Empty fields arrive
 * as null. What depends on the kind, the total or the studio's timezone is
 * checked by toQuoteInput. `baseQuoteId` is the quote the form was showing
 * (null for a first quote): ProjectService.issueQuote refuses the save when
 * it is no longer the current one.
 */
export const quoteValidator = vine.create({
	baseQuoteId: vine.string().uuid().nullable().optional(),
	kind: vine.enum(QUOTE_KINDS),
	...priceFields(),
	depositAmount: vine.number().withoutDecimals().min(0),
	expiresOn: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type QuoteForm = Infer<typeof quoteValidator>;

quoteValidator.messagesProvider = new SimpleMessagesProvider({
	"kind.required": "Choose fixed or hourly.",
	"kind.enum": "Choose fixed or hourly.",
	...PRICE_MESSAGES,
	"depositAmount.required": DEPOSIT,
	"depositAmount.number": DEPOSIT,
	"depositAmount.withoutDecimals": DEPOSIT,
	"depositAmount.min": DEPOSIT,
	"expiresOn.required": EXPIRY,
	"expiresOn.regex": EXPIRY,
});

type Problem = { field: string; message: string; rule: string };

/**
 * The service's input from the validated form, in stored units: paisa,
 * whole minutes and the expiry instant (expiresAtFor). Throws
 * E_VALIDATION_ERROR, shown next to the field, for what the shape can't
 * check: the price fields of the chosen kind, quarter-hour estimates, a
 * deposit above the total, and a last day outside today to a year from now
 * in the studio's timezone. The caps keep rate × hours far below 2^53, so
 * plain numbers are exact here.
 */
export function toQuoteInput(
	form: QuoteForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): NewQuote {
	const problems: Problem[] = [];
	const fail = (field: string, message: string, rule: string) => {
		problems.push({ field, message, rule });
	};

	const expiresAt = checkExpiry(form.expiresOn, timezone, now, fail);
	const depositAmount = form.depositAmount * 100;
	const overTotal = (total: number) => {
		if (depositAmount > total) {
			fail("depositAmount", "The deposit can't be more than the total.", "max");
		}
	};

	if (form.kind === "fixed") {
		const price = form.fixedPrice;
		if (price == null) fail("fixedPrice", "Enter the price.", "required");
		else overTotal(price * 100);
		if (problems.length || price == null || !expiresAt) {
			throw new errors.E_VALIDATION_ERROR(problems);
		}
		return { kind: "fixed", fixedPrice: price * 100, depositAmount, expiresAt };
	}

	const rate = form.hourlyRate;
	const hours = form.estimatedHours;
	if (rate == null) fail("hourlyRate", "Enter the hourly rate.", "required");
	if (hours == null) {
		fail("estimatedHours", "Enter the estimated hours.", "required");
	} else if (!Number.isInteger(hours * 4)) {
		fail(
			"estimatedHours",
			"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
			"quarterHours",
		);
	}
	if (rate != null && hours != null) overTotal(rate * 100 * hours);
	if (problems.length || rate == null || hours == null || !expiresAt) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		kind: "hourly",
		hourlyRate: rate * 100,
		estimatedMinutes: hours * 60,
		depositAmount,
		expiresAt,
	};
}

/**
 * The expiry instant for a last valid day from the studio's today to a
 * year ahead, else null after recording the problem. The dates are
 * yyyy-MM-dd strings, so they compare as text.
 */
function checkExpiry(
	date: string,
	timezone: string,
	now: DateTime,
	fail: (field: string, message: string, rule: string) => void,
): DateTime | null {
	const today = todayIn(timezone, now);
	const last = DateTime.fromISO(today, { zone: "utc" })
		.plus({ years: 1 })
		.toFormat("yyyy-MM-dd");
	const real = DateTime.fromISO(date, { zone: "utc" }).isValid;
	if (!real || date < today || date > last) {
		fail("expiresOn", "Pick a date from today to a year from now.", "range");
		return null;
	}
	return expiresAtFor(date, timezone);
}

/** The quote the client accepted, as the page showed it. */
export const acceptQuoteValidator = vine.create({
	quoteId: vine.string().uuid(),
});
