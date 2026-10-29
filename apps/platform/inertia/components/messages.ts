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

/**
 * The contact line once "Mark contacted" is tapped (TAT-84), before the server answers: the
 * server's `lastContactText` for a contact now with no channel (pinned by
 * slow_connection_source.spec.ts).
 */
export const MARKED_CONTACTED_TEXT = "contacted today";

/**
 * What the Message card shows for the last contact: while "Mark contacted" is out for
 * `projectId` (`markedFor`, state held by the page) the words the server will answer with and
 * no last channel, which is what the server stores for it (so the leading chat button becomes
 * WhatsApp at once); every other project, and no mark, shows the server's own values. It is
 * state held in the page, not an Inertia optimistic visit: while one of those is pending
 * Inertia puts the current page's values into the next page's props of the same names.
 */
export function shownContact(
	markedFor: string | null,
	projectId: string,
	server: { contactedText: string; lastChannel: ContactChannelName | null },
): { contactedText: string; lastChannel: ContactChannelName | null } {
	return markedFor === projectId
		? { contactedText: MARKED_CONTACTED_TEXT, lastChannel: null }
		: server;
}

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
