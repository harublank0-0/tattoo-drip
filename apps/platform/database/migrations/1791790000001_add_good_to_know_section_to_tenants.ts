import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Good to know joins the studio page's sections (TAT-128), key `info`. A
 * studio's `storefront_sections` is the comma list of the sections it shows,
 * in order (#modules/storefront/look). `info` sits just before `inquiry` by
 * default, so: the column's default becomes 'work,artists,info,inquiry' and
 * every stored list gets `info` just before `inquiry`, the spec's place
 * ("Recent work, Artists, Good to know, Got an idea?"). An owner's earlier
 * order stays. It renders nothing until the studio fills something in, so
 * showing it everywhere changes no page by itself.
 *
 * Why the lists are rebuilt, not appended to: the column's check (shapes
 * only: one to eight lowercase keys, `inquiry` among them) and its varchar(100)
 * allow lists the app never writes, with repeated or unknown keys, and adding a
 * key to an eight-key or 100-character list would make the UPDATE violate the
 * check and abort the migration. Each list is rebuilt from its distinct known
 * keys (work, artists, inquiry) in their stored order, which the app reads the
 * same way (`sectionList` drops unknown and repeated keys), then `info` goes
 * immediately before `inquiry` (at the end if `inquiry` were absent, which the
 * check does not allow). The result has at most four keys and 25 characters.
 *
 * Why the default changes first: ALTER TABLE takes its lock for the whole
 * migration transaction, so a studio created meanwhile waits and then takes
 * the new default; with the UPDATE first, a studio inserted between the two
 * would keep a list without `info` and read as "hidden" (126's
 * 1791700000002 orders it the same way).
 *
 * down() sets the previous default first, then rebuilds every list from its
 * distinct known keys without `info`; the list keeps `inquiry`, which the
 * check requires.
 */
const KNOWN = "'work', 'artists', 'inquiry'";

/** Each tenant's stored list as its distinct known keys in stored order (without `info`). */
const REBUILT = `
	with kept as (
		select t.id, k.section, min(k.place) as place
		from tenants t,
			unnest(string_to_array(t.storefront_sections, ',')) with ordinality as k(section, place)
		where k.section in (${KNOWN})
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
			"alter table tenants alter column storefront_sections set default 'work,artists,info,inquiry'",
		);
		this.schema.raw(`${REBUILT}
			update tenants t set storefront_sections = next.sections
			from (
				select id, case
					when 'inquiry' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)inquiry(,|$)', '\\1info,inquiry\\2')
					else sections || ',info'
				end as sections
				from listed
			) next
			where t.id = next.id and t.storefront_sections is distinct from next.sections`);
	}

	async down() {
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,inquiry'",
		);
		this.schema.raw(`${REBUILT}
			update tenants t set storefront_sections = listed.sections
			from listed
			where t.id = listed.id and t.storefront_sections is distinct from listed.sections`);
	}
}
