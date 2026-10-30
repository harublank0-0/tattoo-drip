import type { Studio } from "@tattoo-drip/sdk";
import {
	type Closure,
	type CoverState,
	closedDaysText,
	type HoursLine,
	hoursLines,
	readClosures,
	readWeek,
	steadyCoverState,
	type Week,
	zonedNow,
} from "./hours.ts";
import { cleanText } from "./text.ts";

/**
 * What the Good to know section and the cover's state line show (TAT-128),
 * built from the studio read's `openingHours`, `closedDays` and `goodToKnow`.
 * An older API without those fields gives empty views, so the page is the
 * page it was. Texts are plain text (`cleanText`), rendered as text.
 */

export interface GoodToKnowView {
	/** The week as lines, Sunday first; [] when no day is open. */
	readonly hours: readonly HoursLine[];
	/** The upcoming closed days, earliest first, worded without a year. */
	readonly closedDays: readonly {
		readonly when: string;
		readonly note: string | null;
	}[];
	readonly walkIns: string | null;
	readonly ageRule: string | null;
	readonly depositPolicy: string | null;
	readonly beforeSession: string | null;
	readonly aftercare: string | null;
}

export function goodToKnowView(studio: Studio): GoodToKnowView {
	const texts = studio.goodToKnow as Partial<Studio["goodToKnow"]> | undefined;
	return {
		hours: hoursLines(readWeek(studio.openingHours)),
		closedDays: readClosures(studio.closedDays).map((closure) => ({
			when: closedDaysText(closure.from, closure.to),
			note: closure.note,
		})),
		walkIns: cleanText(texts?.walkIns),
		ageRule: cleanText(texts?.ageRule),
		depositPolicy: cleanText(texts?.depositPolicy),
		beforeSession: cleanText(texts?.beforeSession),
		aftercare: cleanText(texts?.aftercare),
	};
}

/** Nothing to show: the section is left out. */
export function goodToKnowIsEmpty(view: GoodToKnowView): boolean {
	return (
		view.hours.length === 0 &&
		view.closedDays.length === 0 &&
		view.walkIns === null &&
		view.ageRule === null &&
		view.depositPolicy === null &&
		view.beforeSession === null &&
		view.aftercare === null
	);
}

/**
 * What the cover's line needs, to render on the server and to recompute in
 * the browser (src/studio/open-now.tsx). Plain data, so it travels in the
 * loader's data. `initial` is the state the server may render: the one that
 * holds for the page's whole cache life, or null (the browser fills it).
 */
export interface OpenNowView {
	readonly timezone: string;
	readonly week: Week;
	readonly closures: readonly Closure[];
	readonly initial: CoverState | null;
}

/**
 * The cover line's view, or null when there is nothing to say: no open
 * weekday and no closed day, or a timezone the browser can't use. `at` is
 * the clock for `initial` (null: none, so a builder with no clock stays pure).
 */
export function openNowView(
	studio: Studio,
	at: Date | null,
): OpenNowView | null {
	const week = readWeek(studio.openingHours);
	const closures = readClosures(studio.closedDays);
	if (week.every((day) => day === null) && closures.length === 0) return null;
	if (zonedNow(new Date(0), studio.timezone) === null) return null;
	return {
		timezone: studio.timezone,
		week,
		closures,
		initial: at ? steadyCoverState(week, closures, studio.timezone, at) : null,
	};
}
