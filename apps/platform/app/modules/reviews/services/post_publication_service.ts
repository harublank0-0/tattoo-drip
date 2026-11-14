import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, { keyUnder } from "#modules/media/services/image_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService from "#modules/media/services/video_service";
import type ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import { postPublishable } from "#modules/reviews/rules";
import type Tenant from "#modules/tenancy/models/tenant";
import { afterRollback } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** The private purposes a post's files are stored under (ClientPostService). */
const PHOTO = "client_post_photo";
const VIDEO = "client_post_video";
/** Their public copies' purposes: the same names in these folders, on the public disk. */
export const PUBLIC_PHOTO_PURPOSE = "fresh_ink_photo";
export const PUBLIC_VIDEO_PURPOSE = "fresh_ink_video";

/** What a post's media need here: the files of a photo or a ready video. */
type MediaFiles = Pick<
	ClientPostMedia,
	"kind" | "imageKey" | "videoKeys" | "videoState"
>;

/**
 * Publishing a Fresh ink post (Reviews and Fresh ink, slice 2): a client's
 * photos and videos stay on the private disk until the post may show
 * (`postPublishable`: approved by the studio, a surface allowed by the
 * client, not taken down, not deleted). Then each photo (with its copies)
 * and each ready video (its renditions and its poster with the poster's
 * copies) is copied to the public disk under the same names in the public
 * purposes' folders (`keyUnder`), and `published_at` says the copies exist.
 * When the post may no longer show, the public copies are deleted first
 * (`deleteOrThrow`: a copy that can't be deleted fails the change, so a
 * post is never reported withdrawn while its files still answer) and
 * `published_at` is cleared in the same save as the change.
 *
 * Callers hold the project's and the post's row locks and run inside a
 * transaction. A publish registers the removal of its copies if the
 * transaction rolls back. Nothing reads the public copies yet: slice 3's
 * public reads take `published_at` and the surface's consent.
 */
@inject()
export default class PostPublicationService {
	constructor(
		private images: ImageService,
		private videos: VideoService,
	) {}

	/**
	 * Brings the public copies in line with the post as the caller changed it
	 * (not saved yet): copies when it may show and has none, deletes them when
	 * it may not and has them, then saves the post. `media` defaults to the
	 * post's items.
	 */
	async sync(
		tenant: TenantRef,
		post: ClientPost,
		media?: readonly MediaFiles[],
	): Promise<"published" | "withdrawn" | null> {
		const wanted = postPublishable(post);
		let change: "published" | "withdrawn" | null = null;
		if (wanted && !post.publishedAt) {
			await this.publish(
				tenant,
				post,
				media ?? (await this.mediaOf(tenant, post)),
			);
			change = "published";
		} else if (!wanted && post.publishedAt) {
			await this.withdraw(
				tenant,
				post,
				media ?? (await this.mediaOf(tenant, post)),
			);
			change = "withdrawn";
		}
		await post.save();
		return change;
	}

	/**
	 * Copies the post's photos and ready videos to the public disk and sets
	 * `publishedAt` (not saved). Items still processing or failed have no
	 * files and are skipped. A rollback deletes the copies.
	 */
	async publish(
		tenant: TenantRef,
		post: ClientPost,
		media: readonly MediaFiles[],
	): Promise<void> {
		for (const item of media) {
			if (item.kind === "photo" && item.imageKey) {
				const key = item.imageKey;
				afterRollback(() =>
					this.images.delete(
						PUBLIC_PHOTO_PURPOSE,
						keyUnder(key, PHOTO, PUBLIC_PHOTO_PURPOSE),
					),
				);
				await this.images.copyTo(PHOTO, PUBLIC_PHOTO_PURPOSE, key, tenant);
			} else if (
				item.kind === "video" &&
				item.videoState === "ready" &&
				item.imageKey
			) {
				const poster = item.imageKey;
				const keys = item.videoKeys ?? [];
				afterRollback(() =>
					this.videos.removeFiles(
						keyUnder(poster, VIDEO, PUBLIC_VIDEO_PURPOSE),
						keys.map((key) => keyUnder(key, VIDEO, PUBLIC_VIDEO_PURPOSE)),
						PUBLIC_VIDEO_PURPOSE,
					),
				);
				await this.videos.copyTo(
					tenant,
					poster,
					keys,
					VIDEO,
					PUBLIC_VIDEO_PURPOSE,
				);
			}
		}
		post.publishedAt = DateTime.now();
	}

