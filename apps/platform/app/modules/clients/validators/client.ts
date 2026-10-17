import vine from "@vinejs/vine";
import { phoneNumber } from "#validators/phone";

/**
 * An owner's edit of a client (TAT-41). The phone is normalized to E.164;
 * an empty email or notes arrives as null.
 */
export const updateClientValidator = vine.create({
	name: vine.string().trim().minLength(1).maxLength(120),
	phone: vine.string().trim().use(phoneNumber()),
	email: vine.string().trim().maxLength(254).email().nullable(),
	notes: vine.string().trim().maxLength(2000).nullable(),
});
