import vine from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";

/**
 * The input's shape only. Which details a kind needs, and whether it may
 * show on the deposit page, is PaymentMethodService's job (rules.ts): when
 * editing, it depends on the QR already stored. The form only sends the
 * kind's own inputs, so every detail is optional here.
 */
const details = () => ({
	label: vine.string().trim().minLength(1).maxLength(80),
	accountName: vine.string().trim().maxLength(120).nullable().optional(),
	accountNumber: vine.string().trim().maxLength(64).nullable().optional(),
	bankName: vine.string().trim().maxLength(120).nullable().optional(),
	showOnDepositPage: vine.boolean().optional(),
	qr: imageFile().optional(),
});

export const createPaymentMethodValidator = vine.create({
	kind: vine.enum(PAYMENT_METHOD_KINDS),
	...details(),
});

/**
 * No kind: it's fixed once the method exists.
 */
export const updatePaymentMethodValidator = vine.create({
	...details(),
	removeQr: vine.boolean().optional(),
});

export const movePaymentMethodValidator = vine.create({
	direction: vine.enum(["up", "down"] as const),
});
