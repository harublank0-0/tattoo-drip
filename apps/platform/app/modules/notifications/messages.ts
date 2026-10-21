/**
 * The messages staff send clients with one tap (TAT-52): the six kinds,
 * their placeholders, the default texts and the one renderer, plus how a
 * contact was made. No imports, so any module can use it: projects and
 * payments render their messages with it, and the dashboard restates
 * `renderMessage` for the settings page's live preview
 * (inertia/components/messages.ts; a unit test runs both on the same cases).
 */

/** The six messages, in the order a project meets them. */
export const MESSAGE_KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** What each message is called on the dashboard. */
export const MESSAGE_LABELS: Record<MessageKind, string> = {
	inquiry_received: "Inquiry received",
	quote: "Quote",
	deposit_link: "Deposit link",
	booking_confirmation: "Booking confirmation",
	session_reminder: "Session reminder",
	aftercare: "Aftercare",
};

/** Where the dashboard offers each message, as the settings page says it. */
export const MESSAGE_OFFERED: Record<MessageKind, string> = {
	inquiry_received: "Offered on a new inquiry, and on a project under review.",
	quote: "Offered under the quote while the client's answer is awaited.",
	deposit_link:
		"Offered with the deposit link, to owners, while the deposit is due.",
	booking_confirmation: "Offered on a project with a session coming up.",
	session_reminder: "Offered on a project with a session coming up.",
	aftercare: "Offered once a tattoo or touch-up session is done.",
};

