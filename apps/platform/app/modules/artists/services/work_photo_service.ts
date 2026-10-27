import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { WorkPhotoLimitError } from "#modules/artists/errors";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback, withTransaction } from "#services/db_context";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

/**
 * The most work photos an artist shows. The database holds the same limit
 * (`artist_work_photos_position_range`: positions 0 to 5): change both.
 */
export const MAX_WORK_PHOTOS = 6;

const PURPOSE = "artist_work_photo";

/**
 * The photos of an artist's work (TAT-116): up to six public photos, in the
 * studio's order, with an optional description each. Every call is scoped to
 * the tenant. Who may change an artist's photos is ArtistService.findEditable
 * (an owner any live artist's, an artist their own linked profile's), and
 * every write checks that again under the artist's row lock, the lock
 * ArtistService.save takes too, so an upload and a profile save never
 * interleave. Files are stored through ImageService and deleted here, after
 * the real commit or rollback. Positions are dense (0 to n-1): only `add`
 * (append), `move` (swap two neighbours) and `remove` (compact) write them.
 */
@inject()
export default class WorkPhotoService {
	constructor(
		private images: ImageService,
		private artists: ArtistService,
	) {}

	/** The artist's photos in the studio's order. */
	async list(tenant: TenantRef, artist: Artist): Promise<ArtistWorkPhoto[]> {
		assertOwnedBy(tenant, artist);
		return ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("artist_id", artist.id)
			.orderBy("position", "asc");
	}

	/**
	 * Many artists' photos in one query, each artist's in the studio's order;
	 * an artist with none has no entry. The caller passes the ids of artists
	 * it may show (the public reads pass only visible ones); no query for [].
	 */
	async forArtists(
		tenant: TenantRef,
		artistIds: readonly string[],
	): Promise<Map<string, ArtistWorkPhoto[]>> {
		const byArtist = new Map<string, ArtistWorkPhoto[]>();
		if (artistIds.length === 0) return byArtist;
		const photos = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.whereIn("artist_id", [...artistIds])
			.orderBy("artist_id", "asc")
			.orderBy("position", "asc");
		for (const photo of photos) {
			const list = byArtist.get(photo.artistId) ?? [];
			list.push(photo);
			byArtist.set(photo.artistId, list);
		}
		return byArtist;
	}

	/**
	 * The photo and its artist, if `editor` may change them: the photo is the
	 * tenant's, and the artist is live and `editor`'s to edit
	 * (ArtistService.findEditable). Another tenant's photo, a deleted artist's,
	 * another artist's for an artist member and an unknown id all throw
	 * E_ROW_NOT_FOUND (a 404), so callers can't tell them apart.
	 */
	async findEditable(
		tenant: TenantRef,
		editor: ProfileEditor,
		photoId: string,
	): Promise<{ photo: ArtistWorkPhoto; artist: Artist }> {
		const photo = await ArtistWorkPhoto.query()
			.where("tenant_id", tenant.id)
			.where("id", photoId)
			.firstOrFail();
		const artist = await this.artists.findEditable(
			tenant,
			editor,
			photo.artistId,
		);
		return { photo, artist };
	}

	/**
	 * Adds a photo at the end. Throws WorkPhotoLimitError when the artist
	 * already shows six (also when two uploads race for the last place: the
	 * second is refused under the lock and its file is deleted) and
	 * InvalidImageError for a file we can't accept.
	 *
	 * The order matters. The unlocked count refuses a full set before any
	 * decode; the file is stored inside the transaction with its cleanup
	 * registered at once and before the row lock (so the lock is not held
	 * while the image is processed); the lock then serializes uploads, and the
	 * count under it is the one that counts.
	 */
	async add(
		tenant: TenantRef,
		editor: ProfileEditor,
		artist: Artist,
		upload: Upload,
	): Promise<ArtistWorkPhoto> {
		assertOwnedBy(tenant, artist);
		// Before any decode: an upload to a profile that isn't the editor's, or
		// to a full set, costs nothing. (The lock below checks both again.)
		if (!mayEdit(editor, artist.userId)) {
			throw new lucidErrors.E_ROW_NOT_FOUND(Artist);
		}
		if ((await this.countPhotos(tenant, artist.id)) >= MAX_WORK_PHOTOS) {
			throw new WorkPhotoLimitError();
		}
		return withTransaction(async (trx) => {
			const stored = await this.images.store(upload, {
				tenant,
				purpose: PURPOSE,
			});
			afterRollback(() => this.images.delete(PURPOSE, stored.key));
			await this.lockArtist(trx, tenant, editor, artist.id);
			// Again under the lock: another upload may have landed meanwhile.
			const count = await this.countPhotos(tenant, artist.id, trx);
			if (count >= MAX_WORK_PHOTOS) throw new WorkPhotoLimitError();
			return ArtistWorkPhoto.create(
				{
					tenantId: tenant.id,
					artistId: artist.id,
					imageKey: stored.key,
					width: stored.width,
					height: stored.height,
					position: count,
					alt: null,
				},
				{ client: trx },
			);
		});
	}

