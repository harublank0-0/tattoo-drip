import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DEFAULT_SECTIONS } from "#modules/storefront/look";
import { withDbContext, withTransaction } from "#services/db_context";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL on purpose (TAT-56): the database itself must hold the shape of a
// studio's page look, even when the app's own code is bypassed. Which themes,
// fonts and sections exist is the app's list (#modules/storefront/look).

const READ =
	"select storefront_theme, storefront_sections, brand_accent, brand_accent_dark, brand_font, logo_image_key, logo_image_width, logo_image_height from tenants where id = ?";

/** The check each bad update must trip, with the SQL that trips it. */
const REFUSED: [string, string, string][] = [
	[
		"an accent in capitals",
		"update tenants set brand_accent = '#FFFFFF' where id = ?",
		"tenants_brand_accent_format",
	],
	[
		"a colour name instead of a hex colour",
		"update tenants set brand_accent = 'red' where id = ?",
		"tenants_brand_accent_format",
	],
	[
		"a five-digit accent",
		"update tenants set brand_accent = '#12345' where id = ?",
		"tenants_brand_accent_format",
	],
	[
		"a dark-mode colour without the hash",
		"update tenants set brand_accent_dark = 'a99cff' where id = ?",
		"tenants_brand_accent_dark_format",
	],
	[
		"sections without the form",
		"update tenants set storefront_sections = 'artists' where id = ?",
		"tenants_storefront_sections_format",
	],
	[
		"sections separated by a semicolon",
		"update tenants set storefront_sections = 'artists;inquiry' where id = ?",
		"tenants_storefront_sections_format",
	],
	[
		"more than eight sections",
		"update tenants set storefront_sections = 'a,b,c,d,e,f,g,h,inquiry' where id = ?",
		"tenants_storefront_sections_format",
	],
	[
		"a theme that is not a slug",
		"update tenants set storefront_theme = 'Bad Theme' where id = ?",
		"tenants_storefront_theme_format",
	],
	[
		"a font that is not a slug",
		"update tenants set brand_font = 'Comic Sans' where id = ?",
		"tenants_brand_font_format",
	],
	[
		"a logo key without its size",
		"update tenants set logo_image_key = 'tenants/x/studio_logo/k.png' where id = ?",
		"tenants_logo_all_or_none",
	],
	[
		"a logo size without its key",
		"update tenants set logo_image_width = 600, logo_image_height = 200 where id = ?",
		"tenants_logo_all_or_none",
	],
];

test.group("tenants page look columns (TAT-56)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new studio has the default look and no logo", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		const row = await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const { rows } = await trx.rawQuery(READ, [tenant.id]);
			return rows[0];
		});

		assert.deepEqual(row, {
			storefront_theme: "stencil-and-ink",
			storefront_sections: "work,artists,flash,info,inquiry",
			brand_accent: null,
			brand_accent_dark: null,
			brand_font: "eczar",
			logo_image_key: null,
			logo_image_width: null,
			logo_image_height: null,
		});
	});

	for (const [name, query, constraint] of REFUSED) {
		test(`the database refuses ${name}`, async ({ assert }) => {
			const { tenant } = await studioWithOwner();

			await withDbContext({ tenantId: tenant.id }, async (trx) => {
				await assert.rejects(
					() => withTransaction((inner) => inner.rawQuery(query, [tenant.id])),
					new RegExp(`violates check constraint "${constraint}"`),
				);
				// The failed update left the look as it was.
				const { rows } = await trx.rawQuery(READ, [tenant.id]);
				assert.equal(
					rows[0].storefront_sections,
					"work,artists,flash,info,inquiry",
				);
				assert.isNull(rows[0].brand_accent);
			});
		});
	}

	test("the check violations carry SQLSTATE 23514 and the constraint's name", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async () => {
			const error = await withTransaction((inner) =>
				inner.rawQuery("update tenants set brand_accent = 'red' where id = ?", [
					tenant.id,
				]),
			).then(
				() => null,
				(caught: unknown) => caught as { code?: string; constraint?: string },
			);
			assert.equal(error?.code, "23514");
			assert.equal(error?.constraint, "tenants_brand_accent_format");
		});
	});

	test("a new studio's sections are work, artists, Flash, Good to know, then the form", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		const row = await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const { rows } = await trx.rawQuery(READ, [tenant.id]);
			return rows[0];
		});

		assert.equal(row.storefront_sections, "work,artists,flash,info,inquiry");
		// The raw column, not a literal: a key added to the list without a migration fails here.
		assert.equal(row.storefront_sections, DEFAULT_SECTIONS.join(","));
	});

	test("lowercase hex colours, the form alone and a whole logo pass", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(
				`update tenants set brand_accent = '#0f766e', brand_accent_dark = '#a99cff',
				storefront_sections = 'inquiry', brand_font = 'serif',
				logo_image_key = 'tenants/x/studio_logo/k.320-640-1280.png',
				logo_image_width = 600, logo_image_height = 200 where id = ?`,
				[tenant.id],
			);
			const { rows } = await trx.rawQuery(READ, [tenant.id]);
			assert.equal(rows[0].brand_accent, "#0f766e");
			assert.equal(rows[0].brand_accent_dark, "#a99cff");
			assert.equal(rows[0].storefront_sections, "inquiry");
			assert.equal(rows[0].logo_image_width, 600);
			// Both orders of the two sections pass; clearing a colour passes.
			await trx.rawQuery(
				"update tenants set storefront_sections = 'work,inquiry,artists', brand_accent = null where id = ?",
				[tenant.id],
			);
		});
	});
});
