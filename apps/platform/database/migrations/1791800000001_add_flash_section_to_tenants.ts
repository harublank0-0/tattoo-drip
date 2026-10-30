import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Flash joins the studio page's sections (TAT-129), key `flash`. A studio's
 * `storefront_sections` is the comma list of the sections it shows, in order
 * (#modules/storefront/look). `flash` sits right after `artists` by default,
 * so: the column's default becomes 'work,artists,flash,info,inquiry' and every
 * stored list gets `flash` right after `artists`, the spec's place ("Recent
 * work, Artists, Flash, Good to know, Got an idea?"), else right before
 * `info`, else right before `inquiry`. An owner's earlier order stays. It
 * renders nothing until an artist adds a design, so showing it everywhere
 * changes no page by itself.
 *
 * This sorts after TAT-128's `1791790000001`, which rebuilds every list from
 * the keys IT knows (work, artists, inquiry) and drops the others: one that
 * sorted before it would lose `flash` on any database that runs them in
 * order. For the same reason `info` must be a known key here: a list that
 * holds it keeps it.
 *
 * Why the lists are rebuilt, not appended to: the column's check (shapes
 * only: one to eight lowercase keys, `inquiry` among them) and its
 * varchar(100) allow lists the app never writes, with repeated or unknown
 * keys, and adding a key to an eight-key or 100-character list would make the
 * UPDATE violate the check and abort the migration. Each list is rebuilt from
 * its distinct known keys in their stored order, which the app reads the same
 * way (`sectionList` drops unknown and repeated keys), then `flash` is put in
 * (a list that already holds it, which only a development database can,
 * keeps it where it is). The result has at most five keys and 31 characters.
 *
 * Why the default changes first: ALTER TABLE takes its lock for the whole
 * migration transaction, so a studio created meanwhile waits and then takes
 * the new default; with the UPDATE first, a studio inserted between the two
 * would keep a list without `flash` and read as "hidden" (TAT-126's
 * 1791700000002 and TAT-128's 1791790000001 order it the same way).
 *
 * down() sets the previous default first, then rebuilds every list from its
 * distinct known keys without `flash`; the list keeps `inquiry`, which the
 * check requires, and what TAT-128's migration left.
 */
const WITH_FLASH = "'work', 'artists', 'flash', 'info', 'inquiry'";
const WITHOUT_FLASH = "'work', 'artists', 'info', 'inquiry'";

/** Each tenant's stored list as its distinct known keys (from `keys`) in stored order. */
const REBUILT = (keys: string) => `
	with kept as (
		select t.id, k.section, min(k.place) as place
		from tenants t,
			unnest(string_to_array(t.storefront_sections, ',')) with ordinality as k(section, place)
		where k.section in (${keys})
		group by t.id, k.section
	), listed as (
		select id, string_agg(section, ',' order by place) as sections
		from kept
		group by id
	)`;

export default class extends BaseSchema {
	protected tableName = "tenants";

	async up() {
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,flash,info,inquiry'",
		);
		this.schema.raw(`${REBUILT(WITH_FLASH)}
			update tenants t set storefront_sections = next.sections
			from (
				select id, case
					when 'flash' = any (string_to_array(sections, ',')) then sections
					when 'artists' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)artists(,|$)', '\\1artists,flash\\2')
					when 'info' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)info(,|$)', '\\1flash,info\\2')
					when 'inquiry' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)inquiry(,|$)', '\\1flash,inquiry\\2')
					else sections || ',flash'
				end as sections
				from listed
			) next
			where t.id = next.id and t.storefront_sections is distinct from next.sections`);
	}

	async down() {
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,info,inquiry'",
		);
		this.schema.raw(`${REBUILT(WITHOUT_FLASH)}
			update tenants t set storefront_sections = listed.sections
			from listed
			where t.id = listed.id and t.storefront_sections is distinct from listed.sections`);
	}
}
