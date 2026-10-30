import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import {
	type ClaimedFlash,
	type FontKey,
	type SectionKey,
	sectionList,
	type ThemeKey,
} from "#modules/storefront/look";
import {
	LastOwnerError,
	MembershipNotLiveError,
	SlugLimitError,
	SlugTakenError,
} from "#modules/tenancy/errors";
import Tenant, { type TenantType } from "#modules/tenancy/models/tenant";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
import TenantSlug from "#modules/tenancy/models/tenant_slug";
import { MAX_TENANT_SLUGS } from "#modules/tenancy/slugs";
import {
	afterCommit,
	afterRollback,
	dbClient,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

/**
 * The studio's two public images and the tenant columns each is kept in
 * (TAT-116 cover, TAT-56 logo): the purpose picks the disk and the copies,
 * and the three columns hold the key and the size, all set or all null.
 */
const BRAND_IMAGES = {
	cover: {
		purpose: "studio_cover",
		key: "coverImageKey",
		width: "coverImageWidth",
		height: "coverImageHeight",
	},
	logo: {
		purpose: "studio_logo",
		key: "logoImageKey",
		width: "logoImageWidth",
		height: "logoImageHeight",
	},
} as const;
type BrandImage = (typeof BRAND_IMAGES)[keyof typeof BRAND_IMAGES];

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
 * What an owner sets in Settings, Page look (TAT-56): already checked by the
 * validator (keys on today's lists, lowercase "#rrggbb" colours that read on
 * their paper). `accent` and `accentDark` null mean the theme's own violet.
 */
export type PageLookInput = {
	theme: ThemeKey;
	accent: string | null;
	accentDark: string | null;
	font: FontKey;
	/** What the page does with flash designs somebody has claimed (TAT-129). */
	claimedFlash: ClaimedFlash;
	/** The sections to show, in order; stored through `sectionList`, so the form is always there. */
	sections: SectionKey[];
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
 * The short answers a studio's page gives clients before they come (TAT-128).
 * Plain text; null is not set. The deposit policy is the one in
 * DepositSettings.
 */
export type GoodToKnowTexts = {
	walkInsText: string | null;
	ageRuleText: string | null;
	beforeSessionText: string | null;
	aftercareText: string | null;
};

/** A live member and their account's address: who an alert can reach (TAT-52). */
export type TenantMember = {
	/** The membership row's id (Settings, Members routes by it, TAT-33). */
	membershipId: string;
	userId: string;
	role: MembershipRole;
	email: string;
	fullName: string | null;
};

/**
 * The way other modules read and change tenants and memberships.
 */
export default class TenancyService {
	/**
	 * `artists` is only replaceable so a test can make the profile step
	 * fail, and `images` so a test can see what the cover stores; everything
	 * else uses the defaults.
	 */
	constructor(
		private artists: Pick<
			ArtistService,
			"createOwnerProfile"
		> = new ArtistService(new ImageService()),
		private images: Pick<
			ImageService,
			"store" | "delete" | "deleteOrThrow"
		> = new ImageService(),
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
	 * Saves the studio's page look (TAT-56, owners only: the route says so).
	 * The row is read under its lock first, so a studio that is not in this
	 * context is not found (E_ROW_NOT_FOUND) instead of silently updated to
	 * nothing; only the six look columns are written (Lucid saves the dirty
	 * ones), so a logo or cover saved at the same moment is not overwritten.
	 */
	async updateLook(
		tenant: Pick<Tenant, "id">,
		input: PageLookInput,
	): Promise<Tenant> {
		return withTransaction(async (trx) => {
			const live = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.forUpdate()
				.firstOrFail();
			live.merge({
				storefrontTheme: input.theme,
				brandAccent: input.accent,
				brandAccentDark: input.accentDark,
				brandFont: input.font,
				storefrontClaimedFlash: input.claimedFlash,
				storefrontSections: sectionList(input.sections).join(","),
			});
			await live.save();
			return live;
		});
	}

	/**
	 * Sets or replaces the studio's cover photo (TAT-116, owners only: the
	 * route says so). The file is stored inside the transaction with its
	 * cleanup registered at once, before the tenant row is locked; the key and
	 * size go in the three cover columns, and the replaced cover and its copies
	 * are deleted once the outermost transaction commits. Throws
	 * InvalidImageError for a file we can't accept. Call it in the tenant's
	 * context: another tenant's row is not found (E_ROW_NOT_FOUND).
	 */
	async setCover(
		tenant: Pick<Tenant, "id">,
		upload: Pick<MultipartFile, "tmpPath">,
	): Promise<Tenant> {
		return this.setImage(tenant, upload, BRAND_IMAGES.cover);
	}

	/**
	 * Removes the studio's cover photo, files first (TAT-116): under the
	 * tenant row's lock the cover's files and every copy are deleted, and only
	 * then the columns are cleared. If any file cannot be deleted this throws
	 * ImageDeleteError and the cover stays, so the owner can try again (a
	 * missing file counts as deleted). Nothing to remove is not an error.
	 */
	async removeCover(tenant: Pick<Tenant, "id">): Promise<void> {
		await this.removeImage(tenant, BRAND_IMAGES.cover);
	}

	/**
	 * Sets or replaces the studio's logo (TAT-56, owners only): the cover's
	 * rules, with the studio_logo purpose and the three logo columns. A PNG
	 * keeps its see-through background, in its copies too.
	 */
	async setLogo(
		tenant: Pick<Tenant, "id">,
		upload: Pick<MultipartFile, "tmpPath">,
	): Promise<Tenant> {
		return this.setImage(tenant, upload, BRAND_IMAGES.logo);
	}

	/** Removes the studio's logo, files first: the cover's rules (removeCover). */
	async removeLogo(tenant: Pick<Tenant, "id">): Promise<void> {
		await this.removeImage(tenant, BRAND_IMAGES.logo);
	}

	/**
	 * Order matters (TAT-116): store before the lock, register the cleanup at
	 * once with no await in between (afterRollback), lock, swap the columns,
	 * and delete the old files only after the outermost commit (afterCommit).
	 */
	private async setImage(
		tenant: Pick<Tenant, "id">,
		upload: Pick<MultipartFile, "tmpPath">,
		slot: BrandImage,
	): Promise<Tenant> {
		return withTransaction(async (trx) => {
			const stored = await this.images.store(upload, {
				tenant,
				purpose: slot.purpose,
			});
			afterRollback(() => this.images.delete(slot.purpose, stored.key));
			const live = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.forUpdate()
				.firstOrFail();
			const previous = live[slot.key];
			live[slot.key] = stored.key;
			live[slot.width] = stored.width;
			live[slot.height] = stored.height;
			await live.save();
			if (previous) {
				afterCommit(() => this.images.delete(slot.purpose, previous));
			}
			return live;
		});
	}

	/** Files first, under the row's lock; the columns are cleared only when every file is gone. */
	private async removeImage(
		tenant: Pick<Tenant, "id">,
		slot: BrandImage,
	): Promise<void> {
		await withTransaction(async (trx) => {
			const live = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.forUpdate()
				.firstOrFail();
			const previous = live[slot.key];
			if (!previous) return;
			await this.images.deleteOrThrow(slot.purpose, previous);
			live[slot.key] = null;
			live[slot.width] = null;
			live[slot.height] = null;
			await live.save();
		});
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
	 * Saves the four Good to know texts (TAT-128); the rest of the profile is
	 * left alone.
	 */
	async updateGoodToKnow(
		tenant: Tenant,
		input: GoodToKnowTexts,
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
	 * The id of the live tenant whose current or old slug is exactly `slug`,
	 * or null, for the public API (TAT-32). An unauthenticated request has
	 * no context in which RLS would show a tenant, so this asks the
	 * tenant_for_slug() SECURITY DEFINER function, which answers this one
	 * question and nothing else. Read the tenant itself in its own context.
	 */
	async tenantIdForSlug(slug: string): Promise<string | null> {
		const { rows } = await dbClient().rawQuery(
			"select public.tenant_for_slug(?) as id",
			[slug],
		);
		return rows[0]?.id ?? null;
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

	/** The live tenant with this id, or null: what a job, which carries only the id, reads (TAT-52). */
	async find(tenantId: string): Promise<Tenant | null> {
		return Tenant.query().where("id", tenantId).first();
	}

	/**
	 * The tenant's live members with their account's email and name, oldest
	 * membership first: the people a staff alert can reach (TAT-52).
	 */
	async members(tenant: { id: string }): Promise<TenantMember[]> {
		const memberships = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.orderBy("created_at", "asc")
			.orderBy("id", "asc");
		if (memberships.length === 0) return [];
		const users = await User.query().whereIn(
			"id",
			memberships.map(({ userId }) => userId),
		);
		const byId = new Map(users.map((user) => [user.id, user]));
		return memberships.flatMap((membership) => {
			const user = byId.get(membership.userId);
			return user
				? [
						{
							membershipId: membership.id,
							userId: user.id,
							role: membership.role,
							email: user.email,
							fullName: user.fullName,
						},
					]
				: [];
		});
	}

	/**
	 * Throws LastOwnerError if the membership `leavingId` stopping being an
	 * owner (removed, or demoted to artist) would leave the tenant with no
	 * owner. Call it inside the same transaction as that change: it locks
	 * the owner rows, so two owners removing each other at once can't both
	 * succeed.
	 *
	 * Throws MembershipNotLiveError if `leavingId` isn't a live membership of
	 * the tenant: a caller bug unless the member was removed meanwhile, and
	 * passing it would let the real last owner be removed.
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
		if (!leaving) throw new MembershipNotLiveError(leavingId, tenantId);

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
