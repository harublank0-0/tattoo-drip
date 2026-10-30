import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Good to know joins the studio page's sections (TAT-128), key `info`. A
 * studio's `storefront_sections` is the comma list of the sections it shows,
 * in order (#modules/storefront/look). `info` sits just before `inquiry` by
 * default, so: the column's default becomes 'work,artists,info,inquiry' and
 * every list without `info` gets it just before `inquiry`, the spec's place
 * ("Recent work, Artists, Good to know, Got an idea?"). An owner's earlier
 * order stays. It renders nothing until the studio fills something in, so
 * showing it everywhere changes no page by itself. The existing check
 * (shapes only, 'inquiry' always present, at most eight) allows the key.
 *
 * Why a migration number above the other section migrations: a later one
 * that sets this column's default would drop `info` from new studios
 * (page_look_columns.spec.ts compares the default with DEFAULT_SECTIONS).
 *
 * down() takes `info` out of every list and restores the previous default;
 * the list keeps `inquiry`, which the check requires.
 */
export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.raw(
			"update tenants set storefront_sections = regexp_replace(storefront_sections, '(^|,)inquiry(,|$)', '\\1info,inquiry\\2') where not ('info' = any (string_to_array(storefront_sections, ',')))",
		);
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,info,inquiry'",
		);
	}

	async down() {
		this.schema.raw(
			"update tenants set storefront_sections = array_to_string(array_remove(string_to_array(storefront_sections, ','), 'info'), ',') where 'info' = any (string_to_array(storefront_sections, ','))",
		);
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,inquiry'",
		);
	}
}
