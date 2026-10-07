import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type User from "#models/user";
import { LastOwnerError, SlugTakenError } from "#modules/tenancy/errors";
import Tenant, { type TenantType } from "#modules/tenancy/models/tenant";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";

export type NewTenant = {
	type: TenantType;
	name: string;
	slug: string;
	timezone: string;
};

/**
 * The way other modules read and change tenants and memberships.
 */
export default class TenancyService {
	/**
	 * Creates a tenant with `owner` as its first owner, in one transaction,
	 * so a tenant never exists without an owner.
	 */
	async createTenant(owner: User, input: NewTenant): Promise<Tenant> {
		try {
			return await db.transaction(async (trx) => {
				const tenant = await Tenant.create(input, { client: trx });
				await TenantMembership.create(
					{ tenantId: tenant.id, userId: owner.id, role: "owner" },
					{ client: trx },
				);
				return tenant;
			});
		} catch (error) {
			// Validation checks the slug first; this catches a signup that
			// took the same slug in between.
			if (isUniqueViolation(error, "tenants_slug_unique")) {
				throw new SlugTakenError(input.slug);
			}
			throw error;
		}
	}

	/**
	 * The user's tenants with their role in each, oldest membership first.
	 */
	async tenantsFor(
		user: User,
	): Promise<{ tenant: Tenant; role: MembershipRole }[]> {
		const memberships = await TenantMembership.query()
			.where("user_id", user.id)
			.preload("tenant")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc");

		return memberships.map((membership) => ({
			tenant: membership.tenant,
			role: membership.role,
		}));
	}

	/**
	 * Throws LastOwnerError if the membership `leavingId` stopping being an
	 * owner (removed, or demoted to artist) would leave the tenant with no
	 * owner. Call it inside the same transaction as that change: it locks
	 * the owner rows, so two owners removing each other at once can't both
	 * succeed.
	 */
	async assertKeepsAnOwner(
		trx: TransactionClientContract,
		tenantId: string,
		leavingId: string,
	): Promise<void> {
		const owners = await TenantMembership.query({ client: trx })
			.where("tenant_id", tenantId)
			.where("role", "owner")
			.forUpdate()
			.select("id");

		if (!owners.some((owner) => owner.id !== leavingId)) {
			throw new LastOwnerError(tenantId);
		}
	}
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "23505" &&
		"constraint" in error &&
		error.constraint === constraint
	);
}
