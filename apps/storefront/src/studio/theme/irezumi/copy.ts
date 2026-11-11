/**
 * Irezumi's own words: labels and editorial lines only, never a claim about a
 * studio. Everything about the studio itself comes from its data. Templates
 * hold {name}, {studio} and {count}.
 */
export const irezumiCopy = {
	home: {
		/** The hero's second link, to the whole gallery. */
		viewGallery: "View the gallery",
		/** The label over a hero photo that is a piece of work, not the cover. */
		heroPiece: "Featured piece",
		selectedWork: "Selected work",
		selectedWorkLine: "Pieces from the studio's newest work.",
		allWork: "See the whole gallery",
		noWork: "Work will appear here as soon as the studio adds photos.",
		artists: "Artists",
		artistsLone: "The artist",
		meet: "View portfolio",
		about: "The studio",
		closedLine: "Not taking new requests right now.",
	},
	artists: {
		label: "Artists",
		title: "The artists",
		lineOne: "One artist, one portfolio.",
		lineMany: "{count} artists, each with their own portfolio.",
		filter: "Filter by style",
		allStyles: "All styles",
		noMatch: "No artist lists this style.",
		showAll: "Show every artist",
		portfolio: "View portfolio",
		pieces: "{count} recent pieces",
	},
	artist: {
		back: "All artists",
		signature: "Signature piece",
		portfolio: "Portfolio",
		about: "About",
		styles: "Styles",
		book: "Book a session",
		previous: "Previous artist",
		next: "Next artist",
		noWork: "No portfolio photos to show yet.",
		healed: "Healed",
		all: "All",
	},
	gallery: {
		label: "Gallery",
		title: "The gallery",
		line: "Every piece shown whole, as it was photographed.",
		empty: "No photos to show yet.",
		filtered: "No pieces match these filters.",
		showAll: "Show every piece",
		healed: "Healed",
		filters: "Filter the gallery",
		style: "Style",
		artist: "Artist",
		allStyles: "All styles",
		allArtists: "All artists",
		ask: "Ask about a piece like these",
	},
	artwork: {
		back: "Back to the gallery",
		artist: "Artist",
		style: "Style",
		state: "Photographed",
		healed: "Healed",
		fresh: "Fresh",
		about: "About the artist",
		portfolio: "View portfolio",
		inspired: "Inspired by this piece?",
		inspiredLine:
			"Tell the artist what you have in mind. A request starts a conversation, not a copy.",
		similar: "Request a similar tattoo",
		related: "More work",
	},
	book: {
		label: "Booking",
		open: "Request a session",
		openLine:
			"Describe your idea, where it goes and how large. The artist will reply with the next steps.",
		closed: "Requests",
	},
	footer: {
		pages: "Pages",
		more: "More",
	},
} as const;
