import { TenantInvitationSchema } from "#database/schema";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * An invitation to join a studio (TAT-33): bound to one canonical email
 * address, with the role the member gets and an optional artist profile to
 * claim. Only the token's SHA-256 is stored. Not soft-deleted: a
 * credential, deleted when accepted or cancelled. Made and used through
 * InvitationService.
 */
export default class TenantInvitation extends TenantInvitationSchema {
	declare role: MembershipRole;
}
