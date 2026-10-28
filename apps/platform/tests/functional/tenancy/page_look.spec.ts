import testUtils from "@adonisjs/core/services/test_utils";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
import {
	inTenant,
	inTenantAs,
	studioWithOwner,
	twoStudios,
} from "#tests/helpers/tenants";

const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

const LOOK = {
	theme: "stencil-and-ink",
	accent: "#0f766e",
	accentDark: "#a99cff",
	font: "serif",
	artists: "hidden",
} as const;

test.group("TenancyService.updateLook (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("writes the five look columns; an artists placement becomes its section list", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, () => new TenancyService().updateLook(tenant, LOOK));

		const row = await reload(tenant);
		assert.equal(row.storefrontTheme, "stencil-and-ink");
		assert.equal(row.brandAccent, "#0f766e");
		assert.equal(row.brandAccentDark, "#a99cff");
		assert.equal(row.brandFont, "serif");
		assert.equal(row.storefrontSections, "inquiry");

		await inTenant(tenant, () =>
			new TenancyService().updateLook(tenant, {
				...LOOK,
				artists: "last",
			}),
		);
		assert.equal((await reload(tenant)).storefrontSections, "inquiry,artists");
		await inTenant(tenant, () =>
			new TenancyService().updateLook(tenant, {
				...LOOK,
				artists: "first",
			}),
		);
		assert.equal((await reload(tenant)).storefrontSections, "artists,inquiry");
	});

	test("null colours clear the stored ones", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => new TenancyService().updateLook(tenant, LOOK));

		await inTenant(tenant, () =>
			new TenancyService().updateLook(tenant, {
				...LOOK,
				accent: null,
				accentDark: null,
			}),
		);

		const row = await reload(tenant);
		assert.isNull(row.brandAccent);
		assert.isNull(row.brandAccentDark);
	});

	test("touches no logo, cover, profile or slug column, even from a copy loaded before a logo was saved", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		// The caller's copy was loaded before the logo and the cover existed.
		const stale = await reload(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			trx.rawQuery(
				`update tenants set logo_image_key = 'tenants/x/studio_logo/k.png',
				logo_image_width = 600, logo_image_height = 200,
				cover_image_key = 'tenants/x/studio_cover/c.jpg',
				cover_image_width = 2048, cover_image_height = 1536 where id = ?`,
				[tenant.id],
			),
		);

		await inTenant(tenant, () => new TenancyService().updateLook(stale, LOOK));

		const row = await reload(tenant);
		assert.equal(row.logoImageKey, "tenants/x/studio_logo/k.png");
		assert.equal(row.logoImageWidth, 600);
		assert.equal(row.coverImageKey, "tenants/x/studio_cover/c.jpg");
		assert.equal(row.slug, tenant.slug);
		assert.equal(row.name, tenant.name);
		assert.equal(row.brandFont, "serif");
	});

	test("another studio's context finds no row, and the studio is unchanged", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();

		await assert.rejects(
			() =>
				inTenantAs(b.tenant, b.owner, () =>
					new TenancyService().updateLook(a.tenant, LOOK),
				),
			lucidErrors.E_ROW_NOT_FOUND,
		);

		const row = await reload(a.tenant);
		assert.equal(row.brandFont, "eczar");
		assert.isNull(row.brandAccent);
		assert.equal(row.storefrontSections, "artists,inquiry");
		assert.equal((await reload(b.tenant)).brandFont, "eczar");
	});
});
