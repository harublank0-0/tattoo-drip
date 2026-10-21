import db from "@adonisjs/lucid/services/db";

/**
 * Runs `fn` and returns what it returned with the SQL of every query the
 * default connection ran meanwhile, so a test can pin that a read costs the
 * same number of queries for one row as for ten (no query per row). Knex
 * hands the events of a transaction, the test's global one included, to the
 * client it came from, so one listener sees them all. Run nothing else
 * concurrently inside `fn`.
 */
export async function recordQueries<T>(fn: () => Promise<T>) {
	const knex = db.connection().getWriteClient();
	const queries: string[] = [];
	const onQuery = (query: { sql: string }) => {
		queries.push(query.sql);
	};
	knex.on("query", onQuery);
	try {
		const result = await fn();
		return { result, queries };
	} finally {
		knex.removeListener("query", onQuery);
	}
}
