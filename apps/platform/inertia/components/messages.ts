/**
 * The dashboard's side of the chat messages (TAT-52). No imports: the unit
 * tests load it.
 */

export type MessageKindName =
	| "inquiry_received"
	| "quote"
	| "deposit_link"
	| "booking_confirmation"
	| "session_reminder"
	| "aftercare";

export type ContactChannelName = "whatsapp" | "viber" | "call" | "copy";

/** One-tap links to the client without a message. */
export type ContactLinksProps = {
	whatsappUrl: string;
	viberUrl: string;
	callUrl: string;
};

/** A message the "Message the client" card offers, ready to send. */
export type CardMessageProps = {
	kind: MessageKindName;
	label: string;
	text: string;
	whatsappUrl: string;
	viberUrl: string;
};

/** What the contact routes take: the link tapped and the message it carried. */
export type ContactVia = {
	channel?: ContactChannelName;
	kind?: MessageKindName;
};

/** How the last contact names its channel; the server's `CHANNEL_TEXT`. */
export const CHANNEL_TEXT: Record<ContactChannelName, string> = {
	whatsapp: "on WhatsApp",
	viber: "on Viber",
	call: "by phone",
	copy: "with a copied message",
};

/** How the last contact names its message; the server's `MESSAGE_LABELS`. */
export const MESSAGE_LABELS: Record<MessageKindName, string> = {
	inquiry_received: "Inquiry received",
	quote: "Quote",
	deposit_link: "Deposit link",
	booking_confirmation: "Booking confirmation",
	session_reminder: "Session reminder",
	aftercare: "Aftercare",
};

/**
 * What the server will say about a contact recorded now (`lastContactText`):
 * "contacted today on WhatsApp (Quote)". The page shows it while the record
 * is out (`shownContact`, ui.md), so the answer doesn't change the text.
 */
export function justContactedText(via: ContactVia): string {
	const channel = via.channel ? ` ${CHANNEL_TEXT[via.channel]}` : "";
	const kind = via.kind ? ` (${MESSAGE_LABELS[via.kind]})` : "";
	return `contacted today${channel}${kind}`;
}

/**
 * The page props a contact recorded now changes, as the server will send
 * them back: the last contact's words and channel (null for "Mark contacted").
 */
export function justContacted(via: ContactVia): {
	contactedText: string;
	lastChannel: ContactChannelName | null;
} {
	return {
		contactedText: justContactedText(via),
		lastChannel: via.channel ?? null,
	};
}

/** A contact being recorded (TAT-84): the project or inquiry it was tapped on, and what it carried. */
export type ContactMark = { id: string; via: ContactVia };

/**
 * What a project's or inquiry's Message card shows for the last contact: while a contact is
 * being recorded for `recordId` (`mark`, state held by the page) what the server will answer
 * with (`justContacted`, so the leading chat button changes at once too); any other record, and
 * no mark, shows the server's own values. It is state held in the page, not an Inertia
 * optimistic visit: while one of those is pending Inertia puts the current page's values into
 * the next page's props of the same names (a pending record on A leaves B's contact line empty).
 */
export function shownContact(
	mark: ContactMark | null,
	recordId: string,
	server: { contactedText: string; lastChannel: ContactChannelName | null },
): { contactedText: string; lastChannel: ContactChannelName | null } {
	return mark?.id === recordId ? justContacted(mark.via) : server;
}

/** The two channels a message can lead with. */
export type PrimaryChannel = "whatsapp" | "viber";

/**
 * The channel the card leads with (TAT-104): WhatsApp, unless the last
 * contact was a message on Viber. A call or a copied text says nothing about
 * where the client reads messages. A client has one phone number for both
 * apps, so "no WhatsApp but Viber" can't be told apart: the last use is the
 * only evidence there is.
 */
export function primaryChannel(
	last: ContactChannelName | null,
): PrimaryChannel {
	return last === "viber" ? "viber" : "whatsapp";
}

/** What the leading button says. Viber can't carry text: its tap copies it first. */
export const PRIMARY_LABELS: Record<PrimaryChannel, string> = {
	whatsapp: "Send on WhatsApp",
	viber: "Copy and open Viber",
};

