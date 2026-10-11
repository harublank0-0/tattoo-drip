import TenantJob from "#services/tenant_job";

/**
 * Names of job classes that neither extend TenantJob nor appear in the
 * allowlist (name → why it may run without a tenant).
 */
export function jobsOutsideTenantScope(
	classes: { name: string; prototype: object }[],
	allowlist: Record<string, string>,
): string[] {
	return classes
		.filter(
			(JobClass) =>
				!(JobClass.prototype instanceof TenantJob) &&
				!(JobClass.name in allowlist),
		)
		.map(({ name }) => name);
}
