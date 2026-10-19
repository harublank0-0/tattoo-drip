import { test } from "@japa/runner";
import { canonicalEmail, typedEmail } from "#modules/identity/email_address";

test.group("canonicalEmail", () => {
	test("trims spaces and lower-cases the ASCII letters", ({ assert }) => {
		assert.equal(canonicalEmail("  Ink@Example.COM "), "ink@example.com");
		assert.equal(canonicalEmail("ink@example.com"), "ink@example.com");
	});

	test("keeps dots and +tags: what they mean depends on the provider", ({
		assert,
	}) => {
		assert.equal(
			canonicalEmail("I.N.K+Studio@Gmail.com"),
			"i.n.k+studio@gmail.com",
		);
	});

	test("leaves letters outside ASCII as they are", ({ assert }) => {
		assert.equal(canonicalEmail("ÉVA@Example.com"), "Éva@example.com");
		assert.equal(canonicalEmail("सीता@Example.com"), "सीता@example.com");
	});

	test("strips exactly what the database's btrim does: spaces, nothing else", ({
		assert,
	}) => {
		// The users_email_canonical check uses btrim(), which removes only
		// U+0020, so the rule must leave a tab, a line break, a no-break
		// space and an ideographic space alone (the validator's trim() cleans
		// those from typed input before this runs).
		assert.equal(canonicalEmail(" ink@x.com"), "ink@x.com");
		assert.equal(canonicalEmail("ink@x.com   "), "ink@x.com");
		assert.equal(canonicalEmail("\tink@x.com"), "\tink@x.com");
		assert.equal(canonicalEmail("ink@x.com\n"), "ink@x.com\n");
		assert.equal(canonicalEmail("\u00a0ink@x.com"), "\u00a0ink@x.com");
		assert.equal(canonicalEmail("\u3000ink@x.com"), "\u3000ink@x.com");
		assert.equal(canonicalEmail(" \tINK@x.com "), "\tink@x.com");
	});

	test("a typed address loses every kind of surrounding whitespace first, as the validator's trim() does", ({
		assert,
	}) => {
		assert.equal(typedEmail("  Ink@Example.COM \n"), "ink@example.com");
		assert.equal(typedEmail("\t\u3000\u00a0INK@x.com\r\n"), "ink@x.com");
		assert.equal(typedEmail("ink@x.com"), canonicalEmail("ink@x.com"));
	});

	test("a long run of spaces is cheap to strip", ({ assert }) => {
		const value = `a${" ".repeat(200_000)}b@x.com`;
		const started = Date.now();
		assert.equal(canonicalEmail(value), value);
		assert.isBelow(Date.now() - started, 500);
	});

	test("is stable: a canonical address stays as it is", ({ assert }) => {
		for (const value of [
			"INK@x.com",
			" a.B+c@D.np ",
			"ÉVA@x.com",
			"\tINK@x.com",
		]) {
			const once = canonicalEmail(value);
			assert.equal(canonicalEmail(once), once, value);
		}
	});
});
