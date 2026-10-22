import type { SourceChannel } from "@tattoo-drip/sdk";
import type { IntakeField } from "./rules.ts";

/*
 * Every word the intake form shows (TAT-57), in English. Templates hold
 * named placeholders ({studio}, {phone}…) that `fill` replaces; components
 * render the values in <bdi> through <Fill> (components/fill.tsx), because
 * names may be Nepali or right-to-left. A Nepali version would be a second
 * object of the same shape: nothing else would change.
 */

/** The refusals the form explains with a notice (problems.ts). */
export const NOTICE_CODES = [
	"already-waiting",
	"studio-closed",
	"challenge-failed",
	"challenge-unavailable",
	"challenge-blocked",
	"challenge-expired",
	"challenge-unsupported",
	"rate-limited",
	"too-large",
	"cut-off",
	"page-outdated",
	"timeout",
	"offline",
	"invalid",
	"server",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

/** Why a picked photo wasn't added (images.ts). */
export const PHOTO_PROBLEMS = [
	"unsupported",
	"heic",
	"too-big",
	"unreadable",
	"too-heavy",
] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];

export interface Notice {
	readonly title: string;
	readonly body: string;
}

export interface FieldCopy {
	readonly label: string;
	readonly hint?: string;
}

const fields: Readonly<Record<IntakeField, FieldCopy>> = {
	idea: {
		label: "Your idea",
		hint: "What you'd like, its style, and anything that matters to you.",
	},
	placement: { label: "Where on your body", hint: "For example, left forearm" },
	approximateSize: {
		label: "Rough size",
		hint: "For example, about 10 cm, or palm-sized",
	},
	preferredDates: {
		label: "When would suit you",
		hint: "For example, any weekday in November",
	},
	preferredArtistId: { label: "Artist" },
	budget: { label: "Budget (optional)", hint: "For example, NPR 15,000" },
	sourceChannel: { label: "How did you find {studio}?" },
	contactName: { label: "Your name" },
	contactPhone: {
		label: "WhatsApp or Viber number",
		hint: "{studio} replies here. A Nepali number needs no +977.",
	},
	contactEmail: { label: "Email (optional)" },
};

/** What a required field says when it is left empty. */
const required: Readonly<Partial<Record<IntakeField, string>>> = {
	idea: "Describe the tattoo you'd like.",
	placement: "Say where on your body it goes.",
	approximateSize: "Give a rough size.",
	preferredDates: "Say when would suit you.",
	sourceChannel: "Choose how you found {studio}.",
	contactName: "Enter your name.",
	contactPhone: "Enter your WhatsApp or Viber number.",
};

const channels: Readonly<Record<SourceChannel, string>> = {
	instagram: "Instagram",
	facebook: "Facebook",
	tiktok: "TikTok",
	google: "Google",
	friend: "A friend",
	other: "Somewhere else",
};

const photoProblems: Readonly<Record<PhotoProblem, string>> = {
	unsupported:
		"{name} isn't a photo this form can use. Add a JPEG, PNG or WebP image.",
	heic: "{name} is a HEIC photo, which this browser can't convert. Add a screenshot of it or a JPEG copy instead.",
	"too-big":
		"{name} is too big to prepare. Add a smaller copy or a screenshot.",
	unreadable:
		"{name} couldn't be opened. Try another photo, or a screenshot of it.",
	"too-heavy":
		"{name} couldn't be made small enough to send. Try a screenshot of it instead.",
};

