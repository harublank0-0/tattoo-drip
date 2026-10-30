import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import { DateTime } from "luxon";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import {
	CLOCK_TIME,
	CLOSURE_NOTE_MAX,
	type ClosureInput,
	MAX_CLOSURE_DAYS,
	type OpeningDay,
	WEEKDAYS,
	type Weekday,
} from "#modules/scheduling/opening_hours";

const TIMES = "Enter both times, like 11:00 and 20:00.";
const ORDER = "Close after you open. Hours can't run past midnight.";
const FROM = "Pick a day from today to a year from now.";
const TO = "Pick the same day or a later one, at most 60 days after the first.";
const NOTE = `Keep the note to one line of ${CLOSURE_NOTE_MAX} characters or fewer.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The opening hours form (TAT-128): `hours[<day>][open|opens|closes]`. An
 * emptied time box arrives as null (the body parser turns "" into null), so
 * the shape accepts it and toOpeningWeek words the error on the day.
 */
export const openingHoursValidator = vine.create({
	hours: vine
		.object(
			Object.fromEntries(
				WEEKDAYS.map((day) => [
					day,
					vine
						.object({
							open: vine.boolean().optional(),
							opens: vine.string().trim().nullable().optional(),
							closes: vine.string().trim().nullable().optional(),
						})
						.optional(),
				]),
			),
		)
		.optional(),
});

export type OpeningHoursForm = {
	hours?: Partial<
		Record<
			Weekday,
			{
				open?: boolean;
				opens?: string | null;
				closes?: string | null;
			}
		>
	>;
};

/**
 * The week from the validated form, Sunday first: only the ticked days (an
 * unticked day is closed, whatever times came with it). Throws
 * E_VALIDATION_ERROR on `hours.<day>`, shown under that day's row, for a
 * ticked day without two real times or one that closes at or before it
 * opens.
 */
export function toOpeningWeek(form: OpeningHoursForm): OpeningDay[] {
	const week: OpeningDay[] = [];
	const problems: { field: string; message: string; rule: string }[] = [];
	for (const day of WEEKDAYS) {
		const entry = form.hours?.[day];
		if (!entry?.open) continue;
		const { opens, closes } = entry;
		if (
			!opens ||
			!closes ||
			!CLOCK_TIME.test(opens) ||
			!CLOCK_TIME.test(closes)
		) {
			problems.push({ field: `hours.${day}`, message: TIMES, rule: "hours" });
		} else if (closes <= opens) {
			problems.push({ field: `hours.${day}`, message: ORDER, rule: "hours" });
		} else {
			week.push({ day, opens, closes });
		}
	}
	if (problems.length > 0) throw new errors.E_VALIDATION_ERROR(problems);
	return week;
}

/**
 * The closed days form (TAT-128). The fields are `closedFrom` / `closedTo` /
 * `closedNote` because the settings page holds other forms and shares one
 * error bag. An empty box arrives as null; a hand-made request may leave
 * one out. The note is one line of plain text.
 */
export const closedDaysValidator = vine.create({
	closedFrom: vine.string().regex(DATE),
	closedTo: vine.string().regex(DATE).nullable().optional(),
	closedNote: vine
		.string()
		.trim()
		.maxLength(CLOSURE_NOTE_MAX)
		.regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u)
		.nullable()
		.optional(),
});
closedDaysValidator.messagesProvider = new SimpleMessagesProvider({
	"closedFrom.required": FROM,
	"closedFrom.regex": FROM,
	"closedTo.regex": TO,
	"closedNote.maxLength": NOTE,
	"closedNote.regex": NOTE,
});

export type ClosedDaysForm = {
	closedFrom: string;
	closedTo?: string | null;
	closedNote?: string | null;
};

const isDate = (value: string) =>
	DateTime.fromISO(value, { zone: "utc" }).isValid;

/**
 * The closure from the validated form: the first day from the studio's
 * today to a year ahead (the booking page's range), the last day defaulting
 * to the first and at most MAX_CLOSURE_DAYS in all. Throws
 * E_VALIDATION_ERROR on `closedFrom` / `closedTo` for what the shape can't
 * check.
 */
export function toClosure(
	form: ClosedDaysForm,
	timezone: string,
	now: DateTime = DateTime.now(),
): ClosureInput {
	const problems: { field: string; message: string; rule: string }[] = [];
	const today = todayIn(timezone, now);
	const from = form.closedFrom;
	const fromOk =
		isDate(from) && from >= today && from <= lastBookableDay(today);
	if (!fromOk)
		problems.push({ field: "closedFrom", message: FROM, rule: "range" });

	// A last day left empty is the first, so only a bad first day is reported.
	const to = form.closedTo || from;
	if (form.closedTo || fromOk) {
		const lastDay = DateTime.fromISO(from, { zone: "utc" })
			.plus({ days: MAX_CLOSURE_DAYS - 1 })
			.toFormat("yyyy-MM-dd");
		if (!isDate(to) || (fromOk && (to < from || to > lastDay))) {
			problems.push({ field: "closedTo", message: TO, rule: "range" });
		}
	}
	if (problems.length > 0) throw new errors.E_VALIDATION_ERROR(problems);

	return {
		startsOn: from,
		endsOn: to,
		note: form.closedNote?.trim() || null,
	};
}
