import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import type { StyleSlug } from "#modules/artists/styles";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";
import {
	afterCommit,
	afterRollback,
	withTransaction,
} from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

/**
 * The signed-in user making the change. Routes check that they are a member
 * of the tenant; the only user a profile is ever linked to is this one.
 */
export type Member = { id: string };

export type ArtistInput = {
	name: string;
	slug: string;
	bio: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	/** The "Taking flash requests" switch (TAT-129); on for everyone by default. */
	acceptingFlash: boolean;
	closedMessage: string | null;
	/** Up to MAX_ARTIST_STYLES slugs from the list, in the order given. */
	styles: StyleSlug[];
	/** https links; the form checks them, the service stores them as given. */
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	/**
	 * Link the profile to the acting member. Unchecking it unlinks the member
	 * from their own profile; a profile linked to someone else is never
	 * changed by it.
	 */
	linkToMe: boolean;
	/** A new photo; it replaces the stored one. */
	photo?: Upload;
	/** Drop the stored photo (ignored when `photo` is given). */
	removePhoto?: boolean;
};

/** Who is editing a profile: their user and their role in the tenant (TAT-30). */
export type ProfileEditor = Pick<TenantMembership, "userId" | "role">;

/**
 * What an artist may change on their own profile (TAT-30): everything but
 * the link to a login.
 */
export type OwnProfileInput = Omit<ArtistInput, "linkToMe">;

const PHOTO = "artist_photo";
const SLUG_INDEX = "artists_tenant_slug_live_unique";
const USER_INDEX = "artists_tenant_user_live_unique";

/**
 * The way to read and change a tenant's artist profiles. Every call is
 * scoped to the tenant. Photos are stored through ImageService and cleaned
 * up here, after the real commit or rollback.
 */
@inject()
export default class ArtistService {
	constructor(private images: ImageService) {}

	/**
	 * The tenant's live profiles, by name, ignoring case.
	 */
	async list(tenant: TenantRef): Promise<Artist[]> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.orderByRaw("lower(name) asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's live, visible profiles, by name, ignoring case: the
	 * artists a studio page shows and an inquiry may name (TAT-51), open or
	 * closed for inquiries.
	 */
	async listVisible(tenant: TenantRef): Promise<Artist[]> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("visible", true)
			.orderByRaw("lower(name) asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's live, visible profile with exactly this slug (the public
	 * artist page, TAT-44), or null: a hidden, deleted, unknown or other
	 * tenant's slug all give null. Never case-folded.
	 */
	async findVisibleBySlug(
		tenant: TenantRef,
		slug: string,
	): Promise<Artist | null> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("visible", true)
			.where("slug", slug)
			.first();
	}

	/**
	 * The tenant's live profile with this id. An unknown id, a deleted
	 * profile and another tenant's profile all throw E_ROW_NOT_FOUND (a 404),
	 * so callers can't tell them apart.
	 */
	async findFor(tenant: TenantRef, id: string): Promise<Artist> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * The tenant's live profile linked to `userId`, or null (TAT-30): the
	 * member's own profile.
	 */
	async profileOf(tenant: TenantRef, userId: string): Promise<Artist | null> {
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.first();
	}

	/**
	 * The live profile `editor` may edit (TAT-30): any of the tenant's for an
	 * owner (findFor), only the one linked to them for anyone else. Anything
	 * else throws E_ROW_NOT_FOUND (a 404), the same as another tenant's
	 * profile.
	 */
	async findEditable(
		tenant: TenantRef,
		editor: ProfileEditor,
		id: string,
	): Promise<Artist> {
		if (editor.role === "owner") return this.findFor(tenant, id);
		return Artist.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.where("user_id", editor.userId)
			.firstOrFail();
	}

	/**
	 * Locks the artist's live row (`FOR UPDATE`, the lock `save` takes too, so
	 * an upload and a profile save never interleave) and checks `editor` may
	 * still change it: a profile deleted since the page loaded, or unlinked
	 * from an artist member, is a 404 (E_ROW_NOT_FOUND). Call it inside a
	 * transaction; the work photos and the flash designs share it (TAT-129).
	 */
	async lockEditable(
		trx: QueryClientContract,
		tenant: TenantRef,
		editor: ProfileEditor,
		artistId: string,
	): Promise<Artist> {
		const live = await Artist.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", artistId)
			.forUpdate()
			.firstOrFail();
		if (!mayEdit(editor, live.userId)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
		}
		return live;
	}

