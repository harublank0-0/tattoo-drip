import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

const TENANT = "(select app_tenant_id())";
const USER = "(select app_user_id())";

/**
 * Row-level security (TAT-28). The app role reads the context a request or
 * job transaction sets (app/services/db_context.ts); with no context every
 * comparison is NULL and no row comes back.
 *
 * RLS is ENABLEd, not FORCEd: the owner keeps bypassing it, so data
 * migrations behave the same everywhere. The boot guard makes sure the app
 * role is never the owner.
 */
export default class extends BaseSchema {
	async up() {
		const statements = [
			`create function app_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$`,
			`create function app_user_id() returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$`,

			...enableTenantRls("payment_methods"),

			// A membership is visible inside its tenant, and to its own user
			// (listing "my studios"). Writes need the tenant context.
			"alter table tenant_memberships enable row level security",
			"alter table tenant_memberships add constraint tenant_memberships_tenant_id_id_unique unique (tenant_id, id)",
			`create policy tenant_memberships_select on tenant_memberships for select using (tenant_id = ${TENANT} or user_id = ${USER})`,
			`create policy tenant_memberships_insert on tenant_memberships for insert with check (tenant_id = ${TENANT})`,
			`create policy tenant_memberships_update on tenant_memberships for update using (tenant_id = ${TENANT}) with check (tenant_id = ${TENANT})`,
			`create policy tenant_memberships_delete on tenant_memberships for delete using (tenant_id = ${TENANT})`,

			// A tenant is visible when it is the current one, or when the user
			// has a live membership in it (resolving a slug, listing studios).
			// No delete policy: tenants are soft-deleted. Any signed-in user
			// can create a tenant by setting its new id as context; onboarding
			// stays the gate.
			"alter table tenants enable row level security",
			`create policy tenants_select on tenants for select using (id = ${TENANT} or id in (select tenant_id from tenant_memberships where user_id = ${USER} and deleted_at is null))`,
			`create policy tenants_insert on tenants for insert with check (id = ${TENANT})`,
			`create policy tenants_update on tenants for update using (id = ${TENANT}) with check (id = ${TENANT})`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		const statements = [
			"drop policy tenants_update on tenants",
			"drop policy tenants_insert on tenants",
			"drop policy tenants_select on tenants",
			"alter table tenants disable row level security",

			"drop policy tenant_memberships_delete on tenant_memberships",
			"drop policy tenant_memberships_update on tenant_memberships",
			"drop policy tenant_memberships_insert on tenant_memberships",
			"drop policy tenant_memberships_select on tenant_memberships",
			"alter table tenant_memberships drop constraint tenant_memberships_tenant_id_id_unique",
			"alter table tenant_memberships disable row level security",

			...disableTenantRls("payment_methods"),

			"drop function app_user_id()",
			"drop function app_tenant_id()",
		];
		for (const statement of statements) this.schema.raw(statement);
	}
}
