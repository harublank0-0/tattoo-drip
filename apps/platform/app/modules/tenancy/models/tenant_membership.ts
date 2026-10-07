import { belongsTo } from "@adonisjs/lucid/orm";
import type { BelongsTo } from "@adonisjs/lucid/types/relations";
import { TenantMembershipSchema } from "#database/schema";
import Tenant from "#modules/tenancy/models/tenant";

export const MEMBERSHIP_ROLES = ["owner", "artist"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * One role for one user in one tenant. Users have no tenant_id; their
 * access is the set of these rows.
 */
export default class TenantMembership extends TenantMembershipSchema {
	declare role: MembershipRole;

	@belongsTo(() => Tenant)
	declare tenant: BelongsTo<typeof Tenant>;
}