	/**
	 * Holds the live, visible profile `artistId` until the transaction ends
	 * (`FOR KEY SHARE`: the lock a row naming the artist takes through its
	 * foreign key anyway, taken here early), or null when it is not one. A
	 * request that names one of the artist's flash designs takes it before the
	 * design's own lock (FlashService.holdShown): the owner removing a design
	 * takes the artist's `FOR UPDATE` (`lockEditable`) and then the design's,
	 * so both go artist first and neither can wait for the other. Call it
	 * inside a transaction.
	 */
	async holdVisible(
		trx: QueryClientContract,
		tenant: TenantRef,
		artistId: string,
	): Promise<Artist | null> {
		const query = Artist.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", artistId)
			.where("visible", true);
		query.knexQuery.forKeyShare();
		return query.first();
	}

	/**
	 * Adds a profile. Throws ArtistSlugTakenError or ArtistProfileExistsError
	 * (after rolling back its own savepoint, so the request stays usable) and
	 * InvalidImageError for a photo we can't accept.
	 */
	async create(
		tenant: TenantRef,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		try {
			return await withTransaction(async (trx) => {
				const photo = await this.storePhoto(tenant, input.photo);
				return Artist.create(
					{
						tenantId: tenant.id,
						...profileFields(input),
						userId: input.linkToMe ? member.id : null,
						...photoColumns(photo),
					},
					{ client: trx },
				);
			});
		} catch (error) {
			rethrowConflict(error, input.slug);
		}
	}

	/**
	 * Saves an owner's edit. A new `photo` replaces the stored one and
	 * `removePhoto` drops it; the old file is deleted once the outermost
	 * transaction commits.
	 */
	async update(
		tenant: TenantRef,
		artist: Artist,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
		return this.save(tenant, artist.id, input, (live) =>
			nextUserId(live.userId, input.linkToMe, member),
		);
	}

	/**
	 * An artist's edit of their own profile (TAT-30): the profile fields and
	 * the photo, never the link to a login. Under the row lock the profile
	 * must still be live and linked to `userId` (an owner may have deleted it
	 * since the form loaded, or TAT-33 unlinked a removed member):
	 * E_ROW_NOT_FOUND otherwise.
	 */
	async updateOwn(
		tenant: TenantRef,
		userId: string,
		artist: Artist,
		input: OwnProfileInput,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
		return this.save(tenant, artist.id, input, (live) => {
			if (live.userId !== userId) {
				throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
			}
			return live.userId;
		});
	}

	/**
	 * Links the live, unlinked profile `artistId` to `userId`: the claim an
	 * owner offered in an invitation (TAT-33). The only path that links a
	 * profile to anyone but the acting member, so it checks under the row
	 * lock: false, with nothing changed, when the profile is gone, was linked
	 * to someone meanwhile, or the account already has a live profile here.
	 */
	async claim(
		tenant: TenantRef,
		artistId: string,
		userId: string,
	): Promise<boolean> {
		return withTransaction(async (trx) => {
			if (await this.profileOf(tenant, userId)) return false;
			const live = await Artist.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", artistId)
				.forUpdate()
				.first();
			if (!live || live.userId !== null) return false;
			live.userId = userId;
			await live.save();
			return true;
		});
	}

	/**
	 * Unlinks every profile of the tenant linked to `userId`, deleted ones
	 * included (TAT-33: a removed member's profile stays with the studio,
	 * unlinked, with its projects and sessions). Update queries skip the
	 * soft-delete hooks, so deleted rows are reached too.
	 */
	async unlinkUser(tenant: TenantRef, userId: string): Promise<void> {
		await Artist.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.update({ user_id: null, updated_at: new Date() });
	}

