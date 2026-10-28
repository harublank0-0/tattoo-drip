import { test } from "@japa/runner";
import { PASSWORD_LENGTH } from "#modules/identity/passwords";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `AccountModule` below restates its shape and the inertia project type-checks the real one.
import * as accountModule from "../../../inertia/components/account.js";

type AccountModule = {
	PASSWORD_HINT: string;
	NEW_PASSWORD_HINT: string;
	ACCOUNT_TITLE: string;
	CHANGE_PASSWORD_INTRO: string;
	FORGOT_CURRENT: string;
	OTHER_DEVICES_INTRO: string;
	SIGN_OUT_OTHERS: Record<string, string>;
	backLabel(hasStudio: boolean): string;
	submitLabel(processing: boolean): string;
	describedBy(
		...ids: (string | false | null | undefined)[]
	): string | undefined;
	clearsFields(flash: {
		success?: string | null;
		error?: string | null;
	}): boolean;
};
const {
	PASSWORD_HINT,
	NEW_PASSWORD_HINT,
	ACCOUNT_TITLE,
	CHANGE_PASSWORD_INTRO,
	FORGOT_CURRENT,
	OTHER_DEVICES_INTRO,
	SIGN_OUT_OTHERS,
	backLabel,
	submitLabel,
	describedBy,
	clearsFields,
} = accountModule as AccountModule;

test.group("Account page words (TAT-95)", () => {
	test("the password hint on the pages is the server's range", ({ assert }) => {
		assert.equal(
			PASSWORD_HINT,
			`${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters.`,
		);
		assert.isTrue(NEW_PASSWORD_HINT.startsWith(PASSWORD_HINT));
		assert.include(NEW_PASSWORD_HINT, "Not the same as your current password.");
	});

	test("the header link goes back to the studio, or on to setting one up", ({
		assert,
	}) => {
		assert.equal(ACCOUNT_TITLE, "Your account");
		assert.equal(backLabel(true), "Back to your studio");
		assert.equal(backLabel(false), "Set up your studio");
	});

	test("the submit button says what it is doing", ({ assert }) => {
		assert.equal(submitLabel(false), "Change password");
		assert.equal(submitLabel(true), "Changing…");
	});

	test("the sign-out panel asks, confirms, keeps and waits in its own words", ({
		assert,
	}) => {
		assert.deepEqual(SIGN_OUT_OTHERS, {
			label: "Sign out of other devices",
			question:
				"Sign out every other phone, tablet and computer? You stay signed in here.",
			confirm: "Sign them out",
			keep: "Cancel",
			busy: "Signing out…",
		});
	});

	test("aria-describedby lists the ids that apply, or nothing", ({
		assert,
	}) => {
		assert.equal(describedBy("a", null, false, "b"), "a b");
		assert.equal(describedBy("only"), "only");
		assert.isUndefined(describedBy(null));
		assert.isUndefined(describedBy(false, undefined));
		assert.isUndefined(describedBy());
	});

	test("the form clears after a saved change, never after a refusal that keeps what was typed", ({
		assert,
	}) => {
		assert.isTrue(clearsFields({ success: "Password changed." }));
		assert.isFalse(clearsFields({ error: "Too many attempts." }));
		assert.isFalse(clearsFields({}));
		assert.isFalse(clearsFields({ success: null, error: null }));
	});

	test("plain English: no word of the account page's copy says session or version", ({
		assert,
	}) => {
		const words = [
			CHANGE_PASSWORD_INTRO,
			FORGOT_CURRENT,
			OTHER_DEVICES_INTRO,
			...Object.values(SIGN_OUT_OTHERS),
		].join(" ");
		for (const jargon of ["session", "version", "token", "credential"]) {
			assert.notInclude(words.toLowerCase(), jargon);
		}
	});
});
