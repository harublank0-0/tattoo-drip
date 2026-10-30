import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * A project's claim moment has happened (TAT-129, part 4b review fix).
 * `flash_claimed_once_at` is set, under the project's lock, at the first
 * qualifying event of a project that names a flash design (its first
 * verified deposit or its becoming booked, whichever comes first), whether
 * or not that event claimed the design. Only a project where it is null
 * attempts a claim, so a later deposit (the rest of a split deposit) or the
 * booking after the first deposit never takes back a design the studio made
 * available meanwhile. Null for a project that has not reached the moment
 * (and for every project without a design: they never set it).
 *
 * Nothing to backfill: the claim itself arrives with `1791810000000`, and no
 * released design exists before this one. The table already has RLS.
 *
 * This sorts after `1791820000000` (TAT-123).
 */
export default class extends BaseSchema {
	protected tableName = "tattoo_projects";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.timestamp("flash_claimed_once_at", { useTz: true }).nullable();
		});
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("flash_claimed_once_at");
		});
	}
}
