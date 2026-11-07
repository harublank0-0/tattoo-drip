/**
 * Discover publication rules for Studio OS (Discover D04,
 * docs/discover/publication-controls.md): the listing consent, the five
 * derived statuses, the readiness checklist and the Discover state of one
 * artist or one photo. Pure: PublicationService gathers the facts from the
 * database, and the database (the D02 `discovery` views) stays the only
 * thing that decides what is public. Nothing here is stored as a status.
 */

/**
 * The listing consent's version. It names one exact wording: a change of
 * meaning is a new version, never an edit of this one. Turning a listing on
 * records the version accepted; an older acceptance stays valid for the
 * listing it was given for, and turning the listing on again always asks for
 * this one.
 */
export const LISTING_CONSENT_VERSION = "2026-11-07.draft-1";

/**
 * Recommended profile completeness (the blueprint's open decision 1). Not
 * required to list: a studio with fewer photos can still list, and the
 * checklist says what would make the profile stronger.
 */
export const DISCOVER_RECOMMENDED = {
	/** Published photos across the studio's artists shown on Discover. */
	studioPhotos: 6,
	/** Published photos for each artist shown on Discover (and an independent artist). */
	artistPhotos: 3,
} as const;

export type BusinessType = "studio" | "independent";

/** The listing consent, as shown before a listing is turned on. */
export type ListingConsent = {
	version: string;
	/** True until the wording is legally reviewed: the page says so. */
	draft: boolean;
	text: string;
	/** What Discover can show once listed, in plain words. */
	shows: string[];
};

export function listingConsent(type: BusinessType): ListingConsent {
	const studio = type === "studio";
	return {
		version: LISTING_CONSENT_VERSION,
		draft: true,
		text: studio
			? "By listing this studio on TattooDrip Discover, I confirm I may do so for the studio, and I allow TattooDrip to show the studio's public profile, its published portfolio photos, the artists shown on Discover and links to the studio's booking page in its public directory. I confirm the studio may publish these photos, including with the consent of clients who can be recognised in them. I understand I can turn the listing off at any time."
			: "By listing my artist profile on TattooDrip Discover, I allow TattooDrip to show my public profile, my published portfolio photos and links to my booking page in its public directory. I confirm I may publish these photos, including with the consent of clients who can be recognised in them. I understand I can turn the listing off at any time.",
		shows: studio
			? [
					"The studio's name, description, city, logo and cover photo",
					"Its tattoo styles and social links",
					"Published portfolio photos of the artists shown on Discover",
					"Those artists' names, photos, bios, styles and social links",
					"Links to the studio's page and its booking form",
				]
			: [
					"Your name, description, city, logo and cover photo",
					"Your tattoo styles and social links",
					"Your published portfolio photos",
					"Links to your page and your booking form",
				],
	};
}

