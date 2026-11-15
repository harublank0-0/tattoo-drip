import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Who granted a pilot (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * Pilots: "a note, and who granted it"). `node ace packages:pilot --by`
 * records the operator's name. Null only for grants made before this column.
 */
export default class extends BaseSchema {
	protected tableName = "pilot_grants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("granted_by", 100).nullable();
		});
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("granted_by");
		});
	}
}
