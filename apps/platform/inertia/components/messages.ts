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

/** How many lines of a message the folded preview shows (the `line-clamp-2` class). */
export const FOLD_LINES = 2;

/**
 * The preview's fold: it is clamped to FOLD_LINES until opened, and the
 * toggle shows only when there is more to see (or to hide again).
 */
export function foldToggle(
	expanded: boolean,
	overflows: boolean,
): { clamp: boolean; showToggle: boolean; label: string } {
	return {
		clamp: !expanded,
		showToggle: expanded || overflows,
		label: expanded ? "Hide message" : "Show message",
	};
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
