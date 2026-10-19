import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import {
	CONTACT_CHANNELS,
	type ContactVia,
	MESSAGE_KINDS,
} from "#modules/notifications/messages";

/**
 * What a contact route takes (TAT-52): the link or button tapped and the
 * message it carried, both optional ("Mark contacted" sends neither). The
 * page sends them; a value it doesn't send is a validation error.
 */
export const contactValidator = vine.create({
	channel: vine.enum(CONTACT_CHANNELS).optional(),
	kind: vine.enum(MESSAGE_KINDS).optional(),
});
contactValidator.messagesProvider = new SimpleMessagesProvider({
	"channel.enum": "Choose WhatsApp, Viber, a call or a copied message.",
	"kind.enum": "Choose one of the studio's messages.",
});

/** The validated body as a last contact: what is missing is null. */
export function toContactVia({
	channel,
	kind,
}: Infer<typeof contactValidator>): ContactVia {
	return { channel: channel ?? null, kind: kind ?? null };
}
