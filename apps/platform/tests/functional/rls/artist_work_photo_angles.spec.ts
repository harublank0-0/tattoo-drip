import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import { addArtist } from "#tests/helpers/artists";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * Angles in the database itself (migration
 * 1791900000000_add_angles_to_artist_work_photos), in raw SQL as the app
 * role, so the shape of a tattoo holds even when WorkPhotoService is
 * bypassed: the composite key to the lead, the checks, the deferrable unique
 * of a place and the guard trigger (no chains, a tattoo of angles never
 * becomes an angle, one tenant and one artist per tattoo). Each refusal runs
 * in its own savepoint (withTransaction), so the test goes on.
 */
const INSERT =
	"insert into artist_work_photos (tenant_id, artist_id, image_key, width, height, created_at, lead_photo_id, angle_position) values (?, ?, ?, 1200, 900, now(), ?, ?) returning id";

/** Bindings that may hold SQL nulls (Lucid's binding type leaves null out; pg sends it as NULL). */
const withNulls = (values: (string | number | null)[]) =>
	values as unknown as RawQueryBindings;

async function seed() {
	const a = await studioWithOwner("angles-db-a", "Angles A");
	const b = await studioWithOwner("angles-db-b", "Angles B");
	const sita = await addArtist(a.tenant, a.owner);
	const bina = await addArtist(a.tenant, a.owner, {
		name: "Bina",
		slug: "bina",
	});
	const theirs = await addArtist(b.tenant, b.owner);
	return { a, b, sita, bina, theirs };
}

test.group("Database: a tattoo's angles", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("holds its shape: no chain, no tattoo of angles made an angle, one artist and one tenant, places 1 to 7 once each, a lead and a place together, never its own angle", async ({
		assert,
	}) => {
		const { a, b, sita, bina, theirs } = await seed();
		const theirPhoto = await withDbContext(
			{ tenantId: b.tenant.id },
			async () =>
				(
					await dbClient().rawQuery(
						INSERT,
						withNulls([b.tenant.id, theirs.id, "t.jpg", null, null]),
					)
				).rows[0].id as string,
		);

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			const add = async (
				artistId: string,
				lead: string | null = null,
				place: number | null = null,
			) =>
				(
					await dbClient().rawQuery(
						INSERT,
						withNulls([a.tenant.id, artistId, "p.jpg", lead, place]),
					)
				).rows[0].id as string;
			const refused = (
				query: string,
				bindings: RawQueryBindings,
				error: RegExp,
			) =>
				assert.rejects(
					() => withTransaction((trx) => trx.rawQuery(query, bindings)),
					error,
				);
			const SET =
				"update artist_work_photos set lead_photo_id = ?, angle_position = ? where id = ?";

			const lead = await add(sita.id);
			const angle = await add(sita.id, lead, 1);
			const other = await add(sita.id);
			const binas = await add(bina.id);

			await refused(SET, [angle, 1, other], /is an angle itself/);
			await refused(SET, [other, 1, lead], /has angles and cannot become one/);
			await refused(SET, [lead, 2, binas], /of another tenant or artist/);
			// Another tenant's photo is unreadable here: the key refuses it.
			await refused(
				SET,
				[theirPhoto, 1, other],
				/artist_work_photos_angle_lead_fk/,
			);
			await refused(SET, [lead, 1, other], /artist_work_photos_angle_place/);
			await refused(SET, [lead, 8, other], /artist_work_photos_angle_position/);
			await refused(
				SET,
				withNulls([lead, null, other]),
				/artist_work_photos_angle_complete/,
			);
			await refused(
				SET,
				[other, 1, other],
				/artist_work_photos_angle_not_self/,
			);
			await refused(
				"delete from artist_work_photos where id = ?",
				[lead],
				/artist_work_photos_angle_lead_fk/,
			);
			await refused(
				"update artist_work_photos set artist_id = ? where id = ?",
				[bina.id, lead],
				/angles of .* are of another artist/,
			);
			await refused(
				"update artist_work_photos set artist_id = ? where id = ?",
				[bina.id, angle],
				/of another tenant or artist/,
			);
		});
	});

	test("one statement can hand a tattoo to a new lead, swap places, move a whole tattoo or delete it", async ({
		assert,
	}) => {
		const { a, sita, bina } = await seed();
		await withDbContext({ tenantId: a.tenant.id }, async () => {
			const run = (query: string, bindings: RawQueryBindings = []) =>
				dbClient().rawQuery(query, bindings);
			const add = async (lead: string | null, place: number | null) =>
				(
					await run(
						INSERT,
						withNulls([a.tenant.id, sita.id, "p.jpg", lead, place]),
					)
				).rows[0].id as string;
			const lead = await add(null, null);
			const first = await add(lead, 1);
			const second = await add(lead, 2);
			const shape = async (leadId: string) =>
				(
					await run(
						"select id, lead_photo_id, angle_position from artist_work_photos where id = ? or lead_photo_id = ? order by angle_position nulls first",
						[leadId, leadId],
					)
				).rows.map(
					(row: {
						id: string;
						lead_photo_id: string | null;
						angle_position: number | null;
					}) => [row.id, row.lead_photo_id, row.angle_position],
				);

			await run(
				"update artist_work_photos set angle_position = 3 - angle_position where lead_photo_id = ?",
				[lead],
			);
			assert.deepEqual(await shape(lead), [
				[lead, null, null],
				[second, lead, 1],
				[first, lead, 2],
			]);

			await run(
				`update artist_work_photos set
					lead_photo_id = case when id = ? then null else ?::uuid end,
					angle_position = case id when ? then 1 when ? then 2 else null end
				where id in (?, ?, ?)`,
				[first, first, lead, second, lead, first, second],
			);
			assert.deepEqual(await shape(first), [
				[first, null, null],
				[lead, first, 1],
				[second, first, 2],
			]);

			await run(
				"update artist_work_photos set artist_id = ? where id = ? or lead_photo_id = ?",
				[bina.id, first, first],
			);
			await run(
				"delete from artist_work_photos where id = ? or lead_photo_id = ?",
				[first, first],
			);
			assert.deepEqual(await shape(first), []);
		});
	});

	test("the guard function pins its search_path and runs as the invoker", async ({
		assert,
	}) => {
		const { rows } = await dbClient().rawQuery(
			`select p.prosecdef as definer, p.proconfig as config
			 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'public' and p.proname = 'artist_work_photos_angles_guard'`,
		);
		assert.deepEqual(rows, [
			{ definer: false, config: ["search_path=pg_catalog, pg_temp"] },
		]);
		const triggers = await dbClient().rawQuery(
			`select tgname, tgdeferrable, tginitdeferred, tgconstraint <> 0 as is_constraint
			 from pg_trigger where tgrelid = 'public.artist_work_photos'::regclass and not tgisinternal`,
		);
		assert.deepEqual(triggers.rows, [
			{
				tgname: "artist_work_photos_angles_guard",
				tgdeferrable: true,
				tginitdeferred: false,
				is_constraint: true,
			},
		]);
	});
});