/** Every placeholder a message can hold. */
export const PLACEHOLDERS = [
	"client_name",
	"studio_name",
	"artist_name",
	"price",
	"deposit_note",
	"valid_until",
	"amount",
	"reference_code",
	"deposit_link",
	"session_time",
	"studio_address",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** What each placeholder becomes, for the settings page. */
export const PLACEHOLDER_HELP: Record<Placeholder, string> = {
	client_name: "the client's first name",
	studio_name: "your studio's name",
	artist_name: "the artist's name",
	price: "the quoted price",
	deposit_note: "the deposit sentence, such as “Deposit: NPR 3,000.”",
	valid_until: "the quote's last day",
	amount: "the deposit still due",
	reference_code: "the code for the payment remark",
	deposit_link: "the deposit page link",
	session_time: "the session's day and time",
	studio_address:
		"your address from the studio profile (empty if you have none)",
};

/** The placeholders each message may use (spec ruling 16). */
export const KIND_PLACEHOLDERS: Record<MessageKind, readonly Placeholder[]> = {
	inquiry_received: ["client_name", "studio_name"],
	quote: ["client_name", "studio_name", "price", "deposit_note", "valid_until"],
	deposit_link: [
		"client_name",
		"studio_name",
		"amount",
		"reference_code",
		"deposit_link",
	],
	booking_confirmation: [
		"client_name",
		"studio_name",
		"artist_name",
		"session_time",
		"studio_address",
	],
	session_reminder: [
		"client_name",
		"studio_name",
		"artist_name",
		"session_time",
		"studio_address",
	],
	aftercare: ["client_name", "studio_name", "artist_name"],
};

/**
 * What a studio sends until it writes its own (Settings, Messages). The
 * quote and the deposit link are TAT-64's and TAT-65's messages word for
 * word: their tests pin that a studio which never edited them sends what it
 * sent before.
 */
export const DEFAULT_TEMPLATES: Record<MessageKind, string> = {
	inquiry_received:
		"Hi {client_name}, thank you for your tattoo inquiry to {studio_name}. We have your idea and will reply here soon.",
	quote:
		"Hi {client_name}, here is your quote from {studio_name}: {price}. {deposit_note} Valid until {valid_until}. Reply here to confirm.",
	deposit_link:
		"Hi {client_name}, please pay your deposit of {amount} to {studio_name}. Write {reference_code} in the payment remark, then send a screenshot of the payment on this page:\n{deposit_link}",
	booking_confirmation:
		"Hi {client_name}, your session at {studio_name} is booked for {session_time} with {artist_name}. Reply here if you need to change it.",
	session_reminder:
		"Hi {client_name}, a reminder of your session at {studio_name} on {session_time} with {artist_name}. See you soon!",
	aftercare:
		"Hi {client_name}, thank you for your tattoo at {studio_name}! For the next two weeks: wash it gently with clean water and mild soap and pat it dry, put on a thin layer of aftercare cream, don't scratch or pick it, and keep it out of the sun, pools and the sea. Message us here if anything worries you. In about four weeks, send us a photo of the healed tattoo here.",
};

/** A message's longest text, in characters (the column is varchar(1000)). */
export const MAX_TEMPLATE_LENGTH = 1000;

/** The placeholders' values; a missing or empty one removes its placeholder. */
export type MessageValues = Partial<Record<Placeholder, string>>;

/** How staff reached a client: the link or button they tapped (TAT-52). */
export const CONTACT_CHANNELS = ["whatsapp", "viber", "call", "copy"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** The channel in "contacted today on WhatsApp". */
export const CHANNEL_TEXT: Record<ContactChannel, string> = {
	whatsapp: "on WhatsApp",
	viber: "on Viber",
	call: "by phone",
	copy: "with a copied message",
};

/** What a last contact records besides its time; both null for "Mark contacted". */
export type ContactVia = {
	channel: ContactChannel | null;
	kind: MessageKind | null;
};
export const NO_VIA: ContactVia = { channel: null, kind: null };

/** `{name}`, with the one space before it that an empty value takes along. */
const PLACEHOLDER = /( ?)\{([a-z_]+)\}/g;
/** Anything in braces: on save, each must be one of the kind's placeholders. */
const BRACED = /\{([^{}]*)\}/g;

/** The first word of a name, for "Hi Sita"; "" for a blank name. */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * `template` with each of `kind`'s placeholders replaced by its value, in
 * one pass: a value is never read again, so a client named "{deposit_link}"
 * keeps that name. A name `kind` doesn't use stays as typed. An empty or
 * missing value removes the placeholder and one space before it, so
 * "Hi {client_name}," reads "Hi," without a name (TAT-64's behaviour).
 */
export function renderMessage(
	kind: MessageKind,
	template: string,
	values: MessageValues,
): string {
	const allowed: readonly string[] = KIND_PLACEHOLDERS[kind];
	return template.replace(
		PLACEHOLDER,
		(match: string, space: string, name: string) => {
			if (!allowed.includes(name)) return match;
			const value = values[name as Placeholder] ?? "";
			return value === "" ? "" : `${space}${value}`;
		},
	);
}

/** A typed text as it is stored: "\n" line endings, trimmed. */
export function normalizeTemplate(text: string): string {
	return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * Why `text` can't be `kind`'s message, for its field error; null when it
 * can (spec ruling 20). Lengths count characters as Postgres does (code
 * points), after normalizeTemplate.
 */
export function templateProblem(
	kind: MessageKind,
	text: string,
): string | null {
	const body = normalizeTemplate(text);
	if (body.includes("\u0000")) return "Remove the unsupported characters.";
	if (body === "") return "Write the message, or reset it to the default.";
	if (Array.from(body).length > MAX_TEMPLATE_LENGTH) {
		return "Use at most 1,000 characters.";
	}
	const allowed: readonly string[] = KIND_PLACEHOLDERS[kind];
	for (const [braced, name] of body.matchAll(BRACED)) {
		if (!allowed.includes(name ?? "")) {
			const list = allowed.map((placeholder) => `{${placeholder}}`).join(", ");
			return `${braced} can't be used here. This message can use ${list}.`;
		}
	}
	// An unbalanced brace ("{client_name", "{{client_name}}") would reach the
	// client as typed: refuse what is left once the complete pairs are gone.
	if (/[{}]/.test(body.replace(BRACED, ""))) {
		return "Remove the stray { or }: every brace must be part of a placeholder such as {client_name}.";
	}
	if (kind === "deposit_link" && !body.includes("{deposit_link}")) {
		return "Keep {deposit_link}: it is the link the client pays on.";
	}
	return null;
}

/**
 * Example values for the settings page's preview: the studio's own name and
 * address, made-up details for the rest.
 */
export function sampleValues(studio: {
	name: string;
	address: string | null;
}): Record<Placeholder, string> {
	return {
		client_name: "Sita",
		studio_name: studio.name,
		artist_name: "Asha",
		price: "NPR 15,000",
		deposit_note: "Deposit: NPR 3,000.",
		valid_until: "28 Oct 2026",
		amount: "NPR 3,000",
		reference_code: "7K3M9Q",
		deposit_link: "https://your-studio.example/deposit#example",
		session_time: "Mon 2 Nov 2026, 15:45–17:45",
		studio_address: studio.address ?? "",
	};
}
