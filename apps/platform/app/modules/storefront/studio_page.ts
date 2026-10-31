import type { TenantProfile } from "#modules/tenancy/services/tenancy_service";

/**
 * The links a studio page shows (TAT-44), in this order, with the tenant
 * column each comes from.
 */
export const SOCIAL_PLATFORMS = [
	["instagram", "instagramUrl"],
	["facebook", "facebookUrl"],
	["tiktok", "tiktokUrl"],
	["website", "websiteUrl"],
] as const;

export type PublicSocialLink = {
	platform: (typeof SOCIAL_PLATFORMS)[number][0];
	url: string;
};

/**
 * The links of a studio (the public Studio) or an artist (the public
 * Artist, which has no website): the set ones, in a fixed order, and only
 * https URLs. The forms already refuse anything else; checking again here
 * means a row written another way can never put a `javascript:` or
 * plain-http link on the page. The URL is sent as stored. A field the
 * source has not got is unset.
 */
export function socialLinks(
	profile: Partial<
		Pick<
			TenantProfile,
			"instagramUrl" | "facebookUrl" | "tiktokUrl" | "websiteUrl"
		>
	>,
): PublicSocialLink[] {
	return SOCIAL_PLATFORMS.flatMap(([platform, field]) => {
		const url = profile[field];
		return url && isHttpsUrl(url) ? [{ platform, url }] : [];
	});
}

/** Starts with https:// (no leading space or other scheme) and parses as an https URL. */
function isHttpsUrl(value: string): boolean {
	if (!/^https:\/\//i.test(value)) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}
