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
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

const PURPOSE = "studio_logo";
/** A wide logo: 600 x 200, so only the 320 copy is made (copies are never enlarged). */
const logo = async () => uploadOf(await testImages.png(600, 200));
const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

function makeService() {
	const images = new RecordingImageService();
	return { images, tenancy: new TenancyService(undefined, images) };
}

test.group("TenancyService logo (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("setLogo stores the logo as a public PNG with its narrower copies and saves key and size", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));

		const row = await reload(tenant);
		assert.match(
			row.logoImageKey ?? "",
			new RegExp(`^tenants/${tenant.id}/${PURPOSE}/.+\\.320\\.png$`),
		);
		assert.equal(row.logoImageWidth, 600);
		assert.equal(row.logoImageHeight, 200);
		assert.lengthOf(
			await storedImages(tenant, PURPOSE),
			2,
			"the logo and its 320 copy",
		);
		assert.deepEqual(await storedImages(tenant, PURPOSE, "private"), []);
		assert.isNull(row.coverImageKey, "the cover is untouched");
	});

	test("a PNG logo keeps its see-through background", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, async () =>
			tenancy.setLogo(
				tenant,
				await uploadOf(await testImages.transparentPng(900, 300)),
			),
		);

		const row = await reload(tenant);
		assert.match(row.logoImageKey ?? "", /\.320-640\.png$/);
	});

	test("replacing it deletes the old file and its copies after the commit, not before", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const old = (await reload(tenant)).logoImageKey;

		await withDbContext({ tenantId: tenant.id }, async () => {
			await tenancy.setLogo(tenant, await logo());
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				4,
				"the old logo stays until the commit",
			);
		});

		const row = await reload(tenant);
		assert.notEqual(row.logoImageKey, old);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2, "one logo is left");
	});

	test("a later failure in the same transaction keeps the old logo and deletes the new file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const old = (await reload(tenant)).logoImageKey;

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await tenancy.setLogo(tenant, await logo());
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.equal((await reload(tenant)).logoImageKey, old);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2);
	});

	test("removeLogo deletes the files first, then clears the three columns", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));

		await withDbContext({ tenantId: tenant.id }, async () => {
			await tenancy.removeLogo(tenant);
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				0,
				"the files go first, before the commit",
			);
		});

		const row = await reload(tenant);
		assert.isNull(row.logoImageKey);
		assert.isNull(row.logoImageWidth);
		assert.isNull(row.logoImageHeight);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("removing a logo that isn't there changes nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, () => tenancy.removeLogo(tenant));

		assert.isNull((await reload(tenant)).logoImageKey);
	});

	test("an unusable file is an InvalidImageError and changes nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const old = (await reload(tenant)).logoImageKey;

		for (const bytes of [
			await testImages.gif(),
			await testImages.heif(),
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
			await testImages.huge(),
		]) {
			const file = await uploadOf(bytes);
			await assert.rejects(
				() => inTenant(tenant, () => tenancy.setLogo(tenant, file)),
				InvalidImageError,
			);
		}

		assert.equal((await reload(tenant)).logoImageKey, old);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2);
	});

	test("a failed file delete fails removeLogo and keeps the logo; the retry removes it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const key = (await reload(tenant)).logoImageKey ?? "";
		const failing = failDeletes("public", (file) => file.endsWith(".320w.png"));

		try {
			await assert.rejects(
				() => inTenant(tenant, () => tenancy.removeLogo(tenant)),
				ImageDeleteError,
			);
		} finally {
			failing.restore();
		}

		assert.equal((await reload(tenant)).logoImageKey, key);

		await inTenant(tenant, () => tenancy.removeLogo(tenant));
		assert.isNull((await reload(tenant)).logoImageKey);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
	});

	test("the logo and the cover are separate: setting one never changes the other", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		const cover = async () => uploadOf(await testImages.jpeg(2048, 1536));

		await inTenant(tenant, async () => tenancy.setCover(tenant, await cover()));
		const coverKey = (await reload(tenant)).coverImageKey;
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		await inTenant(tenant, () => tenancy.removeLogo(tenant));

		const row = await reload(tenant);
		assert.equal(row.coverImageKey, coverKey, "the cover survives the logo");
		assert.isNull(row.logoImageKey);
		assert.lengthOf(await storedImages(tenant, "studio_cover"), 5);
	});

	test("another tenant's context cannot set or remove this tenant's logo", async ({
		assert,
	}) => {
		const a = await studioWithOwner("logo-a", "Logo A");
		const b = await studioWithOwner("logo-b", "Logo B");
		const { tenancy } = makeService();
		const file = await logo();
		await inTenant(a.tenant, async () =>
			tenancy.setLogo(a.tenant, await logo()),
		);
		const own = (await reload(a.tenant)).logoImageKey;

		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () => tenancy.setLogo(a.tenant, file)),
			lucidErrors.E_ROW_NOT_FOUND,
		);
		await assert.rejects(
			() => inTenantAs(b.tenant, b.owner, () => tenancy.removeLogo(a.tenant)),
			lucidErrors.E_ROW_NOT_FOUND,
		);

		assert.equal((await reload(a.tenant)).logoImageKey, own);
		assert.lengthOf(
			await storedImages(a.tenant, PURPOSE),
			2,
			"the file stored before the lock is taken away again",
		);
	});
});
