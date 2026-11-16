import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ImageService from "#modules/media/services/image_service";
import StoredFile from "#modules/storage/models/stored_file";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist } from "#tests/helpers/artists";
import { testImages } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
// No #commands alias exists, so the command is imported by path.
import StorageReconcile from "../../../commands/storage_reconcile.js";

/**
 * `storage:reconcile` (docs/superpowers/specs/2026-11-16-storage-meter-design.md,
 * Backfill and reconcile): makes the ledger match storage for the files live
 * records hold, safe to run again.
 */
test.group("Storage: reconcile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	// Raw mode keeps the command's log lines for assertLogMatches.
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	async function run(...args: string[]) {
		const command = await ace.create(StorageReconcile, args);
		await command.exec();
		return command;
	}

	const rowsOf = (tenant: Tenant) =>
		inTenant(tenant, () => StoredFile.query().orderBy("key"));

	/** A studio whose artist's photo is stored; `keepRow` false drops its size row, as before the meter. */
	async function studioWithPhoto(slug: string, keepRow = true) {
		const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
		const artist = await addArtist(tenant, owner);
		const png = await testImages.png(800, 600);
		const stored = await inTenant(tenant, () =>
			new ImageService().storeBytes(png, { tenant, purpose: "artist_photo" }),
		);
		await inTenant(tenant, async () => {
			await Artist.query().where("id", artist.id).update({
				photo_key: stored.key,
				photo_width: stored.width,
				photo_height: stored.height,
			});
			if (!keepRow) await StoredFile.query().where("key", stored.key).delete();
		});
		const bytes = Number(
			(await drive.use("public").getMetaData(stored.key)).contentLength,
		);
		return { tenant, key: stored.key, bytes };
	}

	const orphan = (tenant: Tenant, over: Record<string, unknown> = {}) =>
		inTenant(tenant, () =>
			StoredFile.create({
				tenantId: tenant.id,
				key: `tenants/${tenant.id}/artist_photo/${crypto.randomUUID()}.jpg`,
				purpose: "artist_photo",
				bytes: 1000,
				status: "stored",
				storedAt: DateTime.utc(),
				...over,
			}),
		);

	test("it backfills existing files from storage", async ({ assert }) => {
		const s = await studioWithPhoto("rec-backfill", false);
		assert.lengthOf(await rowsOf(s.tenant), 0);

		const command = await run("rec-backfill");

		command.assertSucceeded();
		assert.deepEqual(
			(await rowsOf(s.tenant)).map((row) => [row.key, row.status, row.bytes]),
			[[s.key, "stored", s.bytes]],
		);
		command.assertLogMatches(/rec-backfill: 1 recorded, 0 removed, 0 missing/);
	});

	test("it removes rows no live record holds, and expired reservations", async ({
		assert,
	}) => {
		const s = await studioWithPhoto("rec-clean");
		await orphan(s.tenant);
		await orphan(s.tenant, {
			status: "reserved",
			storedAt: null,
			reservedAt: DateTime.utc().minus({ hours: 2 }),
			expiresAt: DateTime.utc().minus({ hours: 1 }),
		});

		(await run("rec-clean")).assertLogMatches(
			/rec-clean: 0 recorded, 2 removed/,
		);
		assert.deepEqual(
			(await rowsOf(s.tenant)).map((row) => row.key),
			[s.key],
		);
	});

	test("a live key whose file is gone is reported and not counted", async ({
		assert,
	}) => {
		const s = await studioWithPhoto("rec-missing", false);
		await drive.use("public").delete(s.key);

		const command = await run("rec-missing");

		command.assertSucceeded();
		command.assertLogMatches(/rec-missing: 0 recorded, 0 removed, 1 missing/);
		assert.lengthOf(await rowsOf(s.tenant), 0);
	});

	test("a second run changes nothing", async ({ assert }) => {
		const s = await studioWithPhoto("rec-twice", false);
		await run("rec-twice");
		const first = (await rowsOf(s.tenant)).map((row) => [row.key, row.bytes]);

		(await run("rec-twice")).assertLogMatches(
			/rec-twice: 0 recorded, 0 removed, 0 missing/,
		);
		assert.deepEqual(
			(await rowsOf(s.tenant)).map((row) => [row.key, row.bytes]),
			first,
		);
	});

	test("one studio by slug leaves the others alone", async ({ assert }) => {
		const a = await studioWithPhoto("rec-a");
		const b = await studioWithPhoto("rec-b");
		await orphan(a.tenant);
		await orphan(b.tenant);

		await run("rec-a");

		assert.lengthOf(await rowsOf(a.tenant), 1);
		assert.lengthOf(await rowsOf(b.tenant), 2, "B's orphan stays");
	});
});
