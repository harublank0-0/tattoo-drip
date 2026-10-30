import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL on purpose (TAT-123): the database itself must hold the shape of a
// studio's logo tile and icon, even when the app's own code is bypassed. Which
// tiles exist is the app's list (#modules/storefront/look), like the look's.

const READ =
	"select logo_tile, logo_icon_key, logo_image_key from tenants where id = ?";

/** The check each bad update must trip, with the SQL that trips it. */
const REFUSED: [string, string, string][] = [
	[
		"a tile that is not a lowercase word",
		"update tenants set logo_tile = 'Dark Tile' where id = ?",
		"tenants_logo_tile_format",
	],
	[
		"an empty tile",
		"update tenants set logo_tile = '' where id = ?",
		"tenants_logo_tile_format",
	],
	[
		"an icon key without a logo",
		"update tenants set logo_icon_key = 'tenants/x/studio_icon/k.32.png' where id = ?",
		"tenants_logo_icon_needs_logo",
	],
];

test.group("tenants logo tile and icon columns (TAT-123)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a new studio has the light tile and no icon", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		const row = await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const { rows } = await trx.rawQuery(READ, [tenant.id]);
			return rows[0];
		});

		assert.deepEqual(row, {
			logo_tile: "light",
			logo_icon_key: null,
			logo_image_key: null,
		});
	});

	for (const [name, query, constraint] of REFUSED) {
		test(`the database refuses ${name}`, async ({ assert }) => {
			const { tenant } = await studioWithOwner();

			await withDbContext({ tenantId: tenant.id }, async (trx) => {
				const error = await withTransaction((inner) =>
					inner.rawQuery(query, [tenant.id]),
				).then(
					() => null,
					(caught: unknown) => caught as { code?: string; constraint?: string },
				);
				assert.equal(error?.code, "23514");
				assert.equal(error?.constraint, constraint);
				// The failed update left the row as it was.
				const { rows } = await trx.rawQuery(READ, [tenant.id]);
				assert.equal(rows[0].logo_tile, "light");
				assert.isNull(rows[0].logo_icon_key);
			});
		});
	}

	test("a dark tile, and an icon with a whole logo, pass", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(
				`update tenants set logo_tile = 'dark',
				logo_image_key = 'tenants/x/studio_logo/k.320-640-1280.png',
				logo_image_width = 600, logo_image_height = 200,
				logo_icon_key = 'tenants/x/studio_icon/k.32.png' where id = ?`,
				[tenant.id],
			);
			const { rows } = await trx.rawQuery(READ, [tenant.id]);
			assert.equal(rows[0].logo_tile, "dark");
			assert.equal(rows[0].logo_icon_key, "tenants/x/studio_icon/k.32.png");
			// A word the app does not know passes: the list is the app's, not the database's.
			await trx.rawQuery(
				"update tenants set logo_tile = 'accent' where id = ?",
				[tenant.id],
			);
		});
	});
});
