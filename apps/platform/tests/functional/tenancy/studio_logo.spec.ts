import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import sharp from "sharp";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { failDeletes, failPuts } from "#tests/helpers/storage_failures";
import { inTenant, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

const PURPOSE = "studio_logo";
const ICON = "studio_icon";
/** A wide logo: 600 x 200, so only the 320 copy is made (copies are never enlarged). */
const logo = async () => uploadOf(await testImages.png(600, 200));
const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

/** A stored public file, opened as an image. */
const stored = (key: string) => sharp(app.tmpPath("storage", "public", key));

/** The first pixel of a stored file as [r, g, b]. */
async function cornerOf(key: string) {
	const { data } = await stored(key)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return [data[0], data[1], data[2]];
}

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
		assert.lengthOf(
			await storedImages(tenant, ICON),
			2,
			"its icon and the icon's 32 copy",
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
		const { logoImageKey: old, logoIconKey: oldIcon } = await reload(tenant);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await tenancy.setLogo(tenant, await logo());
			assert.lengthOf(
				await storedImages(tenant, PURPOSE),
				4,
				"the old logo stays until the commit",
			);
			assert.lengthOf(
				await storedImages(tenant, ICON),
				4,
				"so does the old icon",
			);
		});

		const row = await reload(tenant);
		assert.notEqual(row.logoImageKey, old);
		assert.notEqual(row.logoIconKey, oldIcon);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2, "one logo is left");
		assert.lengthOf(await storedImages(tenant, ICON), 2, "one icon is left");
	});

	test("a later failure in the same transaction keeps the old logo and deletes the new file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const { logoImageKey: old, logoIconKey: oldIcon } = await reload(tenant);

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await tenancy.setLogo(tenant, await logo());
					throw new Error("later failure");
				}),
			"later failure",
		);

		const row = await reload(tenant);
		assert.equal(row.logoImageKey, old);
		assert.equal(row.logoIconKey, oldIcon);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2);
		assert.lengthOf(await storedImages(tenant, ICON), 2);
	});

	test("removeLogo deletes the files first, then clears the logo and icon columns", async ({
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
			assert.lengthOf(
				await storedImages(tenant, ICON),
				0,
				"the icon's files too",
			);
		});

		const row = await reload(tenant);
		assert.isNull(row.logoImageKey);
		assert.isNull(row.logoImageWidth);
		assert.isNull(row.logoImageHeight);
		assert.isNull(row.logoIconKey);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		assert.deepEqual(await storedImages(tenant, ICON), []);
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
		assert.lengthOf(await storedImages(tenant, ICON), 2);
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

	test("a white logo with a see-through background goes on the dark tile, with an icon on that tile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, async () =>
			tenancy.setLogo(
				tenant,
				await uploadOf(
					await testImages.logoOnClear([{ r: 255, g: 255, b: 255 }]),
				),
			),
		);

		const row = await reload(tenant);
		assert.equal(row.logoTile, "dark");
		assert.match(
			row.logoIconKey ?? "",
			new RegExp(`^tenants/${tenant.id}/${ICON}/.+\\.32\\.png$`),
		);
		assert.lengthOf(await storedImages(tenant, ICON), 2);
		const meta = await stored(row.logoIconKey ?? "").metadata();
		assert.deepEqual([meta.format, meta.width, meta.height], ["png", 180, 180]);
		assert.deepEqual(await cornerOf(row.logoIconKey ?? ""), [20, 17, 15]);
	});

	test("a dark logo stays on the light tile, and its icon is on the light tile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();

		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));

		const row = await reload(tenant);
		assert.equal(row.logoTile, "light");
		assert.deepEqual(await cornerOf(row.logoIconKey ?? ""), [247, 243, 238]);
	});

	test("a new upload decides the tile again", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		const white = async () =>
			uploadOf(await testImages.logoOnClear([{ r: 255, g: 255, b: 255 }]));
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await white()));
		assert.equal((await reload(tenant)).logoTile, "dark");

		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));

		assert.equal((await reload(tenant)).logoTile, "light");
	});

	test("an icon that can't be stored leaves the logo saved without one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		const failing = failPuts("public", (key) => key.includes(`/${ICON}/`));

		try {
			await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		} finally {
			failing.restore();
		}

		const row = await reload(tenant);
		assert.isNotNull(row.logoImageKey);
		assert.isNull(row.logoIconKey);
		assert.deepEqual(await storedImages(tenant, ICON), []);
		assert.lengthOf(await storedImages(tenant, PURPOSE), 2);
	});

	test("a replaced logo whose new icon can't be stored loses its old icon too", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const failing = failPuts("public", (key) => key.includes(`/${ICON}/`));

		try {
			await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		} finally {
			failing.restore();
		}

		assert.isNull((await reload(tenant)).logoIconKey);
		assert.deepEqual(
			await storedImages(tenant, ICON),
			[],
			"the old icon belonged to the old logo",
		);
	});

	test("a failed icon delete fails removeLogo and keeps the logo and its icon key; the retry removes both", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const before = await reload(tenant);
		const failing = failDeletes("public", (key) => key.includes(`/${ICON}/`));

		try {
			await assert.rejects(
				() => inTenant(tenant, () => tenancy.removeLogo(tenant)),
				ImageDeleteError,
			);
		} finally {
			failing.restore();
		}

		const row = await reload(tenant);
		assert.equal(row.logoImageKey, before.logoImageKey);
		assert.equal(row.logoIconKey, before.logoIconKey);
		assert.lengthOf(
			await storedImages(tenant, PURPOSE),
			2,
			"the logo is still whole",
		);

		await inTenant(tenant, () => tenancy.removeLogo(tenant));
		const after = await reload(tenant);
		assert.isNull(after.logoImageKey);
		assert.isNull(after.logoIconKey);
		assert.deepEqual(await storedImages(tenant, PURPOSE), []);
		assert.deepEqual(await storedImages(tenant, ICON), []);
	});

	test("setLogoTile writes the tile and nothing else", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		await inTenant(tenant, async () => tenancy.setLogo(tenant, await logo()));
		const before = await reload(tenant);

		await inTenant(tenant, () => tenancy.setLogoTile(tenant, "dark"));

		const row = await reload(tenant);
		assert.equal(row.logoTile, "dark");
		assert.equal(row.logoImageKey, before.logoImageKey);
		assert.equal(row.logoIconKey, before.logoIconKey, "the icon is not remade");
		assert.equal(row.storefrontTheme, before.storefrontTheme);
		assert.lengthOf(await storedImages(tenant, ICON), 2);

		await inTenant(tenant, () => tenancy.setLogoTile(tenant, "light"));
		assert.equal((await reload(tenant)).logoTile, "light");
	});

	test("setLogoTile does not write over a change made since the tenant was loaded", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenancy } = makeService();
		const stale = await reload(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			trx.rawQuery("update tenants set brand_font = 'serif' where id = ?", [
				tenant.id,
			]),
		);

		await inTenant(tenant, () => tenancy.setLogoTile(stale, "dark"));

		const row = await reload(tenant);
		assert.equal(row.logoTile, "dark");
		assert.equal(row.brandFont, "serif");
	});

	test("another tenant's context cannot switch this tenant's tile", async ({
		assert,
	}) => {
		const a = await studioWithOwner("tile-a", "Tile A");
		const b = await studioWithOwner("tile-b", "Tile B");
		const { tenancy } = makeService();

		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () =>
					tenancy.setLogoTile(a.tenant, "dark"),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);

		assert.equal((await reload(a.tenant)).logoTile, "light");
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
		assert.lengthOf(await storedImages(a.tenant, ICON), 2);
	});
});
