import drive from "@adonisjs/drive/services/main";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import FlashDesign from "#modules/flash/models/flash_design";
import ImageService from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import DepositLink from "#modules/payments/models/deposit_link";
import Payment from "#modules/payments/models/payment";
import { clientVideoUploadToken } from "#modules/reviews/client_video_uploads";
import { REVIEW_TOKEN_HEADER } from "#modules/reviews/review_links";
import Tenant from "#modules/tenancy/models/tenant";
import { type ProofPart, proofPart } from "#tests/helpers/deposits";
import { testImages } from "#tests/helpers/images";
import { intakeFields, intakeRows } from "#tests/helpers/intake";
import { reviewBody, reviewRows } from "#tests/helpers/reviews";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /api/v1/tenants/:tenant route (TAT-32). public_api.spec.ts
 * requests each under studio A's slug and fails if the answer mentions
 * studio B (publicMarkers) or B's snapshot changes; the guard in
 * api_routes.spec.ts fails for a route without an entry. These are not in
 * cases.ts: the public API has no signed-in actor, and another studio's slug
 * is simply another tenant.
 */
export type PublicIsolationCase = {
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The route as the router prints it, e.g. /api/v1/tenants/:tenant */
	pattern: string;
	/** A valid body for writes, built for the studio sending it (it may stage what the write needs). */
	body?: (
		own: Studio,
	) => Record<string, unknown> | Promise<Record<string, unknown>>;
	/**
	 * How `body` is sent: JSON (the default) or multipart form fields; `raw`
	 * sends `raw`'s bytes with its type (a video's upload).
	 */
	encoding?: "json" | "multipart" | "raw";
	/** The raw body of a `raw` write, built for the studio sending it. */
	raw?: (own: Studio) => { type: string; data: Buffer };
	/**
	 * Values for the pattern's parameters other than :tenant, built for one
	 * studio (TAT-65: a deposit link's token). With them, the harness also
	 * sends B's values under A's slug, which must be the 404 and leave B as
	 * it was.
	 */
	params?: (studio: Studio) => Record<string, string>;
	/**
	 * Request headers built for one studio (the review page: its link's
	 * token in X-Review-Token). Cross-sent like `params`: B's under A's slug
	 * and A's under B's must be the 404.
	 */
	headers?: (studio: Studio) => Record<string, string>;
	/** A query string built for one studio (a video's upload token), cross-sent like `params`. */
	query?: (studio: Studio) => Record<string, string>;
	/** File parts of a multipart write, built for the studio sending it (TAT-65: the proof). */
	files?: (own: Studio) => Promise<ProofPart[]>;
	/** The status of A's own request: the positive control. */
	ownStatus: 200 | 201 | 204;
	/** Strings A's own answer must contain, so an empty answer can't pass. */
	ownMarkers: (own: Studio) => string[];
	/** Reads the state of the studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

const artistRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Artist.query().orderBy("id")).map((row) => row.serialize()),
	);

const workPhotoRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await ArtistWorkPhoto.query().orderBy("id")).map((row) => row.serialize()),
	);

const flashRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await FlashDesign.query().orderBy("id")).map((row) => row.serialize()),
	);

const depositRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		links: (await DepositLink.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		payments: (await Payment.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));

/** The review page's token header, for one studio (Reviews and Fresh ink). */
const reviewHeaders = (studio: Studio) => ({
	[REVIEW_TOKEN_HEADER]: studio.reviewToken,
});

/** A video upload staged for the studio's seeded draft post: 4 bytes, and the token the sign step would give. */
async function stagedVideo(own: Studio) {
	const videos = new VideoService(new ImageService());
	const key = videos.stagingKey(own.tenant);
	await drive.use("private").put(key, Buffer.from("mp4!"));
	return clientVideoUploadToken({
		tenantId: own.tenant.id,
		postId: own.clientPost.id,
		key,
		type: "video/mp4",
		size: 4,
	});
}

export const publicIsolationCases: PublicIsolationCase[] = [
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant",
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.slug, own.tenant.name],
		snapshot: tenantRow,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/artists",
		ownStatus: 200,
		ownMarkers: (own) => [own.artistProfile.id, own.closedArtist.id],
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/artists/:artist",
		// Each studio's own slug (`<slug>-mira`): B's under A's path, and A's
		// under B's, must be the 404.
		params: (studio) => ({ artist: studio.closedArtist.slug }),
		ownStatus: 200,
		ownMarkers: (own) => [own.closedArtist.id, own.closedArtist.name],
		snapshot: artistRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/work",
		// twoStudios seeds two photos of artistProfile in each studio. Its
		// slug is the same in both, so its name (the studio's own) shows the
		// answer is A's.
		ownStatus: 200,
		ownMarkers: (own) => [own.artistProfile.slug, own.artistProfile.name],
		snapshot: workPhotoRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/work/:photo",
		// B's photo id under A's slug must be the 404.
		params: (studio) => ({ photo: studio.workPhoto.id }),
		ownStatus: 200,
		ownMarkers: (own) => [own.workPhoto.id, own.artistProfile.name],
		snapshot: workPhotoRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/flash",
		// twoStudios seeds one shown design of artistProfile in each studio,
		// named after the studio: its id shows the answer is A's.
		ownStatus: 200,
		ownMarkers: (own) => [own.flashDesign.id],
		snapshot: flashRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/flash/:design",
		// B's design id under A's slug must be the 404.
		params: (studio) => ({ design: studio.flashDesign.id }),
		ownStatus: 200,
		ownMarkers: (own) => [own.flashDesign.id, own.flashDesign.name],
		snapshot: flashRows,
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/inquiries",
		encoding: "multipart",
		// A's own artist and a returning client of A's: B must stay as it was.
		body: (own) =>
			intakeFields({
				preferredArtistId: own.artistProfile.id,
				contactPhone: own.client.phone ?? "",
			}),
		ownStatus: 201,
		// The answer is only the new inquiry's id; inquiries.spec.ts checks it landed in A.
		ownMarkers: () => [],
		snapshot: intakeRows,
	},
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name, own.depositReferenceCode],
		snapshot: depositRows,
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		encoding: "multipart",
		body: () => ({ method: "esewa", expectedAmount: "300000" }),
		files: async () => [await proofPart()],
		ownStatus: 201,
		// The answer is the page in `submitted`, with A's reference code.
		ownMarkers: (own) => [own.depositReferenceCode],
		snapshot: depositRows,
	},
	// The review page (Reviews and Fresh ink, slice 1): the link's token in
	// X-Review-Token, cross-sent by the harness like a path parameter.
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/review",
		headers: reviewHeaders,
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name, own.clientPostPhoto.id],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "PUT",
		pattern: "/api/v1/tenants/:tenant/review",
		headers: reviewHeaders,
		body: () => reviewBody(),
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name, "Healed beautifully"],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "DELETE",
		pattern: "/api/v1/tenants/:tenant/review/review",
		headers: reviewHeaders,
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "DELETE",
		pattern: "/api/v1/tenants/:tenant/review/post",
		headers: reviewHeaders,
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/review/photos",
		headers: reviewHeaders,
		encoding: "multipart",
		files: async () => [
			{
				field: "photo",
				name: "healed.png",
				type: "image/png",
				data: await testImages.png(),
			},
		],
		ownStatus: 201,
		ownMarkers: (own) => [own.tenant.name, own.clientPostPhoto.id],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/review/videos/sign",
		headers: reviewHeaders,
		body: () => ({ type: "video/mp4", size: 1000 }),
		ownStatus: 200,
		// On the local disk the upload goes to A's own staging route.
		ownMarkers: (own) => [
			`/api/v1/tenants/${own.tenant.slug}/review/videos/stage`,
		],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "PUT",
		pattern: "/api/v1/tenants/:tenant/review/videos/stage",
		// The upload token is the credential here, as a presigned URL's is.
		query: (studio) => ({
			upload: clientVideoUploadToken({
				tenantId: studio.tenant.id,
				postId: studio.clientPost.id,
				key: new VideoService(new ImageService()).stagingKey(studio.tenant),
				type: "video/mp4",
				size: 4,
			}),
		}),
		encoding: "raw",
		raw: () => ({ type: "video/mp4", data: Buffer.from("mp4!") }),
		ownStatus: 204,
		ownMarkers: () => [],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/review/videos",
		headers: reviewHeaders,
		body: async (own) => ({ upload: await stagedVideo(own) }),
		ownStatus: 201,
		ownMarkers: (own) => [own.tenant.name, "processing"],
		snapshot: (target) => reviewRows(target.tenant),
	},
	{
		method: "DELETE",
		pattern: "/api/v1/tenants/:tenant/review/media/:media",
		headers: reviewHeaders,
		params: (studio) => ({ media: studio.clientPostPhoto.id }),
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name],
		snapshot: (target) => reviewRows(target.tenant),
	},
];
