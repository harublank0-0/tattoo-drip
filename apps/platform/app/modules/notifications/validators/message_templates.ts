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

const SIX = {
	inquiry_received: text("inquiry_received"),
	quote: text("quote"),
	deposit_link: text("deposit_link"),
	booking_confirmation: text("booking_confirmation"),
	session_reminder: text("session_reminder"),
	aftercare: text("aftercare"),
};
const TEMPLATE_MESSAGES = {
	required: "Write the message, or reset it to the default.",
	string: "Write the message, or reset it to the default.",
};

/**
 * Settings, Messages while reviews are on: every text at once, the review
 * request required like the others (an emptied box is the same field error).
 */
export const messageTemplatesValidator = vine.create({
	...SIX,
	review_request: text("review_request"),
});
messageTemplatesValidator.messagesProvider = new SimpleMessagesProvider(
	TEMPLATE_MESSAGES,
);

/**
 * Settings, Messages while reviews are off: TAT-52's six texts. The review
 * request isn't on the page, so its stored text stays as it is.
 */
export const messageTemplatesWithoutReviewValidator = vine.create(SIX);
messageTemplatesWithoutReviewValidator.messagesProvider =
	new SimpleMessagesProvider(TEMPLATE_MESSAGES);
