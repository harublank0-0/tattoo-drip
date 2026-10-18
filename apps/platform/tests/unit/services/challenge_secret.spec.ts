import { test } from "@japa/runner";
import { checkChallengeSecret } from "#services/challenge_secret";
import env from "#start/env";

const KEY = "TURNSTILE_SECRET_KEY";
const VALUE = "0x4AAAAAAAtest-secret-55";

test.group("TURNSTILE_SECRET_KEY at boot", () => {
	test("a set value is a Secret, in production too, and never prints", ({
		assert,
	}) => {
		for (const production of [false, true]) {
			const secret = checkChallengeSecret(KEY, VALUE, production);
			assert.equal(secret?.release(), VALUE);
			assert.notInclude(String(secret), VALUE);
			assert.notInclude(JSON.stringify({ secret }), VALUE);
		}
	});

	test("it is optional outside production: unset or empty turns the check off", ({
		assert,
	}) => {
		assert.isUndefined(checkChallengeSecret(KEY, undefined, false));
		assert.isUndefined(checkChallengeSecret(KEY, "", false));
	});

	test("in production it is required, with a message that says where to find it", ({
		assert,
	}) => {
		for (const value of [undefined, ""]) {
			assert.throws(
				() => checkChallengeSecret(KEY, value, true),
				/TURNSTILE_SECRET_KEY is required in production.*Turnstile/,
			);
		}
	});

	test("a value with spaces or line breaks is refused without showing it", ({
		assert,
	}) => {
		for (const value of [` ${VALUE}`, `${VALUE}\n`, "two words"]) {
			for (const production of [false, true]) {
				try {
					checkChallengeSecret(KEY, value, production);
					assert.fail(`accepted ${JSON.stringify(value)}`);
				} catch (error) {
					assert.match(String(error), /must not contain spaces/);
					assert.notInclude(String(error), value.trim());
				}
			}
		}
	});

	test("tests run with the check off (.env.test sets it empty)", ({
		assert,
	}) => {
		assert.isUndefined(env.get("TURNSTILE_SECRET_KEY"));
	});
});
