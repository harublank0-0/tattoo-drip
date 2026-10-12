import { currentClient, withDbContext } from "#services/db_context";

/**
 * Runs `work` inside an open request-like transaction in which opening the
 * next level (the savepoint a service's withTransaction needs) fails with
 * "cannot open", as a lost database connection would.
 */
export function whereNoSavepointOpens<T>(
	tenantId: string,
	work: () => Promise<T>,
) {
	return withDbContext({ tenantId }, async () => {
		const client = currentClient();
		if (!client) throw new Error("expected an open transaction");
		const original = client.transaction;
		client.transaction = (() =>
			Promise.reject(new Error("cannot open"))) as unknown as typeof original;
		try {
			return await work();
		} finally {
			client.transaction = original;
		}
	});
}
