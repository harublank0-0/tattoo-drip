import type { ReviewMedia, ReviewPage } from "@tattoo-drip/sdk";
import type { ReviewShell } from "../../src/review/loader.ts";

/** Shared by the review page's tests (Reviews and Fresh ink). */

export const TOKEN = "review-browser-pass-token-0123456789abcdefg";
export const MEDIA = "https://media.example.com";

export const SHELL: ReviewShell = {
	studioName: "Black Needle",
	logo: null,
	contact: [
		{
			kind: "instagram",
			label: "Instagram",
			href: "https://instagram.com/blackneedle",
		},
		{
			kind: "whatsapp",
			label: "WhatsApp",
			href: "https://wa.me/9779812345678",
		},
	],
};

export const CONNECTION = {
	apiUrl: "https://api.example.com",
	mediaUrl: MEDIA,
	challengeSiteKey: null,
};

/** A page with nothing written yet: the defaults only. */
export const PAGE: ReviewPage = {
	studio: { name: "Black Needle", onDiscover: false },
	project: { artistName: "Sita Rai", tattooedOn: "2026-10-01" },
	link: { expiresAt: "2027-10-01T00:00:00.000Z" },
	styles: [
		{ slug: "fine-line", name: "Fine line" },
		{ slug: "realism", name: "Realism" },
	],
	defaults: {
		shownName: "Maya G.",
		styles: ["fine-line"],
		placement: "Left forearm",
	},
	review: null,
	post: null,
	blocks: { review: null, post: null },
};

export function photo(
	id: string,
	url = `${MEDIA}/tenants/t/client_post_photo/${id}.320.jpg`,
): ReviewMedia {
	return {
		id,
		kind: "photo",
		state: "ready",
		failure: null,
		image: {
			url,
			width: 1200,
			height: 900,
			alt: null,
			variants: [{ url: url.replace(".320.jpg", ".320w.jpg"), width: 320 }],
		},
		sources: [],
		durationMs: null,
	};
}

export function video(
	id: string,
	state: ReviewMedia["state"] = "ready",
): ReviewMedia {
	return {
		id,
		kind: "video",
		state,
		failure: state === "failed" ? "It's longer than 60 seconds." : null,
		image:
			state === "ready"
				? {
						url: `${MEDIA}/tenants/t/client_post_video/${id}.jpg`,
						width: 720,
						height: 1280,
						alt: null,
						variants: [],
					}
				: null,
		sources:
			state === "ready"
				? [
						{
							url: `${MEDIA}/tenants/t/client_post_video/${id}.720x1280.mp4`,
							type: "video/mp4",
							width: 720,
							height: 1280,
						},
					]
				: [],
		durationMs: state === "ready" ? 12_000 : null,
	};
}

/** A page with a review and a waiting post of a photo and a video. */
export const SAVED: ReviewPage = {
	...PAGE,
	studio: { name: "Black Needle", onDiscover: true },
	review: {
		rating: 4,
		body: "Healed beautifully, crisp lines.",
		shownName: "Maya",
		consentStudioPage: true,
		consentDiscover: false,
		takenDown: null,
		createdAt: "2026-11-01T10:00:00.000Z",
		updatedAt: "2026-11-01T10:00:00.000Z",
	},
	post: {
		status: "waiting",
		caption: "Six weeks in",
		styles: ["realism"],
		placement: "Shoulder",
		shownName: "Maya",
		consentStudioPage: true,
		consentDiscover: false,
		takenDown: null,
		editable: true,
		media: [
			photo("00000000-0000-4000-8000-000000000001"),
			video("00000000-0000-4000-8000-000000000002"),
		],
	},
};
