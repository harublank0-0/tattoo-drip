import { usePage } from "@inertiajs/react";

/**
 * The current tenant (the shared `tenant` prop) on a /t/:tenant page.
 * Throws anywhere else, so a page can't build URLs without a tenant.
 */
export function useTenant() {
	const { tenant } = usePage().props;
	if (!tenant) {
		throw new Error("useTenant() only works on /t/:tenant pages");
	}
	return tenant;
}
