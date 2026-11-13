import encryption from "@adonisjs/core/services/encryption";
import {
	isVideoType,
	MAX_VIDEO_BYTES,
	type VideoType,
} from "#modules/media/video";

/**
 * A client's Fresh ink video upload (Reviews and Fresh ink): what the
 * "sign" answer hands the browser and the browser hands back with its PUT
 * (on the local disk) and with the "finish". The work video angles' model
 * (#modules/artists/video_uploads): the app key's authenticated encryption
 * (AES-GCM) of the tenant, the post, the private staging key, the type and
 * the exact length, for one purpose of its own and one hour, so the browser
 * can neither read nor change it, nor use one signed for another link's
 * post. Every step also resolves the review link again, so a token outlives
 * no revoked link. A staging key finishes once (a unique index).
 */
const PURPOSE = "client-post-video-upload";
const LIFETIME = "1 hour";

export type ClientVideoUpload = {
	tenantId: string;
	postId: string;
	key: string;
	type: VideoType;
	size: number;
};

/** The token for one signed upload. */
export function clientVideoUploadToken(
	upload: ClientVideoUpload,
	lifetime: string = LIFETIME,
): string {
	return encryption.encrypt(
		{
			t: upload.tenantId,
			p: upload.postId,
			k: upload.key,
			ty: upload.type,
			s: upload.size,
		},
		lifetime,
		PURPOSE,
	);
}

/**
 * The upload a token was signed for, if it is good (not altered, not
 * expired, this purpose) and was signed for this tenant and, when given,
 * this post; else null.
 */
export function readClientVideoUploadToken(
	token: unknown,
	expected: { tenantId: string; postId?: string },
): ClientVideoUpload | null {
	if (typeof token !== "string" || token.length > 2048) return null;
	const value = encryption.decrypt<Record<string, unknown>>(token, PURPOSE);
	if (!value || typeof value !== "object") return null;
	const { t, p, k, ty, s } = value;
	if (
		t !== expected.tenantId ||
		typeof p !== "string" ||
		(expected.postId !== undefined && p !== expected.postId) ||
		typeof k !== "string" ||
		!isVideoType(ty) ||
		typeof s !== "number" ||
		!Number.isInteger(s) ||
		s < 1 ||
		s > MAX_VIDEO_BYTES
	) {
		return null;
	}
	return { tenantId: t, postId: p, key: k, type: ty, size: s };
}
