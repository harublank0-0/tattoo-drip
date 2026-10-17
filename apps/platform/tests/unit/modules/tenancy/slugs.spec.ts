import { test } from "@japa/runner";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";
import {
	checkSlug,
	RESERVED_SLUGS,
	STORED_SLUG,
	withTenantSlug,
} from "#modules/tenancy/slugs";

const VALID = [
	"abc",
	"black-needle",
	"ink2",
	"2ink",
	"a1b",
	"studio-9",
	"a-b-c",
	"x".repeat(63),
];

test.group("checkSlug", () => {
	test("accepts lowercase DNS labels with at least one letter", ({
		assert,
	}) => {
		for (const slug of VALID) {
			assert.deepEqual(checkSlug(slug), { ok: true, slug }, slug);
		}
	});

	test("lowercases ASCII capitals", ({ assert }) => {
		assert.deepEqual(checkSlug("Black-Needle"), {
			ok: true,
			slug: "black-needle",
		});
		assert.deepEqual(checkSlug("INK"), { ok: true, slug: "ink" });
	});

	test("refuses the wrong length, edge hyphens, double hyphens, punycode and all digits", ({
		assert,
	}) => {
		for (const input of [
			"",
			"ab",
			"x".repeat(64),
			"-abc",
			"abc-",
			"a--b",
			"black--needle",
			"xn--80ak6aa92e",
			"123",
			"2024",
			"9-9",
			"1-2-3",
		]) {
			assert.deepEqual(
				checkSlug(input),
				{ ok: false, problem: "format" },
				JSON.stringify(input),
			);
		}
	});

	test("refuses spaces and symbols", ({ assert }) => {
		for (const input of [
			"a b",
			"a_b",
			"a.b",
			"a/b",
			"ab?",
			" abc",
			"abc\n",
			"%61bc",
		]) {
			assert.deepEqual(
				checkSlug(input),
				{ ok: false, problem: "format" },
				JSON.stringify(input),
			);
		}
	});

	test("refuses Unicode instead of folding it", ({ assert }) => {
		for (const input of [
			"Kat", // Kelvin sign: toLocaleLowerCase turns it into "kat"
			"ａbc", // fullwidth a
			"blаck", // Cyrillic a
			"bläck", // a with diaeresis
			"black​needle", // zero-width space
			"İnk", // capital I with dot above
			"ink‐well", // Unicode hyphen
		]) {
			assert.deepEqual(
				checkSlug(input),
				{ ok: false, problem: "format" },
				JSON.stringify(input),
			);
		}
	});

	test("refuses reserved names in any case", ({ assert }) => {
		for (const input of [
			"www",
			"WWW",
			"api",
			"Api",
			"app",
			"admin",
			"ADMIN",
			"mail",
			"help",
			"support",
			"security",
			"billing",
			"payments",
			"login",
			"onboarding",
			"undefined",
			"null",
		]) {
			assert.deepEqual(
				checkSlug(input),
				{ ok: false, problem: "reserved" },
				input,
			);
		}
	});

	test("refuses the platform's name anywhere in a slug", ({ assert }) => {
		for (const input of [
			"tattoodrip",
			"tattoo-drip",
			"TattooDrip",
			"tattoodrip-help",
			"my-tattoo-drip",
			"tat-too-drip",
		]) {
			assert.deepEqual(
				checkSlug(input),
				{ ok: false, problem: "reserved" },
				input,
			);
		}
	});

	test("accepts names that only contain a reserved word", ({ assert }) => {
		for (const slug of [
			"www-ink",
			"api-tattoo",
			"help-me-ink",
			"studio-a",
			"black-admin",
		]) {
			assert.deepEqual(checkSlug(slug), { ok: true, slug }, slug);
		}
	});
});

test.group("STORED_SLUG", () => {
	test("matches the slugs stored before the new rules, which stay reachable", ({
		assert,
	}) => {
		for (const slug of [
			"12345",
			"a--b",
			"black--needle",
			"xn--80ak6aa92e",
			"www",
			"tattoo-drip",
			"abc",
			"x".repeat(63),
		]) {
			assert.match(slug, STORED_SLUG, slug);
		}
		// These could not be chosen today, so checkSlug is the wrong filter for
		// a path.
		for (const slug of ["12345", "a--b", "xn--80ak6aa92e", "www"]) {
			assert.isFalse(checkSlug(slug).ok, slug);
		}
	});

	test("refuses what can never be stored", ({ assert }) => {
		for (const input of [
			"",
			"ab",
			"x".repeat(64),
			"-abc",
			"abc-",
			"Black-Needle",
			"a_b",
			"a.b",
			"a b",
			"abc\n",
			"bläck",
			"\u212Aat", // Kelvin sign
		]) {
			assert.notMatch(input, STORED_SLUG, JSON.stringify(input));
		}
	});

	test("every slug checkSlug accepts matches it", ({ assert }) => {
		for (const slug of VALID) assert.match(slug, STORED_SLUG, slug);
	});
});

test.group("RESERVED_SLUGS", () => {
	test("every entry is lowercase and would otherwise be a valid slug", ({
		assert,
	}) => {
		for (const name of RESERVED_SLUGS) {
			assert.match(name, STORED_SLUG, name);
			assert.notInclude(name, "--", name);
			assert.match(name, /[a-z]/, name);
		}
	});

	test("holds the names the ticket lists", ({ assert }) => {
		for (const name of ["www", "api", "app", "admin", "mail", "help"]) {
			assert.isTrue(RESERVED_SLUGS.has(name), name);
		}
	});

	test("a valid tenant slug is always a valid artist slug", ({ assert }) => {
		// An independent artist's own profile starts with the tenant's slug.
		for (const slug of VALID) assert.match(slug, ARTIST_SLUG, slug);
	});
});

test.group("withTenantSlug", () => {
	test("swaps only the tenant segment and keeps the path and the query", ({
		assert,
	}) => {
		assert.equal(withTenantSlug("/t/old", "new"), "/t/new");
		assert.equal(withTenantSlug("/t/old/", "new"), "/t/new/");
		assert.equal(withTenantSlug("/t/old?x=1", "new"), "/t/new?x=1");
		assert.equal(
			withTenantSlug("/t/old/projects/abc?status=closed", "new"),
			"/t/new/projects/abc?status=closed",
		);
		assert.equal(withTenantSlug("/t/old/t/old", "new"), "/t/new/t/old");
	});

	test("keeps a doubled slash inside the path", ({ assert }) => {
		// Still a path on this site: it starts with /t/new.
		assert.equal(
			withTenantSlug("/t/old//evil.example", "new"),
			"/t/new//evil.example",
		);
	});

	test("throws for a URL outside /t/", ({ assert }) => {
		assert.throws(() => withTenantSlug("/dashboard", "new"), /\/t\//);
		assert.throws(() => withTenantSlug("//evil.example/t/old", "new"), /\/t\//);
		assert.throws(() => withTenantSlug("/t/", "new"), /\/t\//);
	});
});
