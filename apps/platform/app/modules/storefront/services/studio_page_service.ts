import { inject } from "@adonisjs/core";
import { studioTakesInquiries } from "#modules/artists/accepting";
import type Artist from "#modules/artists/models/artist";
import type ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService from "#modules/artists/services/work_photo_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type ShownImage,
} from "#modules/media/services/image_service";
import { lookOf, type PageLook } from "#modules/storefront/look";
import type Tenant from "#modules/tenancy/models/tenant";
import type { TenantProfile } from "#modules/tenancy/services/tenancy_service";

/**
 * What getStudio may read of a tenant: the profile its owners were told is
 * shown on the studio page (TenantProfile), its current slug and its type.
 * Never the deposit settings, which the settings page says the deposit page
 * shows.
 */
export type StudioProfile = TenantProfile & Pick<Tenant, "slug" | "type">;

/** The public Studio before formatting (openapi.yaml, Studio). */
export type StudioPage = {
	profile: StudioProfile;
	/** studioTakesInquiries over the visible artists: intake's own rule. */
	acceptingInquiries: boolean;
	/** The studio's cover photo (TAT-116), or null. */
	cover: ShownImage | null;
	/** How the page looks (TAT-56): the checked look and the logo. */
	storefront: { look: PageLook; logo: ShownImage | null };
};

/** A work photo as the public API shows it (openapi.yaml, WorkPhoto). */
export type ShownWorkPhoto = ShownImage & { alt: string | null };

/** A visible artist as the public API shows it (openapi.yaml, Artist). */
export type ShownArtist = Pick<
	Artist,
	"id" | "slug" | "name" | "bio" | "acceptingInquiries" | "closedMessage"
> & { photo: ShownImage | null; workPhotos: ShownWorkPhoto[] };

const PHOTO = "artist_photo";
const COVER = "studio_cover";
const LOGO = "studio_logo";
const WORK_PHOTO = "artist_work_photo";

/**
 * The studio page's public reads (TAT-44): the studio's profile and its
 * visible artists, for the tenant the publicTenant middleware resolved (its
 * row is already loaded, so the profile costs no query). Each read is one
 * query (ArtistService.listVisible or findVisibleBySlug); a photo is
 * ImageService.shownImage: its URL, size and smaller copies, all built from
 * the key without I/O. The studio's cover (TAT-116) comes from the tenant row
 * already loaded; the work photos of the artists a read returns come in one
 * more query (WorkPhotoService.forArtists), only for visible artists. Only the
 * fields the contract lists leave here.
 */
@inject()
export default class StudioPageService {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
		private workPhotos: WorkPhotoService,
	) {}

	async studio(tenant: Tenant): Promise<StudioPage> {
		const visible = await this.artists.listVisible(tenant);
		return {
			profile: profileOf(tenant),
			acceptingInquiries: studioTakesInquiries(visible),
			cover: await this.coverOf(tenant),
			storefront: {
				look: lookOf(tenant),
				logo: await this.logoOf(tenant),
			},
		};
	}

	/** The visible artists, by name (ArtistService.listVisible's order). */
	async visibleArtists(tenant: Tenant): Promise<ShownArtist[]> {
		const visible = await this.artists.listVisible(tenant);
		const work = await this.workPhotos.forArtists(
			tenant,
			visible.map((artist) => artist.id),
		);
		return Promise.all(
			visible.map((artist) =>
				this.shown(tenant, artist, work.get(artist.id) ?? []),
			),
		);
	}

	/** One visible artist by exact slug; null for a hidden, deleted or unknown one (the API's 404). */
	async visibleArtist(
		tenant: Tenant,
		slug: string,
	): Promise<ShownArtist | null> {
		const artist = await this.artists.findVisibleBySlug(tenant, slug);
		if (!artist) return null;
		const work = await this.workPhotos.forArtists(tenant, [artist.id]);
		return this.shown(tenant, artist, work.get(artist.id) ?? []);
	}

	private async shown(
		tenant: Tenant,
		artist: Artist,
		work: ArtistWorkPhoto[],
	): Promise<ShownArtist> {
		return {
			id: artist.id,
			slug: artist.slug,
			name: artist.name,
			bio: artist.bio,
			acceptingInquiries: artist.acceptingInquiries,
			// The form says the message shows while inquiries are off: an old
			// one kept after reopening never leaks.
			closedMessage: artist.acceptingInquiries ? null : artist.closedMessage,
			photo: await this.photoOf(tenant, artist),
			workPhotos: await Promise.all(
				work.map(async (photo) => ({
					...(await this.images.shownImage(WORK_PHOTO, photo.imageKey, tenant, {
						width: photo.width,
						height: photo.height,
					})),
					alt: photo.alt,
				})),
			),
		};
	}

	private async coverOf(tenant: Tenant): Promise<ShownImage | null> {
		const { coverImageKey, coverImageWidth, coverImageHeight } = tenant;
		if (
			!coverImageKey ||
			coverImageWidth === null ||
			coverImageHeight === null
		) {
			return null;
		}
		return this.images.shownImage(COVER, coverImageKey, tenant, {
			width: coverImageWidth,
			height: coverImageHeight,
		});
	}

	/** The logo (TAT-56) from the row already loaded, like the cover: no query. */
	private async logoOf(tenant: Tenant): Promise<ShownImage | null> {
		const { logoImageKey, logoImageWidth, logoImageHeight } = tenant;
		if (!logoImageKey || logoImageWidth === null || logoImageHeight === null) {
			return null;
		}
		return this.images.shownImage(LOGO, logoImageKey, tenant, {
			width: logoImageWidth,
			height: logoImageHeight,
		});
	}

	private async photoOf(
		tenant: Tenant,
		artist: Artist,
	): Promise<ShownImage | null> {
		const { photoKey, photoWidth, photoHeight } = artist;
		if (!photoKey || photoWidth === null || photoHeight === null) return null;
		return this.images.shownImage(PHOTO, photoKey, tenant, {
			width: photoWidth,
			height: photoHeight,
		});
	}
}

/** The tenant's public profile, field by field: nothing else of the row. */
function profileOf(tenant: Tenant): StudioProfile {
	return {
		slug: tenant.slug,
		type: tenant.type,
		name: tenant.name,
		timezone: tenant.timezone,
		intro: tenant.intro,
		contactPhone: tenant.contactPhone,
		contactEmail: tenant.contactEmail,
		address: tenant.address,
		instagramUrl: tenant.instagramUrl,
		facebookUrl: tenant.facebookUrl,
		tiktokUrl: tenant.tiktokUrl,
		websiteUrl: tenant.websiteUrl,
	};
}
