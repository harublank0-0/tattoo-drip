import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * A business on the platform: a studio, or an artist working alone.
 * Profile and payment settings arrive with TAT-26; old-slug aliases and
 * reserved names with TAT-24.
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table.enum("type", ["studio", "independent"]).notNullable();
			table.string("name", 120).notNullable();
			// Also the subdomain, so it follows DNS label rules (3-63 chars).
			// Unique across deleted tenants too: a deleted studio's subdomain
			// is never handed to someone else.
			table.string("slug", 63).notNullable().unique();
			table.string("timezone", 64).notNullable().defaultTo("Asia/Kathmandu");

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();
		});
	}

	async down() {
		this.schema.dropTable(this.tableName);
	}
}
