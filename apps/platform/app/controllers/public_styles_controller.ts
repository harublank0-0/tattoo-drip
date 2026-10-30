import type { HttpContext } from "@adonisjs/core/http";
import { TATTOO_STYLES } from "#modules/artists/styles";
import PublicStyleTransformer from "#transformers/public_style_transformer";

/**
 * The platform's tattoo styles on the public API (listStyles in
 * openapi.yaml, TAT-126): the fixed list, in its order. Under no studio, so
 * nothing is read from the database.
 */
export default class PublicStylesController {
	async index(ctx: HttpContext) {
		return ctx.serialize(PublicStyleTransformer.transform([...TATTOO_STYLES]));
	}
}
