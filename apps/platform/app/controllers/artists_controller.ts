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
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService from "#modules/artists/services/work_photo_service";
import {
	createArtistValidator,
	updateArtistValidator,
} from "#modules/artists/validators/artist";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { artistLink } from "#services/studio_links";

/**
 * The studio's artist profiles. Owners manage every one; an artist edits
 * only the profile linked to them (TAT-30: TENANT_ROUTE_ROLES lets them
 * reach edit, update and mine, and ArtistService.findEditable decides
 * which profile). Every :id loads through the service first, so another
 * tenant's artist, or another artist's, is a 404.
 */
@inject()
export default class ArtistsController {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
		private workPhotos: WorkPhotoService,
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

	/**
	 * The member's own profile (TAT-30): its edit page. Without one, an
	 * owner goes to the list and an artist to Projects with a note (straight
	 * there: a flash doesn't survive a second redirect).
	 */
	async mine(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const profile = await this.artists.profileOf(tenant, membership.userId);
		if (profile) {
			return ctx.response.redirect().toRoute("tenant.artists.edit", {
				tenant: tenant.slug,
				id: profile.id,
			});
		}
		if (membership.role === "owner") {
			return ctx.response
				.redirect()
				.toRoute("tenant.artists", { tenant: tenant.slug });
		}
		ctx.session.flash(
			"error",
			`No artist profile is linked to you in ${tenant.name} yet. Ask an owner to link one.`,
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.projects.index", { tenant: tenant.slug });
	}

	async create(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const userId = ctx.auth.getUserOrFail().id;

		return ctx.inertia.render("artists/form", {
			artist: null,
			canLink: !(await this.hasProfile(tenant, userId)),
			// Photos come once the artist is saved (TAT-116).
			workPhotos: [],
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
		const { tenant, membership } = tenantContext(ctx);
		const userId = membership.userId;
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		// Linking has to succeed: not to someone else's profile, and not a
		// second profile for the same person. Artists never link or unlink.
		const canLink =
			membership.role === "owner" &&
			(artist.userId === userId ||
				(artist.userId === null && !(await this.hasProfile(tenant, userId))));

		// The artist's work photos (TAT-116), loaded after findEditable: only
		// what the tray draws, each as its 320 px copy.
		const photos = await this.workPhotos.list(tenant, artist);
		const workPhotos = await Promise.all(
			photos.map(async (photo) => ({
				id: photo.id,
				thumbnailUrl: await this.images.urlFor(
					"artist_work_photo",
					photo.imageKey,
					tenant,
					THUMBNAIL_WIDTH,
				),
				alt: photo.alt,
			})),
		);

		return ctx.inertia.render("artists/form", {
			artist: await this.toProps(tenant, artist, userId),
			canLink,
			workPhotos,
		});
	}

	async update(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const user = ctx.auth.getUserOrFail();
		// Load first: another tenant's id, or a profile that isn't the
		// artist's, is a 404 even with a bad body.
		const artist = await this.artists.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(updateArtistValidator);
		const input = toInput(data);
		const owner = membership.role === "owner";

		const saved = await asFieldErrors(() =>
			owner
				? this.artists.update(tenant, artist, input, user)
				: this.artists.updateOwn(tenant, user.id, artist, input),
		);

		ctx.session.flash("success", `"${saved.name}" saved.`);
		return owner
			? ctx.response
					.redirect()
					.toRoute("tenant.artists", { tenant: tenant.slug })
			: ctx.response.redirect().toRoute("tenant.artists.edit", {
					tenant: tenant.slug,
					id: saved.id,
				});
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
		return (await this.artists.profileOf(tenant, userId)) !== null;
	}

	/**
	 * What the pages get for one artist, with the photo's public URL (its 320 px
	 * copy, TAT-112). Not the
	 * row: the tenant and the linked user's id stay on the server.
	 */
	private async toProps(tenant: Tenant, artist: Artist, userId: string) {
		return {
			id: artist.id,
			name: artist.name,
			slug: artist.slug,
			bio: artist.bio,
			// The 320 px copy: the list and form draw it at 64 and 96 px.
			photoUrl: artist.photoKey
				? await this.images.urlFor(
						"artist_photo",
						artist.photoKey,
						tenant,
						THUMBNAIL_WIDTH,
					)
				: null,
			visible: artist.visible,
			acceptingInquiries: artist.acceptingInquiries,
			closedMessage: artist.closedMessage,
			isMine: artist.userId === userId,
			// The artist's own page (TAT-101); a hidden artist has none.
			pageUrl: artist.visible ? artistLink(tenant.slug, artist.slug) : null,
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
