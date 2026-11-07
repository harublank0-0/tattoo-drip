import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Studio OS publication controls (Discover D04,
 * docs/discover/publication-controls.md). Additive and nullable: existing
 * rows are unchanged and no tenant becomes listed.
 *
 * - `tenants.discovery_consent_version`: which listing consent the owner
 *   accepted (`LISTING_CONSENT_VERSION`), with `discovery_listed_at` (D02) as
 *   when and `discovery_consented_by_user_id` as who. They describe the last
 *   acceptance and stay after the listing is turned off; turning it on again
 *   asks for the current version again.
 * - `artist_work_photos.discovery_suspension_note`: the operator's reason for
 *   one photo's takedown, like `tenants.discovery_suspension_note`. Internal:
 *   no view or dashboard page shows it.
 *
 * None of these columns is granted to `tattoo_drip_discovery` or selected by
 * a `discovery` view, so the public boundary is unchanged.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("tenants", (table) => {
			table.string("discovery_consent_version", 64).nullable();
			table
				.uuid("discovery_consented_by_user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL");
		});
		this.schema.raw(
			"alter table tenants add constraint tenants_discovery_consent_version check (discovery_consent_version is null or discovery_consent_version ~ '^[a-z0-9][a-z0-9.-]{0,63}$')",
		);

		this.schema.alterTable("artist_work_photos", (table) => {
			table.string("discovery_suspension_note", 500).nullable();
		});
		this.schema.raw(
			"alter table artist_work_photos add constraint artist_work_photos_discovery_suspension_note check (discovery_suspension_note is null or discovery_suspended_at is not null)",
		);
	}

	async down() {
		this.schema.raw(
			"alter table artist_work_photos drop constraint artist_work_photos_discovery_suspension_note",
		);
		this.schema.alterTable("artist_work_photos", (table) => {
			table.dropColumn("discovery_suspension_note");
		});
		this.schema.raw(
			"alter table tenants drop constraint tenants_discovery_consent_version",
		);
		this.schema.alterTable("tenants", (table) => {
			table.dropColumns(
				"discovery_consented_by_user_id",
				"discovery_consent_version",
			);
		});
	}
}
