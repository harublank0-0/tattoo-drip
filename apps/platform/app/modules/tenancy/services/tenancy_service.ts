import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import {
	LastOwnerError,
	SlugLimitError,
	SlugTakenError,
} from "#modules/tenancy/errors";
import Tenant, { type TenantType } from "#modules/tenancy/models/tenant";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
import TenantSlug from "#modules/tenancy/models/tenant_slug";
import { MAX_TENANT_SLUGS } from "#modules/tenancy/slugs";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

/**
 * A slug is taken when it is another tenant's current slug or any slug a
 * tenant ever held (tenant_slugs, TAT-24).
 */
function isSlugTaken(error: unknown): boolean {
	return (
		isUniqueViolation(error, "tenants_slug_unique") ||
		isUniqueViolation(error, "tenant_slugs_slug_unique")
	);
}

export type NewTenant = {
	type: TenantType;
	name: string;
	slug: string;
	timezone: string;
};

/**
 * The studio's public profile. Slug and type are not part of it: the slug
 * changes through changeSlug, the type never.
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
	 * `artists` is only replaceable so a test can make the profile step
	 * fail; everything else uses the default.
	 */
	constructor(
		private artists: Pick<
			ArtistService,
			"createOwnerProfile"
		> = new ArtistService(new ImageService()),
	) {}

	/**
	 * Creates a tenant with `owner` as its first owner and, for an
	 * independent artist, their profile, in one transaction, so a tenant
	 * never exists without an owner.
	 */
	async createTenant(owner: User, input: NewTenant): Promise<Tenant> {
		try {
			// The id comes first so the inserts run in the new tenant's context:
			// row-level security only lets a tenant row in for its own id.
			const { rows } = await dbClient().rawQuery("select uuidv7() as id");
			const id: string = rows[0].id;
			return await withDbContext({ tenantId: id }, async (trx) => {
				const tenant = await Tenant.create({ id, ...input }, { client: trx });
				await TenantMembership.create(
					{ tenantId: tenant.id, userId: owner.id, role: "owner" },
					{ client: trx },
				);
				// An independent artist is the tenant's only artist, so their
				// profile comes with it, in the same transaction.
				if (input.type === "independent") {
					await this.artists.createOwnerProfile(tenant, owner);
				}
				return tenant;
			});
		} catch (error) {
			// The unique indexes are the only slug check; a taken slug (any
			// tenant's old slug, a deleted tenant's included) and a racing signup
			// both land here.
			if (isSlugTaken(error)) {
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
	 * Moves the tenant to `slug`, which has passed checkSlug (the validators
	 * check it). The database keeps every slug the tenant has held as its own
	 * (tenant_slugs), so old links keep resolving and no other tenant can
	 * take them; switching back to an old slug reserves nothing new. Throws
	 * SlugTakenError when another tenant holds the slug, now or before, and
	 * SlugLimitError when the tenant already holds MAX_TENANT_SLUGS and
	 * `slug` is not one of them. Call it in the tenant's context. Returns the
	 * stored tenant; the caller's copy is not updated.
	 */
	async changeSlug(tenant: Tenant, slug: string): Promise<Tenant> {
		try {
			return await withTransaction(async (trx) => {
				// The lock makes two renames of one tenant run one after the
				// other, so both can't pass the limit; the comparison uses the
				// stored slug, not the caller's copy.
				const live = await Tenant.query({ client: trx })
					.where("id", tenant.id)
					.forUpdate()
					.firstOrFail();
				if (live.slug === slug) return live;

				const held = await TenantSlug.query({ client: trx })
					.where("tenant_id", tenant.id)
					.select("slug");
				const ownOldSlug = held.some((row) => row.slug === slug);
				if (!ownOldSlug && held.length >= MAX_TENANT_SLUGS) {
					throw new SlugLimitError(tenant.id);
				}

				// The tenants_register_slug trigger registers a new slug.
				live.slug = slug;
				await live.save();
				return live;
			});
		} catch (error) {
			if (isSlugTaken(error)) throw new SlugTakenError(slug);
			throw error;
		}
	}

	/**
	 * The current slug of the user's live tenant that once had this exact
	 * slug (an old link), or null. Null also covers its current slug
	 * (nothing to redirect), an unknown slug, another tenant's old slug, a
	 * removed member and a deleted tenant, as in membershipFor.
	 */
	async currentSlugFor(user: User, slug: string): Promise<string | null> {
		const membership = await TenantMembership.query()
			.where("user_id", user.id)
			// The soft-delete hooks don't reach this subquery, so filter here.
			.whereHas("tenant", (tenant) =>
				tenant
					.whereNull("tenants.deleted_at")
					.whereHas("slugs", (slugs) => slugs.where("tenant_slugs.slug", slug)),
			)
			.preload("tenant")
			.first();

		const current = membership?.tenant.slug;
		return current && current !== slug ? current : null;
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
