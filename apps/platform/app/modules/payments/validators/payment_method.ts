import vine from "@vinejs/vine";

export const movePaymentMethodValidator = vine.create({
	direction: vine.enum(["up", "down"] as const),
});
