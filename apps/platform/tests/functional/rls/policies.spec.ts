import testUtils from "@adonisjs/core/services/test_utils";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { test } from "@japa/runner";
import {
	type DbContextValues,
	dbClient,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

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

	test("a malformed tenant setting fails closed, and the context recovers (TAT-16)", async ({
		assert,
	}) => {
		const { a } = await seed();

		await withDbContext({ tenantId: a.tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction(async (inner) => {
						await inner.rawQuery(
							"select set_config('app.tenant_id', 'not-a-uuid', true)",
						);
						return inner.rawQuery(
							"select count(*)::int as n from payment_methods",
						);
					}),
				/invalid input syntax for type uuid/,
			);

			// The refused statement leaves A's context as it was.
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from payment_methods",
			);
			assert.isAbove(rows[0].n, 0);
		});
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

		test("a member of two studios can read the other one's rows but not write them, and cannot write without a tenant", async ({
			assert,
		}) => {
			const { a, b } = await seed();
			const c = await studioWithOwner("studio-c", "Studio C");
			const member = await artistIn(a.tenant, "member@example.com");
			await inTenant(b.tenant, () =>
				dbClient().rawQuery(
					"insert into tenant_memberships (tenant_id, user_id, role, created_at) values (?, ?, 'artist', now())",
					[b.tenant.id, member.id],
				),
			);
			const readB = () =>
				sql(
					{ tenantId: b.tenant.id },
					"select 'membership' as kind, id, user_id::text as detail, role::text as state, deleted_at from tenant_memberships union all select 'tenant', id, name, slug, deleted_at from tenants order by kind, id",
				);
			const before = (await readB()).rows;
			// Two memberships (B's owner and the member) and B itself.
			assert.lengthOf(before, 3);

			// Tenant A with the member as user: the SELECT policies are wider than
			// the write policies here (user_id = U, a live membership), and the
			// writes must not follow them.
			await withDbContext(
				{ tenantId: a.tenant.id, userId: member.id },
				async (trx) => {
					const ownInB = await trx.rawQuery(
						"select id from tenant_memberships where tenant_id = ? and user_id = ?",
						[b.tenant.id, member.id],
					);
					assert.lengthOf(
						ownInB.rows,
						1,
						"the member sees their membership in B",
					);
					const studioB = await trx.rawQuery(
						"select id from tenants where id = ?",
						[b.tenant.id],
					);
					assert.lengthOf(studioB.rows, 1, "the member sees studio B");

					const writes: [string, string, RawQueryBindings][] = [
						[
							"update the member's own membership in B",
							"update tenant_memberships set role = 'owner' where tenant_id = ? and user_id = ?",
							[b.tenant.id, member.id],
						],
						[
							"update every membership in B",
							"update tenant_memberships set role = 'artist' where tenant_id = ?",
							[b.tenant.id],
						],
						[
							"delete the member's own membership in B",
							"delete from tenant_memberships where tenant_id = ? and user_id = ?",
							[b.tenant.id, member.id],
						],
						[
							"delete every membership in B",
							"delete from tenant_memberships where tenant_id = ?",
							[b.tenant.id],
						],
						[
							"update studio B",
							"update tenants set name = 'hacked' where id = ?",
							[b.tenant.id],
						],
					];
					for (const [label, query, bindings] of writes) {
						const result = await trx.rawQuery(query, bindings);
						assert.equal(result.rowCount, 0, label);
					}
				},
			);
			assert.deepEqual((await readB()).rows, before, "B is exactly as it was");

			// A user with no tenant context writes nothing, not even their own row.
			await withDbContext({ userId: member.id }, async () => {
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							trx.rawQuery(
								"insert into tenant_memberships (tenant_id, user_id, role, created_at) values (?, ?, 'owner', now())",
								[c.tenant.id, member.id],
							),
						),
					/row-level security policy for table "tenant_memberships"/,
				);
				await assert.rejects(
					() =>
						withTransaction((trx) =>
							trx.rawQuery(
								"insert into tenants (type, name, slug, timezone, created_at) values ('studio', 'x', 'x-shop', 'UTC', now())",
							),
						),
					/row-level security policy for table "tenants"/,
				);
			});
			const joined = await sql(
				{ tenantId: c.tenant.id },
				"select user_id from tenant_memberships where user_id = ?",
				[member.id],
			);
			assert.lengthOf(joined.rows, 0, "the member did not join studio C");
		});
	},
);
