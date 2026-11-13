import { ClientPostMediaSchema } from "#database/schema";

export const MEDIA_KINDS = ["photo", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type MediaVideoState = "processing" | "ready" | "failed";

/**
 * One photo or video of a Fresh ink post: `position` 0 is the lead and is
 * always a photo (the database checks it). A photo's `imageKey` is its
 * image (purpose client_post_photo); a video's is its poster once ready
 * (client_post_video). Not soft-deleted: removing one deletes its files,
 * then its row.
 */
export default class ClientPostMedia extends ClientPostMediaSchema {
	static table = "client_post_media";
	declare kind: MediaKind;
	declare videoState: MediaVideoState | null;
}
