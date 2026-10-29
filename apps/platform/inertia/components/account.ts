/**
 * The words and small rules of the account page, and the password hint of the
 * auth pages (TAT-95). Pure and unit-tested (tests/unit/inertia/
 * account_copy.spec.ts), so the page itself only places them. Plain words: the
 * page says "other devices", never "sessions".
 */

/** The server's password range (`PASSWORD_LENGTH`); a test pins them equal. */
export const PASSWORD_HINT = "8 to 128 characters.";
export const NEW_PASSWORD_HINT = `${PASSWORD_HINT} Not the same as your current password.`;

export const ACCOUNT_TITLE = "Your account";

export const CHANGE_PASSWORD_INTRO =
	"Every other phone or computer signed in to your account is signed out. You stay signed in here.";

export const FORGOT_CURRENT =
	"Forgot your current password? Log out, then choose “Forgot your password?” on the sign-in page.";

export const OTHER_DEVICES_INTRO =
	"Signed in on a phone you lost, or on a shared computer? Sign out everywhere except here.";

export const SIGN_OUT_OTHERS = {
	label: "Sign out of other devices",
	question:
		"Sign out every other phone, tablet and computer? You stay signed in here.",
	confirm: "Sign them out",
	keep: "Cancel",
	busy: "Signing out…",
} as const;

/** Where the header's link goes: /dashboard, which picks the last studio or onboarding. */
export function backLabel(hasStudio: boolean): string {
	return hasStudio ? "Back to your studio" : "Set up your studio";
}

export function submitLabel(processing: boolean): string {
	return processing ? "Changing…" : "Change password";
}

/** An aria-describedby value from the ids that apply, or none. */
export function describedBy(
	...ids: (string | false | null | undefined)[]
): string | undefined {
	const list = ids.filter((id): id is string => Boolean(id));
	return list.length > 0 ? list.join(" ") : undefined;
}

/**
 * Whether the form empties after a visit. A refused limit also comes back as
 * a good page (a redirect with an error toast and no field errors), and its
 * typed values stay; only a saved change, which flashes its success, clears.
 */
export function clearsFields(flash: {
	success?: string | null;
	error?: string | null;
}): boolean {
	return Boolean(flash.success);
}
