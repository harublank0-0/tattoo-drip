/*
 * The words of Ink Noir's artists directory, in English. Editorial lines
 * only: nothing here claims anything about a studio or an artist; names,
 * styles, bios and counts come from the data. Templates hold {style}, {shown},
 * {total} and {name}, which components put in <bdi> through <Fill>.
 */
export const inkNoirArtistsCopy = {
	hero: {
		label: { many: "The artists", one: "The artist" },
		lines: {
			many: ["The hands", "behind the art."],
			one: ["The hand", "behind the art."],
		},
		description: {
			many: "Meet the artists who turn ideas, stories and inspiration into permanent work.",
			one: "Meet the artist who turns ideas, stories and inspiration into permanent work.",
		},
	},
	filters: {
		/** The filter bar's name for screen readers. */
		label: "Filter artists by style",
		all: "All",
		/** The status line under the bar: what the filter shows. */
		showingAll: "{total} artists",
		showingStyle: "{style}: {shown} of {total} artists",
		/** A style nobody lists (an old link): the count without a name. */
		showingCount: "{shown} of {total} artists",
	},
	card: {
		portfolio: "View portfolio",
	},
	empty: {
		title: "No artists to show here yet.",
		line: "When the studio adds its artists, they appear here.",
	},
	noMatch: {
		named: "No artists list {style} right now.",
		unknown: "No artists list this style.",
		reset: "Show all artists",
	},
	cta: {
		lines: ["Found your", "artist?"],
		line: "Your next piece begins with a conversation.",
	},
} as const;
