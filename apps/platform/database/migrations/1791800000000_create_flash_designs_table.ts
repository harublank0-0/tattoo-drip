import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Flash designs (TAT-129): a picture, a name, a size and an optional price an
 * artist offers, listed newest first. Not soft-deleted: removing a design
 * deletes the row and its files, like a work photo.
 *
 * A design that an inquiry or a project names is never deleted. Both keys are
 * `NO ACTION` on purpose (`inquiries_flash_design_fk`,
 * `tattoo_projects_flash_design_fk`): an inquiry is a frozen record of what a
 * client asked for and a project is the work done, so the design they name
 * has to stay readable. FlashService.remove turns the violation into
 * FlashInUseError and the studio hides the design instead.
 *
 * `inquiries_guard_update` needs no change: it freezes every column it does
 * not name, so `flash_design_id` is frozen once submitted.
 *
 * `artists.accepting_flash` is the artist's "Taking flash requests" switch,
 * on for everyone until they switch it off. The limit of 100 designs per
 * artist is not the database's: FlashService counts under the artist's row
 * lock.
 */
export default class extends BaseSchema {
	protected tableName = "flash_designs";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("artist_id").notNullable();
			table.string("image_key", 255).notNullable();
			table.integer("width").notNullable();
			table.integer("height").notNullable();
			table.string("name", 80).notNullable();
			table.string("size", 60).notNullable();
			// Paisa; null when the studio keeps the price to itself.
			table.integer("price").nullable();
			table.string("currency", 3).notNullable().defaultTo("NPR");
			table.boolean("hidden").notNullable().defaultTo(false);
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			// A purged artist takes its design rows (soft deletes never reach here).
			// `artist_id` cascades while the inquiry and project keys below are NO
			// ACTION, so a hard purge of an artist whose design a request names would
			// fail on that key. Artists are only soft-deleted, so it can't happen today.
			tenantReference(table, "artist_id", "artists");
			// The studio-wide and per-artist lists, newest first.
			table.index(["tenant_id", "created_at", "id"], "flash_designs_newest");
			table.index(
				["tenant_id", "artist_id", "created_at", "id"],
				"flash_designs_artist_newest",
			);
		});
		this.schema.raw(
			"alter table flash_designs add constraint flash_designs_size_positive check (width > 0 and height > 0)",
		);
		this.schema.raw(
			"alter table flash_designs add constraint flash_designs_price_positive check (price is null or price > 0)",
		);
		// Adds the UNIQUE (tenant_id, id) the keys below point at.
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);

		this.schema.alterTable("artists", (table) => {
			table.boolean("accepting_flash").notNullable().defaultTo(true);
		});
		for (const name of ["inquiries", "tattoo_projects"]) {
			this.schema.alterTable(name, (table) => {
				table.uuid("flash_design_id").nullable();
				table.index(
					["tenant_id", "flash_design_id"],
					`${name}_flash_design_index`,
				);
			});
			this.schema.raw(
				`alter table ${name} add constraint ${name}_flash_design_fk foreign key (tenant_id, flash_design_id) references flash_designs (tenant_id, id)`,
			);
		}
	}

	async down() {
		for (const name of ["tattoo_projects", "inquiries"]) {
			this.schema.raw(
				`alter table ${name} drop constraint ${name}_flash_design_fk`,
			);
			this.schema.alterTable(name, (table) => {
				table.dropIndex(
					["tenant_id", "flash_design_id"],
					`${name}_flash_design_index`,
				);
				table.dropColumn("flash_design_id");
			});
		}
		this.schema.alterTable("artists", (table) => {
			table.dropColumn("accepting_flash");
		});
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
