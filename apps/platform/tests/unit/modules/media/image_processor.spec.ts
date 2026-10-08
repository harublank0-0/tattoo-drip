import { test } from "@japa/runner";
import sharp from "sharp";
import {
	IMAGE_FORMAT_MESSAGE,
	IMAGE_SIZE_MESSAGE,
	InvalidImageError,
} from "#modules/media/errors";
import { processImage } from "#modules/media/services/image_processor";
import { testImages } from "#tests/helpers/images";

test.group("processImage", () => {
	test("keeps a PNG as PNG", async ({ assert }) => {
		const result = await processImage(await testImages.png());

		assert.equal(result.format, "png");
		assert.equal((await sharp(result.data).metadata()).format, "png");
		assert.deepEqual([result.width, result.height], [300, 200]);
	});

	test("drops EXIF and GPS from a phone photo", async ({ assert }) => {
		const input = await testImages.phonePhoto();
		assert.exists((await sharp(input).metadata()).exif);
		assert.isTrue(input.includes("Kathmandu studio"));

		const result = await processImage(input);

		const after = await sharp(result.data).metadata();
		assert.equal(result.format, "jpeg");
		assert.isUndefined(after.exif);
		assert.isUndefined(after.xmp);
		assert.isUndefined(after.iptc);
		assert.isFalse(result.data.includes("Kathmandu studio"));
	});

	test("turns a sideways phone photo upright", async ({ assert }) => {
		const result = await processImage(await testImages.phonePhoto());

		assert.deepEqual([result.width, result.height], [200, 300]);
		assert.isUndefined((await sharp(result.data).metadata()).orientation);
	});

	test("fits big images in 2048 px and never enlarges small ones", async ({
		assert,
	}) => {
		const big = await processImage(await testImages.jpeg(4000, 3000));
		assert.deepEqual([big.width, big.height], [2048, 1536]);

		const small = await processImage(await testImages.jpeg(300, 200));
		assert.deepEqual([small.width, small.height], [300, 200]);
	});

	test("turns a WebP into a JPEG with transparency on white", async ({
		assert,
	}) => {
		const result = await processImage(await testImages.transparentWebp());

		assert.equal(result.format, "jpeg");
		const [r, g, b] = await sharp(result.data).raw().toBuffer();
		assert.deepEqual([r, g, b], [255, 255, 255]);
	});

	test("rejects {$self}")
		.with([
			{
				name: "a text file",
				make: async () => Buffer.from("hello, not an image"),
			},
			{ name: "an empty file", make: async () => Buffer.alloc(0) },
			{
				name: "an SVG",
				make: async () =>
					Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
					),
			},
			{ name: "a GIF", make: () => testImages.gif() },
			{ name: "a HEIF/HEIC file", make: () => testImages.heif() },
			{
				name: "a truncated PNG",
				make: async () => {
					const png = await testImages.png();
					return png.subarray(0, png.length - 40);
				},
			},
			{
				name: "a truncated JPEG",
				make: async () => {
					const jpeg = await testImages.jpeg(400, 400);
					return jpeg.subarray(0, jpeg.length / 2);
				},
			},
		])
		.run(async ({ assert }, row) => {
			const error = await processImage(await row.make()).catch((e) => e);

			assert.instanceOf(error, InvalidImageError);
			assert.equal(error.message, IMAGE_FORMAT_MESSAGE);
		});

	test("rejects an image over 40 megapixels with its own message", async ({
		assert,
	}) => {
		const error = await processImage(await testImages.huge()).catch((e) => e);

		assert.instanceOf(error, InvalidImageError);
		assert.equal(error.message, IMAGE_SIZE_MESSAGE);
	});
});
