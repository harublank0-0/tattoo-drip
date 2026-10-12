import type { Assert } from "@japa/assert";
import { withDbContext, withTransaction } from "#services/db_context";
import { insertRow, sql } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * Proves row-level security on `table` with raw SQL, for two studios:
 * each sees only its own rows, no context sees none, an INSERT naming
 * another tenant fails the policy check, and an UPDATE that moves a row to
 * another tenant is refused.
 *
 * `seed(tenant)` runs its own `inTenant(tenant, …)`, creates the row's
 * parents (through the pipeline factories) and returns the column/value
 * pairs of a fresh INSERT naming that tenant; it is called more than once
 * per tenant, so it must not reuse unique values.
 *
 * `moved` is the message the move is refused with. It is the policy's
 * message everywhere except on tables with a guard trigger (inquiries,
 * payments), where the BEFORE ROW trigger fires first and names the frozen
 * column.
 */
export async function assertRowLevelSecurity(
	assert: Assert,
	table: string,
	seed: (tenant: { id: string }) => Promise<Record<string, unknown>>,
	moved: RegExp = /row-level security/,
) {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	for (const tenant of [a, b]) {
		const values = await seed(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			insertRow(trx, table, values),
		);
	}

	const own = await sql({ tenantId: a.id }, `select tenant_id from ${table}`);
	assert.deepEqual(
		own.rows.map((row: { tenant_id: string }) => row.tenant_id),
		[a.id],
		`${table}: tenant A sees only its own rows`,
	);
	const none = await sql({}, `select count(*)::int as n from ${table}`);
	assert.equal(none.rows[0].n, 0, `${table}: no context sees no rows`);

	const foreign = await seed(b);
	await withDbContext({ tenantId: a.id }, async () => {
		await assert.rejects(
			() => withTransaction((trx) => insertRow(trx, table, foreign)),
			/row-level security/,
		);
		await assert.rejects(
			() =>
				withTransaction((trx) =>
					trx.rawQuery(`update ${table} set tenant_id = ?`, [b.id]),
				),
			moved,
		);
	});
}
