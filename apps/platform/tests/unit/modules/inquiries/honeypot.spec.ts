import { test } from "@japa/runner";
import { HONEYPOT_FIELD, honeypotFilled } from "#modules/inquiries/honeypot";

test.group("The intake honeypot", () => {
	test("is the website field", ({ assert }) => {
		assert.equal(HONEYPOT_FIELD, "website");
	});

	test("missing, empty or blank is a person's", ({ assert }) => {
		for (const value of [
			undefined,
			null,
			"",
			"   ",
			"\t\n",
			[],
			["", " "],
			[null],
		]) {
			assert.isFalse(honeypotFilled(value), JSON.stringify(value));
		}
	});

	test("anything else is filled, also in one of several parts", ({
		assert,
	}) => {
		for (const value of [
			"x",
			" https://spam.example ",
			["", "https://spam.example"],
			[null, "y"],
			{ nested: "spam" },
		]) {
			assert.isTrue(honeypotFilled(value), JSON.stringify(value));
		}
	});
});
