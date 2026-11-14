import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import {
	type DiscoverCursor,
	type DiscoverSort,
	decodeDiscoverCursor,
} from "#modules/discovery/cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DiscoverReviewService, {
	type DiscoverSubject,
} from "#modules/discovery/services/discover_review_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DiscoveryService from "#modules/discovery/services/discovery_service";
import {
	CITY_MESSAGE,
	CURSOR_MESSAGE,
	DISCOVER_PAGE_SIZE,
	listDiscoverArtistsValidator,
	listDiscoverFreshInkValidator,
	listDiscoverProfilePageValidator,
	listDiscoverSitemapValidator,
	listDiscoverStudiosValidator,
	listDiscoverTattoosValidator,
	SITEMAP_PAGE_SIZE,
} from "#modules/discovery/validators/discover";
import { callerOf } from "#services/api_caller";
import { consumeApiLimit } from "#services/api_limits";
import { ApiException } from "#services/public_api_errors";

/**
 * Discover's public API (Discover D03, openapi.yaml `/discover/*`,
 * docs/discover/api.md): cross-studio reads of what listed studios publish,
 * with no tenant or user context. Only the query string and the path are
 * read. A list answers `{ data, nextCursor }`; a resource Discover does not
 * show (unknown, unlisted, taken down, hidden, deleted) is the same 404.
 * A search (`q`) also counts against its own, smaller limit.
 */
@inject()
export default class DiscoverController {
	constructor(
		private discovery: DiscoveryService,
		private reviews: DiscoverReviewService,
	) {}

	async studios(ctx: HttpContext) {
		const query = await ctx.request.validateUsing(
			listDiscoverStudiosValidator,
			{
				data: ctx.request.qs(),
			},
		);
		checkCity(query);
		if (query.q) await consumeApiLimit("discoverSearch", callerOf(ctx));
		const sort = query.sort ?? "newest";
		const page = await this.discovery.studios({
			q: query.q,
			country: query.country,
			city: query.city,
			style: query.style,
			sort,
			cursor: cursorOf(query.cursor, sort),
			limit: query.limit ?? DISCOVER_PAGE_SIZE,
		});
		return { data: page.items, nextCursor: page.nextCursor };
	}

	async studio({ params }: HttpContext) {
		return { data: found(await this.discovery.studio(params.studio)) };
	}

	async studioArtists({ params }: HttpContext) {
		return { data: found(await this.discovery.studioArtists(params.studio)) };
	}

	async studioArtist({ params }: HttpContext) {
		return {
			data: found(
				await this.discovery.studioArtist(params.studio, params.artist),
			),
		};
	}

	async artists(ctx: HttpContext) {
		const query = await ctx.request.validateUsing(
			listDiscoverArtistsValidator,
			{
				data: ctx.request.qs(),
			},
		);
		checkCity(query);
		if (query.q) await consumeApiLimit("discoverSearch", callerOf(ctx));
		const sort = query.sort ?? "newest";
		const page = await this.discovery.artists({
			q: query.q,
			country: query.country,
			city: query.city,
			style: query.style,
			studio: query.studio,
			independent: query.independent,
			sort,
			cursor: cursorOf(query.cursor, sort),
			limit: query.limit ?? DISCOVER_PAGE_SIZE,
		});
		return { data: page.items, nextCursor: page.nextCursor };
	}

	async independentArtist({ params }: HttpContext) {
		return {
			data: found(await this.discovery.independentArtist(params.artist)),
		};
	}

	async tattoos(ctx: HttpContext) {
		const query = await ctx.request.validateUsing(
			listDiscoverTattoosValidator,
			{
				data: ctx.request.qs(),
			},
		);
		checkCity(query);
		if (query.q) await consumeApiLimit("discoverSearch", callerOf(ctx));
		const page = await this.discovery.tattoos({
			q: query.q,
			country: query.country,
			city: query.city,
			style: query.style,
			studio: query.studio,
			artist: query.artist,
			healed: query.healed,
			cursor: cursorOf(query.cursor, "newest"),
			limit: query.limit ?? DISCOVER_PAGE_SIZE,
		});
		return { data: page.items, nextCursor: page.nextCursor };
	}

	async tattoo({ params }: HttpContext) {
		return { data: found(await this.discovery.tattoo(params.tattoo)) };
	}

	/**
	 * Reviews and Fresh ink (slice 4): a profile's reviews with its rating
	 * (only from 3) and its Fresh ink, a page each, newest first; the 404 of
	 * the profile itself for one Discover does not show.
	 */
	async studioReviews(ctx: HttpContext) {
		return this.profileReviews(ctx, {
			kind: "studio",
			slug: ctx.params.studio,
		});
	}

