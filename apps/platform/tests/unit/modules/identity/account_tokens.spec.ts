import { createHash } from "node:crypto";
import { test } from "@japa/runner";
import {
	ACCOUNT_TOKEN,
	accountUrl,
	forgetStagedTokens,
	hashAccountToken,
	INVITATION_TOKEN_KEY,
	linkPath,
	newAccountToken,
	SESSION_TOKEN_KEYS,
	TOKEN_MINUTES,
	TOKEN_PURPOSES,
} from "#modules/identity/account_tokens";

test.group("Account tokens", () => {
	test("forgetStagedTokens forgets the account links and a staged invitation (TAT-33)", ({
		assert,
	}) => {
		const forgotten: string[] = [];
		forgetStagedTokens({ forget: (key) => forgotten.push(key) });

		assert.sameMembers(forgotten, [
			SESSION_TOKEN_KEYS.verify_email,
			SESSION_TOKEN_KEYS.reset_password,
			INVITATION_TOKEN_KEY,
		]);
		assert.equal(INVITATION_TOKEN_KEY, "invitation_token");
	});

	test("a new token is 43 base64url characters, never the same twice", ({
		assert,
	}) => {
		const tokens = new Set(Array.from({ length: 50 }, () => newAccountToken()));
		assert.equal(tokens.size, 50);
		for (const token of tokens) assert.match(token, ACCOUNT_TOKEN);
	});

	test("the link routes take exactly a token", ({ assert }) => {
		assert.isTrue(ACCOUNT_TOKEN.test("a".repeat(43)));
		for (const bad of [
			"a".repeat(42),
			"a".repeat(44),
			`${"a".repeat(42)}=`,
			`${"a".repeat(42)}.`,
			`${"a".repeat(42)}/`,
			"",
		]) {
			assert.isFalse(ACCOUNT_TOKEN.test(bad), bad);
		}
	});

	test("what is stored is the token's SHA-256, never the token", ({
		assert,
	}) => {
		const token = newAccountToken();
		const stored = hashAccountToken(token);

		assert.equal(stored, createHash("sha256").update(token).digest("hex"));
		assert.match(stored, /^[0-9a-f]{64}$/);
		assert.notInclude(stored, token);
	});

	test("confirmation links work for a day, reset links for an hour", ({
		assert,
	}) => {
		assert.deepEqual(TOKEN_MINUTES, { verify_email: 1440, reset_password: 60 });
		assert.sameMembers(Object.keys(SESSION_TOKEN_KEYS), [...TOKEN_PURPOSES]);
	});

	test("links point at the platform's own pages", ({ assert }) => {
		const token = "a".repeat(43);
		assert.equal(
			accountUrl("https://app.example.com", linkPath("verify_email", token)),
			`https://app.example.com/verify-email/${token}`,
		);
		assert.equal(
			accountUrl("http://localhost:3333", linkPath("reset_password", token)),
			`http://localhost:3333/reset-password/${token}`,
		);
	});
});
