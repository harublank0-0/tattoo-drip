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
 * The studio's public profile. Slug and type are not part of it: the slug
 * changes with aliases (TAT-24), the type never.
 */
export type TenantProfile = {
	name: string;
	timezone: string;
	intro: string | null;
	contactPhone: string | null;
	contactEmail: string | null;
	address: string | null;
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	websiteUrl: string | null;
};

/**
 * Defaults for the deposit page (TAT-65). A null percentage means the
 * artist sets the deposit on each quote.
 */
export type DepositSettings = {
	defaultDepositPercent: number | null;
	depositPolicy: string | null;
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
	 * Saves the studio's public profile. Null clears a field.
	 */
	async updateProfile(tenant: Tenant, input: TenantProfile): Promise<Tenant> {
		tenant.merge(input);
		await tenant.save();
		return tenant;
	}

	/**
	 * Saves the deposit defaults shown on the deposit page.
	 */
	async updateDepositSettings(
		tenant: Tenant,
		input: DepositSettings,
	): Promise<Tenant> {
		tenant.merge(input);
		await tenant.save();
		return tenant;
	}

	/**
	 * The user's live tenants with their role in each, oldest membership
	 * first. Deleted memberships and deleted tenants are left out.
	 */
	async tenantsFor(
		user: User,
	): Promise<{ tenant: Tenant; role: MembershipRole }[]> {
		const memberships = await TenantMembership.query()
			.where("user_id", user.id)
			// The soft-delete hooks don't reach this subquery, so filter here.
			.whereHas("tenant", (tenant) => tenant.whereNull("tenants.deleted_at"))
			.preload("tenant")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc");

		return memberships.map((membership) => ({
			tenant: membership.tenant,
			role: membership.role,
		}));
	}

	/**
	 * The user's live membership in the live tenant with this exact slug,
	 * with that tenant, or null. Null covers every reason not to let them
	 * in (unknown slug, deleted tenant, not a member, removed member) so
	 * callers can't tell the cases apart and neither can the client.
	 */
	async membershipFor(
		user: User,
		slug: string,
	): Promise<{ tenant: Tenant; membership: TenantMembership } | null> {
		const membership = await TenantMembership.query()
			.where("user_id", user.id)
			// The soft-delete hooks don't reach this subquery, so filter here.
			.whereHas("tenant", (tenant) =>
				tenant.where("tenants.slug", slug).whereNull("tenants.deleted_at"),
			)
			.preload("tenant")
			.first();

		return membership ? { tenant: membership.tenant, membership } : null;
	}

	/**
	 * Whether the user belongs to at least one live tenant. One cheap query;
	 * use it instead of tenantsFor when only the yes/no matters.
	 */
	async hasTenant(user: User): Promise<boolean> {
		const membership = await TenantMembership.query()
			.where("user_id", user.id)
			// The soft-delete hooks don't reach this subquery, so filter here.
			.whereHas("tenant", (tenant) => tenant.whereNull("tenants.deleted_at"))
			.select("id")
			.first();

		return membership !== null;
	}

	/**
	 * Throws LastOwnerError if the membership `leavingId` stopping being an
	 * owner (removed, or demoted to artist) would leave the tenant with no
	 * owner. Call it inside the same transaction as that change: it locks
	 * the owner rows, so two owners removing each other at once can't both
	 * succeed.
	 *
	 * Throws a plain Error if `leavingId` isn't a live membership of the
	 * tenant: that's a caller bug, and passing it would let the real last
	 * owner be removed.
	 */
	async assertKeepsAnOwner(
		trx: TransactionClientContract,
		tenantId: string,
		leavingId: string,
	): Promise<void> {
		const leaving = await TenantMembership.query({ client: trx })
			.where("id", leavingId)
			.where("tenant_id", tenantId)
			.first();
		if (!leaving) {
			throw new Error(
				`Membership ${leavingId} is not a live membership of tenant ${tenantId}`,
			);
		}

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
