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

const TEMPLATE_MESSAGES = {
	required: "Write the message, or reset it to the default.",
	string: "Write the message, or reset it to the default.",
};

/**
 * Settings, Messages: every text at once, TAT-52's six and the review
 * request (Reviews and Fresh ink, slice 2), each required (an emptied box is
 * the same field error).
 */
export const messageTemplatesValidator = vine.create({
	inquiry_received: text("inquiry_received"),
	quote: text("quote"),
	deposit_link: text("deposit_link"),
	booking_confirmation: text("booking_confirmation"),
	session_reminder: text("session_reminder"),
	aftercare: text("aftercare"),
	review_request: text("review_request"),
});
messageTemplatesValidator.messagesProvider = new SimpleMessagesProvider(
	TEMPLATE_MESSAGES,
);
