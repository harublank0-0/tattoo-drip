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

// Raw SQL only (TAT-129): the database itself must keep a flash design inside
// its tenant, hide other tenants' rows and refuse a bad size or price, even
// when the app's own query code is bypassed. The 100 designs per artist are
// not the database's: FlashService counts under the artist's row lock.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

const INSERT =
	"insert into flash_designs (tenant_id, artist_id, image_key, width, height, name, size, created_at) values (?, ?, ?, ?, ?, 'Moth', 'About 3 in', now()) returning id";

async function seed() {
	const a = await studioWithOwner("flash-a", "Flash A");
	const b = await studioWithOwner("flash-b", "Flash B");
	const artistA = await addArtist(a.tenant, a.owner);
	const artistB = await addArtist(b.tenant, b.owner);
	const add = async (
		who: { tenant: { id: string } },
		artist: { id: string },
		n = 0,
	) => {
		const { rows } = await sql({ tenantId: who.tenant.id }, INSERT, [
			who.tenant.id,
			artist.id,
			`tenants/${who.tenant.id}/flash_design/d${n}.jpg`,
			1200,
			1200,
		]);
		return rows[0].id as string;
	};
	return { a, b, artistA, artistB, add };
}

let clientNumber = 0;

/** A client of the tenant and an inquiry or a project of it naming the design. */
async function requestNaming(tenantId: string, designId: string) {
	const client = await sql(
		{ tenantId },
		"insert into clients (tenant_id, name, phone, created_at) values (?, 'Client', ?, now()) returning id",
		[tenantId, `+97798000${String(++clientNumber).padStart(5, "0")}`],
	);
	const clientId = client.rows[0].id as string;
	const inquiry = () =>
		sql(
			{ tenantId },
			`insert into inquiries (tenant_id, client_id, idea, placement, approximate_size, preferred_dates,
				source_channel, contact_name, contact_phone, flash_design_id, created_at)
			values (?, ?, 'idea', 'arm', '5 cm', 'any', 'other', 'Client', '+9779800000001', ?, now())
			returning id`,
			[tenantId, clientId, designId],
		);
	const project = () =>
		withDbContext({ tenantId }, (trx) =>
			trx.rawQuery(
				`insert into tattoo_projects (tenant_id, client_id, brief, status, flash_design_id, created_at)
				values (?, ?, 'brief', 'reviewing', ?, now()) returning id`,
				[tenantId, clientId, designId],
			),
		);
	return { inquiry, project };
}

test.group("RLS: flash_designs (TAT-129)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under context A only A's rows come back; with no context none", async ({
		assert,
	}) => {
		const { a, b, artistA, artistB, add } = await seed();
		await add(a, artistA);
		await add(b, artistB);

		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select tenant_id from flash_designs",
		);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].tenant_id, a.tenant.id);

		const none = await dbClient().rawQuery(
			"select count(*)::int as n from flash_designs",
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
						trx.rawQuery(INSERT, [
							b.tenant.id,
							artistB.id,
							"x.jpg",
							1200,
							1200,
						]),
					),
				/row-level security/,
			);
		});
	});

	test("a design cannot name another tenant's artist (composite foreign key)", async ({
		assert,
	}) => {
		const { a, artistB } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(INSERT, [
							a.tenant.id,
							artistB.id,
							"x.jpg",
							1200,
							1200,
						]),
					),
				/violates foreign key constraint "flash_designs_tenant_id_artist_id_foreign"/,
			);
		});
	});

	test("a width or height of zero, and a price of zero, are refused", async ({
		assert,
	}) => {
		const { a, artistA } = await seed();
		const insert = (width: number, height: number, price: number | null) =>
			withDbContext({ tenantId: a.tenant.id }, () =>
				withTransaction((trx) =>
					trx.rawQuery(
						`insert into flash_designs (tenant_id, artist_id, image_key, width, height, name, size, price, created_at)
						values (?, ?, 'x.jpg', ?, ?, 'Moth', 'About 3 in', ${price === null ? "null" : Number(price)}, now())`,
						[a.tenant.id, artistA.id, width, height],
					),
				),
			);

		await assert.rejects(
			() => insert(0, 900, null),
			/flash_designs_size_positive/,
		);
		await assert.rejects(
			() => insert(900, 0, null),
			/flash_designs_size_positive/,
		);
		await assert.rejects(
			() => insert(900, 900, 0),
			/flash_designs_price_positive/,
		);
		await insert(900, 900, 1);
	});

	test("a new design is shown, in rupees and an artist takes flash requests", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		await add(a, artistA);

		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select hidden, currency, price from flash_designs",
		);
		assert.deepEqual(rows, [{ hidden: false, currency: "NPR", price: null }]);
		const artist = await sql(
			{ tenantId: a.tenant.id },
			"select accepting_flash from artists where id = ?",
			[artistA.id],
		);
		assert.isTrue(artist.rows[0].accepting_flash);
	});

	test("an inquiry or a project cannot name another tenant's design", async ({
		assert,
	}) => {
		const { b, artistB, a, add } = await seed();
		const foreign = await add(b, artistB);
		const asA = await requestNaming(a.tenant.id, foreign);

		await assert.rejects(
			() => asA.inquiry(),
			/violates foreign key constraint "inquiries_flash_design_fk"/,
		);
		await assert.rejects(
			() => asA.project(),
			/violates foreign key constraint "tattoo_projects_flash_design_fk"/,
		);
	});

	test("a design an inquiry names cannot be deleted, nor one a project names", async ({
		assert,
	}) => {
		const { a, artistA, add } = await seed();
		const byInquiry = await add(a, artistA, 1);
		const byProject = await add(a, artistA, 2);
		await (await requestNaming(a.tenant.id, byInquiry)).inquiry();
		await (await requestNaming(a.tenant.id, byProject)).project();
		const remove = (id: string) =>
			sql({ tenantId: a.tenant.id }, "delete from flash_designs where id = ?", [
				id,
			]);

		await assert.rejects(() => remove(byInquiry), /inquiries_flash_design_fk/);
		await assert.rejects(
			() => remove(byProject),
			/tattoo_projects_flash_design_fk/,
		);
	});

	test("update and delete of another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { a, b, artistB, add } = await seed();
		await add(b, artistB);

		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update flash_designs set name = 'hacked' where tenant_id = ?",
				[b.tenant.id],
			);
			const remove = await trx.rawQuery(
				"delete from flash_designs where tenant_id = ?",
				[b.tenant.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.tenant.id },
			"select name from flash_designs",
		);
		assert.deepEqual(rows, [{ name: "Moth" }]);
	});
});
