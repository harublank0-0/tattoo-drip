import vine from "@vinejs/vine";
import {
	MAX_TAKEDOWN_NOTE_LENGTH,
	TAKEDOWN_REASONS,
} from "#modules/reviews/rules";

/** The reason an operator gives for a Discover takedown (stored for operators only). */
export const discoverReasonValidator = vine.create({
	reason: vine.string().trim().minLength(1).maxLength(500),
});

/** At most `max` code points (what the commands count with `Array.from`, not UTF-16 units). */
const maxCodePoints = vine.createRule(
	(value: unknown, options: { max: number }, field) => {
		if (typeof value === "string" && Array.from(value).length > options.max) {
			field.report(
				`The {{ field }} field must not be greater than ${options.max} characters`,
				"maxCodePoints",
				field,
			);
		}
	},
);

/** A review, reply or post takedown: the reason, and an optional note for operators. */
export const takedownValidator = vine.create({
	reason: vine.enum(TAKEDOWN_REASONS),
	note: vine
		.string()
		.trim()
		.use(maxCodePoints({ max: MAX_TAKEDOWN_NOTE_LENGTH }))
		.optional()
		.transform((value) => value || null),
});
