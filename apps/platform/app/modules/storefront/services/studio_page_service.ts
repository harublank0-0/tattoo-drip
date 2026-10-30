import { inject } from "@adonisjs/core";
import { studioTakesInquiries } from "#modules/artists/accepting";
import type Artist from "#modules/artists/models/artist";
import type ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import { knownStyles, type TattooStyleRef } from "#modules/artists/styles";
import {
	encodeWorkCursor,
	type WorkCursor,
} from "#modules/artists/work_cursor";
import type FlashDesign from "#modules/flash/models/flash_design";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import FlashService from "#modules/flash/services/flash_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type ShownImage,
} from "#modules/media/services/image_service";
import { formatMoney } from "#modules/projects/quotes";
import type {
	OpeningDay,
	ShownClosure,
} from "#modules/scheduling/opening_hours";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import { lookOf, type PageLook } from "#modules/storefront/look";
import {
	type PublicSocialLink,
	socialLinks,
} from "#modules/storefront/studio_page";
import type Tenant from "#modules/tenancy/models/tenant";
import type { TenantProfile } from "#modules/tenancy/services/tenancy_service";

/**
 * What getStudio may read of a tenant: the profile its owners were told is
 * shown on the studio page (TenantProfile), its current slug and its type.
 * The deposit policy is shown in Good to know (TAT-128, `StudioPage.goodToKnow`);
 * never the default deposit percentage.
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
	/** The open weekdays, Sunday first (TAT-128). */
	openingHours: OpeningDay[];
	/** The closed days that haven't ended in the studio's timezone, earliest first. */
	closedDays: ShownClosure[];
	/**
	 * The texts the studio wrote for clients, as stored (the transformer
	 * trims them and turns a blank one into null). The deposit policy is the
	 * one text of the deposit settings the page shows; never the percentage.
	 */
	goodToKnow: {
		walkIns: string | null;
		ageRule: string | null;
		depositPolicy: string | null;
		beforeSession: string | null;
		aftercare: string | null;
	};
};

/** A work photo as the public API shows it (openapi.yaml, WorkPhoto). */
export type ShownWorkPhoto = ShownImage & { alt: string | null };

/** A photo of the gallery as the public API shows it (openapi.yaml, GalleryPhoto). */
export type ShownGalleryPhoto = ShownWorkPhoto & {
	styles: TattooStyleRef[];
	healed: boolean;
	artist: { slug: string; name: string };
};

/** What listWork asks for: `healed: false` is no filter, and `limit` is already within bounds. */
export type WorkQuery = {
	artist: string | null;
	style: string | null;
	healed: boolean;
	cursor: WorkCursor | null;
	limit: number;
};

/** A page of the gallery before formatting (openapi.yaml, listWork). */
export type ShownWorkPage = {
	photos: ShownGalleryPhoto[];
	nextCursor: string | null;
	filters: { styles: TattooStyleRef[]; healed: boolean };
};

/** A price as the public API shows it (openapi.yaml, Price): in paisa, with the words to show. */
export type ShownPrice = { amount: number; currency: string; text: string };

/** A flash design as the public API shows it (openapi.yaml, FlashDesign). */
export type ShownFlashDesign = {
	id: string;
	name: string;
	size: string;
	price: ShownPrice | null;
	image: ShownImage;
	artist: { slug: string; name: string };
	/** The artist takes flash requests, whatever their books say. */
	requestable: boolean;
};

/** What listFlash asks for: `limit` is already within bounds. */
export type FlashQuery = {
	artist: string | null;
	cursor: WorkCursor | null;
	limit: number;
};

/** A page of flash designs before formatting (openapi.yaml, listFlash). */
export type ShownFlashPage = {
	designs: ShownFlashDesign[];
	nextCursor: string | null;
	filters: { artists: { slug: string; name: string }[] };
};

/** A visible artist as the public API shows it (openapi.yaml, Artist). */
export type ShownArtist = Pick<
	Artist,
	"id" | "slug" | "name" | "bio" | "acceptingInquiries" | "closedMessage"
> & {
	photo: ShownImage | null;
	workPhotos: ShownWorkPhoto[];
	/** The listed styles among the artist's, in the list's order. */
	styles: TattooStyleRef[];
	/** The artist's set https links: instagram, facebook, tiktok. */
	socialLinks: PublicSocialLink[];
};

