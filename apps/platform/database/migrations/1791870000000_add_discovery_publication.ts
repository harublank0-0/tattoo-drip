import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Discover's publication data (Discover D02, docs/discover/database-security.md).
 * Additive only: every existing studio stays off Discover, every artist and
 * photo keeps what it shows on the studio page.
 *
 * - `places`: platform reference data, like the style list (no tenant, no
 *   RLS): the cities a studio can say it is in, per country, with a slug
 *   for URLs. Seeded with curated Nepal cities; more are added by later
 *   migrations, never by tenants.
 * - `tenants`: the owner's opt-in (`discovery_listed`, false for everyone),
 *   when it was given with the listing terms (`discovery_listed_at`, which
 *   a listing requires), the platform's takedown (`discovery_suspended_at`
 *   and an internal note), and the studio's place (`place_id`, optional;
 *   the free-text `address` stays as it is).
 * - `artists.discovery_listed`: an artist's own opt-out (true by default:
 *   an artist follows the studio's listing).
 * - `artist_work_photos.discovery_suspended_at`: the platform's takedown of
 *   one photo from Discover; the studio page is unaffected.
 *
 * New columns with constant defaults: no table rewrite.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.createTable("places", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			// ISO 3166-1 alpha-2, upper case.
			table.specificType("country_code", "char(2)").notNullable();
			// The first-level subdivision (a province in Nepal), as people write it.
			table.string("region", 120).nullable();
			table.string("slug", 63).notNullable();
			table.string("name", 120).notNullable();
			table
				.timestamp("created_at", { useTz: true })
				.notNullable()
				.defaultTo(this.now());
			table.unique(["country_code", "slug"], {
				indexName: "places_country_slug_unique",
			});
		});
		this.schema.raw(
			"alter table places add constraint places_country_code_format check (country_code ~ '^[A-Z]{2}$')",
		);
		this.schema.raw(
			"alter table places add constraint places_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')",
		);
		this.schema.raw(
			"alter table places add constraint places_name_trimmed check (name = btrim(name) and name <> '')",
		);
		// Curated Nepal cities: the municipality names in common use, with their
		// provinces. Janakpur's municipality is officially Janakpurdham; people
		// and maps say Janakpur, which is what a client searches for.
		this.schema.raw(`insert into places (country_code, region, slug, name) values
			('NP', 'Bagmati Province', 'kathmandu', 'Kathmandu'),
			('NP', 'Bagmati Province', 'lalitpur', 'Lalitpur'),
			('NP', 'Bagmati Province', 'bhaktapur', 'Bhaktapur'),
			('NP', 'Gandaki Province', 'pokhara', 'Pokhara'),
			('NP', 'Bagmati Province', 'bharatpur', 'Bharatpur'),
			('NP', 'Koshi Province', 'biratnagar', 'Biratnagar'),
			('NP', 'Madhesh Province', 'birgunj', 'Birgunj'),
			('NP', 'Lumbini Province', 'butwal', 'Butwal'),
			('NP', 'Koshi Province', 'dharan', 'Dharan'),
			('NP', 'Bagmati Province', 'hetauda', 'Hetauda'),
			('NP', 'Madhesh Province', 'janakpur', 'Janakpur'),
			('NP', 'Lumbini Province', 'nepalgunj', 'Nepalgunj'),
			('NP', 'Koshi Province', 'itahari', 'Itahari'),
			('NP', 'Sudurpashchim Province', 'dhangadhi', 'Dhangadhi')`);

		this.schema.alterTable("tenants", (table) => {
			table.boolean("discovery_listed").notNullable().defaultTo(false);
			table.timestamp("discovery_listed_at", { useTz: true }).nullable();
			table.timestamp("discovery_suspended_at", { useTz: true }).nullable();
			table.string("discovery_suspension_note", 300).nullable();
			// A place in use is never deleted (RESTRICT): retire it with a migration.
			table
				.uuid("place_id")
				.nullable()
				.references("id")
				.inTable("places")
				.onDelete("RESTRICT");
		});
		// A listing is the owner's opt-in with the listing terms accepted, so it
		// always has the time they were; a note only comes with a takedown.
		this.schema.raw(
			"alter table tenants add constraint tenants_discovery_listed_at check (not discovery_listed or discovery_listed_at is not null)",
		);
		this.schema.raw(
			"alter table tenants add constraint tenants_discovery_suspension_note check (discovery_suspension_note is null or discovery_suspended_at is not null)",
		);

		this.schema.alterTable("artists", (table) => {
			table.boolean("discovery_listed").notNullable().defaultTo(true);
		});

		this.schema.alterTable("artist_work_photos", (table) => {
			table.timestamp("discovery_suspended_at", { useTz: true }).nullable();
		});
	}

	async down() {
		this.schema.alterTable("artist_work_photos", (table) => {
			table.dropColumn("discovery_suspended_at");
		});
		this.schema.alterTable("artists", (table) => {
			table.dropColumn("discovery_listed");
		});
		this.schema.raw(
			"alter table tenants drop constraint tenants_discovery_suspension_note",
		);
		this.schema.raw(
			"alter table tenants drop constraint tenants_discovery_listed_at",
		);
		this.schema.alterTable("tenants", (table) => {
			table.dropForeign(["place_id"]);
			table.dropColumns(
				"place_id",
				"discovery_suspension_note",
				"discovery_suspended_at",
				"discovery_listed_at",
				"discovery_listed",
			);
		});
		this.schema.dropTable("places");
	}
}
