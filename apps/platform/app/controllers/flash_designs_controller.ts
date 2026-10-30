import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	FlashInUseError,
	FlashLimitError,
	FlashRuleError,
} from "#modules/flash/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import FlashService, {
	MAX_FLASH_DESIGNS,
} from "#modules/flash/services/flash_service";
import {
	addFlashDesignValidator,
	claimFlashDesignValidator,
	updateFlashDesignValidator,
} from "#modules/flash/validators/flash_design";
import { InvalidImageError } from "#modules/media/errors";

/**
 * An artist's flash designs (TAT-129), changed from the artist's edit page by
 * owners (any live artist) and by the artist (their own linked profile):
 * TENANT_ROUTE_ROLES lets every member reach the routes and FlashService /
 * ArtistService.findEditable decide whose designs. Each route loads first and
 * validates after, so another tenant's artist or design, or another artist's
 * for an artist member, is a 404 with any body. Every write goes back to the
 * edit page.
 */
@inject()
export default class FlashDesignsController {
	constructor(
		private flash: FlashService,
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
		const data = await ctx.request.validateUsing(addFlashDesignValidator);

		await asFieldErrors(() =>
			this.flash.add(tenant, membership, artist, data.picture, {
				name: data.name,
				size: data.size,
				price: toPaisa(data.price),
				oneOfAKind: data.oneOfAKind ?? false,
			}),
		);

		ctx.session.flash("success", "Design added.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/**
	 * `:id` is the design. Saves its words, price, whether it is one of a kind
	 * and whether it is shown; an unchecked box is not sent, so a missing
	 * "shown" hides the design and a missing "one of a kind" makes it
	 * repeatable (which clears a claim on it).
	 */
	async update(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { design, artist } = await this.flash.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(updateFlashDesignValidator);

		await this.flash.update(tenant, membership, design, {
			name: data.name,
			size: data.size,
			price: toPaisa(data.price),
			oneOfAKind: data.oneOfAKind ?? false,
			hidden: !(data.shown ?? false),
		});

		ctx.session.flash("success", "Design saved.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/**
	 * `:id` is the design. The one-tap claim: "Mark claimed" (`claimed` true)
	 * and "Make available" (false). A design that can be tattooed again is
	 * never claimed: the error flash says so and nothing changes.
	 */
	async claim(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { design, artist } = await this.flash.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		const data = await ctx.request.validateUsing(claimFlashDesignValidator);

		try {
			await this.flash.setClaimed(tenant, membership, design, data.claimed);
		} catch (error) {
			if (!(error instanceof FlashRuleError)) throw error;
			ctx.session.flash(
				"error",
				"A design that can be tattooed again is never claimed.",
			);
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}

		ctx.session.flash(
			"success",
			data.claimed ? "Marked claimed." : "Available again.",
		);
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	/** `:id` is the design. */
	async destroy(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { design, artist } = await this.flash.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);

		let outcome: Awaited<ReturnType<FlashService["remove"]>>;
		try {
			outcome = await this.flash.remove(tenant, membership, design);
		} catch (error) {
			// A request or a project names the design: it stays, hidden if the
			// studio wants.
			if (!(error instanceof FlashInUseError)) throw error;
			ctx.session.flash(
				"error",
				"Clients asked for this design, so it can't be removed. Hide it instead.",
			);
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}
		if (outcome === "hidden") {
			// A file could not be deleted and the design is hidden now (the hide is
			// committed with this request), so a client can't ask for it.
			ctx.session.flash(
				"error",
				"Some of this design's files couldn't be removed. It's hidden now; try Remove again.",
			);
			return this.toEditPage(ctx, tenant.slug, artist.id);
		}

		ctx.session.flash("success", "Design removed.");
		return this.toEditPage(ctx, tenant.slug, artist.id);
	}

	private toEditPage(ctx: HttpContext, tenantSlug: string, artistId: string) {
		return ctx.response
			.redirect()
			.toRoute("tenant.artists.edit", { tenant: tenantSlug, id: artistId });
	}
}

/** The form's whole rupees as the paisa the table stores; empty is no price. */
function toPaisa(rupees: number | null | undefined): number | null {
	return rupees == null ? null : rupees * 100;
}

/**
 * Turns the limit and an unusable image into a field error on the picture, so
 * the tray shows it next to its input.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof FlashLimitError) {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "picture",
					message: `This artist already has ${MAX_FLASH_DESIGNS} flash designs. Remove one to add another.`,
					rule: "limit",
				},
			]);
		}
		if (error instanceof InvalidImageError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "picture", message: error.message, rule: "image" },
			]);
		}
		throw error;
	}
}
