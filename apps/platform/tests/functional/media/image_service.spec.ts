import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { InvalidImageError } from "#modules/media/errors";
import ImageService from "#modules/media/services/image_service";
import env from "#start/env";
import { testImages } from "#tests/helpers/images";

const images = new ImageService();
const tenant = { id: "0199c0de-0000-7000-8000-000000000001" };
/** A random (v4) UUID; time-based v7 keys would be guessable. */
const V4 =
	"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * What the body parser hands over: the upload written to a temp file.
 * Kept under tmp/storage, which the test hooks clear.
 */
async function upload(data: Buffer) {
	await mkdir(app.tmpPath("storage/uploads"), { recursive: true });
	const tmpPath = app.tmpPath("storage/uploads", randomUUID());
	await writeFile(tmpPath, data);
	return { tmpPath };
}

/** Image URLs are absolute (APP_URL) so other origins can show them. */
function pathOf(url: string) {
	const { pathname, search } = new URL(url);
	return pathname + search;
}

test.group("ImageService", () => {
	test("stores a QR code on the public disk under tenant and purpose", async ({
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.png()), {
			tenant,
			purpose: "payment_qr",
		});

		assert.match(
			stored.key,
			new RegExp(`^tenants/${tenant.id}/payment_qr/${V4}\\.png$`),
		);
		assert.deepEqual([stored.width, stored.height], [300, 200]);
		assert.isTrue(await drive.use("public").exists(stored.key));
		assert.isFalse(await drive.use("private").exists(stored.key));
	});

	test("stores a payment proof on the private disk only, as JPEG", async ({
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});

		assert.match(
			stored.key,
			new RegExp(`^tenants/${tenant.id}/payment_proof/${V4}\\.jpg$`),
		);
		assert.isTrue(await drive.use("private").exists(stored.key));
		assert.isFalse(await drive.use("public").exists(stored.key));
	});

	test("gives every upload its own random key", async ({ assert }) => {
		const png = await testImages.png();

		const first = await images.store(await upload(png), {
			tenant,
			purpose: "payment_qr",
		});
		const second = await images.store(await upload(png), {
			tenant,
			purpose: "payment_qr",
		});

		assert.notEqual(first.key, second.key);
	});

	test("a public image is served at its URL", async ({ client, assert }) => {
		const stored = await images.store(await upload(await testImages.png()), {
			tenant,
			purpose: "payment_qr",
		});

		const url = await images.url("payment_qr", stored.key);

		assert.equal(url, `${env.get("APP_URL")}/uploads/${stored.key}`);
		const response = await client.get(pathOf(url));
		response.assertStatus(200);
		assert.match(response.header("content-type") ?? "", /^image\/png/);
	});

	test("a private image is served only through its signed URL", async ({
		client,
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});

		const url = await images.url("payment_proof", stored.key);

		assert.isTrue(url.startsWith(`${env.get("APP_URL")}/files/${stored.key}?`));
		assert.include(url, "signature=");
		(await client.get(pathOf(url))).assertStatus(200);
		(await client.get(`/files/${stored.key}`)).assertStatus(401);
	});

	test("rejects an upload that isn't an image", async ({ assert }) => {
		const file = await upload(Buffer.from("hello"));

		await assert.rejects(
			() => images.store(file, { tenant, purpose: "payment_qr" }),
			InvalidImageError,
		);
	});

	test("delete removes the file, and ignores one that's already gone", async ({
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.png()), {
			tenant,
			purpose: "payment_qr",
		});

		await images.delete("payment_qr", stored.key);

		assert.isFalse(await drive.use("public").exists(stored.key));
		await images.delete("payment_qr", stored.key);
	});
});
