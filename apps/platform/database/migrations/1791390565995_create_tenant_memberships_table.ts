import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * One role for one user in one tenant. Users have no tenant_id: a user's
 * access is the set of their membership rows.
 */
export default class extends BaseSchema {
	protected tableName = "tenant_memberships";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table
				.uuid("user_id")
				.notNullable()
				.references("id")
				.inTable("users")
				.onDelete("CASCADE");
			table.enum("role", ["owner", "artist"]).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			table.index(["tenant_id"]);
			// "Which tenants is this user in?"
			table.index(["user_id"]);
		});

		// One live membership per user per tenant. Partial, so a removed
		// (soft-deleted) member can be invited back.
		this.schema.raw(
			"CREATE UNIQUE INDEX tenant_memberships_tenant_user_live_unique ON tenant_memberships (tenant_id, user_id) WHERE deleted_at IS NULL",
		);
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
