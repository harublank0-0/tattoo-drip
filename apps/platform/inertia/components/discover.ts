/**
 * The words and small rules of Settings, Discover and its preview (Discover
 * D04). Plain TypeScript with no imports, so a unit test loads it
 * (tests/unit/inertia/discover_copy.spec.ts); the pages only lay them out.
 * The server decides every status, checklist item and state, and words them
 * itself (#modules/discovery/publication): nothing here guesses what is
 * public. These are only the words around the controls.
 */

export type BusinessType = "studio" | "independent";

/** The server's statuses (PUBLICATION_STATUSES), in its order. */
export const DISCOVER_STATUSES = [
	"not_listed",
	"needs_attention",
	"eligible",
	"listed",
	"taken_down",
] as const;
export type DiscoverStatus = (typeof DISCOVER_STATUSES)[number];

export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** How the status badge reads: listed is good news, a takedown is the worst. */
export function statusTone(key: string): StatusTone {
	switch (key) {
		case "listed":
			return "success";
		case "needs_attention":
			return "warning";
		case "taken_down":
			return "danger";
		default:
			return "neutral";
	}
}

/**
 * Each tone's colours: the dashboard's status tokens (app.css), literal so
 * Tailwind sees them. `danger` uses the Badge's own destructive variant.
 */
export const TONE_CLASS: Record<Exclude<StatusTone, "danger">, string> = {
	success: "bg-status-booked-bg text-status-booked-fg",
	warning: "bg-status-studio-bg text-status-studio-fg",
	neutral: "bg-status-closed-bg text-status-closed-fg",
};

const studio = (type: BusinessType) => type === "studio";

export const PAGE_TITLE = "Discover";

export function pageIntro(type: BusinessType): string {
	return studio(type)
		? "Make your studio discoverable to people looking for tattoo artists and studios."
		: "Make your artist profile discoverable to people looking for tattoo artists and studios.";
}

export function previewLabel(type: BusinessType): string {
	return studio(type) ? "Preview my studio" : "Preview my artist profile";
}

/** Beside the "Off" badge: what being off means, not the button's words again. */
export function offLine(type: BusinessType): string {
	return studio(type)
		? "Your studio isn't on Discover."
		: "Your artist profile isn't on Discover.";
}

/** The main control, while the listing is off. */
export function listLabel(type: BusinessType): string {
	return studio(type)
		? "List my studio on TattooDrip Discover"
		: "List my artist profile on Discover";
}

/** Under the listing heading: Discover is optional and changes nothing else. */
export function optionalNote(type: BusinessType): string {
	return studio(type)
		? "Discover is optional and stays off unless you turn it on. Your studio page and bookings work the same either way."
		: "Discover is optional and stays off unless you turn it on. Your page and bookings work the same either way.";
}

export const LISTING_HEADING = "Listing";
export const LISTING_OFF = "Off";
export const LISTING_ON = "On";

/** Why the control is disabled: the required items still open, by their labels. */
export function blockedLine(labels: readonly string[]): string {
	if (labels.length === 0) return "";
	const names =
		labels.length === 1
			? labels[0]
			: `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
	return labels.length === 1
		? `Finish the required step first: ${names}. It's marked in the checklist below.`
		: `Finish the required steps first: ${names}. They're marked in the checklist below.`;
}

export function onLine(type: BusinessType): string {
	return studio(type)
		? "You've turned on your studio's listing."
		: "You've turned on your artist profile's listing.";
}

/** The terms the owner accepted, and whether newer ones exist. */
export function acceptedLine(accepted: {
	acceptedOn: string;
	current: boolean;
}): string {
	return accepted.current
		? `Terms accepted on ${accepted.acceptedOn}.`
		: `Terms accepted on ${accepted.acceptedOn}. Newer listing terms exist: turning the listing off and on again accepts them.`;
}

export const TAKEN_DOWN_HEADING = "Removed by TattooDrip";

/** Under a takedown's summary: the switch is still the owner's, but can't put it back. */
export const TAKEN_DOWN_NOTE =
	"While it is removed, your listing stays off Discover, even with the switch on. You can still turn the listing on or off here.";

export const TURN_OFF_LABEL = "Turn off listing";
export const TURN_OFF_KEEP = "Keep it on";
export const TURN_OFF_BUSY = "Turning off…";

/** The turn-off question: the business leaves Discover, nothing else changes. */
export function turnOffQuestion(type: BusinessType): string {
	return studio(type)
		? "Turn off your listing? Your studio leaves Discover within a few minutes. Your studio page, Studio OS and bookings stay as they are."
		: "Turn off your listing? Your artist profile leaves Discover within a few minutes. Your page, Studio OS and bookings stay as they are.";
}

// The consent panel, shown before a listing is turned on.

export function consentShowsHeading(type: BusinessType): string {
	return studio(type)
		? "What Discover can show once your studio is listed"
		: "What Discover can show once your profile is listed";
}

export const CONSENT_TERMS_HEADING = "Listing terms";
export const DRAFT_MARKER = "Draft: not legally reviewed";
export const DRAFT_NOTE =
	"This wording is a draft. It hasn't been reviewed by a lawyer yet and may change before Discover launches.";
export const CONSENT_LABEL = "I accept these listing terms";
export const CONSENT_CANCEL = "Cancel";

export function consentSubmit(processing: boolean): string {
	return processing ? "Turning on…" : "Turn on listing";
}

// The city.

export const CITY_HEADING = "City";
export const CITY_INTRO =
	"Discover lists every business under its city. Choose the one people would search for.";