const notices: Readonly<Record<NoticeCode, Notice>> = {
	"already-waiting": {
		title: "You already have inquiries waiting",
		body: "{studio} has your earlier inquiries and will reply on WhatsApp or Viber. To add something, message them.",
	},
	"studio-closed": {
		title: "{studio} isn't taking new inquiries right now",
		body: "They closed their inquiries while you were writing. You can still message them.",
	},
	"challenge-failed": {
		title: "We couldn't confirm you're a person",
		body: "Send again. If it keeps happening, message {studio} instead.",
	},
	"challenge-unavailable": {
		title: "The security check isn't working right now",
		body: "Send again in a minute, or message {studio} instead.",
	},
	"challenge-blocked": {
		title: "The security check didn't finish",
		body: "An ad blocker or a weak connection may be stopping it. Send again, or message {studio} instead.",
	},
	"challenge-expired": {
		title: "The security check timed out",
		body: "Send again, and tick the box when it appears.",
	},
	"challenge-unsupported": {
		title: "This browser can't run the security check",
		body: "Try another browser, or message {studio} instead.",
	},
	"rate-limited": {
		title: "Too many tries",
		body: "Wait {wait} before sending again, or message {studio} instead.",
	},
	"too-large": {
		title: "Your photos are too large to send together",
		body: "Remove a photo or two, then send again.",
	},
	"cut-off": {
		title: "The upload was cut off",
		body: "Check your connection, then send again. Everything you entered is still here.",
	},
	"page-outdated": {
		title: "This page is out of date",
		body: "Reload it to send your inquiry. Copy your idea first: reloading clears the form.",
	},
	timeout: {
		title: "Sending took too long",
		body: "Your connection may be slow. Everything you entered is still here: send again, perhaps with fewer photos or on Wi-Fi. If {studio} got it already, they'll reply on WhatsApp or Viber.",
	},
	offline: {
		title: "Your inquiry wasn't sent",
		body: "We couldn't reach Tattoo Drip. Check your connection, then send again. Everything you entered is still here.",
	},
	invalid: {
		title: "Some answers weren't accepted",
		body: "Check the form, then send again.",
	},
	server: {
		title: "Something went wrong on our side",
		body: "Send again in a minute. If it keeps happening, message {studio} instead.",
	},
};

export const copy = {
	required: "Everything is needed unless it says (optional).",
	/** The one line above the form (TAT-105): what a nervous client wants to know first. */
	reassurance: "Only {studio} sees what you send.",
	/** The small print under Send (TAT-105): who runs the page, and the bot check. */
	privacy:
		"Tattoo Drip runs this page for {studio}. To keep spam bots out, this form uses a Cloudflare check that runs in your browser. Cloudflare sees your connection and device, not your answers.",
	privacyLink: "Cloudflare's privacy notice",
	tattooLegend: "Your tattoo",
	contactLegend: "How {studio} reaches you",
	fields,
	noPreference: "No preference",
	channels,
	photos: {
		legend: "Reference photos (optional)",
		hint: "Up to {max} photos: designs you like, or the spot on your body. Only {studio} sees them.",
		add: "Add photos",
		count: "{count} of {max} photos, {size} in total",
		full: "That's {max} photos, the most you can send. Remove one to add another.",
		alt: "Reference photo {index}",
		remove: "Remove reference photo {index}",
		preparing: "Preparing…",
		tooManyOne: "You can send up to {max} photos, so one wasn't added.",
		tooMany: "You can send up to {max} photos, so {count} weren't added.",
		problems: photoProblems,
		refused:
			"This photo wasn't accepted: {message} Remove it, then send again.",
		itemError: "Reference photo {index}: {message}",
		fixPhotos: "Remove the photo marked with a problem.",
		stopped:
			"A photo couldn't be prepared, so your inquiry wasn't sent yet. Read the message under the photos, then send again.",
	},
	honeypot: "Leave this empty",
	send: "Send inquiry",
	sending: "Sending…",
	sendAgain: "Send again",
	reload: "Reload the page",
	chat: "Prefer to chat?",
	chatLinks: {
		whatsapp: "Message on WhatsApp",
		email: "Send an email",
		instagram: "Message on Instagram",
	},
	status: {
		preparing: "Preparing your photos…",
		checking: "Running a quick security check…",
		interactive: "Tick the box above to send.",
		sending: "Sending your inquiry…",
		sendingPhotos: "Sending your inquiry with {photos} ({size})…",
		stillSending:
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		photoOne: "1 photo",
		photoMany: "{count} photos",
	},
	errors: {
		required,
		tooLong: "Use at most {max} characters.",
		nul: "Remove the unsupported characters.",
		phone: "Enter a phone number, like 9812345678 or +977 1 4123456.",
		email: "Enter a valid email address, or leave it empty.",
		artist: "Choose an artist from the list, or No preference.",
		artistClosed:
			"{artist} just stopped taking new inquiries. Choose another artist, or No preference.",
		artistClosedUnnamed:
			"That artist just stopped taking new inquiries. Choose another artist, or No preference.",
		summaryOne: "Check this answer before sending",
		summaryMany: "Check these {count} answers before sending",
	},
	notices,
	wait: {
		minute: "a minute",
		minutes: "{count} minutes",
		hour: "an hour",
		hours: "{count} hours",
	},
	sent: {
		title: "Inquiry sent",
		body: "{studio} will reply on WhatsApp or Viber at {phone}.",
		more: "Want to add something? Message them:",
		back: "Back to the studio page",
	},
};

export { fill, fillParts, type Part } from "./template.ts";
