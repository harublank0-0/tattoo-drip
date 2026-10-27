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

// Raw SQL only (TAT-116): the database itself must hold the limit of six
// photos per artist, keep a photo inside its tenant and hide other tenants'
// rows, even when the app's own query code is bypassed.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

const INSERT =
	"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, position, created_at) values (?, ?, ?, 1200, 900, ?, now())";

async function seed() {
	const a = await studioWithOwner("photos-a", "Photos A");
	const b = await studioWithOwner("photos-b", "Photos B");
	const artistA = await addArtist(a.tenant, a.owner);
	const artistB = await addArtist(b.tenant, b.owner);
	const add = (
		who: { tenant: { id: string } },
		artist: { id: string },
		position: number,
	) =>
		sql({ tenantId: who.tenant.id }, INSERT, [
			who.tenant.id,
			artist.id,
			`tenants/${who.tenant.id}/artist_work_photo/p${position}.jpg`,
			position,
		]);
	return { a, b, artistA, artistB, add };
}

const positionsOf = async (tenantId: string, artistId: string) => {
	const { rows } = await sql(
		{ tenantId },
		"select id, position from artist_work_photos where artist_id = ? order by position",
		[artistId],
	);
	return rows as { id: string; position: number }[];
};

test.group("RLS: artist_work_photos (TAT-116)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under context A only A's rows come back; with no context none", async ({
		assert,
	}) => {
		const { a, b, artistA, artistB, add } = await seed();
		await add(a, artistA, 0);
		await add(b, artistB, 0);

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
						trx.rawQuery(INSERT, [b.tenant.id, artistB.id, "x.jpg", 0]),
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
						trx.rawQuery(INSERT, [a.tenant.id, artistB.id, "x.jpg", 0]),
					),
				/violates foreign key constraint "artist_work_photos_tenant_id_artist_id_foreign"/,
			);
		});
	});

	test("a row at position 6 is refused, so a seventh photo cannot exist", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		for (let position = 0; position < 6; position++) {
			await add(a, artistA, position);
		}

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(INSERT, [a.tenant.id, artistA.id, "x.jpg", 6]),
					),
				/artist_work_photos_position_range/,
			);
		});
		assert.lengthOf(await positionsOf(a.tenant.id, artistA.id), 6);
	});

	test("a second row at an occupied position is refused", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		await add(a, artistA, 2);

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(INSERT, [a.tenant.id, artistA.id, "y.jpg", 2]),
					),
				/artist_work_photos_position_unique/,
			);
		});
	});

	test("a width or height of zero is refused", async ({ assert }) => {
		const { a, artistA } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, position, created_at) values (?, ?, 'x.jpg', 0, 900, 0, now())",
							[a.tenant.id, artistA.id],
						),
					),
				/artist_work_photos_size/,
			);
		});
	});

	test("swapping two positions in one UPDATE succeeds (deferrable), and compacting too", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		await add(a, artistA, 0);
		await add(a, artistA, 1);
		await add(a, artistA, 2);
		const before = await positionsOf(a.tenant.id, artistA.id);

		await sql(
			{ tenantId: a.tenant.id },
			`update artist_work_photos
			 set position = case when id = ? then 1::smallint else 0::smallint end
			 where id in (?, ?)`,
			[before[0].id, before[0].id, before[1].id],
		);
		const swapped = await positionsOf(a.tenant.id, artistA.id);
		assert.deepEqual(
			swapped.map((row) => row.id),
			[before[1].id, before[0].id, before[2].id],
		);

		// Removing the first photo and shifting the rest down is one UPDATE too.
		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			await trx.rawQuery("delete from artist_work_photos where id = ?", [
				swapped[0].id,
			]);
			await trx.rawQuery(
				"update artist_work_photos set position = position - 1 where artist_id = ? and position > 0",
				[artistA.id],
			);
		});
		assert.deepEqual(
			(await positionsOf(a.tenant.id, artistA.id)).map((row) => row.position),
			[0, 1],
		);
	});

	test("update and delete of another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { a, b, artistB, add } = await seed();
		await add(b, artistB, 0);

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
