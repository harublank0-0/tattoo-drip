import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { WorkPhotoLimitError } from "#modules/artists/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService, {
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import {
	addWorkPhotoValidator,
	updateWorkPhotoValidator,
} from "#modules/artists/validators/work_photo";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";

/**
 * An artist's work photos (TAT-116, TAT-126), changed from the artist's edit
 * page by owners (any live artist) and by the artist (their own linked
 * profile): TENANT_ROUTE_ROLES lets every member reach the routes and
 * WorkPhotoService / ArtistService.findEditable decide whose photos. Each
 * route loads first and validates after, so another tenant's artist or
 * photo, or another artist's for an artist member, is a 404 with any body.
 * Every write goes back to the edit page.
 */
@inject()
export default class WorkPhotosController {
	constructor(
		private photos: WorkPhotoService,
		private artists: ArtistService,
	) {}

	/** `:id` is the artist. */
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(addWorkPhotoValidator);

		await asFieldErrors(() =>
			this.photos.add(tenant, membership, artist, data.photo),
		);

		ctx.session.flash("success", "Photo added.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/**
	 * `:id` is the photo. Saves its description, styles and healed mark. A
	 * checkbox that is not ticked is not sent, so no style box means no styles
	 * and no healed box means not healed.
	 */
	async update(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo, artist } = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(updateWorkPhotoValidator);

		await this.photos.updateDetails(tenant, membership, photo, {
			alt: data.alt,
			styles: data.styles ?? [],
			healed: data.healed ?? false,
		});

		ctx.session.flash("success", "Photo saved.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/** `:id` is the photo. */
	async destroy(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo, artist } = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);

		try {
			await this.photos.remove(tenant, membership, photo);
		} catch (error) {
			// A file could not be deleted: the photo stays (and is still public),
			// so say so and let the owner try again.
			if (!(error instanceof ImageDeleteError)) throw error;
			ctx.session.flash("error", "Couldn't remove the photo, try again.");
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}

		ctx.session.flash("success", "Photo removed.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	private toEditPage(ctx: HttpContext, tenantSlug: string, artistId: string) {
		return ctx.response
			.redirect()
			.toRoute("tenant.artists.edit", { tenant: tenantSlug, id: artistId });
	}
}

/**
 * Turns the limit and an unusable image into a field error, so the tray
 * shows it next to its input.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof WorkPhotoLimitError) {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "photo",
					message: `This artist already has ${MAX_WORK_PHOTOS} photos. Remove one to add another.`,
					rule: "limit",
				},
			]);
		}
		if (error instanceof InvalidImageError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "photo", message: error.message, rule: "image" },
			]);
		}
		throw error;
	}
}
