import { compose } from "@adonisjs/core/helpers";
import { hasMany } from "@adonisjs/lucid/orm";
import type { HasMany } from "@adonisjs/lucid/types/relations";
import { TenantSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import TenantMembership from "#modules/tenancy/models/tenant_membership";

export const TENANT_TYPES = ["studio", "independent"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

/**
 * A business on the platform. Read and change tenants through
 * TenancyService, not from other modules directly.
 */
export default class Tenant extends compose(TenantSchema, withSoftDeletes) {
	declare type: TenantType;

	@hasMany(() => TenantMembership)
	declare memberships: HasMany<typeof TenantMembership>;
}
