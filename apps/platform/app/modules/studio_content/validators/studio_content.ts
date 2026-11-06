import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import {
	FAQ_LIMITS,
	MAX_FAQ_ENTRIES,
	MAX_POLICY_SECTIONS,
	POLICY_LIMITS,
} from "#modules/studio_content/limits";

/** A filled text within `max`: trimmed, at least one character. */
const filled = (max: number) =>
	vine.string().trim().minLength(1).maxLength(max);

/** The studio's FAQ, whole (Settings → FAQ & policies). */
export const faqValidator = vine.create({
	entries: vine
		.array(
			vine.object({
				question: filled(FAQ_LIMITS.question),
				answer: filled(FAQ_LIMITS.answer),
			}),
		)
		.maxLength(MAX_FAQ_ENTRIES),
});

/** The studio's policy sections, whole. */
export const policiesValidator = vine.create({
	sections: vine
		.array(
			vine.object({
				title: filled(POLICY_LIMITS.title),
				text: filled(POLICY_LIMITS.text),
			}),
		)
		.maxLength(MAX_POLICY_SECTIONS),
});

const messages = {
	required: "Fill this in, or remove the row.",
	minLength: "Fill this in, or remove the row.",
	maxLength: "Keep it to {{ max }} characters or fewer.",
};
faqValidator.messagesProvider = new SimpleMessagesProvider({
	...messages,
	"entries.array.maxLength": `You can have up to ${MAX_FAQ_ENTRIES} questions.`,
});
policiesValidator.messagesProvider = new SimpleMessagesProvider({
	...messages,
	"sections.array.maxLength": `You can have up to ${MAX_POLICY_SECTIONS} sections.`,
});
