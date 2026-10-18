import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Single-use account links (TAT-18): one live token per account and
 * purpose (a new one replaces the old), stored as its SHA-256 only, bound to
 * the address it was sent to, deleted when used. Not tenant-owned and read
 * before any context exists, by a link anyone may open, so no row-level
 * security (exempt in catalog_guard.spec.ts, like users). Deleting the
 * account deletes its tokens. An expired row stays until it is replaced (at
 * most two per account). Not soft-deleted: a credential. The purposes are
 * TOKEN_PURPOSES in #modules/identity/account_tokens (copied, not imported).
 */
export default class extends BaseSchema {
	protected tableName = "account_tokens";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("user_id")
				.notNullable()
				.references("id")
				.inTable("users")
				.onDelete("CASCADE");
			table.enum("purpose", ["verify_email", "reset_password"]).notNullable();
			table.string("token_hash", 64).notNullable().unique();
			table.string("email", 254).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();

			// One live token per account and purpose; also the user_id index.
			table.unique(["user_id", "purpose"]);
		});
		this.schema.raw(
			"alter table account_tokens add constraint account_tokens_expires_after_creation check (expires_at > created_at)",
		);
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
