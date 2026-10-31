/**
 * The words and small rules of Settings, Good to know (TAT-128). Plain
 * TypeScript, so a unit test loads it
 * (tests/unit/inertia/good_to_know_copy.spec.ts); the page only lays them
 * out. The week's keys are the server's (#modules/scheduling/opening_hours
 * WEEKDAYS, which the test compares); the flash messages a save sends live
 * there too.
 */

/** The server's weekday keys, Sunday first, and the name the page shows for each. */
export const DAY_NAMES = {
	sun: "Sunday",
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
};
export type DayKey = keyof typeof DAY_NAMES;

/** One weekday of the hours form: ticked means open; the times are "HH:mm". */
export type WeekRow = {
	day: DayKey;
	open: boolean;
	opens: string;
	closes: string;
};

/** The page's rows to edit: the stored week, Sunday first, seven rows. */
export function weekRows(week: readonly WeekRow[]): WeekRow[] {
	return week.map((row) => ({ ...row }));
}

/**
 * The rows after ticking or unticking one day. Ticking copies the times of
 * the nearest open day above it, else the nearest below it, else keeps the
 * row's own, so a week is mostly ticks. Unticking closes the day and keeps
 * its times (ticking it again brings them back).
 */
export function tickDay(
	rows: readonly WeekRow[],
	index: number,
	checked: boolean,
): WeekRow[] {
	return rows.map((row, i) => {
		if (i !== index) return row;
		if (!checked) return { ...row, open: false };
		const above = rows.slice(0, index).reverse();
		const below = rows.slice(index + 1);
		const donor = [...above, ...below].find((other) => other.open) ?? row;
		return { ...row, open: true, opens: donor.opens, closes: donor.closes };
	});
}

export const HOURS_INTRO = (timezone: string) =>
	`Your page shows them in Good to know, and today's on its cover, like "Open now · till 8 pm". Times are ${timezone} time.`;

export const CLOSED_INTRO =
	"Holidays and days off, like Dashain or Tihar. On those days your cover says you're closed and shows your note.";

export const NO_CLOSED_DAYS = "No closed days ahead.";

export const TEXTS_INTRO =
	"Short answers to what clients ask before they come. Your page shows each one you fill in and leaves out the rest.";

/** The Remove button's name, so a list of them is told apart by its dates. */
export const removeLabel = (when: string) => `Remove closed days ${when}`;

/** The line under the texts: the deposit policy is written in Payments. */
export const depositLine = (hasPolicy: boolean) =>
	hasPolicy
		? "Your deposit policy shows here too. Change it in Payments."
		: "Add a deposit policy in Payments and it shows here too.";

/** At the top of the page while the section is hidden in Page look: the sentence, then the link's words. */
export const HIDDEN_TEXT = "Good to know is hidden on your page.";
export const HIDDEN_LINK = "Show it in Page look.";
export const HIDDEN_NOTE = `${HIDDEN_TEXT} ${HIDDEN_LINK}`;
