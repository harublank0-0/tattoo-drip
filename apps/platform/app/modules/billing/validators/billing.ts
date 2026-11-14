import vine from "@vinejs/vine";

/** A plan from the catalogue, by code. */
export const planChoiceValidator = vine.create({
	plan: vine
		.string()
		.trim()
		.maxLength(64)
		.regex(/^[a-z0-9-]+$/),
});
