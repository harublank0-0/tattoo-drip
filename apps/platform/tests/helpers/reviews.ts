import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import type { ApiClient } from "@japa/api-client";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import type Client from "#modules/clients/models/client";
import PublicationService from "#modules/discovery/services/publication_service";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import ImageService, {
	IMAGE_PURPOSES,
	type ImagePurpose,
} from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { clientVideoUploadToken } from "#modules/reviews/client_video_uploads";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import ReviewLink from "#modules/reviews/models/review_link";
import { REVIEW_TOKEN_HEADER } from "#modules/reviews/review_links";
import type { PostStatus } from "#modules/reviews/rules";
import ClientPostService from "#modules/reviews/services/client_post_service";
import PostPublicationService from "#modules/reviews/services/post_publication_service";
import ReviewLinkService from "#modules/reviews/services/review_link_service";
import ReviewPageService from "#modules/reviews/services/review_page_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { depositServices } from "#tests/helpers/deposits";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant } from "#tests/helpers/tenants";

type TenantRef = Pick<Tenant, "id">;

/** An owner of the studio: the review link services read only the role for owners. */
export const OWNER_MEMBER = (userId: string) => ({
	userId,
	role: "owner" as const,
});

/** The review services wired as the container does. */
export function reviewServices(images: ImageService = new ImageService()) {
	const base = depositServices(images);
	const videos = new VideoService(images);
	const links = new ReviewLinkService(base.projects, base.sessions);
	const publication = new PostPublicationService(images, videos);
	const posts = new ClientPostService(
		images,
		videos,
		base.projects,
		publication,
	);
	const inquiries = new InquiryService(base.artists, base.projects);
	const discover = new PublicationService(images, base.artists);
	const pages = new ReviewPageService(
		links,
		base.projects,
		base.sessions,
		base.artists,
		inquiries,
		discover,
		posts,
		images,
		videos,
	);
	return {
		...base,
		videos,
		links,
		posts,
		inquiries,
		publication: discover,
		postPublication: publication,
		pages,
	};
}

/**
 * What a review link needs in `tenant`: a client "Sita Rai", an artist,
 * an inquiry with a placement and a style, and a `completed` project made
 * from it, assigned to the artist, whose tattoo session ended a week ago.
 * Call it inside `inTenant(tenant, …)`.
 */
export async function reviewReady(
	tenant: TenantRef,
	over: {
		status?: ProjectStatus;
		sessionStatus?: "completed" | "scheduled";
		artistSlug?: string;
		clientName?: string;
	} = {},
): Promise<{
	client: Client;
	artist: Artist;
	project: TattooProject;
}> {
	const client = await makeClient(tenant, {
		name: over.clientName ?? "Sita Rai",
	});
	const artist = await makeArtist(tenant, over.artistSlug ?? "review-artist");
	const inquiry = await makeInquiry(tenant, client, {
		placement: "Left forearm",
		style: "fine-line",
		status: "accepted",
		decidedAt: DateTime.now().minus({ days: 60 }),
	});
	const project = await makeProject(tenant, client, {
		status: over.status ?? "completed",
		artistId: artist.id,
		inquiryId: inquiry.id,
	});
	const endsAt = DateTime.now().minus({ days: 7 }).startOf("hour");
	await makeSession(tenant, project, artist, {
		startsAt: endsAt.minus({ hours: 2 }),
		endsAt,
		status: over.sessionStatus ?? "completed",
	});
	return { client, artist, project };
}

/** A review link for `project`, made by an owner. Call it inside the tenant's context. */
export async function issueReviewLink(
	tenant: Pick<Tenant, "id" | "slug">,
	project: Pick<TattooProject, "id">,
	userId: string = randomUUID(),
) {
	return reviewServices().links.linkFor(
		tenant,
		OWNER_MEMBER(userId),
		project.id,
	);
}

/** A request to a review page route of `slug`, with the token in its header (or none). */
export function reviewRequest(
	client: ApiClient,
	method: "GET" | "PUT" | "POST" | "DELETE",
	slug: string,
	path: string,
	token: string | null,
) {
	const request = client.request(
		`/api/v1/tenants/${slug}/review${path}`,
		method,
	);
	return token ? request.header(REVIEW_TOKEN_HEADER, token) : request;
}

