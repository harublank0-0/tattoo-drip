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
 * The backfill marks the projects that reached the moment before the column
 * existed, or the next event of one of them would claim again a design the
 * studio has since made available. Evidence, in the columns the schema has
 * (nothing records when a project was booked): a design names the project as
 * its claimer (the claim's own time); a verified deposit (the earliest
 * `verified_at`); or the project is booked or past it (now: the time is not
 * kept). A project that was booked and then cancelled without a verified
 * deposit (a quote with no deposit, withdrawn) leaves no trace to find, and
 * stays unmarked. Two set-based statements, inside the migration's
 * transaction. The table already has RLS, and migrations run as its owner.
 *
 * This sorts after `1791820000000` (TAT-123).
 */
export const BACKFILL = [
	`update tattoo_projects project
	set flash_claimed_once_at = coalesce(design.claimed_at, now())
	from flash_designs design
	where design.tenant_id = project.tenant_id and design.claimed_project_id = project.id`,
	`update tattoo_projects project
	set flash_claimed_once_at = coalesce(
		(select min(payment.verified_at) from payments payment
			where payment.tenant_id = project.tenant_id and payment.project_id = project.id
			and payment.kind = 'deposit' and payment.status = 'verified'),
		now()
	)
	where project.flash_design_id is not null and project.flash_claimed_once_at is null
	and (
		project.status in ('booked', 'in_progress', 'completed', 'healing_check')
		or exists (select 1 from payments payment
			where payment.tenant_id = project.tenant_id and payment.project_id = project.id
			and payment.kind = 'deposit' and payment.status = 'verified')
	)`,
];

export default class extends BaseSchema {
	protected tableName = "tattoo_projects";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.timestamp("flash_claimed_once_at", { useTz: true }).nullable();
		});
		for (const statement of BACKFILL) this.schema.raw(statement);
	}

	async down() {
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumn("flash_claimed_once_at");
		});
	}
}
