import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * A studio logo's tile and icon (TAT-123), as columns of tenants like the logo
 * itself, so the public read and the settings page cost no query.
 *
 * - `logo_tile`: the small tile the logo sits on, `light` or `dark`. Picked
 *   when the logo is uploaded (a light logo with a see-through background gets
 *   the dark one); the owner can switch it. The database checks only the shape,
 *   like the look columns: which words exist is the app's list
 *   (#modules/storefront/look LOGO_TILES).
 * - `logo_icon_key`: the logo's square icon (purpose `studio_icon`), the
 *   browser tab's and home screen's. Null until a logo with an icon is saved,
 *   and only ever set with a logo.
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("logo_tile", 10).notNullable().defaultTo("light");
			table.string("logo_icon_key", 255).nullable();
		});
		this.schema.raw(
			"alter table tenants add constraint tenants_logo_tile_format check (logo_tile ~ '^[a-z]{1,10}$')",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_logo_icon_needs_logo check (logo_icon_key is null or logo_image_key is not null)",
		);
	}

	async down() {
		this.schema.raw(
			"alter table tenants drop constraint tenants_logo_icon_needs_logo",
		);
		this.schema.raw(
			"alter table tenants drop constraint tenants_logo_tile_format",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns("logo_tile", "logo_icon_key");
		});
	}
}
