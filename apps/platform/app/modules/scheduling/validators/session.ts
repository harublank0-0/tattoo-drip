import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import { DateTime } from "luxon";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import { SESSION_OUTCOMES } from "#modules/scheduling/outcomes";
import type { SessionTimes } from "#modules/scheduling/services/session_service";
import { localDateTime } from "#modules/scheduling/times";

const DAY = "Pick a date from today to a year from now.";
const TIME = "Enter the start time, like 14:00.";
const LENGTH = "Enter a length from 0.25 to 12 hours.";
const SKIPPED =
	"That time doesn't exist on this day because the clocks change. Pick another.";
const OUTCOME = "Choose done, no-show or cancelled.";

/** Quarter hours: a session's length, and the booking form's estimated hours. */
export const QUARTERS = "Use quarter hours: 0.25, 0.5, 0.75 and so on.";

/**
 * A session's time as a form gives it (TAT-43's booking form, TAT-85's
 * move form): the studio's local date (yyyy-MM-dd) and start time (HH:mm),
 * and the length in hours, 0.25 to 12. What depends on the studio's
 * timezone is readSessionTimes'.
 */
export function sessionTimeFields() {
	return {
		date: vine.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		startTime: vine.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
		hours: vine.number().range([0.25, 12]),
	};
}

/** sessionTimeFields' messages, in the forms' words. */
export const SESSION_TIME_MESSAGES = {
	"date.required": DAY,
	"date.regex": DAY,
	"startTime.required": TIME,
	"startTime.regex": TIME,
	"hours.required": LENGTH,
	"hours.number": LENGTH,
	"hours.range": LENGTH,
};

export type SessionTimeForm = {
	date: string;
	startTime: string;
	hours: number;
};

/** Collects a field error shown next to `field`, like the validator's own. */
export type Fail = (field: string, message: string, rule: string) => void;

/**
 * A session's start and end from the form, or null after reporting what's
 * wrong through `fail`: a real day from the studio's today to a year ahead
 * (yyyy-MM-dd strings compare as text; a time earlier today is fine: the
 * client is in the chair), a start time that exists that day (localDateTime:
 * a time the clocks skip is an error, one they pass twice is its first
 * occurrence), and a length in quarter hours, as elapsed time.
 */
export function readSessionTimes(
	form: SessionTimeForm,
	timezone: string,
	now: DateTime,
	fail: Fail,
): SessionTimes | null {
	const today = todayIn(timezone, now);
	const real = DateTime.fromISO(form.date, { zone: "utc" }).isValid;
	let startsAt: DateTime | null = null;
	if (!real || form.date < today || form.date > lastBookableDay(today)) {
		fail("date", DAY, "range");
	} else {
		startsAt = localDateTime(form.date, form.startTime, timezone);
		if (!startsAt) fail("startTime", SKIPPED, "time");
	}
	const quarters = Number.isInteger(form.hours * 4);
	if (!quarters) fail("hours", QUARTERS, "quarterHours");
	if (!startsAt || !quarters) return null;
	return { startsAt, endsAt: startsAt.plus({ minutes: form.hours * 60 }) };
}

/** The move form (TAT-85): only the new time. */
export const sessionTimeValidator = vine.create(sessionTimeFields());
sessionTimeValidator.messagesProvider = new SimpleMessagesProvider(
	SESSION_TIME_MESSAGES,
);

/**
 * SessionService.move's input from the validated move form. Throws
 * E_VALIDATION_ERROR, shown next to the field, for what the shape can't
 * check (readSessionTimes).
 */
export function toSessionTimes(
	form: SessionTimeForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): SessionTimes {
	const problems: { field: string; message: string; rule: string }[] = [];
	const times = readSessionTimes(
		form,
		timezone,
		now,
		(field, message, rule) => {
			problems.push({ field, message, rule });
		},
	);
	if (!times) throw new errors.E_VALIDATION_ERROR(problems);
	return times;
}

/** The outcome buttons (TAT-85): `status` is the session's new status. */
export const outcomeValidator = vine.create({
	status: vine.enum(SESSION_OUTCOMES),
});
outcomeValidator.messagesProvider = new SimpleMessagesProvider({
	"status.required": OUTCOME,
	"status.enum": OUTCOME,
});
