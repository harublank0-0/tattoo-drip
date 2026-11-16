import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Archived artists (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * Archiving artists): an archived artist keeps their projects, sessions and
 * portfolio, doesn't count toward the package's active-artist limit and
 * gets no new work. `artists_archived_hidden` makes an archived artist
 * always hidden, so every public read, view and policy that checks
 * `visible` leaves them out unchanged. The partial index serves the count of
 * active artists (live and not archived; hidden ones count).
 */
export default class extends BaseSchema {
	protected tableName = "artists";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.timestamp("archived_at", { useTz: true }).nullable();
		});
		this.schema.raw(
			"alter table artists add constraint artists_archived_hidden check (archived_at is null or not visible)",
		);
		this.schema.raw(
			"create index artists_tenant_active_index on artists (tenant_id) where deleted_at is null and archived_at is null",
		);
	}

	async down() {
		this.schema.raw("drop index artists_tenant_active_index");
		this.schema.raw(
			"alter table artists drop constraint artists_archived_hidden",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("archived_at");
		});
	}
}
