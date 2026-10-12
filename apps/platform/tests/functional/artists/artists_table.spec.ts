import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	type DbContextValues,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL on purpose: this proves what the database itself enforces.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

const INSERT =
	"insert into artists (tenant_id, name, slug, created_at) values (?, ?, ?, now())";
const INSERT_LINKED =
	"insert into artists (tenant_id, user_id, name, slug, created_at) values (?, ?, ?, ?, now())";

test.group("artists table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a slug is unique among a tenant's live artists and free again after a soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT, [tenant.id, "Sita", "sita"]);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(INSERT, [tenant.id, "Other", "sita"]),
					),
				/artists_tenant_slug_live_unique/,
			);
			await trx.rawQuery(
				"update artists set deleted_at = now() where slug = 'sita'",
			);
			await trx.rawQuery(INSERT, [tenant.id, "Again", "sita"]);
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from artists where slug = 'sita'",
			);
			assert.equal(rows[0].n, 2);
		});
	});

	test("two tenants can use the same slug", async () => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		await sql({ tenantId: a.id }, INSERT, [a.id, "Sita", "sita"]);
		await sql({ tenantId: b.id }, INSERT, [b.id, "Sita", "sita"]);
	});

	test("a login has at most one live profile per tenant, and profiles without a login are unlimited", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT_LINKED, [tenant.id, owner.id, "A", "a1"]);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(INSERT_LINKED, [tenant.id, owner.id, "B", "b1"]),
					),
				/artists_tenant_user_live_unique/,
			);
			await trx.rawQuery(INSERT, [tenant.id, "C", "c1"]);
			await trx.rawQuery(INSERT, [tenant.id, "D", "d1"]);
		});
	});

	test("the photo columns are all set or all null", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(
							"insert into artists (tenant_id, name, slug, photo_key, created_at) values (?, 'A', 'a1', 'k.png', now())",
							[tenant.id],
						),
					),
				/artists_photo_all_or_none/,
			);
			await trx.rawQuery(
				"insert into artists (tenant_id, name, slug, photo_key, photo_width, photo_height, created_at) values (?, 'A', 'a1', 'k.png', 300, 200, now())",
				[tenant.id],
			);
		});
	});

	test("deleting the linked user's account keeps the profile and unlinks it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const other = await User.create({
			email: "other@example.com",
			password: "secret-password",
		});

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await trx.rawQuery(INSERT_LINKED, [tenant.id, other.id, "A", "a1"]);
			await trx.rawQuery("delete from users where id = ?", [other.id]);
			const { rows } = await trx.rawQuery(
				"select user_id from artists where slug = 'a1'",
			);
			assert.lengthOf(rows, 1);
			assert.isNull(rows[0].user_id);
		});
	});

	test("row-level security: a tenant sees only its own artists, no context sees none, and rows cannot move", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		await sql({ tenantId: a.id }, INSERT, [a.id, "A", "a-1"]);
		await sql({ tenantId: b.id }, INSERT, [b.id, "B", "b-1"]);

		const underA = await sql(
			{ tenantId: a.id },
			"select tenant_id from artists",
		);
		assert.deepEqual(
			underA.rows.map((row: { tenant_id: string }) => row.tenant_id),
			[a.id],
		);
		const none = await sql({}, "select count(*)::int as n from artists");
		assert.equal(none.rows[0].n, 0);
		await assert.rejects(
			() => sql({ tenantId: a.id }, INSERT, [b.id, "X", "x-1"]),
			/row-level security/,
		);
		await assert.rejects(
			() => sql({ tenantId: a.id }, "update artists set tenant_id = ?", [b.id]),
			/row-level security/,
		);
	});
});
