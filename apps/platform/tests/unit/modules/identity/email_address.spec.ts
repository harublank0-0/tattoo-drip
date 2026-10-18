import { test } from "@japa/runner";
import { canonicalEmail } from "#modules/identity/email_address";

test.group("canonicalEmail", () => {
	test("trims and lower-cases the ASCII letters", ({ assert }) => {
		assert.equal(canonicalEmail("  Ink@Example.COM \n"), "ink@example.com");
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

	test("is stable: a canonical address stays as it is", ({ assert }) => {
		for (const value of ["INK@x.com", " a.B+c@D.np ", "ÉVA@x.com"]) {
			const once = canonicalEmail(value);
			assert.equal(canonicalEmail(once), once, value);
		}
	});
});
