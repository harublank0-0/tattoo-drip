import { compose } from "@adonisjs/core/helpers";
import { belongsTo } from "@adonisjs/lucid/orm";
import type { BelongsTo } from "@adonisjs/lucid/types/relations";
import { TenantMembershipSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import Tenant from "#modules/tenancy/models/tenant";

export const MEMBERSHIP_ROLES = ["owner", "artist"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * One role for one user in one tenant. Users have no tenant_id; their
 * access is the set of these rows.
 */
export default class TenantMembership extends compose(
	TenantMembershipSchema,
	withSoftDeletes,
) {
	declare role: MembershipRole;

	@belongsTo(() => Tenant)
	declare tenant: BelongsTo<typeof Tenant>;
}
