import vine from "@vinejs/vine";
import { PACKAGE_KEYS } from "#modules/packages/packages";
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

/**
 * A pilot grant from the studio's admin page: the package, the day it ends
 * (00:00 UTC; an impossible day is refused by the controller) and the note.
 */
export const pilotGrantValidator = vine.create({
	package: vine.enum(PACKAGE_KEYS),
	until: vine
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/),
	note: vine.string().trim().minLength(1).maxLength(500),
});

/** The address of the account to confirm; the service canonicalises it. */
export const verifyAccountValidator = vine.create({
	email: vine.string().trim().email().maxLength(254),
});
