import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
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
	closedMessage: string | null;
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
	 * Saves an edit. A new `photo` replaces the stored one and `removePhoto`
	 * drops it; the old file is deleted once the outermost transaction
	 * commits.
	 */
	async update(
		tenant: TenantRef,
		artist: Artist,
		input: ArtistInput,
		member: Member,
	): Promise<Artist> {
		assertOwnedBy(tenant, artist);
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
					.where("id", artist.id)
					.forUpdate()
					.firstOrFail();
				const previous = live.photoKey;
				const keepsPhoto = !photo && !input.removePhoto;
				live.merge({
					...profileFields(input),
					userId: nextUserId(live.userId, input.linkToMe, member),
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
			closedMessage: null,
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

function profileFields(input: ArtistInput) {
	return {
		name: input.name,
		slug: input.slug,
		bio: input.bio,
		visible: input.visible,
		acceptingInquiries: input.acceptingInquiries,
		closedMessage: input.closedMessage,
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

/**
 * A caller bug, not a user error: profiles come from findFor(tenant, id).
 */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}
