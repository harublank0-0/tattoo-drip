import { test } from "@japa/runner";
import {
	NO_VARIANTS,
	originalKey,
	VARIANT_WIDTHS,
	variantKey,
	variantsOfKey,
	variantWidths,
} from "#modules/media/variants";

const BASE = "tenants/6a3f2c1e-0d4b-4a8e-9f10-2b7c5d9e8a41/artist_photo/abc123";

test.group("image copies' keys (TAT-112)", () => {
	test("an image is never enlarged: only widths below its own", ({
		assert,
	}) => {
		const cases: [number, number[]][] = [
			[2048, [320, 640, 1280]],
			[1281, [320, 640, 1280]],
			[1280, [320, 640]],
			[641, [320, 640]],
			[640, [320]],
			[321, [320]],
			[320, []],
			[300, []],
			[1, []],
		];
		for (const [width, expected] of cases) {
			assert.deepEqual(
				variantWidths(width, VARIANT_WIDTHS),
				expected,
				`${width}`,
			);
		}
		assert.deepEqual(variantWidths(2048, NO_VARIANTS), []);
	});

	test("a key names its copies and reads them back", ({ assert }) => {
		for (const extension of ["jpg", "png"] as const) {
			const key = originalKey(BASE, extension, [320, 640, 1280]);

			assert.equal(key, `${BASE}.320-640-1280.${extension}`);
			assert.deepEqual(variantsOfKey(key), [
				{ width: 320, key: `${BASE}.320w.${extension}` },
				{ width: 640, key: `${BASE}.640w.${extension}` },
				{ width: 1280, key: `${BASE}.1280w.${extension}` },
			]);
			assert.equal(
				variantKey(BASE, 640, extension),
				`${BASE}.640w.${extension}`,
			);
		}
	});

	test("an image without copies keeps the old form of key", ({ assert }) => {
		assert.equal(originalKey(BASE, "png", []), `${BASE}.png`);
		assert.equal(originalKey(BASE, "jpg", []), `${BASE}.jpg`);
	});

	test("every copy stays in the image's own tenant and purpose folder", ({
		assert,
	}) => {
		const prefix = BASE.slice(0, BASE.lastIndexOf("/") + 1);
		const copies = variantsOfKey(originalKey(BASE, "jpg", [320, 640, 1280]));

		assert.lengthOf(copies, 3);
		for (const copy of copies) {
			assert.isTrue(copy.key.startsWith(prefix), copy.key);
			assert.isFalse(copy.key.includes(".."), copy.key);
			assert.isFalse(copy.key.slice(prefix.length).includes("/"), copy.key);
		}
	});

	test("a key that names no copies gives none", ({ assert }) => {
		const keys = [
			`${BASE}.jpg`,
			`${BASE}.png`,
			`${BASE}.webp`,
			`${BASE}.320w.jpg`,
			`${BASE}.640-320.jpg`,
			`${BASE}.320-320.jpg`,
			`${BASE}.0.jpg`,
			`${BASE}.0320.jpg`,
			`${BASE}.12345.jpg`,
			`${BASE}.320.gif`,
			`${BASE}.320.jpg.exe`,
			"tenants/a/../b/x.320.jpg",
			`${BASE}.1-2-3-4-5-6-7-8-9.jpg`,
			`${BASE}.320-640.JPG`,
			`${BASE}.320-640.jpg\n`,
			"",
		];
		for (const key of keys) {
			assert.deepEqual(variantsOfKey(key), [], JSON.stringify(key));
		}
	});
});
