import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import { test } from "@japa/runner";
import { ImageCopyError } from "#modules/media/errors";
import ImageService, { keyUnder } from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { variantsOfKey } from "#modules/media/variants";
import { captureLogs } from "#tests/helpers/logs";
import { useR2StandIn } from "#tests/helpers/r2_stand_in";

/**
 * Publishing a Fresh ink post copies its files from the private bucket to the
 * public one. On R2 an upload must say its length: a copy that streamed a
 * download into an upload without one was refused (MissingContentLength) and
 * every approval answered 500, while the folder disks of the other tests
 * accepted it. A photo is copied whole, so one failed upload is tried again.
 * A copy that still fails removes what it wrote, logs why and throws
 * ImageCopyError, which every page words as "nothing changed, try again".
 */
test.group("Copies between R2 buckets (Fresh ink publishing)", (group) => {
	let r2: Awaited<ReturnType<typeof useR2StandIn>>;
	group.each.setup(async () => {
		r2 = await useR2StandIn();
		return () => r2.restore();
	});

	test("a photo and its copies reach the public bucket, each with its length", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const key = `tenants/${tenant.id}/client_post_photo/${randomUUID()}.320-640.jpg`;
		const files = [key, ...variantsOfKey(key).map((copy) => copy.key)];
		files.forEach((file, index) => {
			r2.put("private", file, Buffer.alloc(1_000 * (index + 1), index));
		});

		const published = await (await app.container.make(ImageService)).copyTo(
			"client_post_photo",
			"fresh_ink_photo",
			key,
			tenant,
		);

		assert.deepEqual(r2.refused, []);
		assert.equal(
			published,
			keyUnder(key, "client_post_photo", "fresh_ink_photo"),
		);
		for (const file of files) {
			const target = keyUnder(file, "client_post_photo", "fresh_ink_photo");
			assert.deepEqual(r2.get("public", target), r2.get("private", file));
		}
	});

	test("a photo's upload that R2 fails once is tried again", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const key = `tenants/${tenant.id}/client_post_photo/${randomUUID()}.jpg`;
		r2.put("private", key, Buffer.alloc(1_000, 1));
		r2.failNextPuts(1);

		await (await app.container.make(ImageService)).copyTo(
			"client_post_photo",
			"fresh_ink_photo",
			key,
			tenant,
		);

		assert.deepEqual(
			r2.get("public", keyUnder(key, "client_post_photo", "fresh_ink_photo")),
			r2.get("private", key),
		);
	});

	test("a video's renditions and its poster reach the public bucket, each with its length", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const folder = `tenants/${tenant.id}/client_post_video`;
		const renditions = [
			`${folder}/${randomUUID()}.720.mp4`,
			`${folder}/${randomUUID()}.1080.mp4`,
		];
		const poster = `${folder}/${randomUUID()}.320.jpg`;
		const files = [
			...renditions,
			poster,
			...variantsOfKey(poster).map((copy) => copy.key),
		];
		files.forEach((file, index) => {
			r2.put("private", file, Buffer.alloc(2_000 * (index + 1), index));
		});

		await (await app.container.make(VideoService)).copyTo(
			tenant,
			poster,
			renditions,
			"client_post_video",
			"fresh_ink_video",
		);

		assert.deepEqual(r2.refused, []);
		for (const file of files) {
			const target = keyUnder(file, "client_post_video", "fresh_ink_video");
			assert.deepEqual(r2.get("public", target), r2.get("private", file));
		}
	});

	test("a photo copy R2 keeps failing removes what it wrote, is logged and throws ImageCopyError", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const key = `tenants/${tenant.id}/client_post_photo/${randomUUID()}.320-640.jpg`;
		for (const file of [key, ...variantsOfKey(key).map((copy) => copy.key)]) {
			r2.put("private", file, Buffer.alloc(1_000, 1));
		}
		// The image and its first copy are written, the last copy never is.
		r2.failNextPuts(Number.POSITIVE_INFINITY, (path) =>
			path.endsWith(".640w.jpg"),
		);
		const logs = captureLogs();
		let thrown: unknown;
		try {
			await (await app.container.make(ImageService)).copyTo(
				"client_post_photo",
				"fresh_ink_photo",
				key,
				tenant,
			);
		} catch (error) {
			thrown = error;
		} finally {
			logs.restore();
		}

		assert.instanceOf(thrown, ImageCopyError);
		assert.deepEqual(r2.keys("public"), []);
		assert.lengthOf(logs.errors(), 1);
		assert.containsSubset(logs.errors()[0][0], {
			tenantId: tenant.id,
			purpose: "fresh_ink_photo",
			key,
		});
	});

	test("a wrong poster key is a caller bug: thrown as it is, never as ImageCopyError, and the renditions copied are removed", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const rendition = `tenants/${tenant.id}/client_post_video/${randomUUID()}.720.mp4`;
		r2.put("private", rendition, Buffer.alloc(2_000, 3));
		const otherTenant = randomUUID();
		const poster = `tenants/${otherTenant}/client_post_video/${randomUUID()}.jpg`;

		let thrown: unknown;
		try {
			await (await app.container.make(VideoService)).copyTo(
				tenant,
				poster,
				[rendition],
				"client_post_video",
				"fresh_ink_video",
			);
		} catch (error) {
			thrown = error;
		}

		assert.notInstanceOf(thrown, ImageCopyError);
		assert.match(String(thrown), /key of another tenant or purpose/);
		assert.deepEqual(r2.keys("public"), []);
	});

	test("a video copy R2 fails removes what it wrote, is logged once and throws ImageCopyError", async ({
		assert,
	}) => {
		const tenant = { id: randomUUID() };
		const folder = `tenants/${tenant.id}/client_post_video`;
		const renditions = [
			`${folder}/${randomUUID()}.720.mp4`,
			`${folder}/${randomUUID()}.1080.mp4`,
		];
		const poster = `${folder}/${randomUUID()}.jpg`;
		for (const file of [...renditions, poster]) {
			r2.put("private", file, Buffer.alloc(2_000, 2));
		}
		// The first rendition is written, the second never is.
		r2.failNextPuts(Number.POSITIVE_INFINITY, (path) =>
			path.endsWith(".1080.mp4"),
		);
		const logs = captureLogs();
		let thrown: unknown;
		try {
			await (await app.container.make(VideoService)).copyTo(
				tenant,
				poster,
				renditions,
				"client_post_video",
				"fresh_ink_video",
			);
		} catch (error) {
			thrown = error;
		} finally {
			logs.restore();
		}

		assert.instanceOf(thrown, ImageCopyError);
		assert.deepEqual(r2.keys("public"), []);
		assert.lengthOf(logs.errors(), 1);
		assert.containsSubset(logs.errors()[0][0], {
			tenantId: tenant.id,
			purpose: "fresh_ink_video",
		});
	});
});
