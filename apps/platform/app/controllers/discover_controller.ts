import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import {
	type DiscoverCursor,
	type DiscoverSort,
	decodeDiscoverCursor,
} from "#modules/discovery/cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DiscoveryService from "#modules/discovery/services/discovery_service";
import {
	CITY_MESSAGE,
	CURSOR_MESSAGE,
	DISCOVER_PAGE_SIZE,
	listDiscoverArtistsValidator,
	listDiscoverStudiosValidator,
	listDiscoverTattoosValidator,
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
	constructor(private discovery: DiscoveryService) {}

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
		const page = await this.discovery.tattoos({
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