	/**
	 * Deletes the public copies of these items, or throws ImageDeleteError
	 * (VideoDeleteError for a video) naming what is left, and clears
	 * `publishedAt` (not saved). A file already gone counts as deleted, so it
	 * may run on a post that was never published (the deletes, `erase`). When
	 * the post was published, a rollback copies the files back from the
	 * private originals (best effort, logged), so storage and `published_at`
	 * agree again.
	 */
	async withdraw(
		tenant: TenantRef,
		post: ClientPost,
		media: readonly MediaFiles[],
	): Promise<void> {
		if (post.publishedAt !== null) {
			const items = [...media];
			afterRollback(() => this.republish(tenant, post.id, items));
		}
		for (const key of publicKeys(media).photos) {
			await this.images.deleteOrThrow(PUBLIC_PHOTO_PURPOSE, key);
		}
		for (const video of publicKeys(media).videos) {
			await this.videos.deleteOrThrow(
				tenant,
				video.posterKey,
				video.keys,
				PUBLIC_VIDEO_PURPOSE,
			);
		}
		post.publishedAt = null;
	}

	/** A rolled-back withdrawal's copies made again; a failure is logged, never thrown. */
	private async republish(
		tenant: TenantRef,
		postId: string,
		media: readonly MediaFiles[],
	): Promise<void> {
		for (const item of media) {
			try {
				if (item.kind === "photo" && item.imageKey) {
					await this.images.copyTo(
						PHOTO,
						PUBLIC_PHOTO_PURPOSE,
						item.imageKey,
						tenant,
					);
				} else if (
					item.kind === "video" &&
					item.videoState === "ready" &&
					item.imageKey
				) {
					await this.videos.copyTo(
						tenant,
						item.imageKey,
						item.videoKeys ?? [],
						VIDEO,
						PUBLIC_VIDEO_PURPOSE,
					);
				}
			} catch (error) {
				logger.error(
					{ err: error, tenantId: tenant.id, postId },
					"a rolled-back withdrawal could not copy a Fresh ink file back",
				);
			}
		}
	}

	private mediaOf(tenant: TenantRef, post: Pick<ClientPost, "id">) {
		return ClientPostMedia.query()
			.where("tenant_id", tenant.id)
			.where("post_id", post.id)
			.orderBy("position", "asc");
	}
}

/**
 * The public keys a post's items have once published: each photo's image
 * key, each ready video's poster and renditions, under the public purposes.
 */
export function publicKeys(media: readonly MediaFiles[]): {
	photos: string[];
	videos: { posterKey: string; keys: string[] }[];
} {
	const photos: string[] = [];
	const videos: { posterKey: string; keys: string[] }[] = [];
	for (const item of media) {
		if (item.kind === "photo" && item.imageKey) {
			photos.push(keyUnder(item.imageKey, PHOTO, PUBLIC_PHOTO_PURPOSE));
		} else if (
			item.kind === "video" &&
			item.videoState === "ready" &&
			item.imageKey
		) {
			videos.push({
				posterKey: keyUnder(item.imageKey, VIDEO, PUBLIC_VIDEO_PURPOSE),
				keys: (item.videoKeys ?? []).map((key) =>
					keyUnder(key, VIDEO, PUBLIC_VIDEO_PURPOSE),
				),
			});
		}
	}
	return { photos, videos };
}
