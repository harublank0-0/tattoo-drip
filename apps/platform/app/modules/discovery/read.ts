import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { withTransaction } from "#services/db_context";

/**
 * Runs Discover's reads (Discover D03, docs/discover/api.md) inside the D02
 * boundary: a savepoint of the request's transaction (or a transaction of
 * its own) where
 *
 * - `app.tenant_id` and `app.user_id` are empty, whatever the caller had,
 *   so no tenant-scoped row can come back through the app role;
 * - the transaction is read-only (`transaction_read_only`), so a mistaken
 *   write fails in the database;
 * - and which is always rolled back afterwards, so neither setting outlives
 *   the reads (a released savepoint would keep both for the rest of the
 *   transaction, and on a pooled connection's next request).
 *
 * If `ROLLBACK TO SAVEPOINT` itself fails (a dropped connection, a savepoint
 * already gone), knex does not reject `rollback()`. The settings still
 * cannot outlive the read: PostgreSQL has then aborted or lost the enclosing
 * transaction, every later statement in it fails, and the request
 * transaction's end discards every `set_config(..., true)` with it.
 *
 * `fn` must query only the `discovery` views and `places`; the app role
 * reads nothing else without a tenant context anyway.
 */
export async function readDiscovery<T>(
	fn: (client: TransactionClientContract) => Promise<T>,
): Promise<T> {
	return withTransaction(async (trx) => {
		const reads = await trx.transaction();
		try {
			await reads.rawQuery(
				"select set_config('app.tenant_id', '', true), set_config('app.user_id', '', true), set_config('transaction_read_only', 'on', true)",
			);
			return await fn(reads);
		} finally {
			await reads.rollback();
		}
	});
}
