import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import { stillOf } from "#modules/artists/services/work_photo_service";
import { knownStyles } from "#modules/artists/styles";
import {
	type ArtistDiscoverState,
	type ArtistFacts,
	type ArtworkDiscoverState,
	artistDiscoverState,
	artworkDiscoverState,
	type BusinessType,
	LISTING_CONSENT_VERSION,
	type PublicationFacts,
	type PublicationStatus,
	publicationStatus,
	type Readiness,
	readiness,
} from "#modules/discovery/publication";
import { readDiscovery } from "#modules/discovery/read";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import { logoTileOf } from "#modules/storefront/look";
import Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";
import { bookingPageUrl, studioPageUrl } from "#services/storefront_url";
import env from "#start/env";

/** A refusal the owner can act on, under `field` on the form. */
export class PublicationError extends Error {
	constructor(
		readonly field: string,
		message: string,
	) {
		super(message);
	}
}

/** A business an operator named that doesn't exist (or a photo not in it). */
export class OperatorTargetError extends Error {}

export type Place = {
	id: string;
	countryCode: string;
	slug: string;
	name: string;
	region: string | null;
};

export type PublicationOverview = {
	type: BusinessType;
	status: PublicationStatus;
	facts: PublicationFacts;
	readiness: Readiness;
	place: Place | null;
	/** The last consent accepted, kept after the listing is turned off. */
	consent: {
		version: string;
		acceptedAt: DateTime;
		current: boolean;
	} | null;
	artists: (ArtistFacts & { state: ArtistDiscoverState })[];
};

type TenantRef = Pick<Tenant, "id">;

/** How many of the newest photos the preview shows, as a Discover profile does. */
const PREVIEW_PHOTOS = 12;

/**
 * Studio OS's side of Discover (Discover D04,
 * docs/discover/publication-controls.md): an owner's listing, its consent
 * and city, the readiness checklist and the preview; an artist's own
 * Discover switch; each photo's Discover state; and the operator's
 * takedowns. Every read and write runs in the tenant's own context, so RLS
 * scopes it as it scopes the rest of Studio OS. What is public is still
 * decided only by the D02 `discovery` views: `publiclyVisible` asks them.
 */
@inject()
export default class PublicationService {
	constructor(
		private images: ImageService,
		private artists: ArtistService,
	) {}

	/** Everything the Discover settings page shows, read now. */
	async overview(
		tenant: TenantRef,
		viewer: { id: string } | null = null,
	): Promise<PublicationOverview> {
		const live = await Tenant.findOrFail(tenant.id);
		// One after another, never in parallel: readDiscovery runs in a
		// savepoint of the same connection with the tenant context cleared,
		// and a tenant read sent meanwhile would run inside it.
		const artists = await this.artistFacts(live);
		const place = live.placeId ? await this.place(live.placeId) : null;
		const publiclyVisible = await this.publiclyVisible(live);
		const facts: PublicationFacts = {
			type: live.type,
			optedIn: live.discoveryListed,
			takenDown: live.discoverySuspendedAt !== null,
			publiclyVisible,
			hasPlace: place !== null,
			hasLogo: live.logoImageKey !== null,
			hasCover: live.coverImageKey !== null,
			hasIntro: (live.intro ?? "").trim() !== "",
			viewerUserId: viewer?.id ?? null,
			artists,
		};
		const ready = readiness(facts);
		return {
			type: live.type,
			status: publicationStatus(facts, ready),
			facts,
			readiness: ready,
			place,
			consent:
				live.discoveryConsentVersion && live.discoveryListedAt
					? {
							version: live.discoveryConsentVersion,
							acceptedAt: live.discoveryListedAt,
							current: live.discoveryConsentVersion === LISTING_CONSENT_VERSION,
						}
					: null,
			artists: artists.map((artist) => ({
				...artist,
				state: artistDiscoverState(facts, artist),
			})),
		};
	}

