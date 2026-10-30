import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { decodeWorkCursor } from "#modules/artists/work_cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import { listFlashValidator } from "#modules/storefront/validators/flash";
import {
	CURSOR_MESSAGE,
	WORK_PAGE_SIZE,
} from "#modules/storefront/validators/work";
import { ApiException } from "#services/public_api_errors";
import PublicFlashDesignTransformer from "#transformers/public_flash_design_transformer";

/**
 * The studio's flash designs on the public API (listFlash and getFlashDesign
 * in openapi.yaml, TAT-129): a page of the visible artists' shown designs,
 * newest first, with the cursor of the next page and the artists the page can
 * be narrowed to, and one design by id. Only the query string is read; a
 * refused parameter or cursor is the 422 validation_failed with that field.
 */
@inject()
export default class PublicFlashController {
	constructor(private pages: StudioPageService) {}

	async index(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const query = await ctx.request.validateUsing(listFlashValidator, {
			data: ctx.request.qs(),
		});
		// decodeWorkCursor takes the validator's string only.
		const cursor =
			query.cursor === undefined ? null : decodeWorkCursor(query.cursor);
		if (query.cursor !== undefined && cursor === null) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "cursor", message: CURSOR_MESSAGE, rule: "cursor" },
			]);
		}
		const page = await this.pages.flash(tenant, {
			artist: query.artist ?? null,
			cursor,
			limit: query.limit ?? WORK_PAGE_SIZE,
		});
		// serialize wraps only `data`: the cursor and the filters join it.
		return {
			...(await ctx.serialize(
				PublicFlashDesignTransformer.transform(page.designs),
			)),
			nextCursor: page.nextCursor,
			filters: {
				artists: page.filters.artists.map(({ slug, name }) => ({ slug, name })),
			},
		};
	}

	/** `:design` is a UUID (the router's 404 otherwise); hidden and unknown designs are the 404 here. */
	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const design = await this.pages.flashDesign(tenant, ctx.params.design);
		if (!design) throw ApiException.notFound();
		return ctx.serialize(PublicFlashDesignTransformer.transform(design));
	}
}
