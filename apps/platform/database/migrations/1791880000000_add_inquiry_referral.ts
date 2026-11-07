import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Verified referral attribution on an inquiry (Discover D03,
 * docs/discover/api.md, "Referral"): `referral_source` is `discover` when the
 * request carried a Discover referral token that verified for this studio,
 * with `referral_issued_at`, when Discover made the link. Both or neither.
 * Separate from `source_channel`, which is what the client said; nothing
 * about the person is stored.
 *
 * inquiries_guard_update freezes every column it does not name, so both are
 * set once, when the inquiry is created, and never change. Existing rows
 * stay null.
 */
export default class extends BaseSchema {
	protected tableName = "inquiries";

	async up() {
		this.schema.alterTable(this.tableName, (table) => {
			table.string("referral_source", 20).nullable();
			table.timestamp("referral_issued_at", { useTz: true }).nullable();
		});
		this.schema.raw(
			"alter table inquiries add constraint inquiries_referral_source check (referral_source in ('discover'))",
		);
		this.schema.raw(
			"alter table inquiries add constraint inquiries_referral_complete check ((referral_source is null) = (referral_issued_at is null))",
		);
	}

	async down() {
		this.schema.raw(
			"alter table inquiries drop constraint inquiries_referral_complete",
		);
		this.schema.raw(
			"alter table inquiries drop constraint inquiries_referral_source",
		);
		this.schema.alterTable(this.tableName, (table) => {
			table.dropColumns("referral_issued_at", "referral_source");
		});
	}
}
