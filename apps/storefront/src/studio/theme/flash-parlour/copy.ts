/**
 * Flash Parlour's own words, in a walk-in shop's plain voice: labels and
 * lines only, never a claim about a studio. Everything about the studio
 * itself comes from its data. Templates hold {name}, {studio} and {count}.
 */
export const flashParlourCopy = {
	wall: {
		/** The home page's opening: the studio's available flash. */
		title: "Flash on the wall",
		line: "Pick a design off the wall and ask for it.",
		all: "See all the flash",
		/** A design whose price the studio keeps to itself. */
		askPrice: "Ask for a price",
		request: "Request this design",
		/** After "Request this design", for a screen reader: which one. */
		requestOf: ": {name}",
	},
	home: {
		/** The second way on from the first screen: the gallery. */
		viewGallery: "See the work",
		/** Over a first-screen photo that is a piece of work, not the cover. */
		heroPiece: "Fresh from the shop",
		work: "Fresh from the shop",
		allWork: "See all the work",
		noWork: "No photos of work to show here yet.",
		artists: "The artists",
		artistsLone: "The artist",
		about: "About the shop",
	},
	flash: {
		label: "Walk in or book ahead",
		title: "Flash",
		line: "Every design here is ready to tattoo. Ask for one and the artist will reply.",
		/** The design's own page. */
		back: "Back to the flash",
		kicker: "Flash",
		ask: "Don't see the one? Bring your own idea.",
	},
	artists: {
		label: "Who's tattooing",
		title: "The artists",
		lineOne: "One artist, one chair.",
		lineMany: "{count} artists, each with their own flash and work.",
		filter: "Filter by style",
		allStyles: "All styles",
		noMatch: "No artist lists this style.",
		showAll: "Show every artist",
	},
	artist: {
		back: "All artists",
		about: "About",
		work: "Work",
		styles: "Styles",
		/** A closed artist's page, while the studio still takes requests. */
		closedInvite:
			"{name} isn't taking new work right now. A request from here goes to {studio}.",
		previous: "Previous artist",
		next: "Next artist",
		noWork: "No photos of work to show yet.",
		healed: "Healed",
	},
	gallery: {
		label: "Tattooed here",
		title: "The work",
		line: "Every tattoo shown whole, as it was photographed.",
		empty: "No photos to show yet.",
		filtered: "No tattoos match these filters.",
		showAll: "Show all the work",
		healed: "Healed",
		filters: "Filter the work",
		style: "Style",
		artist: "Artist",
		allStyles: "All styles",
		allArtists: "All artists",
		ask: "Seen something you like? Ask for your own take on it.",
	},
	artwork: {
		back: "Back to the work",
		artist: "Artist",
		style: "Style",
		state: "Photographed",
		healed: "Healed",
		about: "About the artist",
		portfolio: "See their work",
		inspired: "Want one like it?",
		inspiredLine:
			"Tell the artist what you have in mind. A request starts a conversation, not a copy.",
		similar: "Request a similar tattoo",
		related: "More from the shop",
	},
	book: {
		label: "Booking",
		open: "Request a session",
		openLine:
			"Pick a design off the wall or bring your own idea. The artist will reply with the next steps.",
		closed: "Requests",
	},
} as const;
