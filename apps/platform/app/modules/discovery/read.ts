import logger from "@adonisjs/core/services/logger";
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
 * `fn` must query only the `discovery` views and `places`; the app role
 * reads nothing else without a tenant context anyway.
 */
export async function readDiscovery<T>(
	fn: (client: TransactionClientContract) => Promise<T>,
): Promise<T> {
	return withTransaction(async (trx) => {
		const reads = await trx.transaction();
		let result: T;
		try {
			await reads.rawQuery(
				"select set_config('app.tenant_id', '', true), set_config('app.user_id', '', true), set_config('transaction_read_only', 'on', true)",
			);
			result = await fn(reads);
		} catch (error) {
			// The read's error is the one to report; a failed rollback (a
			// dropped connection) only loses the transaction, which the
			// error rolls back anyway.
			try {
				await reads.rollback();
			} catch (err) {
				logger.error({ err }, "Rolling back a Discover read failed");
			}
			throw error;
		}
		// After a successful read a failed rollback must fail the request:
		// the savepoint's settings would otherwise stay in force.
		await reads.rollback();
		return result;
	});
}
