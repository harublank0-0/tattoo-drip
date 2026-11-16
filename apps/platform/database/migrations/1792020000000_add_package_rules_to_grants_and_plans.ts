import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The package rules the services kept alone until now (studio packages,
 * phase 1 review): at most one pilot grant runs at a time for a studio
 * (`pilot_grants_one_running`, half-open ranges, so one ending as the next
 * begins is fine), and a plan or a grant names a bundle of its own package
 * (`*_bundle_package`, a foreign key on the bundle's id and package).
 * btree_gist is already installed (project sessions' overlap rule).
 */
export default class extends BaseSchema {
	async up() {
		for (const statement of [
			"alter table allowance_bundles add constraint allowance_bundles_id_package unique (id, package)",
			"alter table billing_plans add constraint billing_plans_bundle_package foreign key (allowance_bundle_id, package) references allowance_bundles (id, package)",
			"alter table pilot_grants add constraint pilot_grants_bundle_package foreign key (allowance_bundle_id, package) references allowance_bundles (id, package)",
			"alter table pilot_grants add constraint pilot_grants_one_running exclude using gist (tenant_id with =, tstzrange(starts_at, ends_at) with &&)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const statement of [
			"alter table pilot_grants drop constraint pilot_grants_one_running",
			"alter table pilot_grants drop constraint pilot_grants_bundle_package",
			"alter table billing_plans drop constraint billing_plans_bundle_package",
			"alter table allowance_bundles drop constraint allowance_bundles_id_package",
		]) {
			this.schema.raw(statement);
		}
	}
}
