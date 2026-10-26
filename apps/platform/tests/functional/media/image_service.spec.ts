import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import sharp from "sharp";
import { InvalidImageError } from "#modules/media/errors";
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import { variantsOfKey } from "#modules/media/variants";
import env from "#start/env";
import { POLYGLOT_MARKERS, polyglot, testImages } from "#tests/helpers/images";

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

		const url = await images.url("payment_qr", stored.key, tenant);

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

		const url = await images.url("payment_proof", stored.key, tenant);

		assert.isTrue(url.startsWith(`${env.get("APP_URL")}/files/${stored.key}?`));
		assert.include(url, "signature=");
		const served = await client.get(pathOf(url));
		served.assertStatus(200);
		// Proofs and references are never kept by a browser or a proxy.
		served.assertHeader("cache-control", "private, no-store");
		(await client.get(`/files/${stored.key}`)).assertStatus(401);
	});

	test("url refuses a key of another tenant or another purpose", async ({
		assert,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});
		const other = { id: "0199c0de-0000-7000-8000-000000000002" };

		await assert.rejects(
			() => images.url("payment_proof", stored.key, other),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() => images.url("reference_image", stored.key, tenant),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() =>
				images.url(
					"payment_proof",
					`tenants/${tenant.id}/payment_proof/../reference_image/x.webp`,
					tenant,
				),
			/another tenant or purpose/,
		);
	});

	test("the Cache-Control is part of the signature: dropping it is a 401", async ({
		client,
	}) => {
		const stored = await images.store(await upload(await testImages.jpeg()), {
			tenant,
			purpose: "payment_proof",
		});
		const url = new URL(await images.url("payment_proof", stored.key, tenant));
		url.searchParams.delete("cacheControl");

		(await client.get(`${url.pathname}${url.search}`)).assertStatus(401);
	});

	test("removes the raw upload, which still has its metadata", async ({
		assert,
	}) => {
		const accepted = await upload(await testImages.phonePhoto());
		const rejected = await upload(Buffer.from("hello"));

		await images.store(accepted, { tenant, purpose: "payment_proof" });
		await images
			.store(rejected, { tenant, purpose: "payment_proof" })
			.catch(() => {});

		assert.isFalse(existsSync(accepted.tmpPath));
		assert.isFalse(existsSync(rejected.tmpPath));
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

test.group("ImageService.storeBytes", () => {
	test("stores bytes like an upload: processed, private, under tenant and purpose", async ({
		assert,
	}) => {
		const stored = await images.storeBytes(await testImages.jpeg(), {
			tenant,
			purpose: "reference_image",
		});

		assert.match(
			stored.key,
			new RegExp(`^tenants/${tenant.id}/reference_image/${V4}\\.jpg$`),
		);
		assert.deepEqual([stored.width, stored.height], [300, 200]);
		assert.isTrue(await drive.use("private").exists(stored.key));
		assert.isFalse(await drive.use("public").exists(stored.key));
	});
});

/** The files a studio has for a purpose on a disk (the folder the keys name), sorted. */
async function filesOf(
	visibility: "public" | "private",
	studio: { id: string },
	purpose: string,
) {
	const folder = app.tmpPath(
		"storage",
		visibility,
		"tenants",
		studio.id,
		purpose,
	);
	return (await readdir(folder).catch(() => [] as string[])).sort();
}

test.group("ImageService copies (TAT-112)", () => {
	test("an artist photo is stored with its 320, 640 and 1280 px copies beside it, on the public disk", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };

		const stored = await images.store(
			await upload(await testImages.jpeg(2000, 1500)),
			{ tenant: studio, purpose: "artist_photo" },
		);

		assert.match(
			stored.key,
			new RegExp(
				`^tenants/${studio.id}/artist_photo/${V4}\\.320-640-1280\\.jpg$`,
			),
		);
		const files = await filesOf("public", studio, "artist_photo");
		assert.lengthOf(files, 4);
		assert.deepEqual(await filesOf("private", studio, "artist_photo"), []);
		for (const copy of variantsOfKey(stored.key)) {
			const bytes = await readFile(
				join(app.tmpPath("storage", "public"), ...copy.key.split("/")),
			);
			assert.equal((await sharp(bytes).metadata()).width, copy.width);
		}
	});

	test("QR codes and payment screenshots keep one size", async ({ assert }) => {
		const studio = { id: randomUUID() };

		const qr = await images.store(
			await upload(await testImages.png(2000, 1500)),
			{ tenant: studio, purpose: "payment_qr" },
		);
		const proof = await images.store(
			await upload(await testImages.jpeg(2000, 1500)),
			{ tenant: studio, purpose: "payment_proof" },
		);

		assert.match(
			qr.key,
			new RegExp(`^tenants/${studio.id}/payment_qr/${V4}\\.png$`),
		);
		assert.match(
			proof.key,
			new RegExp(`^tenants/${studio.id}/payment_proof/${V4}\\.jpg$`),
		);
		assert.lengthOf(await filesOf("public", studio, "payment_qr"), 1);
		assert.lengthOf(await filesOf("private", studio, "payment_proof"), 1);
	});

	test("an image 320 px wide or narrower is stored as before, without copies", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };

		const stored = await images.store(
			await upload(await testImages.jpeg(320, 240)),
			{ tenant: studio, purpose: "artist_photo" },
		);

		assert.match(
			stored.key,
			new RegExp(`^tenants/${studio.id}/artist_photo/${V4}\\.jpg$`),
		);
		assert.lengthOf(await filesOf("public", studio, "artist_photo"), 1);
	});

	test("variants() gives each copy's public URL, narrowest first, on the image's origin", async ({
		client,
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const stored = await images.store(
			await upload(await testImages.jpeg(2000, 1500)),
			{ tenant: studio, purpose: "artist_photo" },
		);

		const url = await images.url("artist_photo", stored.key, studio);
		const copies = await images.variants("artist_photo", stored.key, studio);

		assert.deepEqual(
			copies.map((copy) => copy.width),
			[320, 640, 1280],
		);
		const named = variantsOfKey(stored.key);
		for (const [index, copy] of copies.entries()) {
			assert.equal(
				copy.url,
				`${env.get("APP_URL")}/uploads/${named[index].key}`,
			);
			assert.equal(new URL(copy.url).origin, new URL(url).origin);
			const response = await client.get(pathOf(copy.url));
			response.assertStatus(200);
			assert.match(response.header("content-type") ?? "", /^image\/jpeg/);
		}
		// An image stored before TAT-112 names no copies.
		assert.deepEqual(
			await images.variants(
				"artist_photo",
				`tenants/${studio.id}/artist_photo/${randomUUID()}.jpg`,
				studio,
			),
			[],
		);
	});

	test("a reference image's copies are private: signed, and never kept", async ({
		client,
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const stored = await images.store(
			await upload(await testImages.jpeg(1000, 800)),
			{ tenant: studio, purpose: "reference_image" },
		);

		const copies = await images.variants("reference_image", stored.key, studio);

		assert.deepEqual(
			copies.map((copy) => copy.width),
			[320, 640],
		);
		const named = variantsOfKey(stored.key);
		for (const [index, copy] of copies.entries()) {
			const copyKey = named[index].key;
			assert.isTrue(
				copy.url.startsWith(`${env.get("APP_URL")}/files/${copyKey}?`),
			);
			assert.include(copy.url, "signature=");
			const served = await client.get(pathOf(copy.url));
			served.assertStatus(200);
			served.assertHeader("cache-control", "private, no-store");
			(await client.get(`/files/${copyKey}`)).assertStatus(401);
			(await client.get(`/uploads/${copyKey}`)).assertStatus(404);

			const noCache = new URL(copy.url);
			noCache.searchParams.delete("cacheControl");
			(await client.get(pathOf(noCache.href))).assertStatus(401);
		}
		// A signature is for one path: the 320 px copy's, with the 640 px name.
		const swapped = pathOf(copies[0].url).replace(".320w.", ".640w.");
		(await client.get(swapped)).assertStatus(401);
		assert.deepEqual(await filesOf("public", studio, "reference_image"), []);
		assert.lengthOf(await filesOf("private", studio, "reference_image"), 3);
	});

	test("variants() and urlFor() refuse a key of another tenant or purpose, as url() does", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const stored = await images.store(
			await upload(await testImages.jpeg(1000, 800)),
			{ tenant: studio, purpose: "reference_image" },
		);
		const other = { id: randomUUID() };

		await assert.rejects(
			() => images.variants("reference_image", stored.key, other),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() => images.variants("payment_proof", stored.key, studio),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() =>
				images.variants(
					"reference_image",
					`tenants/${studio.id}/reference_image/../payment_proof/x.320-640.jpg`,
					studio,
				),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() => images.urlFor("reference_image", stored.key, other, 320),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() => images.urlFor("payment_proof", stored.key, studio, 320),
			/another tenant or purpose/,
		);
		await assert.rejects(
			() =>
				images.urlFor(
					"reference_image",
					`tenants/${studio.id}/reference_image/../payment_proof/x.320-640.jpg`,
					studio,
					320,
				),
			/another tenant or purpose/,
		);
	});

	test("urlFor gives the narrowest copy at least that wide, else the image", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const stored = await images.store(
			await upload(await testImages.jpeg(1000, 800)),
			{ tenant: studio, purpose: "reference_image" },
		);
		const pathnameOf = (url: string) => new URL(url).pathname;
		const [small, medium] = variantsOfKey(stored.key);

		const narrow = await images.urlFor(
			"reference_image",
			stored.key,
			studio,
			THUMBNAIL_WIDTH,
		);
		const wider = await images.urlFor(
			"reference_image",
			stored.key,
			studio,
			321,
		);
		const widest = await images.urlFor(
			"reference_image",
			stored.key,
			studio,
			700,
		);

		assert.equal(THUMBNAIL_WIDTH, 320);
		assert.equal(pathnameOf(narrow), `/files/${small.key}`);
		assert.include(narrow, "signature=");
		assert.equal(pathnameOf(wider), `/files/${medium.key}`);
		assert.equal(pathnameOf(widest), `/files/${stored.key}`);
		assert.include(widest, "signature=");

		const old = `tenants/${studio.id}/reference_image/${randomUUID()}.jpg`;
		assert.equal(
			pathnameOf(await images.urlFor("reference_image", old, studio, 320)),
			`/files/${old}`,
		);
	});

	test("shownImage gives the URL, the stored size and the copies", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const stored = await images.store(
			await upload(await testImages.jpeg(2000, 1500)),
			{ tenant: studio, purpose: "artist_photo" },
		);

		const shown = await images.shownImage("artist_photo", stored.key, studio, {
			width: stored.width,
			height: stored.height,
		});

		assert.deepEqual(shown, {
			url: await images.url("artist_photo", stored.key, studio),
			width: 2000,
			height: 1500,
			variants: await images.variants("artist_photo", stored.key, studio),
		});
		assert.lengthOf(shown.variants, 3);
	});

	test("when the copies can't be made, the upload is still stored, as before", async ({
		assert,
	}) => {
		class NoCopies extends ImageService {
			protected override makeVariants(): Promise<never> {
				return Promise.reject(new Error("no copies"));
			}
		}
		const studio = { id: randomUUID() };

		const stored = await new NoCopies().store(
			await upload(await testImages.jpeg(2000, 1500)),
			{ tenant: studio, purpose: "artist_photo" },
		);

		assert.match(
			stored.key,
			new RegExp(`^tenants/${studio.id}/artist_photo/${V4}\\.jpg$`),
		);
		assert.lengthOf(await filesOf("public", studio, "artist_photo"), 1);
		assert.deepEqual(
			await images.variants("artist_photo", stored.key, studio),
			[],
		);
	});

	test("when writing a copy fails half way, no copy is left and the image is stored without any", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const disk = drive.use("public");
		const put = disk.put.bind(disk);
		let writes = 0;
		disk.put = async (key: string, ...rest: unknown[]) => {
			writes += 1;
			if (writes === 2) throw new Error("disk full");
			return (put as (...args: unknown[]) => Promise<void>)(key, ...rest);
		};
		try {
			const stored = await images.store(
				await upload(await testImages.jpeg(2000, 1500)),
				{ tenant: studio, purpose: "artist_photo" },
			);

			// 1st copy written, 2nd failed, then the image alone (3rd write).
			assert.equal(writes, 3);
			assert.match(
				stored.key,
				new RegExp(`^tenants/${studio.id}/artist_photo/${V4}\\.jpg$`),
			);
			assert.lengthOf(await filesOf("public", studio, "artist_photo"), 1);
		} finally {
			disk.put = put;
		}
	});

	test("when the image's own write fails, its copies are removed and the error is thrown", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };
		const disk = drive.use("public");
		const put = disk.put.bind(disk);
		disk.put = async (key: string, ...rest: unknown[]) => {
			// The image is written after its three copies; its name has two widths.
			if (/\.320-640-1280\.jpg$/.test(key)) throw new Error("disk full");
			return (put as (...args: unknown[]) => Promise<void>)(key, ...rest);
		};
		try {
			await assert.rejects(
				async () =>
					images.store(await upload(await testImages.jpeg(2000, 1500)), {
						tenant: studio,
						purpose: "artist_photo",
					}),
				/disk full/,
			);

			assert.deepEqual(await filesOf("public", studio, "artist_photo"), []);
		} finally {
			disk.put = put;
		}
	});

	test("a polyglot upload: the image and its copies are clean", async ({
		assert,
	}) => {
		const studio = { id: randomUUID() };

		await images.store(await upload(await polyglot()), {
			tenant: studio,
			purpose: "artist_photo",
		});

		const folder = app.tmpPath(
			"storage",
			"public",
			"tenants",
			studio.id,
			"artist_photo",
		);
		const files = await filesOf("public", studio, "artist_photo");
		assert.lengthOf(files, 3);
		for (const file of files) {
			const bytes = await readFile(join(folder, file));
			for (const marker of POLYGLOT_MARKERS) {
				assert.isFalse(bytes.includes(marker), `${file} keeps ${marker}`);
			}
		}
	});

	test("a phone photo's copies have no EXIF or GPS", async ({ assert }) => {
		const studio = { id: randomUUID() };

		await images.store(await upload(await testImages.phonePhoto(1200, 900)), {
			tenant: studio,
			purpose: "reference_image",
		});

		const folder = app.tmpPath(
			"storage",
			"private",
			"tenants",
			studio.id,
			"reference_image",
		);
		const files = await filesOf("private", studio, "reference_image");
		assert.lengthOf(files, 3);
		for (const file of files) {
			const bytes = await readFile(join(folder, file));
			const seen = await sharp(bytes).metadata();
			assert.isUndefined(seen.exif, file);
			assert.isFalse(bytes.includes("Kathmandu studio"), file);
		}
	});
});
