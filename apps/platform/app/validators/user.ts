import vine from "@vinejs/vine";
import { canonicalEmail } from "#modules/identity/email_address";

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().trim().email().maxLength(254);
const password = () => vine.string().minLength(8).maxLength(32);

/**
 * An account's address, as stored and looked up: canonical (TAT-18,
 * #modules/identity/email_address). The transform runs after the rules.
 */
const accountEmail = () => email().transform(canonicalEmail);

/**
 * Validator to use when performing self-signup.
 *
 * The "passwordConfirmation" field is declared explicitly, so that it is part
 * of the request body type shared with the frontend. Otherwise the signup form
 * has no way to know about the errors reported for this field.
 */
export const signupValidator = vine.create({
	fullName: vine.string().nullable(),
	email: email().unique({ table: "users", column: "email" }),
	password: password(),
	passwordConfirmation: password().sameAs("password"),
});

/**
 * Validator to use before validating user credentials
 * during login
 */
export const loginValidator = vine.create({
	email: accountEmail(),
	password: vine.string(),
});

/**
 * Asking for a password reset link (TAT-18): the address in its canonical
 * form, registered or not.
 */
export const passwordResetRequestValidator = vine.create({
	email: accountEmail(),
});

/** A new password from a reset link: signup's rules, never weaker (TAT-18). */
export const newPasswordValidator = vine.create({
	password: password(),
	passwordConfirmation: password().sameAs("password"),
});
