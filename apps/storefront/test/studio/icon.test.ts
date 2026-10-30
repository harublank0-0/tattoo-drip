import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { iconLinks, studioIconLinks } from "../../src/studio/icon.ts";
import { LOGO, withStorefront } from "./theme-fixtures.ts";

/**
 * The studio's icon in the root head (TAT-123): the logo's square icon as the
 * browser tab's and the home screen's icon, else the `data:,` stop.
 */
const ORIGIN = "https://api.example.com";
const A32 = "https://api.example.com/uploads/tenants/t/studio_icon/i.32w.png";
const A180 = "https://api.example.com/uploads/tenants/t/studio_icon/i.32.png";
const STOP = [{ rel: "icon", href: "data:," }];

const apiIcon = (extra: Record<string, unknown> = {}) => ({
	url: A180,
	width: 180,
	height: 180,
	alt: null,
	variants: [{ url: A32, width: 32 }],
	...extra,
});
const withIcon = (icon: unknown) =>
	withStorefront({ branding: { logo: { ...LOGO, tile: "light", icon } } });

describe("iconLinks (TAT-123)", () => {
	test("no icon is the stop, so the browser does not ask for /favicon.ico", () => {
		assert.deepEqual(iconLinks(null), STOP);
	});

	test("an icon with its 32 px copy: the tab's copy, the icon and the Apple touch icon", () => {
		assert.deepEqual(
			iconLinks({
				src: A180,
				width: 180,
				height: 180,
				srcSet: `${A32} 32w, ${A180} 180w`,
			}),
			[
				{ rel: "icon", sizes: "32x32", href: A32 },
				{ rel: "icon", sizes: "180x180", href: A180 },
				{ rel: "apple-touch-icon", href: A180 },
			],
		);
	});

	test("an icon without a copy leaves the 32 px link out", () => {
		assert.deepEqual(iconLinks({ src: A180, width: 180, height: 180 }), [
			{ rel: "icon", sizes: "180x180", href: A180 },
			{ rel: "apple-touch-icon", href: A180 },
		]);
	});
});

describe("studioIconLinks (TAT-123)", () => {
	test("a studio whose logo has an icon on the API's origin gets its links", () => {
		assert.deepEqual(studioIconLinks(withIcon(apiIcon()), ORIGIN), [
			{ rel: "icon", sizes: "32x32", href: A32 },
			{ rel: "icon", sizes: "180x180", href: A180 },
			{ rel: "apple-touch-icon", href: A180 },
		]);
	});

	test("an icon on another origin, a logo without an icon, no logo, or no studio gets the stop", () => {
		assert.deepEqual(
			studioIconLinks(
				withIcon(apiIcon({ url: "https://evil.example/i.png" })),
				ORIGIN,
			),
			STOP,
		);
		assert.deepEqual(studioIconLinks(withIcon(null), ORIGIN), STOP);
		assert.deepEqual(studioIconLinks(withStorefront({}), ORIGIN), STOP);
		assert.deepEqual(studioIconLinks(withIcon(apiIcon()), null), STOP);
		assert.deepEqual(studioIconLinks(undefined, null), STOP);
		assert.deepEqual(studioIconLinks(undefined, ORIGIN), STOP);
	});

	test("an icon that is not square is not used", () => {
		assert.deepEqual(
			studioIconLinks(withIcon(apiIcon({ width: 180, height: 120 })), ORIGIN),
			STOP,
		);
	});
});
