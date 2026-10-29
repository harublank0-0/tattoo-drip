import { test } from "@japa/runner";
import {
	knownStyles,
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
			assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
		assert.deepEqual(TATTOO_STYLES[1], {
			slug: "fine-line",
			name: "Fine line",
		});
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
