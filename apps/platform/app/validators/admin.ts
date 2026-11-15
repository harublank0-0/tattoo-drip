import vine from "@vinejs/vine";

/** The reason an operator gives for a Discover takedown (stored for operators only). */
export const discoverReasonValidator = vine.create({
	reason: vine.string().trim().minLength(1).maxLength(500),
});
