/**
 * Atelier's own words, in a catalogue's voice: labels and editorial lines only, never a claim about a
 * studio. Everything about the studio itself comes from its data. Templates
 * hold {name}, {studio} and {count}.
 */
export const atelierCopy = {
	home: {
		/** The hero's second link, to the whole gallery. */
		viewGallery: "View the collection",
		/** The label over a hero photo that is a piece of work, not the cover. */
		heroPiece: "From the collection",
		selectedWork: "The collection",
		allWork: "View the full collection",
		noWork: "No pieces to show here yet.",
		artists: "The artists",
		artistsLone: "The artist",
		about: "The atelier",
	},
	artists: {
		label: "The atelier",
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
		portfolio: "The collection",
		about: "About",
		styles: "Styles",
		/** A closed artist's page, while the studio still takes requests. */
		closedInvite:
			"{name} isn't taking new work right now. A request from here goes to {studio}.",
		previous: "Previous artist",
		next: "Next artist",
		noWork: "No portfolio photos to show yet.",
		healed: "Healed",
	},
	gallery: {
		/** A piece's catalogue number: "No. 01". */
		number: "No. {n}",
		label: "The atelier",
		title: "The collection",
		line: "Each piece numbered and shown whole, as it was photographed.",
		empty: "No photos to show yet.",
		filtered: "No pieces match these filters.",
		showAll: "Show the whole collection",
		healed: "Healed",
		filters: "Filter the gallery",
		style: "Style",
		artist: "Artist",
		allStyles: "All styles",
		allArtists: "All artists",
		ask: "Each piece begins with a conversation. Tell the atelier what you have in mind.",
	},
	artwork: {
		back: "Back to the collection",
		artist: "Artist",
		style: "Style",
		state: "Photographed",
		healed: "Healed",
		about: "About the artist",
		portfolio: "View portfolio",
		inspired: "Inspired by this piece?",
		inspiredLine:
			"Tell the artist what you have in mind. A request starts a conversation, not a copy.",
		similar: "Request a similar tattoo",
		related: "From the same collection",
	},
	book: {
		label: "By appointment",
		open: "Request an appointment",
		openLine:
			"Describe your idea, where it goes and how large. The artist will reply with the next steps.",
		closed: "Requests",
	},
} as const;