	/** The platform's places, for the city picker. */
	async places(): Promise<Place[]> {
		const rows = await dbClient()
			.from("places")
			.select("id", "country_code", "slug", "name", "region")
			.orderBy("country_code")
			.orderBy("name");
		return rows.map(placeFrom);
	}

	/**
	 * Sets the city Discover lists the business under, or clears it. A
	 * listed business can't clear it: the city is required to list.
	 */
	async setPlace(tenant: TenantRef, placeId: string | null): Promise<void> {
		await withTransaction(async (trx) => {
			const live = await lockTenant(trx, tenant);
			if (placeId === null) {
				if (live.discoveryListed) {
					throw new PublicationError(
						"placeId",
						"A listing needs a city. Turn the listing off first to remove it.",
					);
				}
			} else if (!(await trx.from("places").where("id", placeId).first())) {
				throw new PublicationError("placeId", "Choose a city from the list.");
			}
			live.placeId = placeId;
			await live.save();
		});
	}

	/**
	 * Turns the listing on with the owner's consent to `version`, which must
	 * be the current wording (the page may be older than a change). Records
	 * the version, when and who. Refused without a city. Already listed under
	 * the current version: nothing changes. A takedown doesn't stop the
	 * owner's choice being saved; it keeps the listing off Discover.
	 */
	async enable(
		tenant: TenantRef,
		consentedBy: { id: string },
		version: string,
	): Promise<void> {
		if (version !== LISTING_CONSENT_VERSION) {
			throw new PublicationError(
				"consent",
				"The listing terms changed while this page was open. Read them again before you accept.",
			);
		}
		await withTransaction(async (trx) => {
			const live = await lockTenant(trx, tenant);
			if (
				live.discoveryListed &&
				live.discoveryConsentVersion === LISTING_CONSENT_VERSION
			) {
				return;
			}
			if (!live.placeId) {
				throw new PublicationError(
					"placeId",
					"Choose your city before you list.",
				);
			}
			live.merge({
				discoveryListed: true,
				discoveryListedAt: DateTime.now(),
				discoveryConsentVersion: version,
				discoveryConsentedByUserId: consentedBy.id,
			});
			await live.save();
			// An independent artist has one switch: listing the business shows
			// their own profile, whose switch the page doesn't offer. A profile
			// another login manages keeps its own choice (setArtistListed).
			if (live.type === "independent") {
				await Artist.query({ client: trx })
					.where("tenant_id", live.id)
					.where((query) =>
						query.whereNull("user_id").orWhere("user_id", consentedBy.id),
					)
					.update({ discovery_listed: true });
			}
		});
	}

	/** Turns the listing off. The consent record stays; nothing else changes. */
	async disable(tenant: TenantRef): Promise<void> {
		await withTransaction(async (trx) => {
			const live = await lockTenant(trx, tenant);
			if (!live.discoveryListed) return;
			live.discoveryListed = false;
			await live.save();
		});
	}

	/**
	 * One artist's own Discover switch. Whoever may edit the profile may turn
	 * it off (ArtistService.lockEditable: an owner any profile, an artist
	 * their own). Turning it back on is the artist's own choice: an owner
	 * may do it only for a profile no login manages, or their own.
	 */
	async setArtistListed(
		tenant: TenantRef,
		editor: ProfileEditor,
		artistId: string,
		listed: boolean,
	): Promise<Artist> {
		return withTransaction(async (trx) => {
			const artist = await this.artists.lockEditable(
				trx,
				tenant,
				editor,
				artistId,
			);
			// An independent artist's one switch is the listing's (enable).
			const business = await Tenant.query({ client: trx })
				.where("id", tenant.id)
				.firstOrFail();
			if (business.type === "independent") {
				throw new PublicationError(
					"listed",
					"Your Discover listing is managed in Settings, Discover.",
				);
			}
			if (listed && artist.userId !== null && artist.userId !== editor.userId) {
				throw new PublicationError(
					"listed",
					`${artist.name} manages their own profile, so only they can turn their Discover switch back on.`,
				);
			}
			artist.discoveryListed = listed;
			await artist.save();
			return artist;
		});
	}

