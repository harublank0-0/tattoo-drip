/*
 * The words of Ink Noir's artist page, in English. Editorial lines only:
 * nothing here claims experience, awards or credentials; the artist's name,
 * bio, styles, links and whether they take new work come from the data.
 * Templates hold {name}, {studio} and {style}, which components put in <bdi>
 * through <Fill>.
 */
export const inkNoirArtistCopy = {
	hero: {
		/** The breadcrumb's name for screen readers, and its first step. */
		breadcrumb: "Breadcrumb",
		artists: "Artists",
		/** When the artist lists no style. */
		specialtyFallback: "Tattoo artist",
		/** The Studio fact of an artist who works on their own. */
		independent: "Independent",
		book: "Book a session",
		explore: "Explore the work",
		meta: {
			studio: "Studio",
			based: "Based in",
			bookings: "Bookings",
		},
		links: "{name} elsewhere",
	},
	about: {
		label: "About",
		title: "About the artist",
	},
	portfolio: {
		label: "Portfolio",
		title: "The work",
		allWork: "See it in the full gallery",
		/** Also what a failed portfolio read shows: it claims nothing. */
		empty: "No photos to show here yet.",
		follow: "See the latest on Instagram",
	},
	specialties: {
		label: "Specialties",
		title: "Styles",
		/** Each style's link to the gallery filtered by it and this artist. */
		seeWork: "See {style} work by {name}",
	},
	booking: {
		label: "Book",
		lines: ["Start your", "next piece."],
		line: "Tell {name} what you'd like and where it goes. Add photos if you have them.",
		open: "{name} is taking new work.",
		closed: "{name} isn't taking new work right now.",
		/** The artist is closed but the studio takes general inquiries. */
		studioOpen: "You can still send {studio} a general inquiry.",
	},
	neighbours: {
		label: "More artists",
		previous: "Previous artist",
		next: "Next artist",
		all: "All artists",
	},
} as const;
