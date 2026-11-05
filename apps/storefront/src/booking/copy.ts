/*
 * The booking flow's words (Prompt 6), in English, for every theme. Nothing
 * here claims a time, a price or a confirmation: the flow sends a request and
 * the studio answers it. Templates hold {studio}, {name}, {n}, {max}, {step}
 * and {count}, filled through <Fill> (each value in <bdi>).
 */
export const bookingCopy = {
	steps: {
		label: "Your request",
		/** The compact progress line on a phone. */
		count: "Step {step} of {count}",
		artist: "Artist",
		when: "Dates",
		tattoo: "Your tattoo",
		details: "Your details",
		review: "Review",
	},
	titles: {
		artist: "Choose your artist",
		when: "When would you like to come in?",
		tattoo: "Describe your tattoo",
		details: "Your details",
		review: "Review your request",
	},
	artist: {
		legend: "Who would you like to tattoo you?",
		hint: "Pick an artist, or let {studio} match you with the right one.",
		any: "No preference",
		anyHint: "{studio} matches you with an artist",
		portfolio: "Portfolio",
	},
	when: {
		hint: "Pick up to {max} days that would suit you. These are your preferences, not bookings: {studio} replies with a time that works.",
		previous: "Previous month",
		next: "Next month",
		weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
		chosen: "Chosen",
		closed: "{studio} is closed",
		full: "You've picked {max} days. Remove one to pick another.",
		none: "No days picked yet.",
		remove: "Remove {name}",
		flexible: "I'm flexible: any date that suits {studio}",
		timeOfDay: "What time of day suits you?",
	},
	tattoo: {
		style: "Style",
		styleHint: "If you know it. Leave it if you're not sure.",
		anyStyle: "Not sure",
		colour: "Colour",
		size: "Size",
		sizeHint: "A rough idea is enough.",
		sizeDetails: "Size in your own words",
		sizeDetailsHint:
			"Optional: centimetres or inches, or how big it should look.",
		notes: "Anything else",
		notesHint:
			"Optional: a cover-up, a scar, allergies, or something you'd like to ask.",
	},
	review: {
		edit: "Edit",
		editStep: "Edit {name}",
		artist: "Artist",
		anyArtist: "No preference",
		dates: "Preferred dates",
		idea: "Your idea, as {studio} will read it",
		placement: "Placement",
		size: "Size",
		budget: "Budget",
		photos: "Reference photos",
		noPhotos: "None",
		contact: "Contact",
		heard: "Found {studio} through",
		inspired: "Inspired by",
		notice:
			"Your request will be reviewed by the studio. Your appointment is not confirmed until the studio approves it.",
		submit: "Request your session",
		sending: "Sending…",
	},
	summary: {
		title: "Your request",
		show: "Show your request",
		artist: "Artist",
		dates: "Dates",
		tattoo: "Tattoo",
		photos: "{n} reference photos",
		onePhoto: "1 reference photo",
		empty: "Not chosen yet",
		provisional: "Preferences only: {studio} confirms a time.",
	},
	nav: {
		back: "Back",
		next: "Continue",
	},
	sent: {
		title: "Your story starts here.",
		body: "Your session request has been received. {studio} will review your details and contact you about the next steps.",
		reply: "They'll reply on WhatsApp or Viber at {phone}.",
		artist: "Artist",
		dates: "Preferred dates",
		pending: "Not confirmed yet: {studio} replies with a time.",
		artists: "View the artists",
		home: "Back to the studio page",
	},
	/** An "inspired by" piece in the summary and the review. */
	artwork: "Inspired by {name}",
} as const;
