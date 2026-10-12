import { test } from "@japa/runner";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";

test.group("ARTIST_SLUG", () => {
	test("accepts 2 to 63 lowercase letters, digits and inner hyphens", ({
		assert,
	}) => {
		for (const slug of [
			"ab",
			"sita",
			"sita-rai",
			"a--b",
			"a1",
			"x".repeat(63),
		]) {
			assert.match(slug, ARTIST_SLUG, slug);
		}
	});

	test("rejects one character, 64 characters, edge hyphens, capitals and symbols", ({
		assert,
	}) => {
		for (const slug of [
			"a",
			"x".repeat(64),
			"-ab",
			"ab-",
			"Ab",
			"a b",
			"a_b",
			"é",
			"",
		]) {
			assert.notMatch(slug, ARTIST_SLUG, JSON.stringify(slug));
		}
	});
});
