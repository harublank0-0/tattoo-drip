import { test } from "@japa/runner";
import sharp from "sharp";
import {
	IMAGE_FORMAT_MESSAGE,
	IMAGE_SIZE_MESSAGE,
	InvalidImageError,
} from "#modules/media/errors";
import {
	makeVariants,
	processImage,
} from "#modules/media/services/image_processor";
import { NO_VARIANTS, VARIANT_WIDTHS } from "#modules/media/variants";
import { POLYGLOT_MARKERS, polyglot, testImages } from "#tests/helpers/images";

test.group("processImage", () => {
	test("keeps no decoded images in sharp's cache", ({ assert }) => {
		const { files, items, memory } = sharp.cache();

		assert.deepEqual([files.max, items.max, memory.max], [0, 0, 0]);
	});

	test("keeps a PNG as PNG", async ({ assert }) => {
		const result = await processImage(await testImages.png());

		assert.equal(result.format, "png");
		assert.equal((await sharp(result.data).metadata()).format, "png");
		assert.deepEqual([result.width, result.height], [300, 200]);
	});

	test("an animated WebP is stored as one still frame (TAT-16)", async ({
		assert,
	}) => {
		const frame = (r: number, g: number, b: number) =>
			sharp({
				create: { width: 64, height: 48, channels: 3, background: { r, g, b } },
			})
				.png()
				.toBuffer();
		const animated = await sharp(
			[await frame(255, 0, 0), await frame(0, 0, 255)],
			{
				join: { animated: true },
			},
		)
			.webp({ loop: 0, delay: [100, 100] })
			.toBuffer();
		// The control: the input really has two frames.
		assert.equal(
			(await sharp(animated, { animated: true }).metadata()).pages,
			2,
		);

		const result = await processImage(animated);

		const after = await sharp(result.data, { animated: true }).metadata();
		assert.equal(after.format, "jpeg");
		assert.isTrue(after.pages === undefined || after.pages === 1);
		assert.deepEqual([result.width, result.height], [64, 48]);
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

	test("keeps sharp's error as the cause, so failures can be traced", async ({
		assert,
	}) => {
		const png = await testImages.png();

		const error = await processImage(png.subarray(0, png.length - 40)).catch(
			(e) => e,
		);

		assert.instanceOf(error, InvalidImageError);
		assert.instanceOf(error.cause, Error);
		assert.notEqual(error.cause.message, error.message);
	});

	test("rejects an image over 40 megapixels with its own message", async ({
		assert,
	}) => {
		const error = await processImage(await testImages.huge()).catch((e) => e);

		assert.instanceOf(error, InvalidImageError);
		assert.equal(error.message, IMAGE_SIZE_MESSAGE);
	});
});

test.group("makeVariants (TAT-112)", () => {
	test("makes 320, 640 and 1280 px copies of a big photo, narrowest first, as JPEG", async ({
		assert,
	}) => {
		const image = await processImage(await testImages.jpeg(4000, 3000));
		assert.deepEqual([image.width, image.height], [2048, 1536]);

		const copies = await makeVariants(image, VARIANT_WIDTHS);

		assert.deepEqual(
			copies.map((copy) => copy.width),
			[320, 640, 1280],
		);
		assert.deepEqual(
			copies.map((copy) => copy.height),
			[240, 480, 960],
		);
		for (const copy of copies) {
			const seen = await sharp(copy.data).metadata();
			assert.equal(seen.format, "jpeg");
			assert.equal(seen.width, copy.width);
			assert.equal(seen.height, copy.height);
			assert.isBelow(copy.data.length, image.data.length);
		}
	});

	test("gives the same bytes as a separate decode for each width", async ({
		assert,
	}) => {
		for (const [format, source] of [
			["jpeg", await testImages.jpeg(2400, 1800)],
			["png", await testImages.transparentPng(1500, 900)],
		] as const) {
			const image = await processImage(source);
			const copies = await makeVariants(image, VARIANT_WIDTHS);
			assert.isAbove(copies.length, 1);

			for (const copy of copies) {
				// What makeVariants did before one source served every width.
				const resized = sharp(image.data, {
					limitInputPixels: 2048 * 2048,
					failOn: "error",
				}).resize({ width: copy.width });
				const alone =
					format === "png"
						? await resized.png().toBuffer()
						: await resized.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
				assert.isTrue(
					copy.data.equals(alone),
					`${format} ${copy.width} px differs`,
				);
			}
		}
	});

	test("never enlarges: only widths below the image's own", async ({
		assert,
	}) => {
		const widths = async (width: number, height: number) =>
			(
				await makeVariants(
					await processImage(await testImages.jpeg(width, height)),
					VARIANT_WIDTHS,
				)
			).map((copy) => copy.width);

		assert.deepEqual(await widths(640, 480), [320]);
		assert.deepEqual(await widths(320, 240), []);
		assert.deepEqual(await widths(300, 200), []);
		assert.deepEqual(
			await makeVariants(
				await processImage(await testImages.jpeg(2048, 1536)),
				NO_VARIANTS,
			),
			[],
		);
	});

	test("a PNG's copies stay PNG, with their transparency", async ({
		assert,
	}) => {
		const image = await processImage(
			await testImages.transparentPng(1000, 400),
		);
		assert.equal(image.format, "png");

		const copies = await makeVariants(image, VARIANT_WIDTHS);

		assert.deepEqual(
			copies.map((copy) => copy.width),
			[320, 640],
		);
		for (const copy of copies) {
			const seen = await sharp(copy.data).metadata();
			assert.equal(seen.format, "png");
			assert.isTrue(seen.hasAlpha);
		}
	});

	test("a strip 4000 x 2 px: copies are 1 px tall, never 0", async ({
		assert,
	}) => {
		const image = await processImage(await testImages.png(4000, 2));
		assert.deepEqual([image.width, image.height], [2048, 1]);

		const copies = await makeVariants(image, VARIANT_WIDTHS);

		assert.deepEqual(
			copies.map((copy) => [copy.width, copy.height]),
			[
				[320, 1],
				[640, 1],
				[1280, 1],
			],
		);
		for (const copy of copies) {
			assert.equal((await sharp(copy.data).metadata()).height, 1);
		}
	});

	test("copies carry no metadata", async ({ assert }) => {
		const input = await testImages.phonePhoto(1200, 900);
		assert.exists((await sharp(input).metadata()).exif);
		const image = await processImage(input);

		const copies = await makeVariants(image, VARIANT_WIDTHS);

		assert.isAbove(copies.length, 0);
		for (const copy of copies) {
			const seen = await sharp(copy.data).metadata();
			assert.isUndefined(seen.exif);
			assert.isUndefined(seen.xmp);
			assert.isUndefined(seen.iptc);
			assert.isFalse(copy.data.includes("Kathmandu studio"));
		}
	});

	test("a polyglot: neither the image nor its copies keep what came after it", async ({
		assert,
	}) => {
		const input = await polyglot();
		for (const marker of POLYGLOT_MARKERS) {
			assert.isTrue(input.includes(marker), marker);
		}

		const image = await processImage(input);
		const copies = await makeVariants(image, VARIANT_WIDTHS);

		assert.isAbove(copies.length, 0);
		for (const data of [image.data, ...copies.map((copy) => copy.data)]) {
			for (const marker of POLYGLOT_MARKERS) {
				assert.isFalse(data.includes(marker), marker);
			}
		}
	});

	test("refuses anything larger than processImage's output", async ({
		assert,
	}) => {
		const error = await makeVariants(
			{
				data: await testImages.jpeg(3000, 3000),
				format: "jpeg",
				width: 3000,
				height: 3000,
			},
			VARIANT_WIDTHS,
		).catch((e) => e);

		assert.instanceOf(error, Error);
	});
});