	/** Sets the photo's description; empty text clears it (the public page then words its own). */
	async describe(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		alt: string | null,
	): Promise<ArtistWorkPhoto> {
		assertPhotoOf(tenant, photo);
		return withTransaction(async (trx) => {
			await this.lockArtist(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const text = alt?.trim();
			live.alt = text ? text : null;
			await live.save();
			return live;
		});
	}

	/**
	 * Moves the photo one place earlier or later by swapping it with its
	 * neighbour in one UPDATE (the position constraint is deferrable for
	 * this). At either end nothing changes.
	 */
	async move(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
		direction: "up" | "down",
	): Promise<void> {
		assertPhotoOf(tenant, photo);
		await withTransaction(async (trx) => {
			await this.lockArtist(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const neighbourPosition =
				direction === "up" ? live.position - 1 : live.position + 1;
			const neighbour = await ArtistWorkPhoto.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("artist_id", live.artistId)
				.where("position", neighbourPosition)
				.first();
			if (!neighbour) return;
			await trx.rawQuery(
				`update artist_work_photos
				 set position = case when id = ? then ?::smallint else ?::smallint end,
				     updated_at = now()
				 where tenant_id = ? and id in (?, ?)`,
				[
					live.id,
					neighbour.position,
					live.position,
					tenant.id,
					live.id,
					neighbour.id,
				],
			);
		});
	}

	/**
	 * Deletes the photo for good, files first (TAT-116): under the artist's
	 * lock the photo's files and every copy are deleted, and only then the row
	 * goes and the photos after it move up one place in one UPDATE. A photo a
	 * client asked to take down must not stay fetchable while the studio is
	 * told it is gone, so if any file cannot be deleted this throws
	 * ImageDeleteError (the controller says so and the row stays, so the owner
	 * can try again: a missing file counts as deleted, so a retry finishes the
	 * job). The deletes are real the moment they run, before the commit; the
	 * transaction only has the row delete and the compaction left to fail.
	 */
	async remove(
		tenant: TenantRef,
		editor: ProfileEditor,
		photo: ArtistWorkPhoto,
	): Promise<void> {
		assertPhotoOf(tenant, photo);
		await withTransaction(async (trx) => {
			await this.lockArtist(trx, tenant, editor, photo.artistId);
			const live = await this.lockedPhoto(trx, tenant, photo);
			const { imageKey, position, artistId } = live;
			await this.images.deleteOrThrow(PURPOSE, imageKey);
			await live.delete();
			await trx.rawQuery(
				`update artist_work_photos set position = position - 1, updated_at = now()
				 where tenant_id = ? and artist_id = ? and position > ?`,
				[tenant.id, artistId, position],
			);
		});
	}

	/** How many photos the artist has now. A hook so a test can stage a racing upload. */
	protected async countPhotos(
		tenant: TenantRef,
		artistId: string,
		client?: QueryClientContract,
	): Promise<number> {
		const [row] = await ArtistWorkPhoto.query(client ? { client } : undefined)
			.where("tenant_id", tenant.id)
			.where("artist_id", artistId)
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * Locks the artist's live row (`FOR UPDATE`, the lock ArtistService.save
	 * takes) and checks `editor` may still change it: a profile deleted since
	 * the page loaded, or unlinked from an artist member, is a 404.
	 */
	private async lockArtist(
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

	/** The photo's row, read again under the artist's lock: gone meanwhile is a 404. */
	private async lockedPhoto(
		trx: QueryClientContract,
		tenant: TenantRef,
		photo: ArtistWorkPhoto,
	): Promise<ArtistWorkPhoto> {
		return ArtistWorkPhoto.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", photo.id)
			.firstOrFail();
	}
}

/** ArtistService.findEditable's rule: an owner any profile, anyone else their own linked one. */
function mayEdit(editor: ProfileEditor, linkedUserId: string | null): boolean {
	return editor.role === "owner" || linkedUserId === editor.userId;
}

/** A caller bug, not a user error: artists come from findEditable(tenant, editor, id). */
function assertOwnedBy(tenant: TenantRef, artist: Artist) {
	if (artist.tenantId !== tenant.id) {
		throw new Error(`Artist ${artist.id} belongs to another tenant`);
	}
}

function assertPhotoOf(tenant: TenantRef, photo: ArtistWorkPhoto) {
	if (photo.tenantId !== tenant.id) {
		throw new Error(`Work photo ${photo.id} belongs to another tenant`);
	}
}
