import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	ArtistProfileExistsError,
	ArtistSlugTakenError,
} from "#modules/artists/errors";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService, {
	type ArtistInput,
} from "#modules/artists/services/artist_service";
import {
	createArtistValidator,
	updateArtistValidator,
} from "#modules/artists/validators/artist";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";

/**
 * The studio's artist profiles, managed by its owners. Every :id loads
 * through findFor(tenant, id), so another tenant's artist is a 404.
 */
@inject()
export default class ArtistsController {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;
		const list = await this.artists.list(tenant);

		return ctx.inertia.render("artists/index", {
			artists: await Promise.all(
				list.map((artist) => this.toProps(tenant, artist, userId)),
			),
		});
	}

	async create(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;

		return ctx.inertia.render("artists/form", {
			artist: null,
			canLink: !(await this.hasProfile(tenant, userId)),
		});
	}

	async store(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		const data = await ctx.request.validateUsing(createArtistValidator);

		const artist = await asFieldErrors(() =>
			this.artists.create(tenant, toInput(data), user),
		);

		ctx.session.flash("success", `"${artist.name}" added.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	async edit(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;
		const artist = await this.artists.findFor(tenant, ctx.params.id);
		// Linking has to succeed: not to someone else's profile, and not a
		// second profile for the same person.
		const canLink =
			artist.userId === userId ||
			(artist.userId === null && !(await this.hasProfile(tenant, userId)));

		return ctx.inertia.render("artists/form", {
			artist: await this.toProps(tenant, artist, userId),
			canLink,
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		// Load first: another tenant's id is a 404 even with a bad body.
		const artist = await this.artists.findFor(tenant, ctx.params.id);
		const data = await ctx.request.validateUsing(updateArtistValidator);

		const saved = await asFieldErrors(() =>
			this.artists.update(tenant, artist, toInput(data), user),
		);

		ctx.session.flash("success", `"${saved.name}" saved.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const artist = await this.artists.findFor(tenant, ctx.params.id);

		await this.artists.delete(tenant, artist);

		ctx.session.flash("success", `"${artist.name}" deleted.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.artists", { tenant: tenant.slug });
	}

	/**
	 * Whether the user already has a live profile in the tenant.
	 */
	private async hasProfile(tenant: { id: string }, userId: string) {
		const list = await this.artists.list(tenant);
		return list.some((artist) => artist.userId === userId);
	}

	/**
	 * What the pages get for one artist, with the photo's public URL. Not the
	 * row: the tenant and the linked user's id stay on the server.
	 */
	private async toProps(tenant: Tenant, artist: Artist, userId: string) {
		return {
			id: artist.id,
			name: artist.name,
			slug: artist.slug,
			bio: artist.bio,
			photoUrl: artist.photoKey
				? await this.images.url("artist_photo", artist.photoKey, tenant)
				: null,
			visible: artist.visible,
			acceptingInquiries: artist.acceptingInquiries,
			closedMessage: artist.closedMessage,
			isMine: artist.userId === userId,
		};
	}
}

/**
 * The service's input from the validated body. A checkbox that is not
 * checked is not sent at all, so a missing boolean means off.
 */
function toInput(data: Infer<typeof updateArtistValidator>): ArtistInput {
	return {
		name: data.name,
		slug: data.slug,
		bio: data.bio ?? null,
		visible: data.visible ?? false,
		acceptingInquiries: data.acceptingInquiries ?? false,
		closedMessage: data.closedMessage ?? null,
		linkToMe: data.linkToMe ?? false,
		photo: data.photo,
		removePhoto: data.removePhoto ?? false,
	};
}

function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}

/**
 * Turns the service's conflicts and an unusable image into field errors, so
 * the form shows them next to their inputs.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof ArtistSlugTakenError) {
			throw fieldError(
				"slug",
				"This link is already used by another artist.",
				"unique",
			);
		}
		if (error instanceof ArtistProfileExistsError) {
			throw fieldError("linkToMe", "You already have a profile.", "unique");
		}
		if (error instanceof InvalidImageError) {
			throw fieldError("photo", error.message, "image");
		}
		throw error;
	}
}
