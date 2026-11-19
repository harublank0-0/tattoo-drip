import { readFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import DesignProject from "#modules/design_lab/models/design_project";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import PilotGrant from "#modules/packages/models/pilot_grant";
import PaymentMethod from "#modules/payments/models/payment_method";
import ClientPost from "#modules/reviews/models/client_post";
import { formatBytes } from "#modules/storage/categories";
import {
	COUNTED_KEY_COLUMNS,
	EXCLUDED_KEY_COLUMNS,
} from "#modules/storage/live_keys";
import StoredFile from "#modules/storage/models/stored_file";
import StorageMeterService from "#modules/storage/services/storage_meter_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist } from "#tests/helpers/artists";
import { seedDesignLab } from "#tests/helpers/design_lab";
import { testImages } from "#tests/helpers/images";
import {
	artistIn,
	inTenant,
	seededStudio,
	studioWithOwner,
} from "#tests/helpers/tenants";
import { makeClip, videoService } from "#tests/helpers/videos";

const MB = 1048576;

/**
 * The storage meter, measuring (docs/superpowers/specs/2026-11-16-storage-meter-design.md,
 * Rollout step 1): each stored main file, rendition and poster gets a size
 * row; usage counts the rows a live record still holds; the allowance is
 * the package bundle's, v1 bundles reading their package's launch default.
 */
test.group("Storage meter: measuring", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const meter = () => app.container.make(StorageMeterService);
	const usageOf = async (tenant: Tenant) =>
		inTenant(tenant, async () => (await meter()).usage(tenant));
	const rowsOf = (tenant: Tenant) =>
		inTenant(tenant, () => StoredFile.query().orderBy("created_at"));

	/** A studio with an artist whose photo is a stored file of `width` px. */
	async function studioWithPhoto(slug: string, width = 900) {
		const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
		const artist = await addArtist(tenant, owner);
		const png = await testImages.png(width, 700);
		const stored = await inTenant(tenant, () =>
			new ImageService().storeBytes(png, {
				tenant,
				purpose: "artist_photo",
			}),
		);
		await inTenant(tenant, () =>
			Artist.query().where("id", artist.id).update({
				photo_key: stored.key,
				photo_width: stored.width,
				photo_height: stored.height,
			}),
		);
		const bytes = Number(
			(await drive.use("public").getMetaData(stored.key)).contentLength,
		);
		return { tenant, owner, artist, key: stored.key, bytes };
	}

	test("only main files, renditions and posters count", async ({ assert }) => {
		const s = await studioWithPhoto("meter-main");

		const rows = await rowsOf(s.tenant);
		assert.deepEqual(
			rows.map((row) => [row.key, row.status, row.bytes]),
			[[s.key, "stored", s.bytes]],
			"one row, the main file's: never its size copies",
		);
		assert.equal((await usageOf(s.tenant)).usedBytes, s.bytes);

		// A published post's public copy duplicates a private original: no row.
		const images = new ImageService();
		const photo = await testImages.png(400, 300);
		const original = await inTenant(s.tenant, () =>
			images.storeBytes(photo, {
				tenant: s.tenant,
				purpose: "client_post_photo",
			}),
		);
		await images.copyTo(
			"client_post_photo",
			"fresh_ink_photo",
			original.key,
			s.tenant,
		);
		assert.notExists(
			(await rowsOf(s.tenant)).find((row) =>
				row.key.includes("/fresh_ink_photo/"),
			),
		);
	});

	test("soft-deleted records and orphans don't count", async ({ assert }) => {
		const s = await studioWithPhoto("meter-soft");
		assert.equal((await usageOf(s.tenant)).usedBytes, s.bytes);

		await inTenant(s.tenant, () =>
			StoredFile.create({
				tenantId: s.tenant.id,
				key: `tenants/${s.tenant.id}/artist_photo/orphan.jpg`,
				purpose: "artist_photo",
				bytes: 5 * MB,
				status: "stored",
				storedAt: DateTime.utc(),
			}),
		);
		assert.equal(
			(await usageOf(s.tenant)).usedBytes,
			s.bytes,
			"an orphan never counts",
		);

		await inTenant(s.tenant, () =>
			Artist.query()
				.where("id", s.artist.id)
				.update({ deleted_at: new Date() }),
		);
		assert.equal((await usageOf(s.tenant)).usedBytes, 0);
		assert.lengthOf(await rowsOf(s.tenant), 2, "the rows stay");
	});

	test("each record stops counting once it or its parent is deleted", async ({
		assert,
	}) => {
		const studio = await seededStudio("meter-live", "Meter Live");
		const { tenant } = studio;
		const lab = await seedDesignLab(tenant, studio.artist);
		const reference = await inTenant(tenant, () =>
			ReferenceImage.query()
				.where("inquiry_id", studio.newInquiry.id)
				.firstOrFail(),
		);
		const qrKey = `tenants/${tenant.id}/payment_qr/${crypto.randomUUID()}.png`;
		await inTenant(tenant, () =>
			PaymentMethod.query()
				.where("id", studio.depositMethod.id)
				.update({ qr_image_key: qrKey }),
		);
		const counted = async (key: string) => {
			await inTenant(tenant, () =>
				StoredFile.updateOrCreate(
					{ key },
					{
						tenantId: tenant.id,
						key,
						purpose: key.split("/")[2],
						bytes: 1000,
						status: "stored",
						storedAt: DateTime.utc(),
					},
				),
			);
		};
		const cases: {
			name: string;
			keys: string[];
			remove: () => Promise<unknown>;
		}[] = [
			{
				name: "an artist's work photos and flash, with the artist",
				keys: [
					studio.workPhoto.imageKey as string,
					studio.flashDesign.imageKey,
				],
				remove: () =>
					Artist.query()
						.where("id", studio.workPhoto.artistId)
						.update({ deleted_at: new Date() }),
			},
			{
				name: "a payment method's QR",
				keys: [qrKey],
				remove: () =>
					PaymentMethod.query()
						.where("id", studio.depositMethod.id)
						.update({ deleted_at: new Date() }),
			},
			{
				name: "an inquiry's reference photo",
				keys: [reference.imageKey],
				remove: () =>
					ReferenceImage.query()
						.where("id", reference.id)
						.update({ deleted_at: new Date() }),
			},
			{
				name: "a client post's photo, with the post",
				keys: [studio.clientPostPhoto.imageKey as string],
				remove: () =>
					ClientPost.query()
						.where("id", studio.clientPost.id)
						.update({ deleted_at: new Date() }),
			},
			{
				name: "a Design Lab concept, with its project",
				keys: [lab.designAsset.imageKey],
				remove: () =>
					DesignProject.query()
						.where("id", lab.designProject.id)
						.update({ deleted_at: new Date() }),
			},
		];
		for (const { name, keys, remove } of cases) {
			for (const key of keys) await counted(key);
			const live = (await usageOf(tenant)).usedBytes;
			await inTenant(tenant, remove);
			assert.equal(
				live - (await usageOf(tenant)).usedBytes,
				1000 * keys.length,
				`${name}: counted while live, not once deleted`,
			);
		}
	});

	test("usage is broken down by category", async ({ assert }) => {
		const s = await studioWithPhoto("meter-categories");
		const artist = await artistIn(s.tenant, "artist@meter-categories.example");
		await seedDesignLab(s.tenant, artist);

		const usage = await usageOf(s.tenant);
		assert.equal(usage.byCategory.portfolio, s.bytes);
		assert.isAbove(usage.byCategory.design_lab, 0);
		assert.equal(usage.byCategory.clients, 0);
		assert.equal(
			usage.usedBytes,
			usage.byCategory.portfolio + usage.byCategory.design_lab,
		);
	});

	test("v1 bundles read their package's launch default", async ({ assert }) => {
		const grantOn = async (
			tenant: Tenant,
			key: string,
			pkg: "solo" | "studio",
		) => {
			const bundle = await AllowanceBundle.findByOrFail("key", key);
			await inTenant(tenant, () =>
				PilotGrant.create({
					tenantId: tenant.id,
					package: pkg,
					allowanceBundleId: bundle.id,
					startsAt: DateTime.utc().minus({ days: 1 }),
					endsAt: DateTime.utc().plus({ months: 1 }),
					note: "Storage test",
					grantedBy: "Ops",
				}),
			);
		};
		const limitOf = async (tenant: Tenant) =>
			inTenant(tenant, async () => (await meter()).limitBytes(tenant));

		const legacy = (await studioWithOwner("meter-v1", "Meter V1")).tenant;
		await grantOn(legacy, "studio-v1", "studio");
		assert.equal(await limitOf(legacy), 25600 * MB);

		const solo = (await studioWithOwner("meter-solo", "Meter Solo")).tenant;
		await grantOn(solo, "solo-v2", "solo");
		assert.equal(await limitOf(solo), 5120 * MB);

		await AllowanceBundle.create({
			key: "test-null",
			package: "solo",
			imagesPerMonth: 40,
		});
		const unmetered = (await studioWithOwner("meter-null", "Meter Null"))
			.tenant;
		await grantOn(unmetered, "test-null", "solo");
		assert.isNull(await limitOf(unmetered));
	});

	test("a video's renditions and poster are recorded", async ({ assert }) => {
		const { tenant } = await studioWithOwner("meter-video", "Meter Video");
		const clip = await makeClip({ width: 1280, height: 720, seconds: 2 });
		const videos = videoService();
		const key = videos.stagingKey(tenant);
		await drive.use("private").put(key, await readFile(clip.path));

		const outcome = await videos.process(tenant, key);
		assert.equal(outcome.kind, "ready");
		if (outcome.kind !== "ready") return;
		const rows = new Map(
			(await rowsOf(tenant)).map((row) => [row.key, row.bytes]),
		);
		for (const rendition of [...outcome.keys, outcome.posterKey]) {
			assert.equal(
				rows.get(rendition),
				Number(
					(await drive.use("public").getMetaData(rendition)).contentLength,
				),
			);
		}
	});

	test("every file key column is counted or explicitly excluded", async ({
		assert,
	}) => {
		const schema = await readFile(app.makePath("database/schema.ts"), "utf8");
		const found: string[] = [];
		let current = "";
		for (const line of schema.split("\n")) {
			const cls = /^export class (\w+)Schema /.exec(line);
			if (cls) current = cls[1];
			const column = /declare (\w+(?:Key|Keys))[?]?:/.exec(line);
			if (column) found.push(`${current}.${column[1]}`);
		}
		const known = new Set([...COUNTED_KEY_COLUMNS, ...EXCLUDED_KEY_COLUMNS]);
		assert.deepEqual(
			found.filter((name) => !known.has(name)),
			[],
			"a new key column: count it in liveKeysSql or exclude it with a reason",
		);
	});

	test("formatBytes says sizes the way people read them", ({ assert }) => {
		assert.equal(formatBytes(0), "0 KB");
		assert.equal(formatBytes(1536), "1.5 KB");
		assert.equal(formatBytes(340 * MB), "340 MB");
		assert.equal(formatBytes(1.25 * 1024 * MB), "1.3 GB");
		assert.equal(formatBytes(5 * 1024 * MB), "5 GB");
	});
});
