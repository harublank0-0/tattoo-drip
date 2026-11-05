/*
 * The words of Ink Noir's home page, in English. Editorial lines only: none
 * of them claims anything about a studio (no awards, years, counts or
 * credentials); everything about the studio itself comes from its data.
 * Templates hold {studio}, {name} or {style}, which components put in <bdi>
 * through <Fill>. The shared words (Request a session, the booking steps, Good
 * to know's labels) stay in src/studio/copy.ts.
 */
export const inkNoirHomeCopy = {
	hero: {
		/** The headline under the studio's name, one line each. */
		lines: ["Art is", "permanent."],
		support: {
			studio: "Your story. Our canvas.",
			independent: "Your story. My canvas.",
		},
		explore: "Explore the work",
		/** The scroll cue: a link to the introduction ("Scroll to the studio"). */
		scroll: "Scroll",
		scrollRest: " to the introduction",
		meta: {
			label: "About the studio",
			based: "Based in",
			today: "Today",
			bookings: "Bookings",
			artists: "Artists",
		},
	},
	intro: {
		eyebrow: { studio: "The studio", independent: "The artist" },
		title: "Every tattoo begins with a story worth telling.",
		facts: {
			based: "Based in",
			artists: "Artists",
		},
		planVisit: "Plan your visit",
		meetArtists: "Meet the artists",
		meetArtist: "Meet the artist",
	},
	work: {
		eyebrow: "Portfolio",
		title: "Selected work",
		all: "View full gallery",
		/** Also what a failed gallery read shows, so it claims nothing about the studio. */
		emptyTitle: "No photos to show here yet.",
		follow: "See the latest on Instagram",
	},
	artists: {
		eyebrow: { many: "The artists", one: "The artist" },
		title: { many: "Meet the artists", one: "Meet the artist" },
		portfolio: "View portfolio",
		request: "Request {name}",
	},
	styles: {
		eyebrow: "Specialties",
		title: "Tattoo styles",
		/** Before the artists who list a style. */
		by: "By",
		/** A style's link to the filtered gallery, named for screen readers. */
		seeWork: "See {style} work",
	},
	experience: {
		eyebrow: "The experience",
		title: "Your visit",
		find: "Find us",
		directions: "Get directions",
	},
	cta: {
		eyebrow: "Start here",
		lines: ["Your next story", "starts here."],
		line: "Have an idea? Let's bring it to life.",
		closedEyebrow: "Inquiries",
		/** The studio's own switch is off; an artist may still take requests (the artists section says so). */
		closedLines: ["Not taking", "new inquiries."],
		exploreArtists: "Explore the artists",
		exploreWork: "Explore the work",
	},
} as const;
