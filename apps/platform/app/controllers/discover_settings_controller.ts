import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	ARTIST_STATE_WORDS,
	DISCOVER_RECOMMENDED,
	listingConsent,
	type ReadinessAction,
	STATUS_WORDS,
} from "#modules/discovery/publication";
import PublicationService, {
	type Place,
	PublicationError,
} from "#modules/discovery/services/publication_service";
import {
	discoverPlaceValidator,
	enableListingValidator,
} from "#modules/discovery/validators/publication";

/** Where a checklist item is fixed: a route of Studio OS, or this page's city form. */
type Target = { route: string; params: Record<string, string>; hash?: string };

/**
 * Settings, Discover (Discover D04, docs/discover/publication-controls.md):
 * the owner's listing on TattooDrip Discover, its consent and city, the
 * readiness checklist, the artists' Discover state and a preview. Owners
 * only (the settings group's role check). Every answer is read again after
 * a write, so the page only ever shows what the database holds.
 */
@inject()
export default class DiscoverSettingsController {
	constructor(private publication: PublicationService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const overview = await this.publication.overview(tenant);
		const places = await this.publication.places();
		const consent = listingConsent(overview.type);
		const firstArtist = overview.artists[0]?.id;
		const target = (action: ReadinessAction): Target => {
			const params = { tenant: tenant.slug };
			switch (action) {
				case "discover_place":
					return { route: "tenant.settings.discover", params, hash: "city" };
				case "profile":
					return { route: "tenant.settings.profile", params };
				case "look":
					return { route: "tenant.settings.look", params };
				case "portfolio":
					return { route: "tenant.portfolio", params };
				case "artists":
					return overview.type === "independent" && firstArtist
						? {
								route: "tenant.artists.edit",
								params: { ...params, id: firstArtist },
							}
						: { route: "tenant.artists", params };
			}
		};

		return ctx.inertia.render("settings/discover", {
			business: {
				type: overview.type,
				name: tenant.name,
			},
			status: {
				key: overview.status,
				label: STATUS_WORDS[overview.status].label,
				summary: STATUS_WORDS[overview.status].summary(overview.type),
			},
			listing: {
				optedIn: overview.facts.optedIn,
				takenDown: overview.facts.takenDown,
				publiclyVisible: overview.facts.publiclyVisible,
				// The switch can be turned on once every required item holds.
				canEnable: overview.readiness.eligible,
			},
			consent: {
				...consent,
				accepted: overview.consent
					? {
							version: overview.consent.version,
							acceptedOn: overview.consent.acceptedAt
								.setZone(tenant.timezone)
								.toFormat("d LLL yyyy"),
							current: overview.consent.current,
						}
					: null,
			},
			place: overview.place ? placeOption(overview.place) : null,
			places: places.map(placeOption),
			readiness: {
				eligible: overview.readiness.eligible,
				complete: overview.readiness.complete,
				items: overview.readiness.items.map((item) => ({
					...item,
					target: target(item.action),
				})),
			},
			// An independent artist has one switch, the listing's: no artist list.
			artists:
				overview.type === "studio"
					? overview.artists.map((artist) => ({
							id: artist.id,
							name: artist.name,
							visible: artist.visible,
							discoveryListed: artist.discoveryListed,
							publishedPhotos: artist.publishedPhotos,
							state: artist.state,
							stateText: ARTIST_STATE_WORDS[artist.state],
						}))
					: [],
			recommended: DISCOVER_RECOMMENDED,
		});
	}

	async preview(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const overview = await this.publication.overview(tenant);
		return ctx.inertia.render("settings/discover_preview", {
			status: {
				key: overview.status,
				label: STATUS_WORDS[overview.status].label,
			},
			preview: await this.publication.preview(tenant),
		});
	}

	async updatePlace(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { placeId } = await ctx.request.validateUsing(discoverPlaceValidator);
		await asFieldErrors(() => this.publication.setPlace(tenant, placeId));
		ctx.session.flash("success", placeId ? "City saved." : "City removed.");
		return back(ctx, tenant.slug);
	}

	async enable(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		const { consentVersion } = await ctx.request.validateUsing(
			enableListingValidator,
		);
		await asFieldErrors(() =>
			this.publication.enable(tenant, user, consentVersion),
		);
		// The page reloads and shows the status the database gives, which a
		// takedown or a missing piece can still keep from "Listed".
		ctx.session.flash("success", "Listing turned on.");
		return back(ctx, tenant.slug);
	}

	async disable(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		await this.publication.disable(tenant);
		ctx.session.flash(
			"success",
			"Listing turned off. It leaves Discover within a few minutes; your page and bookings are unchanged.",
		);
		return back(ctx, tenant.slug);
	}
}

function placeOption(place: Place) {
	return {
		id: place.id,
		label: place.region
			? `${place.name}, ${place.region} (${place.countryCode})`
			: `${place.name} (${place.countryCode})`,
	};
}

function back(ctx: HttpContext, tenant: string) {
	return ctx.response
		.redirect()
		.toRoute("tenant.settings.discover", { tenant });
}

/** A PublicationError becomes the form's field error, like Vine's own. */
export async function asFieldErrors<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (!(error instanceof PublicationError)) throw error;
		throw new errors.E_VALIDATION_ERROR([
			{ field: error.field, message: error.message, rule: "publication" },
		]);
	}
}
