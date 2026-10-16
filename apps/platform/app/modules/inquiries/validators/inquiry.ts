import vine, { SimpleMessagesProvider } from "@vinejs/vine";

/** The artist for the project an accepted inquiry becomes; empty for none. */
export const acceptInquiryValidator = vine.create({
	artistId: vine.string().uuid().nullable(),
});
acceptInquiryValidator.messagesProvider = new SimpleMessagesProvider({
	"artistId.uuid": "Choose an artist from the list.",
});
