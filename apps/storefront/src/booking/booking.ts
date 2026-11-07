import type {
	DetailField,
	IntakeField,
	IntakeValues,
} from "../intake/rules.ts";
import type { Closure, Week } from "../studio/hours.ts";
import {
	type CalendarRules,
	dayState,
	isDate,
	longDate,
	MAX_DAYS,
} from "./calendar.ts";

/**
 * The session request flow (Prompt 6, `/book`): the steps, the choices the
 * flow adds to the intake form's fields, and how they become the inquiry the
 * API takes (`createInquiry`: an idea, a placement, a size, preferred dates
 * as text, the artist and the contact details). Pure and theme-independent:
 * every theme's booking page runs this flow; only its look differs.
 *
 * Nothing here books anything. The API has no appointments for clients
 * (availability.ts), so the dates are the client's preferences and the
 * studio answers with a time; the page says so wherever a date shows.
 */

export const BOOKING_STEPS = [
	"artist",
	"when",
	"tattoo",
	"details",
	"review",
] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];

export const TIMES_OF_DAY = ["any", "morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const COLOURS = ["black-grey", "colour", "undecided"] as const;
export type Colour = (typeof COLOURS)[number];

/** Friendly sizes; `approximateSize` still takes the client's own words. */
export const SIZES = ["small", "medium", "large", "extra-large"] as const;
export type Size = (typeof SIZES)[number];

/** The form's values: the intake's own, plus the flow's choices. */
export interface BookingValues extends IntakeValues {
	/** Up to three days the client would like (yyyy-MM-dd, in the studio's calendar). */
	days: string[];
	timeOfDay: TimeOfDay;
	/** "Any date suits me": no day needed. */
	flexible: boolean;
	/** A style's slug from the studio's list, or "" for none picked. */
	style: string;
	colour: Colour | "";
	size: Size | "";
	notes: string;
}

/** The flow's own fields, beside the intake's. */
export type BookingField = IntakeField | DetailField | "days" | "size";

/** The notes' limit: the API's (InquiryInput.notes). */
export const BOOKING_LIMITS = { notes: 1000 } as const;

/** The words the flow writes into the inquiry; labels the client sees too. */
export const BOOKING_WORDS = {
	timeOfDay: {
		any: "Any time",
		morning: "Mornings",
		afternoon: "Afternoons",
		evening: "Evenings",
	},
	colour: {
		"black-grey": "Black and grey",
		colour: "Colour",
		undecided: "Not sure yet",
	},
	size: {
		small: "Small: up to a palm",
		medium: "Medium: about a hand",
		large: "Large: a forearm or calf",
		"extra-large": "Extra large: a sleeve, back or leg",
	},
	flexible: "Any date that suits the studio",
} as const satisfies Record<string, unknown>;

/** What the flow knows of the studio and its artists (requestPageData builds it). */
export interface BookingContext {
	/** The artists a client can ask for: those who take new work, by name. */
	readonly artists: readonly BookingArtist[];
	/** The studio's styles: those its visible artists list, each once, as the API names them. */
	readonly styles: readonly { readonly slug: string; readonly name: string }[];
	readonly calendar: CalendarRules & {
		/** The studio's IANA timezone: "today" is its date, not the client's. */
		readonly timeZone: string;
	};
	/** The gallery piece the request is "inspired by", checked with the API; null for none. */
	readonly artwork: BookingArtwork | null;
	/** Discover's referral token from the address (`?ref=`, Discover D08), sent as `referral`; absent for none. */
	readonly referral?: string;
}

export interface BookingArtist {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	/** Their first listed style, or null. */
	readonly specialty: string | null;
	readonly photo: {
		readonly src: string;
		readonly srcSet?: string;
		readonly width: number;
		readonly height: number;
		readonly alt: string;
	} | null;
}

export interface BookingArtwork {
	readonly id: string;
	readonly title: string;
	readonly href: string;
	/** Its page's absolute address, which the idea starts with. */
	readonly url: string;
	readonly src: string;
	readonly width: number;
	readonly height: number;
	readonly artistName: string | null;
}

/** The empty calendar: a week with no published hours offers every day. */
export const EMPTY_CALENDAR: BookingContext["calendar"] = {
	week: Array(7).fill(null) as Week,
	closures: [] as Closure[],
	timeZone: "UTC",
};

/**
 * The steps this request shows: the artist step only when there is a choice
 * (two or more artists take new work, or the address asked for one; a flash
 * request is its design's artist's), the others always.
 */
export function bookingSteps(choice: boolean): readonly BookingStep[] {
	return choice
		? BOOKING_STEPS
		: BOOKING_STEPS.filter((step) => step !== "artist");
}

/** Which fields each step checks before the next. */
export const STEP_FIELDS: Record<BookingStep, readonly BookingField[]> = {
	artist: ["preferredArtistId"],
	when: ["days"],
	tattoo: [
		"idea",
		"style",
		"colour",
		"size",
		"approximateSize",
		"placement",
		"budget",
		"notes",
	],
	details: ["contactName", "contactPhone", "contactEmail", "sourceChannel"],
	review: [],
};

/** The flow's field an intake field's error belongs to: the dates are the days, the size its choice. */
export function bookingFieldOf(field: IntakeField | DetailField): BookingField {
	if (field === "preferredDates") return "days";
	if (field === "approximateSize") return "size";
	return field;
}

/** The days a client named that can still be named (a closure added meanwhile drops one), at most three. */
export function namedDays(
	values: Pick<BookingValues, "days">,
	today: string,
	rules: CalendarRules,
): string[] {
	return values.days
		.filter((day) => isDate(day) && dayState(day, today, rules) === "open")
		.slice(0, MAX_DAYS);
}

/** "Tuesday, 12 November 2026; Thursday, 14 November 2026 (afternoons)", or the flexible line; "" when nothing is named. */
export function preferredDatesText(
	values: Pick<BookingValues, "days" | "timeOfDay" | "flexible">,
	today: string,
	rules: CalendarRules,
): string {
	if (values.flexible) {
		return values.timeOfDay === "any"
			? BOOKING_WORDS.flexible
			: `${BOOKING_WORDS.flexible} (${BOOKING_WORDS.timeOfDay[values.timeOfDay].toLowerCase()})`;
	}
	const days = namedDays(values, today, rules).sort();
	if (days.length === 0) return "";
	const list = days.map(longDate).join("; ");
	return values.timeOfDay === "any"
		? list
		: `${list} (${BOOKING_WORDS.timeOfDay[values.timeOfDay].toLowerCase()})`;
}

/** "Medium: about a hand, roughly 12 cm": the choice and the client's own words, either alone. */
export function sizeText(
	values: Pick<BookingValues, "size" | "approximateSize">,
): string {
	const words = values.approximateSize.trim();
	const choice = values.size === "" ? "" : BOOKING_WORDS.size[values.size];
	if (choice && words) return `${choice}, ${words}`;
	return choice || words;
}

/** The idea as the studio reads it: the client's own words, trimmed. */
export function ideaText(values: Pick<BookingValues, "idea">): string {
	return values.idea.trim();
}

/** What the flow sends beyond the intake's own fields: each only when chosen. */
export interface BookingDetails {
	readonly style?: string;
	readonly colour?: Colour;
	readonly notes?: string;
}

/** The intake's values the API is sent, with the style, colour and notes the client chose. */
export function intakeValuesOf(
	values: BookingValues,
	today: string,
	rules: CalendarRules,
): IntakeValues & BookingDetails {
	const notes = values.notes.trim();
	return {
		idea: ideaText(values),
		placement: values.placement,
		approximateSize: sizeText(values),
		preferredDates: preferredDatesText(values, today, rules),
		preferredArtistId: values.preferredArtistId,
		budget: values.budget,
		sourceChannel: values.sourceChannel,
		contactName: values.contactName,
		contactPhone: values.contactPhone,
		contactEmail: values.contactEmail,
		...(values.style ? { style: values.style } : {}),
		...(values.colour ? { colour: values.colour } : {}),
		...(notes ? { notes } : {}),
	};
}

/** The name of the style a slug stands for, among the studio's; null for none. */
export function styleName(
	styles: BookingContext["styles"],
	slug: string,
): string | null {
	return styles.find((style) => style.slug === slug)?.name ?? null;
}

/** A fresh form: the intake's start (an artist, a flash or "inspired by" idea), and nothing else chosen. */
export function bookingValues(start: IntakeValues): BookingValues {
	return {
		...start,
		days: [],
		timeOfDay: "any",
		flexible: false,
		style: "",
		colour: "",
		size: "",
		notes: "",
	};
}
