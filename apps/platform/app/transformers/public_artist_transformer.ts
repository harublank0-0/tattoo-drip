import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownArtist } from "#modules/storefront/services/studio_page_service";

/**
 * A visible artist as the public API shows it (openapi.yaml, Artist;
 * TAT-44). Every field is written out here: a new one needs the contract, a
 * ruling and the exact-fields test. Never the linked user, the visible
 * flag, the photo key or timestamps.
 */
export default class PublicArtistTransformer extends BaseTransformer<ShownArtist> {
	toObject() {
		const artist = this.resource;
		return {
			id: artist.id,
			slug: artist.slug,
			name: artist.name,
			bio: artist.bio,
			photo: artist.photo
				? {
						url: artist.photo.url,
						width: artist.photo.width,
						height: artist.photo.height,
					}
				: null,
			acceptingInquiries: artist.acceptingInquiries,
			closedMessage: artist.closedMessage,
		};
	}
}
