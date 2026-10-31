import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { decodeWorkCursor } from "#modules/artists/work_cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioPageService from "#modules/storefront/services/studio_page_service";
import {
	CURSOR_MESSAGE,
	listWorkValidator,
	WORK_PAGE_SIZE,
} from "#modules/storefront/validators/work";
import PublicGalleryPhotoTransformer from "#transformers/public_gallery_photo_transformer";

/**
 * The studio's gallery on the public API (listWork in openapi.yaml,
 * TAT-126): a page of the visible artists' photos, newest first, with the
 * cursor of the next page and the filters the gallery can offer. Only the
 * query string is read; a refused parameter or cursor is the 422
 * validation_failed with that field.
 */
@inject()
export default class PublicWorkController {
	constructor(private pages: StudioPageService) {}

	async index(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const query = await ctx.request.validateUsing(listWorkValidator, {
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
		const page = await this.pages.work(tenant, {
			artist: query.artist ?? null,
			style: query.style ?? null,
			healed: query.healed ?? false,
			cursor,
			limit: query.limit ?? WORK_PAGE_SIZE,
		});
		// serialize wraps only `data`: the cursor and the filters join it.
		return {
			...(await ctx.serialize(
				PublicGalleryPhotoTransformer.transform(page.photos),
			)),
			nextCursor: page.nextCursor,
			filters: {
				styles: page.filters.styles.map(({ slug, name }) => ({ slug, name })),
				healed: page.filters.healed,
			},
		};
	}
}
