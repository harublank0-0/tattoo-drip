import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import {
	type DbContextValues,
	dbClient,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

// Raw SQL only: these tests prove the database enforces isolation even when
// the app's own query code is bypassed.
const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

async function seed() {
	const a = await studioWithOwner("studio-a", "Studio A");
	const b = await studioWithOwner("studio-b", "Studio B");
	for (const { tenant } of [a, b]) {
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"insert into payment_methods (tenant_id, kind, label, position, created_at) values (?, 'cash', ?, 0, now())",
				[tenant.id, `${tenant.slug} cash`],
			),
		);
	}
	return { a, b };
}

test.group("RLS: tenant context", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("under context A, tenant-owned tables return only A's rows", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		for (const table of ["payment_methods", "tenant_memberships"]) {
			const { rows } = await sql(
				{ tenantId: a.tenant.id },
				`select tenant_id from ${table}`,
			);
			assert.isNotEmpty(rows, table);
			assert.isTrue(
				rows.every(
					(row: { tenant_id: string }) => row.tenant_id === a.tenant.id,
				),
				table,
			);
		}
		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select id from tenants",
		);
		assert.deepEqual(
			rows.map((row: { id: string }) => row.id),
			[a.tenant.id],
		);
		assert.notInclude(
			rows.map((row: { id: string }) => row.id),
			b.tenant.id,
		);
	});

	test("with no context nothing comes back while other tenants have data", async ({
		assert,
	}) => {
		await seed();

		for (const table of ["payment_methods", "tenant_memberships", "tenants"]) {
			const { rows } = await dbClient().rawQuery(
				`select count(*)::int as n from ${table}`,
			);
			assert.equal(rows[0].n, 0, table);
		}
	});

	test("an insert for another tenant fails the policy check", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into payment_methods (tenant_id, kind, label, position, created_at) values (?, 'cash', 'x', 1, now())",
							[b.tenant.id],
						),
					),
				/row-level security/,
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into tenant_memberships (tenant_id, user_id, role, created_at) values (?, ?, 'owner', now())",
							[b.tenant.id, a.owner.id],
						),
					),
				/row-level security/,
			);
			await assert.rejects(
				() =>
					withTransaction((trx) =>
						trx.rawQuery(
							"insert into tenants (type, name, slug, timezone, created_at) values ('studio', 'x', 'x-shop', 'UTC', now())",
						),
					),
				/row-level security/,
			);
		});
	});

	test("update and delete on another tenant's rows affect zero rows", async ({
		assert,
	}) => {
		const { a, b } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			const update = await trx.rawQuery(
				"update payment_methods set label = 'hacked' where tenant_id = ?",
				[b.tenant.id],
			);
			const remove = await trx.rawQuery(
				"delete from payment_methods where tenant_id = ?",
				[b.tenant.id],
			);
			assert.equal(update.rowCount, 0);
			assert.equal(remove.rowCount, 0);
		});
		const { rows } = await sql(
			{ tenantId: b.tenant.id },
			"select label from payment_methods",
		);
		assert.deepEqual(rows, [{ label: "studio-b cash" }]);
	});

	test("an unqualified UPDATE that moves a row to another tenant fails and changes nothing", async ({
		assert,
	}) => {
		const { a, b } = await seed();
		const moves: [string, string][] = [
			["payment_methods", "tenant_id"],
			["tenant_memberships", "tenant_id"],
			["tenants", "id"],
		];

		for (const [table, column] of moves) {
			await withDbContext({ tenantId: a.tenant.id }, async () => {
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							trx.rawQuery(`update ${table} set ${column} = ?`, [b.tenant.id]),
						),
					// The table is in the message, so a failure names it.
					new RegExp(`row-level security policy for table "${table}"`),
				);
			});
		}
		const { rows } = await sql(
			{ tenantId: a.tenant.id },
			"select tenant_id from payment_methods",
		);
		assert.deepEqual(rows, [{ tenant_id: a.tenant.id }]);
	});
});

test.group(
	"RLS: user context (listing my studios, resolving a slug)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a user sees their own studios and memberships, and resolves their slug", async ({
			assert,
		}) => {
			const { a, b } = await seed();

			const tenants = await sql(
				{ userId: a.owner.id },
				"select slug from tenants",
			);
			assert.deepEqual(tenants.rows, [{ slug: "studio-a" }]);

			const memberships = await sql(
				{ userId: a.owner.id },
				"select user_id from tenant_memberships",
			);
			assert.deepEqual(memberships.rows, [{ user_id: a.owner.id }]);

			const own = await sql(
				{ userId: a.owner.id },
				"select id from tenants where slug = ?",
				["studio-a"],
			);
			assert.lengthOf(own.rows, 1);
			const stranger = await sql(
				{ userId: b.owner.id },
				"select id from tenants where slug = ?",
				["studio-a"],
			);
			assert.lengthOf(stranger.rows, 0);
		});

		test("a removed member no longer sees the studio", async ({ assert }) => {
			const { a } = await seed();
			await inTenant(a.tenant, () =>
				dbClient().rawQuery(
					"update tenant_memberships set deleted_at = now() where user_id = ?",
					[a.owner.id],
				),
			);

			const { rows } = await sql(
				{ userId: a.owner.id },
				"select slug from tenants",
			);
			assert.deepEqual(rows, []);
		});
	},
);
