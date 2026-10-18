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