export const PUBLICATION_STATUSES = [
	"not_listed",
	"needs_attention",
	"eligible",
	"listed",
	"taken_down",
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** An artist as the checklist and the overview need them. */
export type ArtistFacts = {
	id: string;
	name: string;
	slug: string;
	/** On the studio page (`artists.visible`). */
	visible: boolean;
	/** Their own Discover switch (`artists.discovery_listed`). */
	discoveryListed: boolean;
	/** Published photos: not hidden and not taken down. */
	publishedPhotos: number;
};

/** What is true of the business now, read from the database. */
export type PublicationFacts = {
	type: BusinessType;
	/** The owner's switch (`discovery_listed`). */
	optedIn: boolean;
	/** A platform takedown (`discovery_suspended_at`). */
	takenDown: boolean;
	/** Whether the public view returns the business right now. */
	publiclyVisible: boolean;
	hasPlace: boolean;
	hasLogo: boolean;
	hasCover: boolean;
	hasIntro: boolean;
	/** Live artists (deleted ones are not passed). */
	artists: ArtistFacts[];
};

export type ReadinessKey =
	| "profile"
	| "location"
	| "branding"
	| "description"
	| "portfolio"
	| "artists";

/** Where in Studio OS an item is fixed. */
export type ReadinessAction =
	| "discover_place"
	| "profile"
	| "look"
	| "portfolio"
	| "artists";

export type ReadinessItem = {
	key: ReadinessKey;
	/** Required to list; every other item is a recommendation. */
	required: boolean;
	met: boolean;
	label: string;
	/** What is missing and what would help, in a sentence. */
	detail: string;
	current: number | null;
	recommended: number | null;
	action: ReadinessAction;
};

export type Readiness = {
	/** Every required item is met: the listing can be turned on. */
	eligible: boolean;
	/** Every item, recommended ones too, is met. */
	complete: boolean;
	items: ReadinessItem[];
};

/** An artist counts towards Discover only while shown on the page and not opted out. */
export function showsOnDiscover(artist: ArtistFacts): boolean {
	return artist.visible && artist.discoveryListed;
}

/** Published photos of the artists shown on Discover. */
export function discoverPhotos(artists: ArtistFacts[]): number {
	return artists
		.filter(showsOnDiscover)
		.reduce((sum, artist) => sum + artist.publishedPhotos, 0);
}

export function readiness(facts: PublicationFacts): Readiness {
	const studio = facts.type === "studio";
	const photos = discoverPhotos(facts.artists);
	const photoTarget = studio
		? DISCOVER_RECOMMENDED.studioPhotos
		: DISCOVER_RECOMMENDED.artistPhotos;
	const items: ReadinessItem[] = [
		{
			key: "location",
			required: true,
			met: facts.hasPlace,
			label: "City",
			detail: facts.hasPlace
				? "People can find you by your city."
				: "Choose your city. Discover lists every business under its city, so it is needed to list.",
			current: null,
			recommended: null,
			action: "discover_place",
		},
		{
			key: "branding",
			required: false,
			met: facts.hasLogo || facts.hasCover,
			label: "Logo or cover photo",
			detail:
				facts.hasLogo || facts.hasCover
					? "Your listing has a picture of its own."
					: "Add a logo or a cover photo, so your listing doesn't show a blank space.",
			current: null,
			recommended: null,
			// The logo is set in Page look, which links to the cover photo too.
			action: "look",
		},
		{
			key: "description",
			required: false,
			met: facts.hasIntro,
			label: "Description",
			detail: facts.hasIntro
				? "Your description shows on your listing."
				: studio
					? "Add a short description of the studio in Studio profile."
					: "Add a short description of your work in your profile.",
			current: null,
			recommended: null,
			action: "profile",
		},
		{
			key: "portfolio",
			required: false,
			met: photos >= photoTarget,
			label: "Published portfolio",
			detail:
				photos >= photoTarget
					? `${photos} published ${photos === 1 ? "photo" : "photos"} can show on Discover.`
					: `${photos} of ${photoTarget} recommended published photos. Publish more work in Portfolio.`,
			current: photos,
			recommended: photoTarget,
			action: "portfolio",
		},
	];
	if (!studio) {
		// An independent artist's public page is their profile: it must be
		// shown on their page. Before listing, an opted-out profile counts,
		// since turning the listing on turns their own switch back on.
		const met = facts.artists.some((artist) =>
			facts.optedIn ? showsOnDiscover(artist) : artist.visible,
		);
		items.unshift({
			key: "profile",
			required: true,
			met,
			label: "Your profile",
			detail: met
				? "Your artist profile is shown on your page."
				: "Show your artist profile on your page. Discover shows the same profile.",
			current: null,
			recommended: null,
			action: "artists",
		});
	}
	if (studio) {
		const shown = facts.artists.filter(showsOnDiscover);
		const strong = shown.filter(
			(artist) => artist.publishedPhotos >= DISCOVER_RECOMMENDED.artistPhotos,
		);
		items.push({
			key: "artists",
			required: false,
			met: shown.length > 0 && strong.length === shown.length,
			label: "Artists",
			detail:
				shown.length === 0
					? "No artist is shown on Discover yet. Show an artist on your page and keep their Discover switch on."
					: strong.length === shown.length
						? `Every artist shown on Discover has at least ${DISCOVER_RECOMMENDED.artistPhotos} published photos.`
						: fewerPhotos(shown.length - strong.length, shown.length),
			current: strong.length,
			recommended: shown.length,
			action: "artists",
		});
	}
	return {
		eligible: items.every((item) => !item.required || item.met),
		complete: items.every((item) => item.met),
		items,
	};
}

function fewerPhotos(short: number, shown: number): string {
	const target = DISCOVER_RECOMMENDED.artistPhotos;
	if (shown === 1) {
		return `Your artist shown on Discover has fewer than ${target} published photos.`;
	}
	return short === 1
		? `1 of the ${shown} artists shown on Discover has fewer than ${target} published photos.`
		: `${short} of the ${shown} artists shown on Discover have fewer than ${target} published photos.`;
}

/**
 * The business's status, in this order: a takedown wins over everything;
 * then an owner who opted in is `listed` only while the public view really
 * returns the business and every required item holds, else
 * `needs_attention`; an owner who has not opted in is `eligible` when the
 * listing could be turned on, else `not_listed`.
 */
export function publicationStatus(
	facts: PublicationFacts,
	ready: Readiness = readiness(facts),
): PublicationStatus {
	if (facts.takenDown) return "taken_down";
	if (facts.optedIn) {
		return facts.publiclyVisible && ready.eligible
			? "listed"
			: "needs_attention";
	}
	return ready.eligible ? "eligible" : "not_listed";
}

export const STATUS_WORDS: Record<
	PublicationStatus,
	{ label: string; summary: (type: BusinessType) => string }
> = {
	not_listed: {
		label: "Not listed",
		summary: (type) =>
			type === "studio"
				? "Your studio isn't on Discover. Finish the required step below to list it."
				: "Your profile isn't on Discover. Finish the required step below to list it.",
	},
	needs_attention: {
		label: "Needs attention",
		summary: () =>
			"Your listing is turned on, but it isn't showing on Discover. Fix the required step marked below.",
	},
	eligible: {
		label: "Ready to list",
		summary: (type) =>
			type === "studio"
				? "Your studio isn't on Discover yet. It has everything it needs: turn the listing on when you're ready."
				: "Your profile isn't on Discover yet. It has everything it needs: turn the listing on when you're ready.",
	},
	listed: {
		label: "Listed",
		summary: (type) =>
			type === "studio"
				? "Your studio is on Discover. Changes show there within a few minutes."
				: "Your profile is on Discover. Changes show there within a few minutes.",
	},
	taken_down: {
		label: "Removed by TattooDrip",
		summary: (type) =>
			`TattooDrip has removed this listing from Discover. Your ${type === "studio" ? "studio page" : "page"} and bookings are not affected. Contact TattooDrip support to have it reviewed.`,
	},
};

export const ARTIST_DISCOVER_STATES = [
	"shown",
	"opted_out",
	"hidden_from_page",
	"studio_not_listed",
	"studio_taken_down",
] as const;
export type ArtistDiscoverState = (typeof ARTIST_DISCOVER_STATES)[number];

/** Whether one artist shows on Discover, and the first reason they don't. */
export function artistDiscoverState(
	studio: { takenDown: boolean; publiclyVisible: boolean },
	artist: Pick<ArtistFacts, "visible" | "discoveryListed">,
): ArtistDiscoverState {
	if (studio.takenDown) return "studio_taken_down";
	if (!artist.visible) return "hidden_from_page";
	if (!artist.discoveryListed) return "opted_out";
	if (!studio.publiclyVisible) return "studio_not_listed";
	return "shown";
}

const ARTIST_STATE_WORDS: Record<
	BusinessType,
	Record<ArtistDiscoverState, string>
> = {
	studio: {
		shown: "Shown on Discover.",
		opted_out: "Not shown on Discover: this artist's Discover switch is off.",
		hidden_from_page:
			"Not shown on Discover: this artist is hidden from the studio page.",
		studio_not_listed:
			"Not shown on Discover yet: the studio isn't listed. The artist will show once it is.",
		studio_taken_down:
			"Not shown on Discover: TattooDrip has removed the studio's listing.",
	},
	// An independent artist's profile is their listing: "your", never "the studio".
	independent: {
		shown: "Your profile is shown on Discover.",
		opted_out:
			"Your profile isn't shown on Discover. Turn your listing off and on again in Settings, Discover.",
		hidden_from_page:
			"Your profile isn't shown on Discover: it's hidden from your page.",
		studio_not_listed:
			"Your profile isn't on Discover yet: your listing is off.",
		studio_taken_down:
			"Your profile isn't shown on Discover: TattooDrip has removed your listing.",
	},
};

/** One artist's Discover state in words, for their business type. */
export function artistStateText(
	state: ArtistDiscoverState,
	type: BusinessType,
): string {
	return ARTIST_STATE_WORDS[type][state];
}

export const ARTWORK_DISCOVER_STATES = [
	"visible",
	"removed",
	"unpublished",
	"artist_hidden",
	"artist_opted_out",
	"studio_not_listed",
] as const;
export type ArtworkDiscoverState = (typeof ARTWORK_DISCOVER_STATES)[number];

/** Whether one photo shows on Discover, and the first reason it doesn't. */
export function artworkDiscoverState(
	studio: { takenDown: boolean; publiclyVisible: boolean },
	artist: Pick<ArtistFacts, "visible" | "discoveryListed">,
	photo: { hidden: boolean; takenDown: boolean },
): ArtworkDiscoverState {
	if (studio.takenDown || photo.takenDown) return "removed";
	if (photo.hidden) return "unpublished";
	if (!artist.visible) return "artist_hidden";
	if (!artist.discoveryListed) return "artist_opted_out";
	if (!studio.publiclyVisible) return "studio_not_listed";
	return "visible";
}

export const ARTWORK_STATE_WORDS: Record<
	ArtworkDiscoverState,
	{ label: string; note: string }
> = {
	visible: { label: "On Discover", note: "This photo can show on Discover." },
	removed: {
		label: "Removed from Discover",
		note: "TattooDrip has removed this photo from Discover. It stays on your page.",
	},
	unpublished: {
		label: "Not on Discover",
		note: "Unpublished photos never show on Discover.",
	},
	artist_hidden: {
		label: "Not on Discover",
		note: "Its artist is hidden from your page, so it doesn't show on Discover.",
	},
	artist_opted_out: {
		label: "Not on Discover",
		note: "Its artist's Discover switch is off.",
	},
	studio_not_listed: {
		label: "Not on Discover",
		note: "Your listing is off. It will show on Discover once you list.",
	},
};
