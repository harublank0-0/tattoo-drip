import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { viberLink, whatsappLink } from "./links.ts";
import type { StudioView } from "./view-model.ts";

/**
 * The chat button's two links (TAT-127). Pure. WhatsApp opens with a message
 * that says what the client was looking at; Viber documents a prefilled text
 * only for bot chats, so its link is the plain chat.
 */
export interface ChatLinks {
	readonly whatsapp: string;
	readonly viber: string;
}

/**
 * The studio's WhatsApp and Viber chats, or null without a valid phone.
 * `subject` is what the client was looking at (an artist's name); without one
 * the message asks about "a tattoo".
 */
export function chatLinks(
	studio: StudioView,
	subject: string | null,
): ChatLinks | null {
	const whatsapp = whatsappLink(
		studio.phone,
		fill(studioCopy.chat.message, {
			subject: subject ?? studioCopy.chat.anyTattoo,
		}),
	);
	const viber = viberLink(studio.phone);
	return whatsapp && viber ? { whatsapp, viber } : null;
}
