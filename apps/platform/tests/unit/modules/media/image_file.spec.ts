import { MultipartFile } from "@adonisjs/core/bodyparser";
import { test } from "@japa/runner";
import vine from "@vinejs/vine";
import { imageFile } from "#modules/media/validators/image_file";

/** A file the body parser has finished reading, as the validator sees it. */
function fakeUpload(clientName: string, size: number) {
	const file = new MultipartFile(
		{ fieldName: "image", clientName, headers: {} },
		{},
	);
	file.size = size;
	file.extname = clientName.split(".").pop();
	file.state = "consumed";
	return file;
}

const validator = vine.create({ image: imageFile() });

test.group("imageFile", () => {
	test("accepts {$self}")
		.with(["qr.png", "qr.jpg", "qr.jpeg", "qr.webp"])
		.run(async ({ assert }, name) => {
			const { image } = await validator.validate({
				image: fakeUpload(name, 1000),
			});

			assert.equal(image.clientName, name);
		});

	test("rejects {$self.name}")
		.with([
			{ name: "a GIF", file: () => fakeUpload("qr.gif", 1000) },
			{ name: "an SVG", file: () => fakeUpload("qr.svg", 1000) },
			{
				name: "a PNG over 10 MB",
				file: () => fakeUpload("qr.png", 11 * 1024 * 1024),
			},
		])
		.run(async ({ assert }, row) => {
			await assert.rejects(() => validator.validate({ image: row.file() }));
		});
});
