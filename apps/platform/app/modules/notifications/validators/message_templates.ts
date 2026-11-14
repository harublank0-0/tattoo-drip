import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";
import {
	type MessageKind,
	templateProblem,
} from "#modules/notifications/messages";

/** A text must pass templateProblem for its kind (spec ruling 20). */
const messageText = vine.createRule<MessageKind>(
	(value: unknown, kind: MessageKind, field: FieldContext) => {
		if (typeof value !== "string") return;
		const problem = templateProblem(kind, value);
		if (problem) field.report(problem, "messageText", field);
	},
);

/** One field per kind, named after it: one form and one error bag, so each error shows under its own box. */
const text = (kind: MessageKind) => vine.string().use(messageText(kind));

/**
 * Settings, Messages: the texts at once. The review request is sent only
 * while reviews are on (the page shows it then); without it, its stored text
 * stays as it is.
 */
export const messageTemplatesValidator = vine.create({
	inquiry_received: text("inquiry_received"),
	quote: text("quote"),
	deposit_link: text("deposit_link"),
	booking_confirmation: text("booking_confirmation"),
	session_reminder: text("session_reminder"),
	aftercare: text("aftercare"),
	review_request: text("review_request").optional(),
});
messageTemplatesValidator.messagesProvider = new SimpleMessagesProvider({
	required: "Write the message, or reset it to the default.",
	string: "Write the message, or reset it to the default.",
});
