/*
 * The words of Ink Noir's gallery and tattoo pages, in English. Editorial
 * lines only: nothing here claims anything about a studio, an artist or a
 * piece; titles, names, styles and counts come from the data. Templates hold
 * {n}, {m}, {q}, {name} and {who}, which components put in <bdi> through
 * <Fill>.
 */
export const inkNoirGalleryCopy = {
	intro: {
		label: "The collection",
		lines: ["Art that", "lives with you."],
		/** {who}: the studio's artists, or the artist working alone. */
		description: "The newest work of {who}, from first line to healed skin.",
		studioArtists: "the artists of {name}",
	},
	filters: {
		/** The style bar's name for screen readers. */
		label: "Filter the collection by style",
		all: "All work",
		artist: "Artist",
		anyArtist: "All artists",
		healed: "Healed only",
		clear: "Clear filters",
	},
	search: {
		label: "Search the collection",
		field: "Search",
		placeholder: "Description, style or artist",
		submit: "Search",
		clear: "Clear search",
	},
	/** The line over the pieces (`role="status"`): what is showing. */
	status: {
		all: "{n} pieces",
		one: "1 piece",
		newest: "The newest {n} pieces",
		matches: "{m} of the {n} pieces shown match “{q}”",
		/** More pages remain: the search only looked at those shown. */
		more: "Show more to search further.",
	},
	empty: {
		title: "The collection is empty for now.",
		line: "When the studio adds photos of its work, they appear here.",
		filtered: "No pieces match these filters.",
		searched: "Nothing among the pieces shown matches “{q}”.",
		showAll: "Show all work",
	},
	card: { healed: "Healed" },
	close: {
		lines: ["Found a piece", "you love?"],
		line: "Every tattoo starts with a conversation.",
	},
	piece: {
		breadcrumb: "Breadcrumb",
		gallery: "Gallery",
		tattoo: "Tattoo",
		meta: {
			artist: "Artist",
			styles: "Style",
			healed: "Healed",
			healedValue: "Photographed healed",
			studio: "Studio",
		},
		independent: "Independent artist",
		similar: "Request a similar tattoo",
		viewArtist: "View the artist",
		artist: {
			label: "The artist",
			portfolio: "View portfolio",
			request: "Request a session",
			/** The artist's portrait, when their own words are missing. */
			portraitAlt: "{name}",
		},
		booking: {
			lines: ["Inspired by", "this piece?"],
			line: "Every tattoo is drawn for the person who wears it. Share this piece as a starting point for your own.",
			/** Nobody takes new work: no button, and no promise. */
			closed: "{name} isn't taking new work right now.",
		},
		related: {
			label: "Keep exploring",
			title: "More from the collection",
			all: "View all work",
		},
	},
} as const;
