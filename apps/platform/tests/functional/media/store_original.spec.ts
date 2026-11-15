import { test } from "@japa/runner";
import sharp from "sharp";
import { InvalidImageError } from "#modules/media/errors";
import { processImage } from "#modules/media/services/image_processor";
import ImageService from "#modules/media/services/image_service";
import { variantsOfKey } from "#modules/media/variants";

const images = new ImageService();
const tenant = { id: "0199c0de-0000-7000-8000-000000000002" };

/** A busy test card, so re-encoding visibly changes the bytes. */
const card = (width: number, height: number) =>
	sharp({
		create: { width, height, channels: 3, background: "#ffffff" },
	}).composite([
		{
			input: Buffer.from(
				`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${width / 3}" fill="none" stroke="#111" stroke-width="9"/></svg>`,
			),
		},
	]);

/**
 * AI Design Lab keeps a generated image exactly as its provider delivered
 * it (BFL's usage policy forbids removing content provenance such as C2PA),
 * while the display copies come from the cleaned image. Each fixture is one
 * that re-encoding changes, so a pipeline that re-encoded the original
 * (storeBytes) fails here.
 */
test.group("ImageService.storeOriginal", () => {
	test("a PNG is kept byte for byte under a .png key, with copies", async ({
		assert,
	}) => {
		// Uncompressed: processImage's re-encode compresses it.
		const delivered = await card(1024, 1024)
			.png({ compressionLevel: 0 })
			.toBuffer();
		assert.isFalse(
			(await processImage(delivered)).data.equals(delivered),
			"the fixture must be one that re-encoding changes",
		);

		const stored = await images.storeOriginal(delivered, {
			tenant,
			purpose: "design_concept",
		});

		assert.match(
			stored.key,
			/^tenants\/[0-9a-f-]+\/design_concept\/[^/]+\.png$/,
		);
		assert.deepEqual([stored.width, stored.height], [1024, 1024]);
		const file = await images.read("design_concept", stored.key, tenant);
		assert.equal(file.contentType, "image/png");
		assert.isTrue(Buffer.from(file.bytes).equals(delivered));
		assert.isNotEmpty(variantsOfKey(stored.key));
		await images.deleteOrThrow("design_concept", stored.key);
	});

	test("a JPEG keeps its metadata under a .jpg key", async ({ assert }) => {
		// EXIF, which processImage strips from uploads, stands in for C2PA data.
		const delivered = await card(832, 1216)
			.withExif({ IFD0: { Copyright: "Provenance marker" } })
			.jpeg({ quality: 90 })
			.toBuffer();
		assert.isFalse((await processImage(delivered)).data.equals(delivered));

		const stored = await images.storeOriginal(delivered, {
			tenant,
			purpose: "design_concept",
		});

		assert.match(stored.key, /\.jpg$/);
		const file = await images.read("design_concept", stored.key, tenant);
		assert.equal(file.contentType, "image/jpeg");
		assert.isTrue(Buffer.from(file.bytes).equals(delivered));
		const { exif } = await sharp(Buffer.from(file.bytes)).metadata();
		assert.include(exif?.toString("latin1") ?? "", "Provenance marker");
		await images.deleteOrThrow("design_concept", stored.key);
	});

	test("anything that is not an image is refused, as for an upload", async ({
		assert,
	}) => {
		await assert.rejects(
			() =>
				images.storeOriginal(Buffer.from("<svg></svg>"), {
					tenant,
					purpose: "design_concept",
				}),
			InvalidImageError,
		);
	});
});
