import { writeFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { StorageFullError } from "#modules/media/errors";
import ImageService, {
	type ImagePurpose,
} from "#modules/media/services/image_service";
import StoredFile from "#modules/storage/models/stored_file";
import { reserveStorage } from "#modules/storage/reservations";
import StorageMeterService from "#modules/storage/services/storage_meter_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { testImages } from "#tests/helpers/images";
import { captureLogs } from "#tests/helpers/logs";
import { forgetStudio } from "#tests/helpers/races";
import {
	enforceStorage,
	fillStorage,
	MB,
	smallStudio,
	storedFilesOf,
	unsetStorageEnforcement,
} from "#tests/helpers/storage";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/** An upload as the body parser leaves it, from bytes. */
async function upload(bytes: Buffer) {
	const tmpPath = app.tmpPath(`upload-${crypto.randomUUID()}`);
	await writeFile(tmpPath, bytes);
	return { tmpPath, size: bytes.length } as never;
}

/**
 * Holding the storage allowance (docs/superpowers/specs/2026-11-16-storage-meter-design.md,
 * Reserving): an upload reserves its size first, under the studio's lock,
 * and a full studio's staff upload is refused before anything is stored.
 */
test.group("Storage: reservations", (group) => {
	group.each.setup(async () => {
		const rollback = await testUtils.db().wrapInGlobalTransaction();
		return async () => {
			unsetStorageEnforcement();
			await rollback();
		};
	});

	const rowsOf = storedFilesOf;
	const store = async (tenant: Tenant, purpose: ImagePurpose) =>
		inTenant(tenant, async () =>
			new ImageService().store(await upload(await testImages.png(400, 300)), {
				tenant,
				purpose,
			}),
		);

	test("a staff upload over the limit is refused in words, and nothing is stored", async ({
		assert,
	}) => {
		const s = await smallStudio("res-full", MB - 600);
		enforceStorage(true);

		const error = await store(s.tenant, "artist_work_photo").catch((e) => e);

		assert.instanceOf(error, StorageFullError);
		assert.match(
			error.message,
			/^This upload needs [\d.]+ KB, but your studio has 0\.6 KB of storage left\. Free up space under Settings, Billing, Storage\.( Studio includes 25 GB: ask TattooDrip to move your studio to Studio\.)?$/,
		);
		assert.lengthOf(await rowsOf(s.tenant), 1, "only the filler row");
	});

	test("in observe mode the same upload is stored and logged", async ({
		assert,
	}) => {
		const s = await smallStudio("res-observe", MB - 600);
		enforceStorage(false);
		const logs = captureLogs();
		try {
			await store(s.tenant, "artist_work_photo");
		} finally {
			logs.restore();
		}
		assert.isTrue(
			logs
				.everything()
				.some((call) => call.includes("Package rule would refuse")),
		);
		const rows = await rowsOf(s.tenant);
		assert.deepEqual(
			rows.map((row) => row.status),
			["stored", "stored"],
			"the filler and the upload, no reservation left",
		);
	});

	test("a failed store releases its reservation", async ({ assert }) => {
		const s = await smallStudio("res-fail", 0);
		enforceStorage(true);
		const error = await inTenant(s.tenant, async () =>
			new ImageService().store(await upload(Buffer.from("not an image")), {
				tenant: s.tenant,
				purpose: "artist_work_photo",
			}),
		).catch((e) => e);

		assert.exists(error);
		assert.notInstanceOf(error, StorageFullError);
		assert.deepEqual(
			(await rowsOf(s.tenant)).map((row) => row.status),
			["stored"],
			"no reservation is left behind",
		);
	});

	test("an expired reservation stops counting", async ({ assert }) => {
		const { tenant } = await studioWithOwner("res-expiry", "Res Expiry");
		const reserve = (minutes: number) =>
			inTenant(tenant, () =>
				StoredFile.create({
					tenantId: tenant.id,
					key: `reserve:${crypto.randomUUID()}`,
					purpose: "artist_work_photo",
					bytes: 1000,
					status: "reserved",
					reservedAt: DateTime.utc(),
					expiresAt: DateTime.utc().plus({ minutes }),
				}),
			);
		await reserve(-1);
		await reserve(10);
		const usage = await inTenant(tenant, async () =>
			(await app.container.make(StorageMeterService)).usage(tenant),
		);
		assert.equal(usage.usedBytes, 1000);
	});

	test("always-accepted purposes are never refused", async ({ assert }) => {
		const s = await smallStudio("res-always", MB - 600);
		enforceStorage(true);
		for (const purpose of [
			"payment_proof",
			"payment_qr",
			"client_post_photo",
		] as const) {
			const stored = await store(s.tenant, purpose);
			assert.include(stored.key, `/${purpose}/`);
		}
	});

	test("the cover upload shows the refusal on its field", async ({
		client,
		assert,
	}) => {
		const s = await smallStudio("res-http", MB - 600);
		enforceStorage(true);
		const response = await client
			.put(`/t/${s.tenant.slug}/settings/cover`)
			.loginAs(s.owner)
			.withCsrfToken()
			.redirects(0)
			.file("cover", await testImages.png(800, 400), {
				filename: "cover.png",
				contentType: "image/png",
			});
		assertValidationError(response, "cover");
		const errors = response.flashMessage("inputErrorsBag") as {
			cover: string[];
		};
		assert.match(errors.cover[0], /^This upload needs .* of storage left\./);
	});

	test("in observe mode the storage line is only on the pages that show it", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("res-pages", "Res Pages");
		const props = async (path: string) =>
			(
				await client
					.get(`/t/${tenant.slug}${path}`)
					.loginAs(owner)
					.withInertia()
			).inertiaProps as { storage: unknown };
		assert.exists((await props("/portfolio")).storage);
		assert.isNull((await props("/projects")).storage);
	});
});

/**
 * Two uploads at once near the limit (Review Focus 1): each reservation
 * runs on a connection of its own, so this group can't use the global
 * transaction; its studio is committed and forgotten again.
 */
test.group("Storage: concurrent reservations", (group) => {
	group.each.teardown(async () => {
		unsetStorageEnforcement();
		await forgetStudio("res-race");
	});

	test("concurrent reservations near the limit: one fits, the other is refused", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("res-race", "Res Race");
		const meter = await app.container.make(StorageMeterService);
		const limit = (await inTenant(tenant, () =>
			meter.limitBytes(tenant),
		)) as number;
		await fillStorage(tenant, owner, limit - 6 * MB);
		enforceStorage(true);

		const outcomes = await Promise.allSettled([
			reserveStorage({
				tenantId: tenant.id,
				purpose: "artist_work_photo",
				bytes: 4 * MB,
				minutes: 15,
			}),
			reserveStorage({
				tenantId: tenant.id,
				purpose: "artist_work_photo",
				bytes: 4 * MB,
				minutes: 15,
			}),
		]);

		assert.deepEqual(
			outcomes.map((outcome) => outcome.status).sort(),
			["fulfilled", "rejected"],
			outcomes
				.map((outcome) =>
					outcome.status === "rejected" ? String(outcome.reason) : "fulfilled",
				)
				.join("; "),
		);
		const refused = outcomes.find((outcome) => outcome.status === "rejected");
		assert.instanceOf(
			(refused as PromiseRejectedResult).reason,
			StorageFullError,
		);
		const usage = await inTenant(tenant, () => meter.usage(tenant));
		assert.isAtMost(usage.usedBytes, limit);
	});
});
