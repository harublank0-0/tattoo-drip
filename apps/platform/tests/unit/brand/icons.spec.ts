import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import sharp from "sharp";

const icon = (name: string) =>
	new URL(`../../../public/icons/${name}`, import.meta.url);

test.group("App icons", () => {
	test("are generated at their sizes", async ({ assert }) => {
		const sizes: Record<string, number> = {
			"icon-192.png": 192,
			"icon-512.png": 512,
			"icon-maskable-512.png": 512,
			"apple-touch-icon.png": 180,
			"favicon-32.png": 32,
		};
		for (const [name, size] of Object.entries(sizes)) {
			const { width, height, format } = await sharp(
				await readFile(icon(name)),
			).metadata();
			assert.deepEqual([format, width, height], ["png", size, size], name);
		}
		assert.include(await readFile(icon("favicon.svg"), "utf8"), "<svg");
	});

	test("the maskable and Apple icons have no transparent corners", async ({
		assert,
	}) => {
		for (const name of ["icon-maskable-512.png", "apple-touch-icon.png"]) {
			const { data } = await sharp(await readFile(icon(name)))
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			assert.equal(data[3], 255, `${name}: the top-left pixel is opaque`);
		}
	});
});
