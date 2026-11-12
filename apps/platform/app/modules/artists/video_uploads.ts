import encryption from "@adonisjs/core/services/encryption";
import {
	isVideoType,
	MAX_VIDEO_BYTES,
	type VideoType,
} from "#modules/media/video";

/**
 * Video angles: what the dashboard's "sign" answer hands the browser and the
 * browser hands back with the "finish" (and, on the local disk, with its PUT):
 * which tenant and tattoo the upload was signed for, its private
 * staging key, its type and its exact length. Encrypted and authenticated
 * with the app key (AES-GCM, `encryption`), for one purpose, and good for an
 * hour, so the browser can neither read nor change it, nor send one signed
 * for another studio or tattoo (every step also checks that the member may
 * change that tattoo). A key finishes once: the row keeps
 * it under a unique index.
 */
const PURPOSE = "work-video-upload";
const LIFETIME = "1 hour";

export type VideoUpload = {
	tenantId: string;
	leadId: string;
	key: string;
	type: VideoType;
	size: number;
};

/** The token for one signed upload. */
export function videoUploadToken(upload: VideoUpload): string {
	return encryption.encrypt(
		{
			t: upload.tenantId,
			l: upload.leadId,
			k: upload.key,
			ty: upload.type,
			s: upload.size,
		},
		LIFETIME,
		PURPOSE,
	);
}

/**
 * The upload a token was signed for, if it is good (not altered, not
 * expired, this purpose) and was signed for this tenant and tattoo; else
 * null.
 */
export function readVideoUploadToken(
	token: unknown,
	expected: { tenantId: string; leadId: string },
): VideoUpload | null {
	if (typeof token !== "string" || token.length > 2048) return null;
	const value = encryption.decrypt<Record<string, unknown>>(token, PURPOSE);
	if (!value || typeof value !== "object") return null;
	const { t, l, k, ty, s } = value;
	if (
		t !== expected.tenantId ||
		l !== expected.leadId ||
		typeof k !== "string" ||
		!isVideoType(ty) ||
		typeof s !== "number" ||
		!Number.isInteger(s) ||
		s < 1 ||
		s > MAX_VIDEO_BYTES
	) {
		return null;
	}
	return { tenantId: t, leadId: l, key: k, type: ty, size: s };
}
