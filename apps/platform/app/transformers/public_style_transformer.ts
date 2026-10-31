import { BaseTransformer } from "@adonisjs/core/transformers";
import type { TattooStyleRef } from "#modules/artists/styles";

/** A tattoo style as the public API shows it (openapi.yaml, TattooStyle): slug and name. */
export default class PublicStyleTransformer extends BaseTransformer<TattooStyleRef> {
	toObject() {
		const { slug, name } = this.resource;
		return { slug, name };
	}
}
