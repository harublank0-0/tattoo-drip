import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	TattooChangedError,
	TattooPhotoLimitError,
	VideoLeadError,
	WorkPhotoLimitError,
} from "#modules/artists/errors";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import {
	portfolioBack,
	TATTOO_CHANGED_SINCE,
} from "#modules/artists/portfolio";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService, {
	MAX_TATTOO_PHOTOS,
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import {
	addWorkPhotoValidator,
	orderWorkPhotosValidator,
	removeWorkPhotoValidator,
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
 * Every write goes back to the edit page, or to the portfolio (Studio OS)
 * when the body's `back` is this studio's portfolio address (portfolioBack).
 *
 * Angles: the upload's `lead` adds the photo to that tattoo; `order` puts a
 * tattoo's photos in a new order (its lead first) and `ungroup` takes one
 * angle out of its tattoo, both naming a photo in the URL and loading it
 * before the body is read, like the others. Removing a lead removes its
 * whole tattoo (WorkPhotoService.remove), and the flash says how many photos
 * went.
 */
@inject()
export default class WorkPhotosController {
	constructor(
		private photos: WorkPhotoService,
		private artists: ArtistService,
	) {}

	/**
	 * `:id` is the artist. With `lead`, the photo goes into that tattoo as its
	 * last angle: the lead must be the editor's to change and this artist's
	 * (anything else is the 404 another studio's id gets), and the tattoo's
	 * room and the artist's are checked again under the lock.
	 */
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(addWorkPhotoValidator);
		let lead: ArtistWorkPhoto | null = null;
		if (data.lead !== undefined) {
			lead = (await this.photos.findEditable(tenant, membership, data.lead))
				.photo;
			// Another artist's tattoo is the same 404 as another studio's.
			if (lead.artistId !== artist.id) {
				throw new lucidErrors.E_ROW_NOT_FOUND(ArtistWorkPhoto);
			}
		}

		await asFieldErrors(() =>
			this.photos.add(
				tenant,
				membership,
				artist,
				data.photo,
				{
					alt: data.alt ?? null,
					styles: data.styles ?? [],
					healed: data.healed ?? false,
					hidden: data.hidden ?? false,
				},
				lead,
			),
		);

		// The portfolio's upload says what its queue added in its own panel,
		// so one toast per file would only pile up over it.
		if (!portfolioBack(ctx.request.input("back"), tenant.slug)) {
			ctx.session.flash("success", "Photo added.");
		}
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

	/**
	 * `:id` is the photo. The query says what the page asked to remove
	 * (`scope`: `photo`, one angle, or `tattoo` with the `photos` it showed):
	 * a tattoo that changed since is not touched, and the flash says so.
	 */
	async destroy(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo, artist } = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(removeWorkPhotoValidator);
		const intent =
			data.scope === "photo"
				? ({ scope: "photo" } as const)
				: ({ scope: "tattoo", photos: data.photos ?? 0 } as const);

		let removed: number;
		try {
			removed = await this.photos.remove(tenant, membership, photo, intent);
		} catch (error) {
			if (error instanceof TattooChangedError) {
				ctx.session.flash("error", TATTOO_CHANGED_SINCE);
				return this.toEditPage(ctx, tenant.slug, artist.id);
			}
			// A file could not be deleted: the photo stays (and is still public),
			// so say so and let the owner try again.
			if (!(error instanceof ImageDeleteError)) throw error;
			ctx.session.flash("error", "Couldn't remove the photo, try again.");
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}

		ctx.session.flash(
			"success",
			removed > 1 ? `Tattoo removed: ${removed} photos.` : "Photo removed.",
		);
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/**
	 * `:id` is a tattoo's lead. Puts its photos in the order of `ids` (every
	 * photo of the tattoo once, the new main photo first). A tattoo that
	 * changed meanwhile is not reordered: the flash says so and the page shows
	 * it as it is now.
	 */
	async order(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo, artist } = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(orderWorkPhotosValidator);

		try {
			await this.photos.arrange(tenant, membership, photo, data.ids);
		} catch (error) {
			if (error instanceof VideoLeadError) {
				ctx.session.flash("error", VIDEO_LEADS);
				return this.toEditPage(ctx, tenant.slug, artist.id);
			}
			if (!(error instanceof TattooChangedError)) throw error;
			ctx.session.flash("error", TATTOO_CHANGED);
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}
		ctx.session.flash("success", "Order saved.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/** `:id` is an angle: it leaves its tattoo and becomes a tattoo of its own. */
	async ungroup(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo, artist } = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);

		try {
			await this.photos.ungroup(tenant, membership, photo);
		} catch (error) {
			if (error instanceof VideoLeadError) {
				ctx.session.flash("error", VIDEO_ALONE);
				return this.toEditPage(ctx, tenant.slug, artist.id);
			}
			if (!(error instanceof TattooChangedError)) throw error;
			ctx.session.flash("error", TATTOO_CHANGED);
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}
		ctx.session.flash(
			"success",
			"Removed from the tattoo. It is now a tattoo of its own.",
		);
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	private toEditPage(ctx: HttpContext, tenantSlug: string, artistId: string) {
		const back = portfolioBack(ctx.request.input("back"), tenantSlug);
		// The address is the whole answer: this request's own query (a delete
		// names `back` and what it removes there) is never carried over.
		if (back) return ctx.response.redirect().withQs(false).toPath(back);
		return ctx.response
			.redirect()
			.withQs(false)
			.toRoute("tenant.artists.edit", { tenant: tenantSlug, id: artistId });
	}
}

/** Video angles: why a video can't be put first, nor taken out on its own (nothing changes). */
const VIDEO_LEADS =
	"A video can't be a tattoo's main photo, so nothing was changed.";
const VIDEO_ALONE =
	"A video stays with its tattoo, so nothing was changed. To take it off, delete it.";

/** What a write on a tattoo that changed meanwhile says. */
const TATTOO_CHANGED =
	"This tattoo changed meanwhile, so nothing was changed. Here it is as it is now: try again.";

/**
 * Turns the limits, a tattoo that changed and an unusable image into a field
 * error, so the tray and the upload show it next to their input.
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
		if (error instanceof TattooPhotoLimitError) {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "photo",
					message: `This tattoo already has ${MAX_TATTOO_PHOTOS} photos. Remove one to add another.`,
					rule: "limit",
				},
			]);
		}
		if (error instanceof TattooChangedError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "photo", message: TATTOO_CHANGED, rule: "tattoo" },
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
