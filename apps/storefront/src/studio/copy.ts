/*
 * The words of the studio page's first screen, contact groups and "How
 * booking works" (TAT-105), in English. Templates hold {studio}, which
 * components put in <bdi> through <Fill> (names may be Nepali or
 * right-to-left); a Nepali version would be a second object of the same shape.
 * Short, kind, and nothing that needs an idiom to translate. The intake form's
 * words are in src/intake/copy.ts.
 */

export interface Step {
	/** The strip's whole line, and the panel's heading for the step. */
	readonly title: string;
	/** The panel's extra line. */
	readonly detail: string;
}

export const studioCopy = {
	/** The hero's primary action: it jumps to the form. */
	sendIdea: "Send your idea",
	/** The hero's secondary action: a WhatsApp chat with the studio. */
	whatsapp: "WhatsApp",
	notTaking: "Not taking new inquiries right now",
	contact: {
		chat: "Chat",
		follow: "Follow",
		visit: "Visit",
		map: "Open in Google Maps",
	},
	/**
	 * The artists' work photos (TAT-116) and the gallery of them (TAT-126).
	 * Templates hold {name}, {n} and {count}.
	 */
	work: {
		title: "Work",
		seeWork: "See work by {name}",
		fallbackAlt: "Tattoo by {name}, photo {n} of {count}",
		photoOf: "Photo {n} of {count}",
		close: "Close",
		/** The home page's section of the newest photos. */
		recentTitle: "Recent work",
		/** The link to the All work page (the home page's Recent work). */
		allWork: "All work",
		/** The All work page's heading. */
		pageTitle: "All work",
		showMore: "Show more",
		loadingMore: "Loading…",
		moreFailed: "Couldn't load more photos. Try again.",
		/** From a later page back to the first. */
		newest: "Back to the newest",
		empty: "No photos yet.",
		noMatch: "No photos match these filters.",
		showAll: "Show all work",
		noHealed: "No healed photos yet.",
		/** The mark in the viewer, and the artist page's second filter. */
		healed: "Healed",
		/** The artist page's All / Healed links, named for screen readers. */
		filterNav: "Which photos",
		all: "All",
		/** A gallery photo's alt when the studio wrote none; the second has no usable artist. */
		galleryAlt: "Tattoo by {name}, photo {n}",
		galleryAltNoName: "Tattoo, photo {n}",
		/** The gallery viewer's label (no total: more may be on the way). */
		photoN: "Photo {n}",
		/** The All work page's form. */
		filters: {
			label: "Filter the photos",
			artist: "Artist",
			anyArtist: "All artists",
			style: "Style",
			anyStyle: "All styles",
			healedOnly: "Healed only",
			apply: "Show photos",
		},
	},
	/**
	 * The request page, its buttons and the invitation to it (TAT-127).
	 * Templates hold {name}, {studio} and {who}.
	 */
	request: {
		/** The header's button, and on an artist's page the one that names them. */
		bar: "Request",
		barArtist: "Request {name}",
		artistButton: "Request a tattoo from {name}",
		inviteTitle: "Got an idea?",
		inviteLine:
			"Tell {studio} what you'd like and where it goes. Add photos if you have them.",
		/**
		 * The request page's title and description while it declines (the page
		 * says "Inquiries" and that nobody is taking new ones, so its tab, search
		 * snippet and share card must not invite). {who} is the artist's name when
		 * one is picked, else the studio's.
		 */
		closedTitle: "Inquiries at {studio}",
		closedTitleArtist: "Inquiries for {name} at {studio}",
		closedDescription: "{who} isn't taking new inquiries right now.",
	},
	/** The studio's flag in words; a closed artist's own message comes first. */
	status: {
		open: "Taking new work",
		closed: "Not taking new work right now",
	},
	/** The chat button (TAT-127). The message holds {subject}. */
	chat: {
		toggle: "Chat",
		label: "Chat with {studio}",
		whatsapp: "WhatsApp",
		viber: "Viber",
		message: "Hi, I'm asking about {subject}",
		anyTattoo: "a tattoo",
	},
	/** The artist page's two lists, named for screen readers (TAT-125). */
	artist: {
		styles: "Styles",
		links: "Links",
	},
	booking: {
		title: "How booking works",
		steps: [
			{
				title: "Send your idea",
				detail:
					"Say what you'd like and where it goes. Add photos if you have them.",
			},
			{
				title: "Get a price on WhatsApp",
				detail:
					"{studio} replies there, or on Viber, with a price and some dates.",
			},
			{
				title: "A deposit holds your date",
				detail:
					"{studio} sends a link with the amount and how to pay. You pay them directly; Tattoo Drip never handles your money.",
			},
			{
				title: "Your session",
				detail: "Come to {studio} on the day you agreed.",
			},
		] as readonly Step[],
		chat: "Prefer to chat?",
		chatLinks: {
			whatsapp: "Message on WhatsApp",
			email: "Send an email",
			instagram: "Message on Instagram",
		},
	},
} as const;