	/** One artist's Discover state, for their profile page. */
	async artistState(
		tenant: TenantRef,
		artist: Pick<Artist, "id" | "visible" | "discoveryListed">,
	): Promise<{ state: ArtistDiscoverState; publishedPhotos: number }> {
		const live = await Tenant.findOrFail(tenant.id);
		// Sequential: see overview.
		const counts = await publishedCounts(live, [artist.id]);
		const publiclyVisible = await this.publiclyVisible(live);
		return {
			state: artistDiscoverState(
				{ takenDown: live.discoverySuspendedAt !== null, publiclyVisible },
				artist,
			),
			publishedPhotos: counts.get(artist.id) ?? 0,
		};
	}

	/** Each photo's Discover state, for the portfolio. */
	async artworkStates(
		tenant: TenantRef,
		artists: Pick<Artist, "id" | "visible" | "discoveryListed">[],
		photos: Pick<
			ArtistWorkPhoto,
			"id" | "artistId" | "hidden" | "discoverySuspendedAt"
		>[],
	): Promise<Map<string, ArtworkDiscoverState>> {
		const live = await Tenant.findOrFail(tenant.id);
		const studio = {
			takenDown: live.discoverySuspendedAt !== null,
			publiclyVisible: await this.publiclyVisible(live),
		};
		const byId = new Map(artists.map((artist) => [artist.id, artist]));
		return new Map(
			photos.map((photo) => {
				const artist = byId.get(photo.artistId) ?? {
					visible: false,
					discoveryListed: false,
				};
				return [
					photo.id,
					artworkDiscoverState(studio, artist, {
						hidden: photo.hidden,
						takenDown: photo.discoverySuspendedAt !== null,
					}),
				];
			}),
		);
	}

	/**
	 * What Discover would show for the business, listed or not, read from
	 * its own records by Discover's rules (shown artists, published photos
	 * that are not taken down). Owners only, through the settings route.
	 */
	async preview(tenant: TenantRef) {
		const live = await Tenant.findOrFail(tenant.id);
		const artists = (await Artist.query()
			.where("tenant_id", live.id)
			.where("visible", true)
			.where("discovery_listed", true)
			.orderBy("name")
			.orderBy("id")) as Artist[];
		const ids = artists.map((artist) => artist.id);
		const photos = ids.length
			? await ArtistWorkPhoto.query()
					.where("tenant_id", live.id)
					.whereIn("artist_id", ids)
					.where("hidden", false)
					.whereNull("discovery_suspended_at")
					// Angles: one artwork per tattoo, its lead, as discovery.artworks lists.
					.whereNull("lead_photo_id")
					.orderBy("created_at", "desc")
					.orderBy("id", "desc")
					.limit(PREVIEW_PHOTOS)
			: [];
		const place = live.placeId ? await this.place(live.placeId) : null;
		const template = storefrontTemplate();
		const styles = [...new Set(artists.flatMap((artist) => artist.styles))];
		const discoverBase = env.get("DISCOVER_URL");

		return {
			type: live.type,
			name: live.name,
			slug: live.slug,
			intro: live.intro,
			location: place
				? {
						name: place.name,
						region: place.region,
						countryCode: place.countryCode,
					}
				: null,
			logo:
				live.logoImageKey && live.logoImageWidth && live.logoImageHeight
					? {
							...(await this.images.shownImage(
								"studio_logo",
								live.logoImageKey,
								live,
								{ width: live.logoImageWidth, height: live.logoImageHeight },
							)),
							tile: logoTileOf(live.logoTile),
						}
					: null,
			cover:
				live.coverImageKey && live.coverImageWidth && live.coverImageHeight
					? await this.images.shownImage(
							"studio_cover",
							live.coverImageKey,
							live,
							{
								width: live.coverImageWidth,
								height: live.coverImageHeight,
							},
						)
					: null,
			styles: knownStyles(styles),
			artists: await Promise.all(
				artists.map(async (artist) => ({
					id: artist.id,
					name: artist.name,
					slug: artist.slug,
					styles: knownStyles(artist.styles),
					photo:
						artist.photoKey && artist.photoWidth && artist.photoHeight
							? await this.images.shownImage(
									"artist_photo",
									artist.photoKey,
									live,
									{
										width: artist.photoWidth,
										height: artist.photoHeight,
									},
								)
							: null,
				})),
			),
			tattoos: await Promise.all(
				photos.map(async (photo) => ({
					id: photo.id,
					alt: photo.alt,
					image: await this.images.shownImage(
						"artist_work_photo",
						stillOf(photo).key,
						live,
						stillOf(photo),
					),
				})),
			),
			storefrontUrl: studioPageUrl(template, live.slug),
			bookingUrl: bookingPageUrl(template, live.slug),
			// Where the profile will live once Discover is online (D05 onward);
			// null while DISCOVER_URL is unset.
			discoverUrl: discoverBase
				? new URL(
						`/${live.type === "independent" ? "artists" : "studios"}/${live.slug}`,
						discoverBase,
					).toString()
				: null,
		};
	}

