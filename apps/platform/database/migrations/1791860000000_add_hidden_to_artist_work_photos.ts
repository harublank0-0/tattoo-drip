import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * A work photo can be unpublished (Studio OS, Prompt 5): `hidden` keeps it
 * in the dashboard and off every public read (the gallery, one photo's page,
 * the artists' newest photos and the gallery's filters), like a flash
 * design's `hidden`. Every existing photo stays published. A photo is on the
 * studio page while it is not hidden and its artist is visible and live.
 * The table already has RLS; no index: the public reads stay on the
 * existing `(tenant_id, [artist_id,] created_at, id)` indexes and filter the
 * few hidden rows there.
 *
 * This sorts after `1791850000000`.
 */
export default class extends BaseSchema {
	protected tableName = "artist_work_photos";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.boolean("hidden").notNullable().defaultTo(false);
		});
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("hidden");
		});
	}
}
