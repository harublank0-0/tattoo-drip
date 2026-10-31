import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownGalleryPhoto } from "#modules/storefront/services/studio_page_service";

/**
 * A photo of the studio's gallery as the public API shows it (openapi.yaml,
 * GalleryPhoto; TAT-126). Every field is written out here: a new one needs
 * the contract, a ruling and the exact-fields test. Never the photo's id or
 * key, the artist's id or the timestamps (the page's cursor is the only
 * trace of the time).
 */
export default class PublicGalleryPhotoTransformer extends BaseTransformer<ShownGalleryPhoto> {
	toObject() {
		const photo = this.resource;
		return {
			url: photo.url,
			width: photo.width,
			height: photo.height,
			alt: photo.alt,
			variants: photo.variants.map(({ url, width }) => ({ url, width })),
			styles: photo.styles.map(({ slug, name }) => ({ slug, name })),
			healed: photo.healed,
			artist: { slug: photo.artist.slug, name: photo.artist.name },
		};
	}
}
