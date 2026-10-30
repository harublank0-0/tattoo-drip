import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownFlashDesign } from "#modules/storefront/services/studio_page_service";

/**
 * A flash design as the public API shows it (openapi.yaml, FlashDesign;
 * TAT-129). Every field is written out here: a new one needs the contract, a
 * ruling and the exact-fields test. Never the design's key, hidden flag or
 * timestamps, nor the artist's id.
 */
export default class PublicFlashDesignTransformer extends BaseTransformer<ShownFlashDesign> {
	toObject() {
		const design = this.resource;
		return {
			id: design.id,
			name: design.name,
			size: design.size,
			price: design.price
				? {
						amount: design.price.amount,
						currency: design.price.currency,
						text: design.price.text,
					}
				: null,
			image: {
				url: design.image.url,
				width: design.image.width,
				height: design.image.height,
				variants: design.image.variants.map(({ url, width }) => ({
					url,
					width,
				})),
			},
			artist: { slug: design.artist.slug, name: design.artist.name },
			requestable: design.requestable,
		};
	}
}
