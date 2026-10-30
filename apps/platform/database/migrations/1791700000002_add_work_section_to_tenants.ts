import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Recent work joins the studio page's sections (TAT-126). A studio's
 * `storefront_sections` is the comma list of the sections it shows, in order
 * (#modules/storefront/look). `work` is new and comes first by default, so:
 * the column's default becomes 'work,artists,inquiry' and every studio
 * without `work` gets it in front of what it had. An owner's earlier choices
 * stay as they were (artists last, artists hidden) and Recent work joins at
 * its default place; each can hide it from Page look. The existing check
 * (shapes only, 'inquiry' always present) already allows the new key.
 *
 * down() takes `work` out of every list and restores the old default; the
 * list keeps `inquiry`, which the check requires.
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,inquiry'",
		);
		this.schema.raw(
			"update tenants set storefront_sections = 'work,' || storefront_sections where not ('work' = any (string_to_array(storefront_sections, ',')))",
		);
	}

	async down() {
		this.schema.raw(
			"update tenants set storefront_sections = array_to_string(array_remove(string_to_array(storefront_sections, ','), 'work'), ',') where 'work' = any (string_to_array(storefront_sections, ','))",
		);
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'artists,inquiry'",
		);
	}
}
