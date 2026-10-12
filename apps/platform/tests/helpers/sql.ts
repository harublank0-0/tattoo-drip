import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { type DbContextValues, withDbContext } from "#services/db_context";

/**
 * Raw SQL in a database context. Raw on purpose: these tests prove what the
 * database itself enforces, whatever the models do.
 */
export const sql = (
	context: DbContextValues,
	query: string,
	bindings: RawQueryBindings = [],
) => withDbContext(context, (trx) => trx.rawQuery(query, bindings));

/**
 * INSERTs one row from column/value pairs (created_at is filled in). When a
 * test expects the insert to fail, run it through withTransaction so the
 * failure rolls back to a savepoint and the test can go on.
 */
export function insertRow(
	client: QueryClientContract,
	table: string,
	values: Record<string, unknown>,
) {
	const columns = Object.keys(values);
	return client.rawQuery(
		`insert into ${table} (${columns.join(", ")}, created_at) values (${columns.map(() => "?").join(", ")}, now()) returning id`,
		Object.values(values) as RawQueryBindings,
	);
}

/**
 * UPDATEs the row with this id from column/value pairs.
 */
export function updateRow(
	client: QueryClientContract,
	table: string,
	id: string,
	set: Record<string, unknown>,
) {
	const columns = Object.keys(set);
	return client.rawQuery(
		`update ${table} set ${columns.map((column) => `${column} = ?`).join(", ")} where id = ?`,
		[...Object.values(set), id] as RawQueryBindings,
	);
}

/**
 * The id from an insertRow result.
 */
export const idOf = (result: { rows: { id: string }[] }) => result.rows[0].id;
