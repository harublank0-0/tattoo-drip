import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import {
	type DbContextValues,
	dbClient,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL only (TAT-116, TAT-126): the database itself must keep a photo
// inside its tenant, hide other tenants' rows and hold the style limit, even
// when the app's own query code is bypassed. The photo limit (100) is not
// the database's: WorkPhotoService counts under the artist's row lock.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

const INSERT =
	"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, created_at) values (?, ?, ?, 1200, 900, now())";

async function seed() {
	const a = await studioWithOwner("photos-a", "Photos A");
	const b = await studioWithOwner("photos-b", "Photos B");
	const artistA = await addArtist(a.tenant, a.owner);
	const artistB = await addArtist(b.tenant, b.owner);
	const add = (
		who: { tenant: { id: string } },
		artist: { id: string },
		n = 0,
	) =>
		sql({ tenantId: who.tenant.id }, INSERT, [
			who.tenant.id,
			artist.id,
			`tenants/${who.tenant.id}/artist_work_photo/p${n}.jpg`,
		]);
	return { a, b, artistA, artistB, add };
}

const countOf = async (tenantId: string, artistId: string) => {
	const { rows } = await sql(
		{ tenantId },
		"select count(*)::int as n from artist_work_photos where artist_id = ?",
		[artistId],
	);
	return rows[0].n as number;
};

test.group("RLS: artist_work_photos (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under context A only A's rows come back; with no context none", async ({
		assert,
	}) => {
		const { a, b, artistA, artistB, add } = await seed();
		await add(a, artistA);
		await add(b, artistB);

		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select tenant_id from artist_work_photos",
		);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].tenant_id, a.tenant.id);

		const none = await dbClient().rawQuery(
			"select count(*)::int as n from artist_work_photos",
		);
		assert.equal(none.rows[0].n, 0);
	});

	test("an insert with another tenant's id fails the policy check", async ({
		assert,
	}) => {
		const { a, b, artistB } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(INSERT, [b.tenant.id, artistB.id, "x.jpg"]),
					),
				/row-level security/,
			);
		});
	});

	test("a photo cannot name another tenant's artist (composite foreign key)", async ({
		assert,
	}) => {
		const { a, artistB } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(INSERT, [a.tenant.id, artistB.id, "x.jpg"]),
					),
				/violates foreign key constraint "artist_work_photos_tenant_id_artist_id_foreign"/,
			);
		});
	});

	test("a new row has no styles and is not healed", async ({ assert }) => {
		const { a, artistA, add } = await seed();
		await add(a, artistA);

		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select styles, healed from artist_work_photos",
		);

		assert.deepEqual(rows, [{ styles: [], healed: false }]);
	});

	test("a fourth style is refused, three are fine, and the list itself is not checked", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		await add(a, artistA);
		const setStyles = (slugs: string) =>
			withDbContext({ tenantId: a.tenant.id }, () =>
				withTransaction((trx) =>
					trx.rawQuery(
						"update artist_work_photos set styles = ?::varchar[] where artist_id = ?",
						[slugs, artistA.id],
					),
				),
			);

		await assert.rejects(
			() => setStyles("{blackwork,fine-line,realism,colour}"),
			/artist_work_photos_styles_max/,
		);
		await setStyles("{blackwork,fine-line,not-on-the-list}");
		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select styles from artist_work_photos",
		);
		assert.deepEqual(rows[0].styles, [
			"blackwork",
			"fine-line",
			"not-on-the-list",
		]);
	});

	test("the database no longer refuses a seventh photo: the count under the artist's lock is the only limit", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		for (let n = 0; n < 7; n++) await add(a, artistA, n);

		assert.equal(await countOf(a.tenant.id, artistA.id), 7);
	});

	test("a width or height of zero is refused", async ({ assert }) => {
		const { a, artistA } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, created_at) values (?, ?, 'x.jpg', 0, 900, now())",
							[a.tenant.id, artistA.id],
						),
					),
				/artist_work_photos_size/,
			);
		});
	});

	test("update and delete of another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { a, b, artistB, add } = await seed();
		await add(b, artistB);

		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update artist_work_photos set alt = 'hacked' where tenant_id = ?",
				[b.tenant.id],
			);
			const remove = await trx.rawQuery(
				"delete from artist_work_photos where tenant_id = ?",
				[b.tenant.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.tenant.id },
			"select alt from artist_work_photos",
		);
		assert.lengthOf(rows, 1);
		assert.isNull(rows[0].alt);
	});

	test("a studio's cover needs all three columns or none", async ({
		assert,
	}) => {
		const { a } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"update tenants set cover_image_key = 'x.jpg' where id = ?",
							[a.tenant.id],
						),
					),
				/tenants_cover_all_or_none/,
			);
			await withTransaction((trx) =>
				trx.rawQuery(
					"update tenants set cover_image_key = 'x.jpg', cover_image_width = 2048, cover_image_height = 1536 where id = ?",
					[a.tenant.id],
				),
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"update tenants set cover_image_width = null where id = ?",
							[a.tenant.id],
						),
					),
				/tenants_cover_all_or_none/,
			);
		});
	});
});
