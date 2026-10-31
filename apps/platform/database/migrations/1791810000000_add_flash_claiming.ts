import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * One-of-a-kind flash and its claim (TAT-129, part 4b). `one_of_a_kind` is the
 * studio's opt-in per design (false by default: most flash can be tattooed
 * again). A one-of-a-kind design is claimed, once, by `claimed_at`:
 * `claimed_project_id` names the project whose first verified deposit or
 * booking claimed it, and is null for a claim by hand ("Mark claimed"). The
 * claim is released only by hand or by switching the design to "can be
 * tattooed again" (FlashService); nothing else clears it.
 *
 * Checks, so the database holds the rules even when the app's code is bypassed:
 * `flash_designs_claim_one_of_a_kind` (only a one-of-a-kind design is claimed)
 * and `flash_designs_claim_project_needs_time` (a claiming project comes with
 * its time). `flash_designs_claimed_project_fk` is the composite key to
 * `tattoo_projects (tenant_id, id)`, so a design can't be claimed by another
 * tenant's project; NO ACTION because the app never purges a project (a
 * project the design names is read for the label and the warnings).
 *
 * `tenants.storefront_claimed_flash` is the studio's choice for claimed
 * designs on its page: `show` (greyed, marked Claimed) or `hide`. As for the
 * other look columns, the database checks only the shape; which values exist
 * is the app's list (#modules/storefront/look, CLAIMED_FLASH_CHOICES).
 *
 * This sorts after part 4a's `1791800000000` and `1791800000001`.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("flash_designs", (table) => {
			table.boolean("one_of_a_kind").notNullable().defaultTo(false);
			table.timestamp("claimed_at", { useTz: true }).nullable();
			table.uuid("claimed_project_id").nullable();
			table.index(
				["tenant_id", "claimed_project_id"],
				"flash_designs_claimed_project_index",
			);
		});
		this.schema.raw(
			"alter table flash_designs add constraint flash_designs_claimed_project_fk foreign key (tenant_id, claimed_project_id) references tattoo_projects (tenant_id, id)",
		);
		this.schema.raw(
			"alter table flash_designs add constraint flash_designs_claim_one_of_a_kind check (claimed_at is null or one_of_a_kind)",
		);
		this.schema.raw(
			"alter table flash_designs add constraint flash_designs_claim_project_needs_time check (claimed_project_id is null or claimed_at is not null)",
		);

		this.schema.alterTable("tenants", (table) => {
			table
				.string("storefront_claimed_flash", 20)
				.notNullable()
				.defaultTo("show");
		});
		this.schema.raw(
			"alter table tenants add constraint tenants_storefront_claimed_flash_format check (storefront_claimed_flash ~ '^[a-z]{1,20}$')",
		);
	}

	async down() {
		this.schema.raw(
			"alter table tenants drop constraint tenants_storefront_claimed_flash_format",
		);
		this.schema.alterTable("tenants", (table) => {
			table.dropColumn("storefront_claimed_flash");
		});

		this.schema.raw(
			"alter table flash_designs drop constraint flash_designs_claim_project_needs_time",
		);
		this.schema.raw(
			"alter table flash_designs drop constraint flash_designs_claim_one_of_a_kind",
		);
		this.schema.raw(
			"alter table flash_designs drop constraint flash_designs_claimed_project_fk",
		);
		this.schema.alterTable("flash_designs", (table) => {
			table.dropIndex(
				["tenant_id", "claimed_project_id"],
				"flash_designs_claimed_project_index",
			);
			table.dropColumns("one_of_a_kind", "claimed_at", "claimed_project_id");
		});
	}
}
