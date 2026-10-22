import type { DepositPaymentMethod } from "@tattoo-drip/sdk";
import type { PhotoProblem } from "../intake/copy.ts";
import { headCopy } from "./head-copy.ts";

/*
 * Every word the deposit page shows (TAT-65b), in English. Templates hold
 * named placeholders ({studio}, {date}…) that `fill` (src/intake/copy.ts)
 * replaces; components put the values in <bdi> through <Fill>, because names
 * may be Nepali or right-to-left. The sentences the TAT-65 spec fixed are
 * kept word for word. A Nepali version would be a second object of this
 * shape: nothing else would change.
 */

export type DepositMethodKind = DepositPaymentMethod["kind"];

/** The refusals after Send that a notice explains (problems.ts). */
export const PROOF_NOTICE_CODES = [
	"changed",
	"not-due",
	"gone",
	"rate-limited",
	"cut-off",
	"offline",
	"busy",
	"invalid",
	"server",
] as const;
export type ProofNoticeCode = (typeof PROOF_NOTICE_CODES)[number];

export interface NoticeText {
	readonly title: string;
	readonly body?: string;
}

const kinds: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
	bank: "Bank transfer",
};

const scan: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Scan it with your bank or wallet app (Fonepay).",
	esewa: "Scan it with your eSewa app.",
	khalti: "Scan it with your Khalti app.",
	bank: "Scan it with your banking app.",
};

/** What the number a client pays to is called (the platform keeps wallet IDs there too). */
const accountNumber: Readonly<Record<DepositMethodKind, string>> = {
	fonepay: "Number",
	esewa: "eSewa ID",
	khalti: "Khalti ID",
	bank: "Account number",
};

const problems: Readonly<Record<PhotoProblem, string>> = {
	unsupported:
		"{name} isn't an image this page can use. Add a JPEG, PNG or WebP screenshot.",
	heic: "{name} is a HEIC photo, which this browser can't open. Take a screenshot of the payment instead.",
	"too-big":
		"{name} is too big to prepare. Take a screenshot of the payment instead.",
	unreadable:
		"{name} couldn't be opened. Try another image, or a screenshot of the payment.",
	"too-heavy":
		"{name} couldn't be made small enough to send. Take a screenshot of the payment instead.",
};

const notices: Readonly<Record<ProofNoticeCode, NoticeText>> = {
	changed: {
		title: "The deposit amount changed. Check the new amount.",
		body: "If you already paid the old amount, message {studio} before you send a screenshot.",
	},
	"not-due": {
		title: "This page changed while you were on it.",
		body: "Check what it says now. If it still asks for a screenshot, send it again.",
	},
	gone: {
		title: "This link doesn't work any more.",
		body: "Ask the studio to send you a new one.",
	},
	"rate-limited": { title: "Too many tries. Wait {wait} and try again." },
	"cut-off": {
		title: "The upload was cut off.",
		body: "Check your connection, then send again.",
	},
	offline: { title: "Couldn't send. Check your connection and try again." },
	busy: {
		title: "The page is busy right now.",
		body: "Send again in a minute.",
	},
	invalid: {
		title: "Your screenshot wasn't accepted.",
		body: "Reload the page, then send it again.",
	},
	server: {
		title: "Something went wrong on our side.",
		body: "Send again in a minute. If it keeps happening, message {studio}.",
	},
};

