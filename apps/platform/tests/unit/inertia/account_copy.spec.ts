import { test } from "@japa/runner";
import { PASSWORD_LENGTH } from "#modules/identity/passwords";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `AccountModule` below restates its shape and the inertia project type-checks the real one.
import * as accountModule from "../../../inertia/components/account.js";

type AccountModule = {
	PASSWORD_HINT: string;
};
const { PASSWORD_HINT } = accountModule as AccountModule;

test.group("Account page words (TAT-95)", () => {
	test("the password hint on the pages is the server's range", ({ assert }) => {
		assert.equal(
			PASSWORD_HINT,
			`${PASSWORD_LENGTH.min} to ${PASSWORD_LENGTH.max} characters.`,
		);
	});
});