/** The one toast of a Viber tap: the copy's confirmation and where to paste. */
export const VIBER_HINT =
	"Message copied. Viber opens the chat empty: paste it there.";

export type WayId = "whatsapp" | "viber" | "call" | "copy" | "chat";

/** One button of the "Other ways" row. */
export type OtherWay = {
	id: WayId;
	label: string;
	/** What a tap records as the last contact's channel. */
	channel: ContactChannelName;
	/** The tap sends the message (so it records the message's kind), not just a chat or a call. */
	withMessage: boolean;
};

/**
 * The "Other ways" row under the leading button (TAT-104), in order: the
 * channel that doesn't lead, Call, Copy text, Chat without a message.
 * `offersPlain` is false for a message that stands alone (the quote, the
 * deposit link): the Message card has the call and the plain chat.
 */
export function otherWays(
	primary: PrimaryChannel,
	offersPlain: boolean,
): OtherWay[] {
	const ways: OtherWay[] = [
		primary === "viber"
			? {
					id: "whatsapp",
					label: "WhatsApp",
					channel: "whatsapp",
					withMessage: true,
				}
			: { id: "viber", label: "Viber", channel: "viber", withMessage: true },
	];
	if (offersPlain) {
		ways.push({
			id: "call",
			label: "Call",
			channel: "call",
			withMessage: false,
		});
	}
	ways.push({
		id: "copy",
		label: "Copy text",
		channel: "copy",
		withMessage: true,
	});
	if (offersPlain) {
		ways.push({
			id: "chat",
			label: "Chat without a message",
			channel: primary,
			withMessage: false,
		});
	}
	return ways;
}

/**
 * What follows a copy once it settles: `copied` when the clipboard took the
 * text, `refused` when it said no, or there was no clipboard to ask.
 */
function afterCopy(
	copied: Promise<boolean>,
	onCopied: () => void,
	onRefused: () => void,
): void {
	copied.then((ok) => (ok ? onCopied() : onRefused()), onRefused);
}

/**
 * The Viber tap (TAT-104). Viber's chat link can't carry text, so the tap
 * also copies it, but the tap itself is the anchor's own navigation: this
 * runs inside the click, starts the copy and records the contact, and
 * returns without waiting for anything. iOS Safari lets a user gesture open
 * a custom scheme only while the gesture is still current, and an `await`
 * before the navigation can lose it. The hint (or the refusal) comes when
 * the copy settles; the page stays alive while Viber opens.
 */
export function tapViber(steps: {
	/** Starts the copy; must not be awaited before the navigation. */
	copy: () => Promise<boolean>;
	/** Records the contact (`viber`, with the message's kind). */
	record: () => void;
	/** The one toast: copied, paste it in Viber. */
	hint: () => void;
	/** The text could not be copied: show it, to select. */
	refused: () => void;
}): void {
	const copied = steps.copy();
	steps.record();
	afterCopy(copied, steps.hint, steps.refused);
}

/** The "Copy text" tap: the contact is recorded only after the clipboard took the text. */
export function tapCopy(steps: {
	copy: () => Promise<boolean>;
	/** The toast: copied. */
	done: () => void;
	/** Records the contact (`copy`, with the message's kind). */
	record: () => void;
	/** The text could not be copied: show it, to select. */
	refused: () => void;
}): void {
	afterCopy(
		steps.copy(),
		() => {
			steps.done();
			steps.record();
		},
		steps.refused,
	);
}

/** `{name}`, with the one space before it that an empty value takes along. */
const PLACEHOLDER = /( ?)\{([a-z_]+)\}/g;

/**
 * The settings page's live preview: the server's renderMessage
 * (#modules/notifications/messages) restated, because the dashboard can't
 * import server code. message_preview.spec.ts runs both on the same cases.
 */
export function previewMessage(
	text: string,
	allowed: readonly string[],
	values: Readonly<Record<string, string>>,
): string {
	return text.replace(
		PLACEHOLDER,
		(match: string, space: string, name: string) => {
			if (!allowed.includes(name)) return match;
			const value = values[name] ?? "";
			return value === "" ? "" : `${space}${value}`;
		},
	);
}
