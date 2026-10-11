/**
 * Migration helpers for tenant-owned tables (every table with a tenant_id).
 * A new tenant-owned table's migration runs enableTenantRls() on it; a test
 * (tests/functional/rls/catalog_guard.spec.ts) fails for a table that does
 * not.
 *
 *   for (const sql of enableTenantRls("quotes")) this.schema.raw(sql);
 *
 * The policy reads the context the request or job transaction sets, see
 * app/services/db_context.ts. It has an explicit WITH CHECK so a row can
 * never be moved to another tenant.
 */
export function enableTenantRls(table: string): string[] {
	return [
		`alter table ${table} enable row level security`,
		// The target of other tables' composite foreign keys.
		`alter table ${table} add constraint ${table}_tenant_id_id_unique unique (tenant_id, id)`,
		`create policy tenant_isolation on ${table} for all using (tenant_id = (select app_tenant_id())) with check (tenant_id = (select app_tenant_id()))`,
	];
}

/**
 * The statements for a migration's down().
 */
export function disableTenantRls(table: string): string[] {
	return [
		`drop policy tenant_isolation on ${table}`,
		`alter table ${table} drop constraint ${table}_tenant_id_id_unique`,
		`alter table ${table} disable row level security`,
	];
}

type ForeignKeyBuilder = {
	references(columns: string[]): {
		inTable(table: string): { onDelete(action: string): unknown };
	};
};

/**
 * A reference from one tenant-owned table to another that includes
 * tenant_id, so the database rejects a link between tenants. The parent
 * needs enableTenantRls() first (its UNIQUE (tenant_id, id) is the target).
 *
 *   tenantReference(table, "client_id", "clients");
 */
export function tenantReference(
	table: { foreign(columns: string[]): ForeignKeyBuilder },
	column: string,
	parent: string,
	onDelete = "CASCADE",
) {
	table
		.foreign(["tenant_id", column])
		.references(["tenant_id", "id"])
		.inTable(parent)
		.onDelete(onDelete);
}