	/**
	 * The body of update and updateOwn: stores a new photo, locks the live
	 * row (a profile deleted since the form loaded is a 404), saves the
	 * fields, the photo and the link `linkFor` decides from the locked row,
	 * and deletes a replaced photo once the outermost transaction commits.
	 */
	private async save(
		tenant: TenantRef,
		id: string,
		input: OwnProfileInput,
		linkFor: (live: Artist) => string | null,
	): Promise<Artist> {
		try {
			return await withTransaction(async (trx) => {
				// Stored inside the transaction: nothing is stored if it cannot
				// open, and the cleanup is registered right after the store
				// resolves. It comes before the row lock below, so the lock is
				// not held while the image is processed.
				const photo = await this.storePhoto(tenant, input.photo);
				// Lock the live row: a delete that landed since the form loaded
				// makes this a 404, and the photo and link are read from the row,
				// not from the form's copy.
				const live = await Artist.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("id", id)
					.forUpdate()
					.firstOrFail();
				const previous = live.photoKey;
				const keepsPhoto = !photo && !input.removePhoto;
				live.merge({
					...profileFields(input),
					userId: linkFor(live),
					...(keepsPhoto ? {} : photoColumns(photo)),
				});
				await live.save();
				// The replaced file goes only once the change is committed for good.
				if (previous && previous !== live.photoKey) {
					afterCommit(() => this.images.delete(PHOTO, previous));
				}
				return live;
			});
		} catch (error) {
			rethrowConflict(error, input.slug);
		}
	}

	/**
	 * Soft-deletes the profile. Its photo stays, like every soft-deleted
	 * record's files.
	 */
	async delete(tenant: TenantRef, artist: Artist): Promise<void> {
		assertOwnedBy(tenant, artist);
		await artist.softDelete();
	}

	/**
	 * The profile an independent artist gets with their tenant: named after
	 * the tenant, same slug, linked to the owner. Call it inside the
	 * transaction that creates the tenant.
	 */
	async createOwnerProfile(
		tenant: Pick<Tenant, "id" | "name" | "slug">,
		owner: Member,
	): Promise<Artist> {
		return Artist.create({
			tenantId: tenant.id,
			name: tenant.name,
			slug: tenant.slug,
			bio: null,
			visible: true,
			acceptingInquiries: true,
			acceptingFlash: true,
			closedMessage: null,
			styles: [],
			instagramUrl: null,
			facebookUrl: null,
			tiktokUrl: null,
			userId: owner.id,
		});
	}

	/**
	 * Stores an upload and registers its cleanup in the same step: no await
	 * sits between the store resolving and the registration, so no failure
	 * can fall between them. If the level rolls back, or the request fails
	 * later, no row will point at the file.
	 */
	private async storePhoto(tenant: TenantRef, upload?: Upload) {
		if (!upload) return null;
		const stored = await this.images.store(upload, {
			tenant,
			purpose: PHOTO,
		});
		afterRollback(() => this.images.delete(PHOTO, stored.key));
		return stored;
	}
}

function profileFields(input: OwnProfileInput) {
	return {
		name: input.name,
		slug: input.slug,
		bio: input.bio,
		visible: input.visible,
		acceptingInquiries: input.acceptingInquiries,
		acceptingFlash: input.acceptingFlash,
		closedMessage: input.closedMessage,
		styles: input.styles,
		instagramUrl: input.instagramUrl,
		facebookUrl: input.facebookUrl,
		tiktokUrl: input.tiktokUrl,
	};
}

function photoColumns(
	photo: { key: string; width: number; height: number } | null,
) {
	return {
		photoKey: photo?.key ?? null,
		photoWidth: photo?.width ?? null,
		photoHeight: photo?.height ?? null,
	};
}

/**
 * The link after an edit: checking the box links an unlinked profile (never
 * one that belongs to someone else); unchecking unlinks only the acting
 * member from their own profile.
 */
function nextUserId(
	current: string | null,
	linkToMe: boolean,
	member: Member,
): string | null {
	if (linkToMe) return current ?? member.id;
	return current === member.id ? null : current;
}

/**
 * Turns the two unique indexes into the errors callers handle. Runs after
 * withTransaction rolled its savepoint back.
 */
function rethrowConflict(error: unknown, slug: string): never {
	if (isUniqueViolation(error, SLUG_INDEX))
		throw new ArtistSlugTakenError(slug);
	if (isUniqueViolation(error, USER_INDEX))
		throw new ArtistProfileExistsError();
	throw error;
}

/** ArtistService.findEditable's rule: an owner any profile, anyone else their own linked one. */
export function mayEdit(
	editor: ProfileEditor,
	linkedUserId: string | null,
): boolean {
	return editor.role === "owner" || linkedUserId === editor.userId;
}

/**
 * A caller bug, not a user error: profiles come from findFor(tenant, id).
 */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}
