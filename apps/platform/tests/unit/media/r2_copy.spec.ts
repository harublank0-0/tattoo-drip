import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import { test } from "@japa/runner";
import ImageService, { keyUnder } from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { variantsOfKey } from "#modules/media/variants";
import { useR2StandIn } from "#tests/helpers/r2_stand_in";

/**
 * Publishing a Fresh ink post copies its files from the private bucket to the
 * public one. On R2 an upload must say its length: a copy that streamed a
 * download into an upload without one was refused (MissingContentLength) and
 * every approval answered 500, while the folder disks of the other tests
 * accepted it.
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
});
