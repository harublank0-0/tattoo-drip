import { createHash, createHmac, hkdfSync } from "node:crypto";
import { test } from "@japa/runner";
import {
	DEPOSIT_TOKEN,
	DEV_STOREFRONT_URL,
	depositMessage,
	depositPageUrl,
	hashToken,
	newReferenceCode,
	newTokenNonce,
	REFERENCE_ALPHABET,
	tokenFor,
} from "#modules/payments/deposit_links";
import { digest } from "#services/rate_limits";
import env from "#start/env";

const TOKEN = "T".repeat(43);

test.group("deposit link tokens", () => {
	test("a nonce is 22 base64url characters, new each time", ({ assert }) => {
		const nonces = new Set(Array.from({ length: 50 }, () => newTokenNonce()));

		assert.equal(nonces.size, 50);
		for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
	});

	test("the token is 43 base64url characters: the same for one nonce, another for another", ({
		assert,
	}) => {
		const nonce = newTokenNonce();
		const token = tokenFor(nonce);

		assert.match(token, DEPOSIT_TOKEN);
		assert.equal(tokenFor(nonce), token);
		assert.notEqual(tokenFor(newTokenNonce()), token);
		assert.notInclude(token, nonce, "the token doesn't show its nonce");
	});

	test("the token comes from a key of its own: HKDF of APP_KEY, not the raw key digest() uses", ({
		assert,
	}) => {
		const nonce = newTokenNonce();
		const appKey = env.get("APP_KEY").release();
		const linkKey = Buffer.from(
			hkdfSync(
				"sha256",
				appKey,
				"",
				"tattoo-drip deposit-link token key v1",
				32,
			),
		);

		assert.equal(
			tokenFor(nonce),
			createHmac("sha256", linkKey).update(nonce).digest("base64url"),
		);
		// digest() keys with the raw APP_KEY, so no input given to it may
		// ever produce a token.
		assert.notEqual(tokenFor(nonce), digest(nonce));
		assert.notEqual(tokenFor(nonce), digest(`deposit-link:v1:${nonce}`));
	});

	test("the hash is the token's SHA-256 in hex", ({ assert }) => {
		const token = tokenFor(newTokenNonce());

		assert.equal(
			hashToken(token),
			createHash("sha256").update(token).digest("hex"),
		);
		assert.match(hashToken(token), /^[0-9a-f]{64}$/);
	});

	test("DEPOSIT_TOKEN takes exactly 43 base64url characters", ({ assert }) => {
		assert.isTrue(DEPOSIT_TOKEN.test("a".repeat(43)));
		assert.isTrue(DEPOSIT_TOKEN.test(`${"A".repeat(41)}-_`));
		for (const bad of [
			"a".repeat(42),
			"a".repeat(44),
			`${"a".repeat(42)}=`,
			`${"a".repeat(42)}/`,
			`${"a".repeat(42)}+`,
		]) {
			assert.isFalse(DEPOSIT_TOKEN.test(bad), bad);
		}
	});
});

test.group("reference codes", () => {
	test("6 symbols that can't be misread", ({ assert }) => {
		assert.equal(REFERENCE_ALPHABET, "23456789ABCDEFGHJKMNPQRSTVWXYZ");
		const codes = new Set(
			Array.from({ length: 200 }, () => newReferenceCode()),
		);

		assert.equal(codes.size, 200);
		for (const code of codes) {
			assert.match(code, /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
		}
	});
});

test.group("depositPageUrl", () => {
	test("the studio's origin from the template, then /deposit and the token in the fragment", ({
		assert,
	}) => {
		assert.equal(
			depositPageUrl("black-needle", TOKEN, "https://{tenant}.tattoodrip.app"),
			`https://black-needle.tattoodrip.app/deposit#${TOKEN}`,
		);
		// Only the origin counts.
		assert.equal(
			depositPageUrl(
				"black-needle",
				TOKEN,
				"http://{tenant}.localhost:3000/ignored",
			),
			`http://black-needle.localhost:3000/deposit#${TOKEN}`,
		);
	});

	test("the default is STOREFRONT_URL, which .env.test sets to the dev host", ({
		assert,
	}) => {
		assert.equal(DEV_STOREFRONT_URL, "http://{tenant}.localhost:3000");
		assert.equal(
			depositPageUrl("black-needle", TOKEN),
			`http://black-needle.localhost:3000/deposit#${TOKEN}`,
		);
	});

	test("a template without {tenant} is a configuration error", ({ assert }) => {
		assert.throws(
			() => depositPageUrl("black-needle", TOKEN, "https://tattoodrip.app"),
			/STOREFRONT_URL must contain \{tenant\}/,
		);
	});
});

test.group("depositMessage", () => {
	const input = {
		clientName: "  Sita Rai ",
		studioName: "Black Needle",
		dueText: "NPR 3,000",
		referenceCode: "7K3M9Q",
		url: `https://black-needle.tattoodrip.app/deposit#${TOKEN}`,
	};

	test("greets by first name, names the amount, studio and code, and ends with the link", ({
		assert,
	}) => {
		assert.equal(
			depositMessage(input),
			`Hi Sita, please pay your deposit of NPR 3,000 to Black Needle. Write 7K3M9Q in the payment remark, then send a screenshot of the payment on this page:\nhttps://black-needle.tattoodrip.app/deposit#${TOKEN}`,
		);
	});

	test("without a name it says Hi", ({ assert }) => {
		assert.match(
			depositMessage({ ...input, clientName: "  " }),
			/^Hi, please pay/,
		);
	});
});