/** A valid submit body: a five-star review, the default consents off. */
export function reviewBody(over: Record<string, unknown> = {}) {
	return {
		shownName: "Sita R.",
		consentStudioPage: true,
		consentDiscover: false,
		review: {
			rating: 5,
			body: "Healed beautifully, the lines are crisp and even.",
		},
		...over,
	};
}

/** A post row with one photo of made-up keys (the drive ignores a delete of a missing file). Call it in the tenant's context. */
export async function seedPost(
	tenant: TenantRef,
	project: Pick<TattooProject, "id" | "clientId" | "artistId">,
	over: Partial<{ submitted: boolean; status: PostStatus }> = {},
) {
	const post = await ClientPost.create({
		tenantId: tenant.id,
		projectId: project.id,
		clientId: project.clientId,
		artistId: project.artistId as string,
		caption: null,
		styles: [],
		placement: null,
		status: over.status ?? "waiting",
		submittedAt: over.submitted ? DateTime.now() : null,
		waitingRound: over.submitted ? 1 : 0,
		waitingSince: over.submitted ? DateTime.now() : null,
		decidedAt: over.status && over.status !== "waiting" ? DateTime.now() : null,
		decidedBy: null,
		shownName: "Sita R.",
		consentStudioPage: false,
		consentDiscover: false,
	});
	const photo = await ClientPostMedia.create({
		tenantId: tenant.id,
		postId: post.id,
		kind: "photo",
		position: 0,
		imageKey: `tenants/${tenant.id}/client_post_photo/${randomUUID()}.320-640-1280.jpg`,
		width: 2048,
		height: 1536,
		alt: null,
	});
	return { post, photo };
}

/** One item of a seeded published post: a photo, or a video in one of its states. */
export type SeededMedia =
	| "photo"
	| "video-ready"
	| "video-processing"
	| "video-failed";

/**
 * A Fresh ink post as publishing leaves it (Reviews and Fresh ink, slice 3):
 * approved, allowed on the studio's page and published (`published_at`),
 * with `media` in order (a photo leads), all of made-up keys: the public
 * reads build URLs without I/O, and a withdrawal counts a missing file as
 * deleted. `over` changes the post itself (a check of the database's still
 * holds: published only while approved, allowed somewhere and not taken
 * down). Call it in the tenant's context.
 */
export async function seedShownPost(
	tenant: TenantRef,
	project: Pick<TattooProject, "id" | "clientId" | "artistId">,
	over: Partial<{
		media: SeededMedia[];
		caption: string | null;
		styles: string[];
		placement: string | null;
		shownName: string;
		status: PostStatus;
		consentStudioPage: boolean;
		consentDiscover: boolean;
		published: boolean;
		publishedAt: DateTime;
		takenDown: boolean;
	}> = {},
) {
	const at = over.publishedAt ?? DateTime.now();
	const status = over.status ?? "approved";
	const post = await ClientPost.create({
		tenantId: tenant.id,
		projectId: project.id,
		clientId: project.clientId,
		artistId: project.artistId as string,
		caption:
			over.caption === undefined ? "Healed after six weeks." : over.caption,
		styles: over.styles ?? ["fine-line"],
		placement: over.placement === undefined ? "Left forearm" : over.placement,
		status,
		submittedAt: at.minus({ days: 2 }),
		waitingRound: 1,
		waitingSince: at.minus({ days: 2 }),
		decidedAt: status === "waiting" ? null : at,
		decidedBy: null,
		shownName: over.shownName ?? "Sita R.",
		consentStudioPage: over.consentStudioPage ?? true,
		consentDiscover: over.consentDiscover ?? false,
		publishedAt: (over.published ?? true) ? at : null,
		takenDownAt: over.takenDown ? at : null,
		takedownReason: over.takenDown ? "other" : null,
	});
	const items = [];
	for (const [position, kind] of (over.media ?? ["photo"]).entries()) {
		items.push(await seedMedia(tenant, post.id, position, kind));
	}
	return { post, media: items };
}

