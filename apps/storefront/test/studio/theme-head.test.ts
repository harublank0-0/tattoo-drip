import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { studioPageData } from "../../src/studio/loaders.ts";
import { headTags } from "../../src/studio/seo.ts";
import { brandingCss } from "../../src/studio/theme/branding.ts";
import { themedHeadTags } from "../../src/studio/theme/head.ts";
import { ARJUN, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import {
	BRANDED,
	HOSTILE,
	IMAGE_ORIGIN,
	withStorefront,
} from "./theme-fixtures.ts";

describe("themedHeadTags (TAT-54)", () => {
	test("the default theme's head is the page's head as it was: no <style>", () => {
		const data = studioPageData(STUDIO, [SITA, ARJUN], ORIGIN, IMAGE_ORIGIN);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), headTags(data.seo));
	});

	test("a hostile config adds nothing either", () => {
		const data = studioPageData(
			withStorefront(HOSTILE),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), headTags(data.seo));
	});

	test("a branded studio's head adds one <style> with its brand's CSS", () => {
		const data = studioPageData(
			withStorefront(BRANDED),
			[SITA, ARJUN],
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const css = brandingCss(data.theme);
		assert.ok(css);
		assert.deepEqual(themedHeadTags(data.seo, data.theme), {
			...headTags(data.seo),
			styles: [{ children: css }],
		});
		assert.doesNotMatch(css, /[<>"'&\\]|url\(/);
	});
});
