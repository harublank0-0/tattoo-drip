import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * Studio packages, phase 1 (docs/superpowers/specs/2026-11-15-studio-packages-design.md).
 *
 * - `allowance_bundles`: platform reference data (no tenant, like
 *   `billing_plans`), the allowances a package version gives: images per
 *   month, storage and its reserve (in megabytes), SMS per month. Null means
 *   not metered yet. Immutable (`allowance_bundles_guard`): a change is a new
 *   row (`<package>-v<n>`), so editing a default never reduces what a paid
 *   period or a pilot grant already uses. Seeded with `solo-v1` and
 *   `studio-v1`: 40 images a month (today's DESIGN_LAB_MONTHLY_LIMIT default)
 *   and nothing else metered, until prices and quantities are set.
 * - `billing_plans.package` / `allowance_bundle_id`: what a plan sells. Every
 *   existing plan is the Studio plan (`studio-monthly`, `studio-yearly`).
 * - `tenants.selected_package`: the package a workspace's trial runs on,
 *   chosen at signup. Null when none was chosen (workspaces from before,
 *   fixtures, a raw insert): the type's suggestion applies then (an
 *   independent artist Solo, a studio Studio), in EntitlementService.
 */
const GUARD = `
create or replace function allowance_bundles_guard() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
	raise exception 'allowance_bundles_guard: bundles are immutable';
end
$$`;

const PACKAGE_CHECK = "in ('solo', 'studio')";

export default class extends BaseSchema {
	async up() {
		this.schema.createTable("allowance_bundles", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table.string("key", 32).notNullable().unique();
			table.string("package", 16).notNullable();
			table.integer("images_per_month").nullable();
			table.integer("storage_megabytes").nullable();
			table.integer("storage_reserve_megabytes").nullable();
			table.integer("sms_per_month").nullable();
			table
				.timestamp("created_at", { useTz: true })
				.notNullable()
				.defaultTo(this.raw("now()"));
		});
		for (const statement of [
			`alter table allowance_bundles add constraint allowance_bundles_package check (package ${PACKAGE_CHECK})`,
			"alter table allowance_bundles add constraint allowance_bundles_quantities check ((images_per_month is null or images_per_month >= 0) and (storage_megabytes is null or storage_megabytes >= 0) and (storage_reserve_megabytes is null or storage_reserve_megabytes >= 0) and (sms_per_month is null or sms_per_month >= 0))",
			"insert into allowance_bundles (key, package, images_per_month) values ('solo-v1', 'solo', 40), ('studio-v1', 'studio', 40)",
			GUARD,
			"create trigger allowance_bundles_guard before update or delete on allowance_bundles for each row execute function allowance_bundles_guard()",
		]) {
			this.schema.raw(statement);
		}

		this.schema.alterTable("billing_plans", (table) => {
			table.string("package", 16).nullable();
			table
				.uuid("allowance_bundle_id")
				.nullable()
				.references("id")
				.inTable("allowance_bundles")
				.onDelete("RESTRICT");
			table.index(["allowance_bundle_id"]);
		});
		this.schema.alterTable("tenants", (table) => {
			table.string("selected_package", 16).nullable();
		});
		for (const statement of [
			"update billing_plans set package = 'studio', allowance_bundle_id = (select id from allowance_bundles where key = 'studio-v1')",
			"alter table billing_plans alter column package set not null, alter column allowance_bundle_id set not null",
			`alter table billing_plans add constraint billing_plans_package check (package ${PACKAGE_CHECK})`,
			`alter table tenants add constraint tenants_selected_package check (selected_package ${PACKAGE_CHECK})`,
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		this.schema.raw(
			"alter table tenants drop constraint tenants_selected_package, drop column selected_package",
		);
		this.schema.raw(
			"alter table billing_plans drop constraint billing_plans_package, drop column allowance_bundle_id, drop column package",
		);
		this.schema.raw(
			"drop trigger allowance_bundles_guard on allowance_bundles",
		);
		this.schema.raw("drop function allowance_bundles_guard()");
		this.schema.dropTable("allowance_bundles");
	}
}
