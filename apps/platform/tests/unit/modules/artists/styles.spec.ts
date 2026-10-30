import { test } from "@japa/runner";
import {
	knownStyles,
	MAX_ARTIST_STYLES,
	MAX_PHOTO_STYLES,
	STYLE_SLUG_SHAPE,
	STYLE_SLUGS,
	TATTOO_STYLES,
} from "#modules/artists/styles";

test.group("tattoo styles", () => {
	test("the list has the 18 styles, unique slugs in path-safe form", ({
		assert,
	}) => {
		assert.lengthOf(TATTOO_STYLES, 18);
		assert.lengthOf(new Set(STYLE_SLUGS), 18);
		for (const slug of STYLE_SLUGS) {
			assert.match(slug, STYLE_SLUG_SHAPE);
		}
		assert.deepEqual(TATTOO_STYLES[1], {
			slug: "fine-line",
			name: "Fine line",
		});
	});

	test("the slug shape accepts the list's slugs and refuses anything else", ({
		assert,
	}) => {
		for (const slug of ["blackwork", "fine-line", "a1", "3d"]) {
			assert.match(slug, STYLE_SLUG_SHAPE);
		}
		for (const slug of [
			"",
			"-x",
			"x-",
			"a--b",
			"Fine-line",
			"fine_line",
			"fine line",
			"x/y",
			"..",
			"a\nb",
		]) {
			assert.notMatch(slug, STYLE_SLUG_SHAPE);
		}
	});

	test("an artist picks up to five styles and a photo carries up to three", ({
		assert,
	}) => {
		assert.equal(MAX_ARTIST_STYLES, 5);
		assert.equal(MAX_PHOTO_STYLES, 3);
	});

	test("knownStyles keeps the list's order and drops unknown and repeated slugs", ({
		assert,
	}) => {
		assert.deepEqual(knownStyles(["realism", "nope", "blackwork", "realism"]), [
			{ slug: "blackwork", name: "Blackwork" },
			{ slug: "realism", name: "Realism" },
		]);
		assert.deepEqual(knownStyles([]), []);
	});
});