async function seedMedia(
	tenant: TenantRef,
	postId: string,
	position: number,
	kind: SeededMedia,
) {
	const base = { tenantId: tenant.id, postId, position, alt: null };
	if (kind === "photo") {
		return ClientPostMedia.create({
			...base,
			kind: "photo",
			imageKey: `tenants/${tenant.id}/client_post_photo/${randomUUID()}.320-640-1280.jpg`,
			width: 2048,
			height: 1536,
		});
	}
	const staging = `client_video_upload/tenants/${tenant.id}/${randomUUID()}`;
	if (kind === "video-ready") {
		const name = randomUUID();
		return ClientPostMedia.create({
			...base,
			kind: "video",
			videoState: "ready",
			videoStagingKey: staging,
			imageKey: `tenants/${tenant.id}/client_post_video/${name}.320-640-1280.jpg`,
			width: 1080,
			height: 1920,
			videoDurationMs: 12_000,
			videoKeys: [
				`tenants/${tenant.id}/client_post_video/${name}.720x1280.mp4`,
				`tenants/${tenant.id}/client_post_video/${name}.1080x1920.mp4`,
			],
		});
	}
	return ClientPostMedia.create({
		...base,
		kind: "video",
		videoState: kind === "video-failed" ? "failed" : "processing",
		videoFailure: kind === "video-failed" ? "The video is too long." : null,
		videoStagingKey: staging,
	});
}

/** A live review of `project` (five stars, the studio page allowed). Call it in the tenant's context. */
export async function seedReview(
	tenant: TenantRef,
	project: Pick<TattooProject, "id" | "clientId" | "artistId">,
	over: Partial<{
		rating: number;
		body: string;
		reply: string;
		shownName: string;
		consentStudioPage: boolean;
		consentDiscover: boolean;
		createdAt: DateTime;
	}> = {},
) {
	return ClientReview.create({
		tenantId: tenant.id,
		projectId: project.id,
		clientId: project.clientId,
		artistId: project.artistId as string,
		rating: over.rating ?? 5,
		body: over.body ?? "Healed beautifully, the lines are crisp and even.",
		shownName: over.shownName ?? "Sita R.",
		consentStudioPage: over.consentStudioPage ?? true,
		consentDiscover: over.consentDiscover ?? false,
		reply: over.reply ?? null,
		repliedAt: over.reply ? DateTime.now() : null,
		...(over.createdAt ? { createdAt: over.createdAt } : {}),
	});
}

/**
 * A clip staged as the browser's upload would leave it for `post`, with the
 * token the sign step would have given.
 */
export async function stageReviewClip(
	tenant: TenantRef,
	postId: string,
	clip: { path: string; type: string; size: number },
): Promise<{ key: string; token: string }> {
	const videos = new VideoService(new ImageService());
	const key = videos.stagingKey(tenant);
	await drive.use("private").put(key, await readFile(clip.path));
	const token = clientVideoUploadToken({
		tenantId: tenant.id,
		postId,
		key,
		type: clip.type as "video/mp4",
		size: clip.size,
	});
	return { key, token };
}

/** Everything the review tables hold for `tenant`, as a snapshot (the isolation cases'). */
export function reviewRows(tenant: TenantRef) {
	return inTenant(tenant, async () => ({
		links: (await ReviewLink.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		reviews: (await ClientReview.withTrashed().orderBy("id")).map((row) =>
			row.serialize(),
		),
		posts: (await ClientPost.withTrashed().orderBy("id")).map((row) =>
			row.serialize(),
		),
		media: (await ClientPostMedia.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));
}

/** The files a studio has under a purpose's folder, on that purpose's disk (client media are private). */
export async function storedFiles(tenant: TenantRef, purpose: ImagePurpose) {
	try {
		return (
			await readdir(
				app.tmpPath(
					"storage",
					IMAGE_PURPOSES[purpose].visibility,
					"tenants",
					tenant.id,
					purpose,
				),
			)
		).sort();
	} catch {
		return [];
	}
}

/** The artists service, for a style list. */
export function artistService() {
	return new ArtistService(new ImageService());
}