	/** Takes the business's listing off Discover (operator only). */
	async suspendStudio(slug: string, note: string): Promise<void> {
		await this.asOperator(slug, async (trx, tenantId) => {
			const live = await lockTenant(trx, { id: tenantId });
			live.merge({
				discoverySuspendedAt: live.discoverySuspendedAt ?? DateTime.now(),
				discoverySuspensionNote: note,
			});
			await live.save();
			logger.info({ tenantId }, "Discover takedown of a business");
		});
	}

	/** Lifts the business's takedown: its listing follows the owner's switch again. */
	async restoreStudio(slug: string): Promise<void> {
		await this.asOperator(slug, async (trx, tenantId) => {
			const live = await lockTenant(trx, { id: tenantId });
			live.merge({ discoverySuspendedAt: null, discoverySuspensionNote: null });
			await live.save();
			logger.info({ tenantId }, "Discover takedown of a business lifted");
		});
	}

	/** Takes one photo off Discover; it stays on the studio page. */
	async suspendPhoto(
		slug: string,
		photoId: string,
		note: string,
	): Promise<void> {
		await this.asOperator(slug, async (trx, tenantId) => {
			const photo = await lockPhoto(trx, tenantId, photoId);
			photo.merge({
				discoverySuspendedAt: photo.discoverySuspendedAt ?? DateTime.now(),
				discoverySuspensionNote: note,
			});
			await photo.save();
			logger.info({ tenantId, photoId }, "Discover takedown of a photo");
		});
	}

	async restorePhoto(slug: string, photoId: string): Promise<void> {
		await this.asOperator(slug, async (trx, tenantId) => {
			const photo = await lockPhoto(trx, tenantId, photoId);
			photo.merge({
				discoverySuspendedAt: null,
				discoverySuspensionNote: null,
			});
			await photo.save();
			logger.info({ tenantId, photoId }, "Discover takedown of a photo lifted");
		});
	}

	/** What an operator needs to review a business's Discover state. */
	async operatorStatus(slug: string) {
		return this.asOperator(slug, async (trx, tenantId) => {
			const overview = await this.overview({ id: tenantId });
			const live = await Tenant.query({ client: trx })
				.where("id", tenantId)
				.firstOrFail();
			const removed = await ArtistWorkPhoto.query({ client: trx })
				.where("tenant_id", tenantId)
				.whereNotNull("discovery_suspended_at")
				.orderBy("discovery_suspended_at", "desc");
			return {
				slug: live.slug,
				name: live.name,
				status: overview.status,
				optedIn: live.discoveryListed,
				publiclyVisible: overview.facts.publiclyVisible,
				takedown: live.discoverySuspendedAt
					? {
							at: live.discoverySuspendedAt,
							note: live.discoverySuspensionNote,
						}
					: null,
				removedPhotos: removed.map((photo) => ({
					id: photo.id,
					at: photo.discoverySuspendedAt as DateTime,
					note: photo.discoverySuspensionNote,
				})),
			};
		});
	}

