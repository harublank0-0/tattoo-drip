import { BaseSchema } from "@adonisjs/lucid/schema";

export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("tenant_memberships", (table) => {
			table.boolean("inventory_access").notNullable().defaultTo(false);
		});
		this.schema.raw(
			"alter table tenant_memberships add constraint tenant_memberships_inventory_artist check (not inventory_access or role = 'artist')",
		);
	}

	async down() {
		this.schema.raw(
			"alter table tenant_memberships drop constraint tenant_memberships_inventory_artist",
		);
		this.schema.alterTable("tenant_memberships", (table) => {
			table.dropColumn("inventory_access");
		});
	}
}
