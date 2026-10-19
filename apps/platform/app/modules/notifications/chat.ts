import { chatLinks, telLink } from "#modules/clients/contact_links";

/** A chat message and the links that send it: WhatsApp prefilled, Viber to paste (TAT-64's shape). */
export type ChatMessage = {
	text: string;
	whatsappUrl: string;
	viberUrl: string;
};

/**
 * `text` as a chat message to `phone`: the client's stored E.164 number,
 * never anything typed. The text only ever goes in WhatsApp's `text` query,
 * percent-encoded as UTF-8.
 */
export function chatMessage(text: string, phone: string): ChatMessage {
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}

/** One-tap links to `phone` without a message: a WhatsApp chat, a Viber chat and a call. */
export type ContactLinks = {
	whatsappUrl: string;
	viberUrl: string;
	callUrl: string;
};

export function contactLinks(phone: string): ContactLinks {
	const links = chatLinks(phone);
	return {
		whatsappUrl: links.whatsapp,
		viberUrl: links.viber,
		callUrl: telLink(phone),
	};
}
