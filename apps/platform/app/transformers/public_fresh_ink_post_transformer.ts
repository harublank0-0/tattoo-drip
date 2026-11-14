import { BaseTransformer } from "@adonisjs/core/transformers";
import type { ShownFreshInkPost } from "#modules/reviews/services/public_review_service";

/**
 * A Fresh ink post as the studio's own page shows it (openapi.yaml,
 * FreshInkPost; Reviews and Fresh ink, slice 3), shaped like a gallery
 * tattoo: the lead photo's public copy, then its other photos and ready
 * videos (`angles`), field by field as PublicGalleryPhotoTransformer writes
 * them. Every field is written out here: a new one needs the contract, a
 * ruling and the exact-fields test. The post's own id is shown (the page's
 * cursor already carries it); never a key (private or public), a media row's
 * id, state or failure, the client's id, full name, phone or email, the
 * project's id, the consents, the status or the takedown record.
 */
export default class PublicFreshInkPostTransformer extends BaseTransformer<ShownFreshInkPost> {
	toObject() {
		const post = this.resource;
		return {
			id: post.id,
			url: post.url,
			width: post.width,
			height: post.height,
			alt: post.alt,
			variants: post.variants.map(({ url, width }) => ({ url, width })),
			angles: post.angles.map((angle) =>
				angle.kind === "video"
					? {
							kind: "video" as const,
							poster: {
								url: angle.poster.url,
								width: angle.poster.width,
								height: angle.poster.height,
								alt: angle.poster.alt,
								variants: angle.poster.variants.map(({ url, width }) => ({
									url,
									width,
								})),
							},
							sources: angle.sources.map(({ url, type, width, height }) => ({
								url,
								type,
								width,
								height,
							})),
							durationMs: angle.durationMs,
							alt: angle.alt,
						}
					: {
							kind: "photo" as const,
							url: angle.url,
							width: angle.width,
							height: angle.height,
							alt: angle.alt,
							variants: angle.variants.map(({ url, width }) => ({
								url,
								width,
							})),
						},
			),
			shownName: post.shownName,
			caption: post.caption,
			styles: post.styles.map(({ slug, name }) => ({ slug, name })),
			placement: post.placement,
			artist: post.artist
				? { slug: post.artist.slug, name: post.artist.name }
				: null,
			date: post.date,
		};
	}
}