export const CITY_LABEL = "City";
export const CITY_PLACEHOLDER = "Choose a city";
export const NO_PLACES = "No cities are available yet.";
export const CITY_LISTED_NOTE =
	"A listing needs its city: turn the listing off before removing it.";

export function citySave(processing: boolean, clearing: boolean): string {
	return processing && !clearing ? "Saving…" : "Save city";
}

export function cityClear(processing: boolean, clearing: boolean): string {
	return processing && clearing ? "Removing…" : "Remove city";
}

// The readiness checklist.

export const CHECKLIST_HEADING = "Checklist";

export function checklistIntro(type: BusinessType): string {
	return studio(type)
		? "What your studio needs before it can be listed, and what makes its listing stronger."
		: "What your profile needs before it can be listed, and what makes its listing stronger.";
}

export function requirementLabel(required: boolean): string {
	return required ? "Required" : "Recommended";
}

/** For a screen reader, next to the mark. */
export function metWords(met: boolean): string {
	return met ? "Done:" : "Not done yet:";
}

/** "4 of 6", or nothing when the item has no figure. */
export function checklistFigure(
	current: number | null,
	recommended: number | null,
): string | null {
	if (current === null || recommended === null) return null;
	return `${current} of ${recommended}`;
}

export type ReadinessAction =
	| "discover_place"
	| "profile"
	| "look"
	| "portfolio"
	| "artists";

/** Each checklist item's link, by where it is fixed. */
export function actionLabel(
	action: ReadinessAction | string,
	type: BusinessType,
	met = false,
): string {
	switch (action) {
		case "discover_place":
			return met ? "Change city" : "Choose your city";
		case "profile":
			return studio(type) ? "Open Studio profile" : "Open your profile";
		case "look":
			return "Open Page look";
		case "portfolio":
			return studio(type) ? "Open Portfolio" : "Manage my public portfolio";
		case "artists":
			return studio(type) ? "Open Artists" : "Open your artist profile";
		default:
			return "Open";
	}
}

/**
 * Where a checklist link goes when it is this page's own section (the city
 * form): a plain `#hash`, so following it scrolls instead of reloading.
 * Null for every other target.
 */
export function samePageHash(
	target: { route: string; hash?: string },
	currentRoute: string,
): string | null {
	return target.route === currentRoute && target.hash
		? `#${target.hash}`
		: null;
}

// The artists overview (studio only).

export const ARTISTS_HEADING = "Artists on Discover";
export const ARTISTS_INTRO =
	"An artist shows on Discover while they're shown on your page and their own Discover switch is on. Change it on their profile.";
export const NO_ARTISTS = "No artists yet.";
export const PORTFOLIO_LINK = "Manage my public portfolio";

export function manageLabel(name: string): string {
	return `Manage ${name}`;
}

/** An artist's published photos against the recommendation. */
export function photosFigure(published: number, recommended: number): string {
	if (published < recommended) {
		return `${published} of ${recommended} recommended published photos`;
	}
	return `${published} published ${published === 1 ? "photo" : "photos"}`;
}

// The artist profile's Discover section.

export const ARTIST_SECTION_HEADING = "Discover";

export function artistSectionIntro(owner: boolean): string {
	return owner
		? "Whether this artist can show on TattooDrip Discover while the studio is listed. It doesn't change the studio page."
		: "Whether you can show on TattooDrip Discover while the studio is listed. It doesn't change the studio page.";
}

export const INDEPENDENT_NOTE =
	"Your Discover listing is managed in Settings, Discover.";
export const INDEPENDENT_LINK = "Open Discover settings";

export function artistSwitchLabel(
	listed: boolean,
	processing: boolean,
): string {
	if (processing) return "Saving…";
	return listed ? "Hide from Discover" : "Show on Discover";
}

/** Why the switch can't be turned back on: the profile belongs to someone else's login. */
export const ARTIST_ONLY_THEY =
	"Only this artist can turn it back on, from their own login.";

// The preview page.

export const PREVIEW_TITLE = "Discover preview";
export const PREVIEW_BANNER =
	"Preview: this is how your listing could look on Discover. Discover isn't online yet.";
export const PREVIEW_BACK = "Back to Discover";

export function previewStatusLine(label: string): string {
	return `Listing status: ${label}`;
}

export function discoverAddressLine(url: string | null): string {
	return url
		? `Your Discover address will be ${url}`
		: "Your Discover address is set when Discover launches.";
}

export function locationLine(
	location: { name: string; region: string | null; countryCode: string } | null,
): string | null {
	if (!location) return null;
	return location.region
		? `${location.name}, ${location.region}`
		: location.name;
}

export const NO_COVER = "No cover photo yet. Add one in Studio profile.";
export const NO_LOGO = "No logo yet";
export const NO_CITY = "No city yet. Choose one in Discover settings.";

export function noIntro(type: BusinessType): string {
	return studio(type)
		? "No description yet. Add one in Studio profile."
		: "No description yet. Add one in your profile.";
}

export function noStyles(type: BusinessType): string {
	return studio(type)
		? "No styles yet. Add them on your artists' profiles."
		: "No styles yet. Add them on your artist profile.";
}

export const NO_PREVIEW_ARTISTS =
	"No artist shows on Discover yet. Show an artist on your page and keep their Discover switch on.";
export const NO_PREVIEW_PHOTOS =
	"No published photos yet. Publish work in Portfolio.";
export const BOOK_LABEL = "Book";

export function pageLinkLabel(type: BusinessType): string {
	return studio(type) ? "Studio page" : "Your page";
}

/** The newest published photos the preview shows: the server sends at most this many. */
export const PREVIEW_PHOTO_LIMIT = 12;

export function workHeading(count: number): string {
	return count === 1 ? "1 photo" : `${count} photos`;
}