	/**
	 * Runs an operator action in the named business's own context. The slug
	 * is resolved by tenant_for_slug() (current or old slug, live tenants
	 * only); an unknown one throws OperatorTargetError.
	 */
	private async asOperator<T>(
		slug: string,
		fn: (trx: QueryClientContract, tenantId: string) => Promise<T>,
	): Promise<T> {
		const { rows } = await dbClient().rawQuery(
			"select public.tenant_for_slug(?) as id",
			[slug],
		);
		const tenantId: string | null = rows[0]?.id ?? null;
		if (!tenantId) throw new OperatorTargetError(`No studio uses "${slug}".`);
		return withDbContext({ tenantId }, (trx) => fn(trx, tenantId));
	}

	private async artistFacts(tenant: TenantRef): Promise<ArtistFacts[]> {
		const artists = (await Artist.query()
			.where("tenant_id", tenant.id)
			.orderBy("name")
			.orderBy("id")) as Artist[];
		const counts = await publishedCounts(
			tenant,
			artists.map((artist) => artist.id),
		);
		return artists.map((artist) => ({
			id: artist.id,
			name: artist.name,
			slug: artist.slug,
			visible: artist.visible,
			discoveryListed: artist.discoveryListed,
			userId: artist.userId,
			publishedPhotos: counts.get(artist.id) ?? 0,
		}));
	}

	/**
	 * Whether Discover's public API returns the business now: a studio in
	 * `discovery.studios`; an independent artist, whose public page is their
	 * artist profile, in `discovery.artists`. Asked of the views themselves,
	 * with no context (readDiscovery), so this is never a guess.
	 */
	private async publiclyVisible(
		tenant: Pick<Tenant, "id" | "type">,
	): Promise<boolean> {
		return readDiscovery(async (client) => {
			const { rows } = await client.rawQuery(
				tenant.type === "independent"
					? "select 1 from discovery.artists where studio_id = ? limit 1"
					: "select 1 from discovery.studios where id = ? limit 1",
				[tenant.id],
			);
			return rows.length > 0;
		});
	}

	private async place(id: string): Promise<Place | null> {
		const row = await dbClient()
			.from("places")
			.select("id", "country_code", "slug", "name", "region")
			.where("id", id)
			.first();
		return row ? placeFrom(row) : null;
	}
}

/**
 * Published photo counts (not hidden, not taken down) per artist: tattoos,
 * as Discover lists them (`discovery.artworks` keeps leads only), so a tattoo
 * of four photos counts once.
 */
async function publishedCounts(
	tenant: TenantRef,
	artistIds: string[],
): Promise<Map<string, number>> {
	if (artistIds.length === 0) return new Map();
	const rows = await dbClient()
		.from("artist_work_photos")
		.select("artist_id")
		.count("* as total")
		.where("tenant_id", tenant.id)
		.whereIn("artist_id", artistIds)
		.where("hidden", false)
		.whereNull("discovery_suspended_at")
		.whereNull("lead_photo_id")
		.groupBy("artist_id");
	return new Map(
		rows.map((row: { artist_id: string; total: string | number }) => [
			row.artist_id,
			Number(row.total),
		]),
	);
}

function lockTenant(trx: QueryClientContract, tenant: TenantRef) {
	return Tenant.query({ client: trx })
		.where("id", tenant.id)
		.forUpdate()
		.firstOrFail();
}

async function lockPhoto(
	trx: QueryClientContract,
	tenantId: string,
	photoId: string,
): Promise<ArtistWorkPhoto> {
	const photo = await ArtistWorkPhoto.query({ client: trx })
		.where("tenant_id", tenantId)
		.where("id", photoId)
		.forUpdate()
		.first();
	if (!photo) {
		throw new OperatorTargetError("That studio has no photo with this id.");
	}
	return photo;
}

function placeFrom(row: {
	id: string;
	country_code: string;
	slug: string;
	name: string;
	region: string | null;
}): Place {
	return {
		id: row.id,
		countryCode: row.country_code,
		slug: row.slug,
		name: row.name,
		region: row.region,
	};
}
