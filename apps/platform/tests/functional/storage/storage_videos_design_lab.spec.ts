import { Readable } from "node:stream";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import GenerationRunner from "#modules/design_lab/services/generation_runner";
import {
	DESIGN_STORAGE_ESTIMATE,
	designReservationKey,
} from "#modules/design_lab/storage_reservation";
import VideoService from "#modules/media/services/video_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { addWorkPhoto } from "#tests/helpers/artists";
import {
	designProvider,
	designProviders,
	generateForm,
	seedDesignLab,
} from "#tests/helpers/design_lab";
import {
	enforceStorage,
	MB,
	smallStudio,
	storedFilesOf,
	unsetStorageEnforcement,
} from "#tests/helpers/storage";
import { artistIn, inTenant } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * Videos and Design Lab concepts hold the studio's storage too (the storage
 * meter, step 2): a work video from its signing until its upload is
 * processed, a concept (8 MB, an estimate) from its submit until it is
 * stored or fails.
 */
test.group("Storage: videos and Design Lab", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		designProvider.reset();
		designProviders.off = false;
		return () => {
			designProvider.reset();
			unsetStorageEnforcement();
		};
	});

	const reservations = async (tenant: Tenant) =>
		(await storedFilesOf(tenant)).filter((row) => row.status === "reserved");

	test("signing a work video for a full studio is refused on its field, and nothing is held", async ({
		client,
		assert,
	}) => {
		const s = await smallStudio("vid-full", MB - 600);
		const lead = await inTenant(s.tenant, () =>
			addWorkPhoto(s.tenant, s.artist),
		);
		enforceStorage(true);

		const response = await client
			.post(`/t/${s.tenant.slug}/artists/photos/${lead.id}/videos/sign`)
			.json({ type: "video/mp4", size: 5 * MB })
			.accept("json")
			.loginAs(s.owner)
			.withCsrfToken();

		response.assertStatus(422);
		const errors = response.body().errors as {
			field: string;
			message: string;
		}[];
		assert.equal(errors[0].field, "video");
		assert.match(errors[0].message, /^This upload needs 5 MB, but your studio/);
		assert.lengthOf(await reservations(s.tenant), 0);
	});

	test("a signed work video holds its size for the upload's window, longer once added, until its upload is cleaned up", async ({
		assert,
	}) => {
		const s = await smallStudio("vid-hold", 0);
		enforceStorage(true);
		const videos = await app.container.make(VideoService);
		const photos = await app.container.make(WorkPhotoService);
		const lead = await inTenant(s.tenant, () =>
			addWorkPhoto(s.tenant, s.artist),
		);
		const key = videos.stagingKey(s.tenant);
		const size = 300_000;
		const minutesLeft = async () => {
			const [row] = await reservations(s.tenant);
			return row.expiresAt
				? Math.round(row.expiresAt.diffNow().as("minutes"))
				: null;
		};

		await inTenant(s.tenant, () =>
			videos.signUpload(s.tenant, key, { type: "video/mp4", size }),
		);
		assert.deepEqual(
			(await reservations(s.tenant)).map((row) => [
				row.key,
				row.bytes,
				row.purpose,
			]),
			[[`reserve:${key}`, size, "work_video"]],
		);
		// An upload that never arrives gives its space back soon.
		assert.equal(await minutesLeft(), 20);

		await videos.writeStaged(
			s.tenant,
			key,
			Readable.from([Buffer.alloc(size)]),
			size,
		);
		await inTenant(s.tenant, () =>
			photos.addVideo(
				s.tenant,
				{ userId: s.owner.id, role: "owner" },
				s.artist,
				lead,
				{
					tenantId: s.tenant.id,
					leadId: lead.id,
					key,
					type: "video/mp4",
					size,
				},
				null,
			),
		);
		// Added: held while the worker processes it.
		assert.equal(await minutesLeft(), 75);

		await videos.deleteStaged(s.tenant, key);
		assert.lengthOf(await reservations(s.tenant), 0);
	});

	test("a client's video is signed for a full studio, holding nothing", async ({
		assert,
	}) => {
		const s = await smallStudio("vid-client", MB - 600);
		enforceStorage(true);
		const videos = await app.container.make(VideoService);
		const key = videos.stagingKey(s.tenant);

		await inTenant(s.tenant, () =>
			videos.signUpload(
				s.tenant,
				key,
				{ type: "video/mp4", size: 5 * MB },
				"client_post_video",
			),
		);
		assert.lengthOf(await reservations(s.tenant), 0);
	});

	test("a Design Lab submit for a full studio is refused on variations, and nothing is queued", async ({
		client,
		assert,
	}) => {
		const s = await smallStudio("lab-full-storage", 0);
		const artist = await artistIn(s.tenant, "artist@lab-full-storage.example");
		const { designProject } = await seedDesignLab(s.tenant, artist);
		enforceStorage(true);
		const before = await inTenant(s.tenant, () =>
			DesignGeneration.query().count("* as total").first(),
		);

		const response = await client
			.post(`/t/${s.tenant.slug}/design-lab/${designProject.id}/generations`)
			.loginAs(artist)
			.withCsrfToken()
			.redirects(0)
			.form(generateForm());

		response.assertStatus(302);
		assertValidationError(response, "variations");
		const after = await inTenant(s.tenant, () =>
			DesignGeneration.query().count("* as total").first(),
		);
		assert.equal(after?.$extras.total, before?.$extras.total);
		assert.lengthOf(await reservations(s.tenant), 0);
	});

	test("a concept's reservation is replaced once it is stored, and released when the generation fails", async ({
		client,
		assert,
	}) => {
		const s = await smallStudio("lab-hold", 0);
		// Room for the 8 MB estimate: the test bundle is 1 MB, so observe.
		enforceStorage(false);
		const artist = await artistIn(s.tenant, "artist@lab-hold.example");
		const { designProject } = await seedDesignLab(s.tenant, artist);
		const runner = await app.container.make(GenerationRunner);
		const drive = async (id: string) => {
			for (let index = 0; index < 6; index++) {
				const row = await inTenant(s.tenant, () =>
					DesignGeneration.findOrFail(id),
				);
				if (["completed", "failed", "moderated"].includes(row.status)) {
					return row;
				}
				await runner.run(s.tenant, row.id, row.attempt, row.step);
			}
			throw new Error("the generation did not finish");
		};

		(
			await client
				.post(`/t/${s.tenant.slug}/design-lab/${designProject.id}/generations`)
				.loginAs(artist)
				.withCsrfToken()
				.redirects(0)
				.form(generateForm({ variations: "2" }))
		).assertStatus(302);
		const queued = await inTenant(s.tenant, () =>
			DesignGeneration.query()
				.where("status", "queued")
				.orderBy("variant_index"),
		);
		assert.lengthOf(queued, 2);
		assert.sameDeepMembers(
			(await reservations(s.tenant)).map((row) => [row.key, row.bytes]),
			queued.map((row) => [
				designReservationKey(row.id, 1),
				DESIGN_STORAGE_ESTIMATE,
			]),
		);

		const [stored, failed] = queued;
		const done = await drive(stored.id);
		assert.equal(done.status, "completed");
		designProvider.nextPolls.push({ state: "error", providerStatus: "Error" });
		const ended = await drive(failed.id);
		assert.equal(ended.status, "failed");

		assert.lengthOf(await reservations(s.tenant), 0);
		const concepts = (await storedFilesOf(s.tenant)).filter(
			(row) => row.purpose === "design_concept" && row.status === "stored",
		);
		assert.isAtLeast(concepts.length, 1);
	});
});