const PHOTO = "artist_photo";
const COVER = "studio_cover";
const LOGO = "studio_logo";
const WORK_PHOTO = "artist_work_photo";
const FLASH_DESIGN = "flash_design";

/** How many photos an Artist carries: the six newest. All of them are in the work gallery. */
const PHOTOS_PER_ARTIST = 6;

/**
 * The studio page's public reads (TAT-44): the studio's profile and its
 * visible artists, for the tenant the publicTenant middleware resolved (its
 * row is already loaded, so the profile costs no query). Each read is one
 * query (ArtistService.listVisible or findVisibleBySlug); a photo is
 * ImageService.shownImage: its URL, size and smaller copies, all built from
 * the key without I/O. The studio's cover (TAT-116) comes from the tenant row
 * already loaded; the work photos of the artists a read returns come in one
 * more query (WorkPhotoService.forArtists), only for visible artists. The
 * studio read adds the opening hours and the upcoming closed days (two more
 * queries, OpeningHoursService.forPage; TAT-128) and the Good to know texts
 * from the row. The flash reads (TAT-129) are `flash` (a page, with
 * listVisible once and one query for the page and one for the filter) and
 * `flashDesign`. Only the fields the contract lists leave here.
 */
@inject()
export default class StudioPageService {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
		private workPhotos: WorkPhotoService,
		private hours: OpeningHoursService,
		private flashDesigns: FlashService,
	) {}

	async studio(tenant: Tenant): Promise<StudioPage> {
		const visible = await this.artists.listVisible(tenant);
		const { openingHours, closedDays } = await this.hours.forPage(tenant);
		return {
			profile: profileOf(tenant),
			acceptingInquiries: studioTakesInquiries(visible),
			cover: await this.coverOf(tenant),
			storefront: {
				look: lookOf(tenant),
				logo: await this.logoOf(tenant),
			},
			openingHours,
			closedDays,
			goodToKnow: {
				walkIns: tenant.walkInsText,
				ageRule: tenant.ageRuleText,
				depositPolicy: tenant.depositPolicy,
				beforeSession: tenant.beforeSessionText,
				aftercare: tenant.aftercareText,
			},
		};
	}

	/** The visible artists, by name (ArtistService.listVisible's order). */
	async visibleArtists(tenant: Tenant): Promise<ShownArtist[]> {
		const visible = await this.artists.listVisible(tenant);
		const work = await this.workPhotos.forArtists(
			tenant,
			visible.map((artist) => artist.id),
			PHOTOS_PER_ARTIST,
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
		const work = await this.workPhotos.forArtists(
			tenant,
			[artist.id],
			PHOTOS_PER_ARTIST,
		);
		return this.shown(tenant, artist, work.get(artist.id) ?? []);
	}

	/**
	 * One page of the gallery (TAT-126): the photos of the visible artists
	 * (all of them, or the one whose slug is `query.artist`), newest first,
	 * with what the gallery can be filtered by among those artists' photos.
	 * The artists are one read, which also gives each photo its artist's slug
	 * and name; an artist who is not visible, not there or not exactly that
	 * slug (never case-folded) is an empty page and empty filters, without a
	 * photo query. A style that is not in the list (a retired one still on a
	 * photo included) matches nothing, as the photos no longer show it.
	 * Then one query for the page and one for the filters, which are not
	 * narrowed by `style`, `healed` or the cursor. A listed `style` the
	 * request asked for is in the filters even when no photo of these artists
	 * carries it (they are an artist's own, so choosing an artist can leave a
	 * chosen style without photos), so the gallery's controls always show the
	 * filtering that was applied.
	 */
	async work(tenant: Tenant, query: WorkQuery): Promise<ShownWorkPage> {
		const visible = await this.artists.listVisible(tenant);
		const asked = query.style === null ? [] : [query.style];
		const artists =
			query.artist === null
				? visible
				: visible.filter((artist) => artist.slug === query.artist);
		if (artists.length === 0) {
			return {
				photos: [],
				nextCursor: null,
				filters: { styles: knownStyles(asked), healed: false },
			};
		}
		const artistIds = artists.map((artist) => artist.id);
		const listed = query.style === null || isListed(query.style);
		const { photos, next } = listed
			? await this.workPhotos.page(
					tenant,
					{ artistIds, style: query.style, healed: query.healed },
					query.cursor,
					query.limit,
				)
			: { photos: [], next: null };
		const facets = await this.workPhotos.facets(tenant, artistIds);
		const owners = new Map(artists.map((artist) => [artist.id, artist]));
		return {
			photos: await Promise.all(
				photos.map(async (photo) => {
					const owner = owners.get(photo.artistId);
					if (!owner) {
						throw new Error(`Work photo ${photo.id} is of an artist not read`);
					}
					return {
						...(await this.shownWorkPhoto(tenant, photo)),
						styles: knownStyles(photo.styles),
						healed: photo.healed,
						artist: { slug: owner.slug, name: owner.name },
					};
				}),
			),
			nextCursor: next ? encodeWorkCursor(next) : null,
			filters: {
				styles: knownStyles([...facets.styles, ...asked]),
				healed: facets.healed,
			},
		};
	}

	/**
	 * One page of the flash designs (TAT-129): the shown designs of the
	 * visible artists (all of them, or the one whose slug is `query.artist`),
	 * newest first, with the artists the page can be narrowed to. The artists
	 * are one read, which also gives each design its artist's slug and name;
	 * an artist who is not visible, not there or not exactly that slug (never
	 * case-folded) is an empty page without a design query. `filters.artists`
	 * are the visible artists with a shown design, by name (listVisible's
	 * order), whatever `query.artist` asks. A design is `requestable` while
	 * its artist takes flash requests, whatever their books say.
	 */
	async flash(tenant: Tenant, query: FlashQuery): Promise<ShownFlashPage> {
		const visible = await this.artists.listVisible(tenant);
		const withDesigns = await this.flashDesigns.artistsWithDesigns(
			tenant,
			visible.map((artist) => artist.id),
			true,
		);
		const filters = {
			artists: visible
				.filter((artist) => withDesigns.has(artist.id))
				.map(({ slug, name }) => ({ slug, name })),
		};
		const artists =
			query.artist === null
				? visible
				: visible.filter((artist) => artist.slug === query.artist);
		if (artists.length === 0) return { designs: [], nextCursor: null, filters };
		const { designs, next } = await this.flashDesigns.page(
			tenant,
			{ artistIds: artists.map((artist) => artist.id), withClaimed: true },
			query.cursor,
			query.limit,
		);
		const owners = new Map(artists.map((artist) => [artist.id, artist]));
		return {
			designs: await Promise.all(
				designs.map(async (design) => {
					const owner = owners.get(design.artistId);
					if (!owner) {
						throw new Error(
							`Flash design ${design.id} is of an artist not read`,
						);
					}
					return this.shownFlashDesign(tenant, design, owner);
				}),
			),
			nextCursor: next ? encodeWorkCursor(next) : null,
			filters,
		};
	}

	/** One shown design of a visible artist; null for a hidden or unknown one, or a hidden or deleted artist's (the API's 404). */
	async flashDesign(
		tenant: Tenant,
		id: string,
	): Promise<ShownFlashDesign | null> {
		const visible = await this.artists.listVisible(tenant);
		const design = await this.flashDesigns.findShown(
			tenant,
			id,
			visible.map((artist) => artist.id),
		);
		if (!design) return null;
		const owner = visible.find((artist) => artist.id === design.artistId);
		if (!owner) return null;
		return this.shownFlashDesign(tenant, design, owner);
	}

	private async shownFlashDesign(
		tenant: Tenant,
		design: FlashDesign,
		artist: Artist,
	): Promise<ShownFlashDesign> {
		return {
			id: design.id,
			name: design.name,
			size: design.size,
			price:
				design.price === null
					? null
					: {
							amount: design.price,
							currency: design.currency,
							text: formatMoney(design.price),
						},
			image: await this.images.shownImage(
				FLASH_DESIGN,
				design.imageKey,
				tenant,
				{ width: design.width, height: design.height },
			),
			artist: { slug: artist.slug, name: artist.name },
			requestable: artist.acceptingFlash,
		};
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
				work.map((photo) => this.shownWorkPhoto(tenant, photo)),
			),
			styles: knownStyles(artist.styles),
			socialLinks: socialLinks(artist),
		};
	}

	private async shownWorkPhoto(
		tenant: Tenant,
		photo: ArtistWorkPhoto,
	): Promise<ShownWorkPhoto> {
		return {
			...(await this.images.shownImage(WORK_PHOTO, photo.imageKey, tenant, {
				width: photo.width,
				height: photo.height,
			})),
			alt: photo.alt,
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

/** Whether `slug` is in the platform's list of styles. */
function isListed(slug: string): boolean {
	return knownStyles([slug]).length > 0;
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
