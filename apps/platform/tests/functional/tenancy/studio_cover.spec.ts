import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { captureLogs } from "#tests/helpers/logs";
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

const PURPOSE = "studio_cover";
const cover = async () => uploadOf(await testImages.jpeg(2048, 1536));
const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

function makeService() {
	const images = new RecordingImageService();
	return { images, tenancy: new TenancyService(undefined, images) };
}

test.group("TenancyService cover (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("setCover stores the cover on the public disk and saves its key and size", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));

		const row = await reload(tenant);
		assert.match(
			row.coverImageKey ?? "",
			new RegExp(
				`^tenants/${tenant.id}/${PURPOSE}/.+\\.640-960-1280-1600\\.jpg$`,
			),
		);
		assert.equal(row.coverImageWidth, 2048);
		assert.equal(row.coverImageHeight, 1536);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 5);
		assert.deepEqual(await storedImages(tenant, PURPOSE, "private"), []);
	});

	test("replacing it deletes the old file and its copies after the commit, not before", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));
		const old = (await reload(tenant)).coverImageKey;

		await withDbContext({ tenantId: tenant.id }, async () => {
			await tenancy.setCover(tenant, await cover());
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				10,
				"the old cover stays until the commit",
			);
		});

		const row = await reload(tenant);
		assert.notEqual(row.coverImageKey, old);
		assert.lengthOf(
			await storedImages(tenant, PURPOSE),
			5,
			"one cover is left",
		);
	});

	test("replaying the same replace leaves exactly one cover", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		const bytes = await testImages.jpeg(2048, 1536);

		for (let n = 0; n < 3; n++) {
			await inTenant(tenant, async () =>
				tenancy.setCover(tenant, await uploadOf(bytes)),
			);
		}

		assert.lengthOf(await storedImages(tenant, PURPOSE), 5);
		assert.isNotNull((await reload(tenant)).coverImageKey);
	});

	test("a later failure in the same transaction keeps the old cover and deletes the new file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));
		const old = (await reload(tenant)).coverImageKey;

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await tenancy.setCover(tenant, await cover());
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.equal((await reload(tenant)).coverImageKey, old);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 5);
	});

	test("removeCover deletes the files first, then clears the three columns", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));

		await withDbContext({ tenantId: tenant.id }, async () => {
			await tenancy.removeCover(tenant);
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				0,
				"the files go first, before the commit",
			);
		});

		const row = await reload(tenant);
		assert.isNull(row.coverImageKey);
		assert.isNull(row.coverImageWidth);
		assert.isNull(row.coverImageHeight);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("removing a cover that isn't there changes nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, () => tenancy.removeCover(tenant));

		assert.isNull((await reload(tenant)).coverImageKey);
	});

	test("an unusable file is an InvalidImageError and changes nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));
		const old = (await reload(tenant)).coverImageKey;

		for (const bytes of [
			await testImages.gif(),
			await testImages.heif(),
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
			await testImages.huge(),
		]) {
			const file = await uploadOf(bytes);
			await assert.rejects(
				() => inTenant(tenant, () => tenancy.setCover(tenant, file)),
				InvalidImageError,
			);
		}

		assert.equal((await reload(tenant)).coverImageKey, old);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 5);
	});

	test("another tenant's context cannot set this tenant's cover", async ({
		assert,
	}) => {
		const a = await studioWithOwner("cover-a", "Cover A");
		const b = await studioWithOwner("cover-b", "Cover B");
		const { tenancy } = makeService();
		const file = await cover();

		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () => tenancy.setCover(a.tenant, file)),
			lucidErrors.E_ROW_NOT_FOUND,
		);

		assert.isNull((await reload(a.tenant)).coverImageKey);
		assert.deepEqual(
			await storedImages(a.tenant, PURPOSE),
			[],
			"the file stored before the lock is taken away again",
		);
	});
});

test.group(
	"removing and replacing a cover is durable (TAT-116 fix round 1)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a failed file delete fails removeCover, keeps the cover and its public answer; the retry removes every copy", async ({
			assert,
		}) => {
			const { tenant } = await studioWithOwner();
			const { tenancy } = makeService();
			await inTenant(tenant, async () =>
				tenancy.setCover(tenant, await cover()),
			);
			const key = (await reload(tenant)).coverImageKey ?? "";
			const failing = failDeletes("public", (file) =>
				file.endsWith(".960w.jpg"),
			);

			try {
				await assert.rejects(
					() => inTenant(tenant, () => tenancy.removeCover(tenant)),
					ImageDeleteError,
				);
			} finally {
				failing.restore();
			}

			const row = await reload(tenant);
			assert.equal(
				row.coverImageKey,
				key,
				"the cover stays, so the owner can retry",
			);
			assert.equal(row.coverImageWidth, 2048);
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				1,
				"the file that failed is left",
			);

			await inTenant(tenant, () => tenancy.removeCover(tenant));
			assert.isNull((await reload(tenant)).coverImageKey);
			assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		});

		test("replacing with a failing delete of the old files still succeeds, and the failure is logged with its key", async ({
			assert,
		}) => {
			const { tenant } = await studioWithOwner();
			const images = new RecordingImageService();
			const tenancy = new TenancyService(undefined, images);
			await inTenant(tenant, async () =>
				tenancy.setCover(tenant, await cover()),
			);
			const old = (await reload(tenant)).coverImageKey ?? "";
			const logs = captureLogs();
			const failing = failDeletes(
				"public",
				(file) =>
					file.includes(old.split("/").pop()?.split(".")[0] ?? "x") &&
					file.endsWith(".640w.jpg"),
			);

			try {
				await inTenant(tenant, async () =>
					tenancy.setCover(tenant, await cover()),
				);
			} finally {
				failing.restore();
				logs.restore();
			}

			const row = await reload(tenant);
			assert.notEqual(row.coverImageKey, old, "the new cover is in place");
			assert.equal(images.deleteFailures, 1);
			const logged = logs
				.errors()
				.map(([first]) => first as { key?: string; purpose?: string });
			assert.isTrue(
				logged.some(
					(fields) =>
						fields.purpose === PURPOSE && fields.key?.endsWith(".640w.jpg"),
				),
				"the failed key is in the error log",
			);
			// The new cover's five files, plus the one old file that could not be deleted.
			assert.lengthOf(await storedImages(tenant, PURPOSE), 6);
		});
	},
);
