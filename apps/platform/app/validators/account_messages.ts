import { SimpleMessagesProvider } from "@vinejs/vine";
import { PASSWORD_RANGE } from "#modules/identity/passwords";

/**
 * What the account forms (signup, login, password reset, and the account
 * page's change form, TAT-95) say when a field is refused (TAT-100). VineJS's
 * own wording names the field ("The passwordConfirmation field must be
 * defined"); these read like a person at the front desk: short, kind, and
 * saying what to do.
 *
 * Keys are `field.rule` (VineJS's rule names), so a Nepali file can mirror
 * this one key for key. A rule nobody listed falls back to VineJS's text,
 * with the field written the way the page labels it (`ACCOUNT_FIELDS`); the
 * unit test sweeps every rule the forms use, so none gets there.
 */
export const ACCOUNT_MESSAGES = {
	"fullName.required": "Enter your name, or leave it blank.",
	"fullName.string": "Enter your name, or leave it blank.",
	"fullName.maxLength": "Use 255 characters or fewer.",

	"email.required": "Enter your email.",
	"email.string": "Enter your email.",
	"email.email": "Enter a valid email address.",
	"email.maxLength": "Enter a valid email address.",

	"currentPassword.required": "Enter your current password.",
	"currentPassword.string": "Enter your current password.",

	"password.required": "Enter your password.",
	"password.string": "Enter your password.",
	"password.minLength": `Use ${PASSWORD_RANGE}.`,
	"password.maxLength": `Use ${PASSWORD_RANGE}.`,
	"password.notSameAs": "Choose a password different from your current one.",

	"passwordConfirmation.required": "Type your password again.",
	"passwordConfirmation.string": "Type your password again.",
	"passwordConfirmation.sameAs": "Type the same password again.",
} as const;

/** The labels VineJS's fallback text uses for these fields. */
const ACCOUNT_FIELDS = {
	fullName: "name",
	email: "email",
	currentPassword: "current password",
	password: "password",
	passwordConfirmation: "password confirmation",
};

/** What the field error says when the current password isn't the stored one (TAT-95). */
export const WRONG_CURRENT_PASSWORD = "That isn't your current password.";

/** One provider for every account form: signup, login, both reset steps and the change form. */
export const accountMessages = new SimpleMessagesProvider(
	ACCOUNT_MESSAGES,
	ACCOUNT_FIELDS,
);
