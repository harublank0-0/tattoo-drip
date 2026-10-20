import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { canonicalEmail } from "#modules/identity/email_address";
import { MEMBERSHIP_ROLES } from "#modules/tenancy/models/tenant_membership";

/**
 * An invitation (TAT-33): the address it is bound to, canonical as accounts
 * store it (TAT-18), the role, and an optional profile to claim ("None"
 * arrives as null).
 */
export const inviteValidator = vine.create({
	email: vine.string().trim().email().maxLength(254).transform(canonicalEmail),
	role: vine.enum(MEMBERSHIP_ROLES),
	artistId: vine.string().uuid().nullable().optional(),
});
inviteValidator.messagesProvider = new SimpleMessagesProvider({
	"email.required": "Enter their email address.",
	"email.email": "Enter an email address, like ink@example.com.",
	"email.maxLength": "Use at most 254 characters.",
	"role.required": "Choose a role.",
	"role.enum": "Choose a role.",
	"artistId.uuid": "Choose a profile from the list.",
});

/** A member's new role (TAT-33). */
export const memberRoleValidator = vine.create({
	role: vine.enum(MEMBERSHIP_ROLES),
});
memberRoleValidator.messagesProvider = new SimpleMessagesProvider({
	"role.required": "Choose a role.",
	"role.enum": "Choose a role.",
});