	async studioArtistReviews(ctx: HttpContext) {
		return this.profileReviews(ctx, {
			kind: "studioArtist",
			studio: ctx.params.studio,
			artist: ctx.params.artist,
		});
	}

	async independentArtistReviews(ctx: HttpContext) {
		return this.profileReviews(ctx, {
			kind: "independent",
			slug: ctx.params.artist,
		});
	}

	async studioFreshInk(ctx: HttpContext) {
		return this.profileFreshInk(ctx, {
			kind: "studio",
			slug: ctx.params.studio,
		});
	}

	async studioArtistFreshInk(ctx: HttpContext) {
		return this.profileFreshInk(ctx, {
			kind: "studioArtist",
			studio: ctx.params.studio,
			artist: ctx.params.artist,
		});
	}

	async independentArtistFreshInk(ctx: HttpContext) {
		return this.profileFreshInk(ctx, {
			kind: "independent",
			slug: ctx.params.artist,
		});
	}

	/** The global Fresh ink feed: filtered by place and style, newest published first. */
	async freshInk(ctx: HttpContext) {
		const query = await ctx.request.validateUsing(
			listDiscoverFreshInkValidator,
			{ data: ctx.request.qs() },
		);
		checkCity(query);
		const page = found(
			await this.reviews.freshInk(null, {
				country: query.country,
				city: query.city,
				style: query.style,
				cursor: cursorOf(query.cursor, "newest"),
				limit: query.limit ?? DISCOVER_PAGE_SIZE,
			}),
		);
		return { data: page.items, nextCursor: page.nextCursor };
	}

	private async profileReviews(ctx: HttpContext, subject: DiscoverSubject) {
		const query = await ctx.request.validateUsing(
			listDiscoverProfilePageValidator,
			{ data: ctx.request.qs() },
		);
		const page = found(
			await this.reviews.reviews(subject, {
				cursor: cursorOf(query.cursor, "newest"),
				limit: query.limit ?? DISCOVER_PAGE_SIZE,
			}),
		);
		return {
			data: page.items,
			nextCursor: page.nextCursor,
			rating: page.rating,
		};
	}

	private async profileFreshInk(ctx: HttpContext, subject: DiscoverSubject) {
		const query = await ctx.request.validateUsing(
			listDiscoverProfilePageValidator,
			{ data: ctx.request.qs() },
		);
		const page = found(
			await this.reviews.freshInk(subject, {
				cursor: cursorOf(query.cursor, "newest"),
				limit: query.limit ?? DISCOVER_PAGE_SIZE,
			}),
		);
		return { data: page.items, nextCursor: page.nextCursor };
	}

	/**
	 * The sitemap lists (D10): identifiers only, by id, keyset-paged. Each
	 * page also counts against `discoverSitemap`: up to 5,000 rows a read.
	 */
	async sitemap(ctx: HttpContext) {
		const query = await ctx.request.validateUsing(
			listDiscoverSitemapValidator,
			{ data: ctx.request.qs() },
		);
		await consumeApiLimit("discoverSitemap", callerOf(ctx));
		const page = {
			after: query.cursor ?? null,
			limit: query.limit ?? SITEMAP_PAGE_SIZE,
		};
		const kind: string = ctx.params.kind;
		const result =
			kind === "studios"
				? await this.discovery.sitemapStudios(page)
				: kind === "artists"
					? await this.discovery.sitemapArtists(page)
					: await this.discovery.sitemapTattoos(page);
		return { data: result.items, nextCursor: result.nextCursor };
	}

	async styles() {
		return { data: this.discovery.styles() };
	}

	async locations() {
		return { data: await this.discovery.locations() };
	}
}

/** The resource, or the API's 404: Discover says nothing about rows it does not show. */
function found<T>(value: T | null): T {
	if (value === null) throw ApiException.notFound();
	return value;
}

/** A city's slug is unique per country only: it needs its country. */
function checkCity(query: { country?: string; city?: string }) {
	if (query.city && !query.country) {
		throw new errors.E_VALIDATION_ERROR([
			{ field: "city", message: CITY_MESSAGE, rule: "requiredWith" },
		]);
	}
}

/** The decoded cursor, or the 422 on `cursor` for one that is not a cursor of this sort. */
function cursorOf(
	text: string | undefined,
	sort: DiscoverSort,
): DiscoverCursor | null {
	if (text === undefined) return null;
	const cursor = decodeDiscoverCursor(text, sort);
	if (!cursor) {
		throw new errors.E_VALIDATION_ERROR([
			{ field: "cursor", message: CURSOR_MESSAGE, rule: "cursor" },
		]);
	}
	return cursor;
}
