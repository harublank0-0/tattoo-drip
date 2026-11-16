import Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext } from "#services/db_context";

/**
 * Every live studio's id from `package_tenants()` (ids only: the one read
 * across tenants an operator page may make), unordered.
 */
export async function liveStudioIds(): Promise<string[]> {
	const { rows } = await dbClient().rawQuery(
		"select tenant_id from public.package_tenants()",
	);
	return (rows as { tenant_id: string }[]).map((row) => row.tenant_id);
}

/**
 * Runs `read` for each live studio in its own tenant context, oldest first
 * (id breaks ties), so no query crosses tenants. A studio gone since the
 * list was read is skipped.
 */
export async function forEachLiveStudio<T>(
	read: (tenant: Tenant) => Promise<T>,
): Promise<{ tenant: Tenant; value: T }[]> {
	const found: { tenant: Tenant; value: T }[] = [];
	for (const tenantId of await liveStudioIds()) {
		await withDbContext({ tenantId }, async () => {
			const tenant = await Tenant.find(tenantId);
			if (!tenant) return;
			found.push({ tenant, value: await read(tenant) });
		});
	}
	return found.sort(
		(a, b) =>
			a.tenant.createdAt.toMillis() - b.tenant.createdAt.toMillis() ||
			a.tenant.id.localeCompare(b.tenant.id),
	);
}
