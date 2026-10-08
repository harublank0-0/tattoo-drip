import { test } from "@japa/runner";
import { normalizePhone } from "#validators/phone";

test.group("normalizePhone", () => {
	for (const [input, expected] of [
		["9812345678", "+9779812345678"],
		["98-1234-5678", "+9779812345678"],
		["01 4123456", "+97714123456"],
		["+977 981 234 5678", "+9779812345678"],
		["00977 9812345678", "+9779812345678"],
		["+1 (415) 555-0100", "+14155550100"],
	] as const) {
		test(`"${input}" becomes ${expected}`, ({ assert }) => {
			assert.equal(normalizePhone(input), expected);
		});
	}

	for (const input of [
		"",
		"12345",
		"98123456781234567",
		"call me",
		"+0 123 456 789",
	]) {
		test(`"${input}" is not a phone number`, ({ assert }) => {
			assert.isUndefined(normalizePhone(input));
		});
	}
});
