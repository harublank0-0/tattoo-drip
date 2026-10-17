import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Rate-limit counters (TAT-8) for @adonisjs/limiter's Postgres store
 * (rate-limiter-flexible's RateLimiterPostgres). Its SQL fixes the shape, so
 * this table skips the uuid and timestamptz conventions: it inserts
 * positional VALUES (key, points, expire), and `expire` is epoch
 * milliseconds. Keys are HMAC digests, never an email or IP address. Not
 * tenant-owned, so no row-level security (exempt in catalog_guard.spec.ts).
 * The app role's SELECT, INSERT, UPDATE and DELETE come from the default
 * privileges in setup_roles.sql.
 */
export default class extends BaseSchema {
	protected tableName = "rate_limits";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.string("key", 255).notNullable().primary();
			table.integer("points").notNullable().defaultTo(0);
			table.bigint("expire");
		});
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
