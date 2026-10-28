import vine from "@vinejs/vine";
import { canonicalEmail } from "#modules/identity/email_address";
import { PASSWORD_LENGTH } from "#modules/identity/passwords";
import { accountMessages } from "#validators/account_messages";

/**
 * Shared rules for email and password.
 */
const email = () => vine.string().trim().email().maxLength(254);
const password = () =>
	vine.string().minLength(PASSWORD_LENGTH.min).maxLength(PASSWORD_LENGTH.max);

/**
 * The "type it again" box: it only has to match the password. Its own
 * length rules would repeat the password's message under it (TAT-100).
 */
const passwordAgain = () => vine.string().sameAs("password");

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
 *
 * No unique rule on the email (TAT-18): the answer must never tell whether
 * an address has an account. AccountService.signUp handles a taken one.
 */
export const signupValidator = vine.create({
	fullName: vine.string().trim().maxLength(255).nullable(),
	email: accountEmail(),
	password: password(),
	passwordConfirmation: passwordAgain(),
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
	passwordConfirmation: passwordAgain(),
});

/**
 * Changing the password while signed in (TAT-95): the current password as
 * sign-in takes it (no length rule, so no stored password is refused), a
 * new one by signup's rule that differs from what was typed as the current
 * one, and its repeat.
 */
export const changePasswordValidator = vine.create({
	currentPassword: vine.string(),
	password: password().notSameAs("currentPassword"),
	passwordConfirmation: passwordAgain(),
});

/**
 * The account forms say what to do, not which field broke (TAT-100): one
 * provider on all five, so signup, login, both reset steps and the account
 * page's change form read alike.
 */
for (const validator of [
	signupValidator,
	loginValidator,
	passwordResetRequestValidator,
	newPasswordValidator,
	changePasswordValidator,
]) {
	validator.messagesProvider = accountMessages;
}
