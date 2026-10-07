import { hasMany } from "@adonisjs/lucid/orm";
import type { HasMany } from "@adonisjs/lucid/types/relations";
import { TenantSchema } from "#database/schema";
import TenantMembership from "#modules/tenancy/models/tenant_membership";

export const TENANT_TYPES = ["studio", "independent"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

/**
 * A business on the platform. Read and change tenants through
 * TenancyService, not from other modules directly.
 */
export default class Tenant extends TenantSchema {
	declare type: TenantType;

	@hasMany(() => TenantMembership)
	declare memberships: HasMany<typeof TenantMembership>;
}
