import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Fresh ink and Reviews join the studio page's sections (Reviews and Fresh
 * ink, slice 3), keys `fresh_ink` and `reviews`. A studio's
 * `storefront_sections` is the comma list of the sections it shows, in order
 * (#modules/storefront/look). They sit after Flash and before Good to know
 * by default, so: the column's default becomes
 * 'work,artists,flash,fresh_ink,reviews,info,inquiry' and every stored list
 * gets `fresh_ink,reviews` (the one it lacks, when it holds the other, which
 * only a development database can) right before `info`, else right before
 * `inquiry`. An owner's earlier order stays. Each renders nothing until a
 * client's post or review is shown there (and nothing while REVIEWS_ENABLED
 * is off), so showing them everywhere changes no page by itself: that is the
 * spec's "off by default, on once there is something to show".
 *
 * The check allowed lowercase letters only (`^[a-z]+(,[a-z]+){0,7}$`), and
 * `fresh_ink` has an underscore: the check becomes
 * `^[a-z][a-z_]*(,[a-z][a-z_]*){0,7}$` (a key starts with a letter; still one
 * to eight keys, `inquiry` among them, in varchar(100)).
 *
 * Why the lists are rebuilt, not appended to: as TAT-128's and TAT-129's
 * migrations explain, the check allows lists the app never writes, with
 * repeated or unknown keys, so each list is rebuilt from its distinct known
 * keys in their stored order (which the app reads the same way:
 * `sectionList` drops unknown and repeated keys), then the new keys go in.
 * The result has at most seven keys and 49 characters. Why the default
 * changes first: a studio created meanwhile waits for the ALTER's lock and
 * then takes the new default, never a list without them.
 *
 * down() sets the previous default first, then rebuilds every list from its
 * distinct known keys without the two, then puts the old check back (no list
 * holds an underscore any more).
 */
const KNOWN =
	"'work', 'artists', 'flash', 'fresh_ink', 'reviews', 'info', 'inquiry'";
const KNOWN_BEFORE = "'work', 'artists', 'flash', 'info', 'inquiry'";
const OLD_CHECK =
	"storefront_sections ~ '^[a-z]+(,[a-z]+){0,7}$' and 'inquiry' = any (string_to_array(storefront_sections, ','))";
const NEW_CHECK =
	"storefront_sections ~ '^[a-z][a-z_]*(,[a-z][a-z_]*){0,7}$' and 'inquiry' = any (string_to_array(storefront_sections, ','))";

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
			"alter table tenants alter column storefront_sections set default 'work,artists,flash,fresh_ink,reviews,info,inquiry'",
		);
		this.schema.raw(
			"alter table tenants drop constraint tenants_storefront_sections_format",
		);
		this.schema.raw(
			`alter table tenants add constraint tenants_storefront_sections_format check (${NEW_CHECK})`,
		);
		this.schema.raw(`${REBUILT(KNOWN)}, missing as (
				select id, sections, concat_ws(',',
					case when not ('fresh_ink' = any (string_to_array(sections, ','))) then 'fresh_ink' end,
					case when not ('reviews' = any (string_to_array(sections, ','))) then 'reviews' end
				) as keys
				from listed
			)
			update tenants t set storefront_sections = next.sections
			from (
				select id, case
					when keys = '' then sections
					when 'info' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)info(,|$)', '\\1' || keys || ',info\\2')
					when 'inquiry' = any (string_to_array(sections, ','))
						then regexp_replace(sections, '(^|,)inquiry(,|$)', '\\1' || keys || ',inquiry\\2')
					else sections || ',' || keys
				end as sections
				from missing
			) next
			where t.id = next.id and t.storefront_sections is distinct from next.sections`);
	}

	async down() {
		this.schema.raw(
			"alter table tenants alter column storefront_sections set default 'work,artists,flash,info,inquiry'",
		);
		this.schema.raw(`${REBUILT(KNOWN_BEFORE)}
			update tenants t set storefront_sections = listed.sections
			from listed
			where t.id = listed.id and t.storefront_sections is distinct from listed.sections`);
		this.schema.raw(
			"alter table tenants drop constraint tenants_storefront_sections_format",
		);
		this.schema.raw(
			`alter table tenants add constraint tenants_storefront_sections_format check (${OLD_CHECK})`,
		);
	}
}