export const copy = {
	// title, titleWithStudio, description, descriptionWithStudio: head-copy.ts
	...headCopy,
	heading: "Pay your deposit to {studio}",
	/** The h1 once the deposit has left `due` (TAT-106), or when it can't be read; each says what its message says. */
	headings: {
		submitted: "Screenshot sent",
		paid: "Deposit paid",
		paidNone: "No deposit needed",
		updating: "Your quote is being updated",
		expired: "This quote has expired",
		cancelled: "This booking was cancelled",
		/** The h1 over a load problem (TAT-119); each says what its message under it says. */
		load: {
			dead: "This link doesn't work",
			"rate-limited": "Too many tries",
			failed: "We couldn't load your deposit",
		},
	},
	withArtist: "with {artist}",
	briefSummary: "Your tattoo idea",
	loading: "Loading your deposit…",
	noScript: "Turn on JavaScript to see your deposit, or message {studio}.",
	due: {
		title: "Deposit due",
		/** Under the amount: who gets the money (TAT-110; was the footer's sentence). */
		direct: "You pay {studio} directly. Tattoo Drip never handles your money.",
		partial: "Part of your {amount} deposit was already received.",
		payBy: "Pay by {date}.",
		payByToday: "Pay by today, {date}.",
		payByTomorrow: "Pay by tomorrow, {date}.",
		payByDays: "Pay by {date}, in {count} days.",
	},
	code: {
		title: "Reference code",
		hint: "Write this code in the payment remark (or note).",
		copy: "Copy code",
		copyLabel: "Copy code {code}",
	},
	/** The numbered steps' headings (TAT-110); step 3's is form.title. */
	steps: { label: "Step {count}: ", code: "Copy the code", pay: "Pay" },
	payWith: { legend: "Pay with", only: "Pay with {label}" },
	/** The sticky button that takes the client to step 3. */
	paidButton: "I've paid: send the screenshot",
	methods: {
		title: "How to pay",
		samePhone:
			"On this phone? Press and hold the QR code to save it, then choose it in your payment app's scanner.",
		/** A method whose QR didn't pass the image check and that has no number. */
		missing: "Ask {studio} for these details.",
		qrAlt: "{label} QR code for {studio}",
		scan,
		accountNumber,
		accountName: "Account name",
		bankName: "Bank",
		copy: "Copy",
		copyLabel: "Copy {number}",
		none: "The studio hasn't added payment details yet. Message them to ask how to pay.",
	},
	policyTitle: "Deposit policy",
	rejected:
		"The studio couldn't confirm your last screenshot. Check the amount and the reference code, then send a new one, or message the studio.",
	form: {
		title: "Send the screenshot",
		method: "How did you pay?",
		kinds,
		proof: "Payment screenshot",
		proofHint: "A screenshot or a photo of the payment: JPEG, PNG or WebP.",
		add: "Add screenshot",
		replace: "Choose another",
		remove: "Remove screenshot",
		previewAlt: "Your payment screenshot",
		preparing: "Preparing your screenshot…",
		ready: "Screenshot added.",
		problems,
		send: "Send screenshot",
		sending: "Sending…",
		sendingStatus: "Sending your screenshot…",
		stillSending:
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		required: {
			method: "Choose how you paid.",
			proof: "Add a screenshot of your payment.",
		},
		tooLarge: "This image is too large. Use one of 10 MB or less.",
		summaryOne: "Check this before sending",
		summaryMany: "Check these {count} things before sending",
		summaryLabels: { method: "How you paid", proof: "Payment screenshot" },
	},
	notices,
	wait: {
		minute: "a minute",
		minutes: "{count} minutes",
		hour: "an hour",
		hours: "{count} hours",
	},
	states: {
		submitted:
			"We've sent your screenshot to {studio}, received {date}. They'll check it and confirm on WhatsApp or Viber.",
		submittedUndated:
			"We've sent your screenshot to {studio}. They'll check it and confirm on WhatsApp or Viber.",
		amount: "Amount",
		/** The paid receipt's next session (TAT-110). */
		session: "Your session",
		artist: "Artist",
		paid: "Your deposit is paid. Thank you!",
		paidNone: "No deposit is needed for this booking.",
		updating:
			"{studio} is updating your quote. They'll message you when it's ready.",
		expired:
			"This quote has expired. Message {studio} if you still want to book.",
		cancelled:
			"This booking was cancelled. Message {studio} if you think this is a mistake.",
	},
	load: {
		dead: "This link doesn't work any more. Ask the studio to send you a new one.",
		"rate-limited": "Too many tries. Wait a few minutes, then reload the page.",
		failed: "We couldn't load your deposit. Check your connection.",
		retry: "Try again",
		retrying: "Trying again…",
	},
	copied: "Copied",
	copyFailed: "Couldn't copy. Press and hold the text to copy it.",
	contact: "Questions? Message {studio}:",
	whatsapp: "WhatsApp",
	viber: "Viber",
	whatsappText: "Hi {studio}, about my deposit (reference code {code}).",
	whatsappTextNoCode: "Hi {studio}, about my deposit.",
	footer: "Tattoo Drip runs this page for {studio}.",
};
