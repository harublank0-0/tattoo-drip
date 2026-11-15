import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import { encodeWorkCursor } from "#modules/artists/work_cursor";
import ImageService from "#modules/media/services/image_service";
import ClientPost from "#modules/reviews/models/client_post";
import type ClientReview from "#modules/reviews/models/client_review";
import PublicReviewService from "#modules/reviews/services/public_review_service";
import { CURSOR_MESSAGE } from "#modules/storefront/validators/work";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantModel from "#modules/tenancy/models/tenant";
import {
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { testImages } from "#tests/helpers/images";
import {
	issueReviewLink,
	reviewBody,
	reviewReady,
	reviewRequest,
	seedReview,
	seedShownPost,
	storedFiles,
} from "#tests/helpers/reviews";
import { inTenant, studioWithOwner, twoStudios } from "#tests/helpers/tenants";

/**
 * What the studio's own page shows of its clients' reviews and Fresh ink
 * (Reviews and Fresh ink, slice 3; listReviews and listFreshInk): exactly
 * the documented fields, every visibility rule (the client's consent, a
 * takedown, the client's delete, the studio's decision, publication, a reply
 * taken down, a video that is not ready, a hidden artist), the 3-review
 * threshold for the average (ruling 10), newest first with a cursor, a
 * deleted studio and the other studio's rows.
 */

/** Shorter than the other reads (60 s stale): a takedown leaves shared caches within 2 minutes. */
const CACHED = "public, max-age=60, stale-while-revalidate=60";

/** The documented fields (openapi.yaml). A new one needs the contract and a ruling first. */
const REVIEWS_BODY = ["data", "nextCursor", "rating"];
const REVIEW_FIELDS = [
	"artist",
	"body",
	"date",
	"id",
	"rating",
	"reply",
	"shownName",
];
const FRESH_INK_BODY = ["data", "nextCursor"];
const POST_FIELDS = [
	"alt",
	"angles",
	"artist",
	"caption",
	"date",
	"height",
	"id",
	"placement",
	"shownName",
	"styles",
	"url",
	"variants",
	"width",
];

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
/** A fixed time `minutes` after T0: a higher number is newer. */
const at = (minutes: number) => T0.plus({ minutes });

const reviewsUrl = (slug: string, query = "") =>
	`/api/v1/tenants/${slug}/reviews${query}`;
const freshInkUrl = (slug: string, query = "") =>
	`/api/v1/tenants/${slug}/fresh-ink${query}`;

type ReviewItem = {
	id: string;
	rating: number;
	body: string;
	shownName: string;
	date: string;
	artist: { slug: string; name: string } | null;
	reply: { body: string; date: string } | null;
};
type PostItem = {
	id: string;
	url: string;
	alt: string | null;
	angles: { kind: string; url?: string; poster?: { url: string } }[];
	shownName: string;
	caption: string | null;
	styles: { slug: string; name: string }[];
	placement: string | null;
	artist: { slug: string; name: string } | null;
	date: string;
};

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A studio with a client's completed project (reviewReady: "Sita Rai", artist "review-artist"). */
async function studio(slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
	const ready = await inTenant(tenant, () => reviewReady(tenant));
	return { tenant, owner, ...ready };
}

type Ready = Awaited<ReturnType<typeof studio>>;

/** Another completed project of the same client and artist (one review and post per project). */
async function anotherProject(s: Ready) {
	const { project } = await inTenant(s.tenant, () =>
		reviewReady(s.tenant, {
			artistSlug: `artist-${Math.random().toString(36).slice(2, 8)}`,
		}),
	);
	// The same visible artist as the first project, so the tag is theirs.
	await inTenant(s.tenant, () =>
		project.merge({ artistId: s.artist.id }).save(),
	);
	return project;
}

test.group("GET /api/v1/tenants/:tenant/reviews (listReviews)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists the shown reviews newest first, with exactly the documented fields and no client data", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-a");
		const second = await anotherProject(s);
		const [older, newer] = await inTenant(s.tenant, async () => [
			await seedReview(s.tenant, s.project, {
				rating: 4,
				body: "The line work healed evenly, really happy with it.",
				reply: "Thank you, Sita!",
				createdAt: at(1),
			}),
			await seedReview(s.tenant, second, {
				rating: 5,
				body: "Second piece, just as good as the first one.",
				shownName: "S. R.",
				createdAt: at(2),
			}),
		]);

		const response = await client.get(reviewsUrl(s.tenant.slug));
		response.assertStatus(200);
		assert.equal(response.header("cache-control"), CACHED);
		assert.isString(response.header("etag"));
		assertApiHeaders(response);
		assertNoCookies(response);
		const body = response.body() as {
			data: ReviewItem[];
			nextCursor: string | null;
			rating: unknown;
		};
		assert.sameMembers(Object.keys(body), REVIEWS_BODY);
		assert.deepEqual(ids(body.data), [newer.id, older.id], "newest first");
		for (const item of body.data) {
			assert.sameMembers(Object.keys(item), REVIEW_FIELDS);
		}
		assert.deepEqual(body.data[1], {
			id: older.id,
			rating: 4,
			body: "The line work healed evenly, really happy with it.",
			shownName: "Sita R.",
			date: "2026-10-01",
			artist: { slug: s.artist.slug, name: s.artist.name },
			reply: {
				body: "Thank you, Sita!",
				date: (older.repliedAt as DateTime)
					.setZone(s.tenant.timezone)
					.toISODate() as string,
			},
		});
		assert.equal(body.data[0].shownName, "S. R.");
		assert.isNull(body.data[0].reply);
		assert.isNull(body.nextCursor);
		assert.isNull(body.rating, "two reviews: no average (ruling 10)");
		// Never the client's full name, phone, email or ids, nor the project's.
		const text = JSON.stringify(body);
		for (const secret of [
			s.client.name,
			s.client.phone ?? "",
			s.client.id,
			s.project.id,
			second.id,
			s.artist.id,
		]) {
			assert.notInclude(text, secret);
		}
	});

	test("leaves out a review without the studio-page consent, taken down or deleted, and a reply taken down", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-b");
		const projects = [
			s.project,
			await anotherProject(s),
			await anotherProject(s),
			await anotherProject(s),
		];
		const [shown, noConsent, takenDown, deleted] = await inTenant(
			s.tenant,
			async () => [
				await seedReview(s.tenant, projects[0], {
					reply: "We're glad it healed well.",
				}),
				await seedReview(s.tenant, projects[1], { consentStudioPage: false }),
				await seedReview(s.tenant, projects[2]),
				await seedReview(s.tenant, projects[3]),
			],
		);
		await inTenant(s.tenant, async () => {
			await takenDown
				.merge({ takenDownAt: DateTime.now(), takedownReason: "hate" })
				.save();
			// The client's delete soft-deletes it (ClientReviewService also scrubs it).
			await deleted.softDelete();
		});

		const listed = async () =>
			(await client.get(reviewsUrl(s.tenant.slug))).body() as {
				data: ReviewItem[];
				rating: unknown;
			};
		let body = await listed();
		assert.deepEqual(ids(body.data), [shown.id]);
		assert.notInclude(JSON.stringify(body), noConsent.id);
		assert.deepEqual(body.data[0].reply?.body, "We're glad it healed well.");

		// TattooDrip takes the reply down: the review stays, without it.
		await inTenant(s.tenant, () =>
			shown
				.merge({
					replyTakenDownAt: DateTime.now(),
					replyTakedownReason: "hate",
				})
				.save(),
		);
		body = await listed();
		assert.deepEqual(ids(body.data), [shown.id]);
		assert.isNull(body.data[0].reply);
	});

	test("tags only an artist the studio shows, and never a hidden one", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-c");
		await inTenant(s.tenant, () => seedReview(s.tenant, s.project));
		await inTenant(s.tenant, () =>
			Artist.query().where("id", s.artist.id).update({ visible: false }),
		);
		const body = (await client.get(reviewsUrl(s.tenant.slug))).body() as {
			data: ReviewItem[];
		};
		assert.lengthOf(body.data, 1);
		assert.isNull(body.data[0].artist);
		assert.notInclude(JSON.stringify(body), s.artist.slug);
	});

	test("the average and count appear only from 3 shown reviews, to one decimal", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-d");
		const projects = [s.project];
		for (let n = 0; n < 4; n++) projects.push(await anotherProject(s));
		await inTenant(s.tenant, async () => {
			await seedReview(s.tenant, projects[0], { rating: 5 });
			await seedReview(s.tenant, projects[1], { rating: 4 });
			// Neither counts: not shown on the studio's page.
			await seedReview(s.tenant, projects[2], {
				rating: 1,
				consentStudioPage: false,
			});
			const down = await seedReview(s.tenant, projects[3], { rating: 1 });
			await down
				.merge({ takenDownAt: DateTime.now(), takedownReason: "hate" })
				.save();
		});
		const rating = async () =>
			(
				(await client.get(reviewsUrl(s.tenant.slug))).body() as {
					rating: { average: number; count: number } | null;
				}
			).rating;
		assert.isNull(await rating(), "two shown reviews: no average");

		await inTenant(s.tenant, () =>
			seedReview(s.tenant, projects[4], { rating: 4 }),
		);
		assert.deepEqual(await rating(), { average: 4.3, count: 3 });
	});

	test("pages newest first with a cursor, and refuses a malformed cursor or limit", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-e");
		const projects = [
			s.project,
			await anotherProject(s),
			await anotherProject(s),
		];
		const rows = await inTenant(s.tenant, async () => {
			const made: ClientReview[] = [];
			for (const [n, project] of projects.entries()) {
				made.push(
					await seedReview(s.tenant, project, { createdAt: at(n + 1) }),
				);
			}
			return made;
		});
		const first = (
			await client.get(reviewsUrl(s.tenant.slug, "?limit=2"))
		).body() as {
			data: ReviewItem[];
			nextCursor: string;
			rating: unknown;
		};
		assert.deepEqual(ids(first.data), [rows[2].id, rows[1].id]);
		assert.isString(first.nextCursor);
		assert.deepEqual(first.rating, { average: 5, count: 3 });
		const second = (
			await client.get(
				reviewsUrl(s.tenant.slug, `?limit=2&cursor=${first.nextCursor}`),
			)
		).body() as {
			data: ReviewItem[];
			nextCursor: string | null;
			rating: unknown;
		};
		assert.deepEqual(ids(second.data), [rows[0].id]);
		assert.isNull(second.nextCursor);
		assert.deepEqual(second.rating, first.rating, "the same on every page");

		const forged = encodeWorkCursor({
			at: "2026-02-31T00:00:00.000000Z",
			id: rows[0].id,
		});
		const bad = await client.get(
			reviewsUrl(s.tenant.slug, `?cursor=${forged}`),
		);
		assertApiError(bad, 422, "validation_failed");
		assert.deepEqual(bad.body().error.fields, { cursor: [CURSOR_MESSAGE] });
		assertApiError(
			await client.get(reviewsUrl(s.tenant.slug, "?limit=0")),
			422,
			"validation_failed",
		);
		assertApiError(
			await client.get(reviewsUrl(s.tenant.slug, "?limit=49")),
			422,
			"validation_failed",
		);
	});

	test("a deleted studio's reviews are the 404", async ({ client, assert }) => {
		const s = await studio("sp-reviews-f");
		const projects = [
			s.project,
			await anotherProject(s),
			await anotherProject(s),
		];
		await inTenant(s.tenant, async () => {
			for (const project of projects) await seedReview(s.tenant, project);
		});
		const on = (await client.get(reviewsUrl(s.tenant.slug))).body() as {
			data: unknown[];
		};
		assert.lengthOf(on.data, 3);

		await inTenant(s.tenant, () =>
			TenantModel.query()
				.where("id", s.tenant.id)
				.update({ deleted_at: new Date() }),
		);
		assertApiError(
			await client.get(reviewsUrl(s.tenant.slug)),
			404,
			"not_found",
		);
	});

	test("getStudio's sections carry Fresh ink and Reviews", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-reviews-g");
		const sections = async () =>
			(
				(await client.get(`/api/v1/tenants/${s.tenant.slug}`)).body() as {
					data: { storefront: { sections: { type: string }[] } };
				}
			).data.storefront.sections.map(({ type }) => type);
		assert.deepEqual(await sections(), [
			"work",
			"artists",
			"flash",
			"fresh_ink",
			"reviews",
			"info",
			"inquiry",
		]);
	});

	test("never lists the other studio's reviews, through the route or from the other studio's context", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const body = (await client.get(reviewsUrl(a.tenant.slug))).body() as {
			data: ReviewItem[];
		};
		assert.deepEqual(ids(body.data), [a.clientReview.id]);
		assert.notInclude(JSON.stringify(body), b.clientReview.id);

		// The app's own filter, without RLS's help: B's context, A's tenant.
		const service = new PublicReviewService(
			new ArtistService(new ImageService()),
			new ImageService(),
		);
		const page = await inTenant(b.tenant, () =>
			service.reviews(a.tenant as Tenant, { cursor: null, limit: 24 }),
		);
		assert.deepEqual(page.reviews, []);
		assert.isNull(page.rating);
		const posts = await inTenant(b.tenant, () =>
			service.freshInk(a.tenant as Tenant, { cursor: null, limit: 24 }),
		);
		assert.deepEqual(posts.posts, []);
	});
});

test.group("GET /api/v1/tenants/:tenant/fresh-ink (listFreshInk)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists a shown post with exactly the documented fields: public copies only, lead first, ready videos only", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-fresh-a");
		const { post, media } = await inTenant(s.tenant, () =>
			seedShownPost(s.tenant, s.project, {
				media: [
					"photo",
					"video-ready",
					"photo",
					"video-processing",
					"video-failed",
				],
				styles: ["fine-line", "not-a-style"],
				publishedAt: at(5),
			}),
		);

		const response = await client.get(freshInkUrl(s.tenant.slug));
		response.assertStatus(200);
		assert.equal(response.header("cache-control"), CACHED);
		assertApiHeaders(response);
		const body = response.body() as {
			data: PostItem[];
			nextCursor: string | null;
		};
		assert.sameMembers(Object.keys(body), FRESH_INK_BODY);
		assert.deepEqual(ids(body.data), [post.id]);
		const [item] = body.data;
		assert.sameMembers(Object.keys(item), POST_FIELDS);
		const publicPhoto = `tenants/${s.tenant.id}/fresh_ink_photo/`;
		const publicVideo = `tenants/${s.tenant.id}/fresh_ink_video/`;
		assert.include(item.url, publicPhoto);
		assert.include(
			item.url,
			(media[0].imageKey as string).split("/").at(-1) as string,
		);
		assert.deepEqual(
			item.angles.map((angle) => angle.kind),
			["video", "photo"],
			"the ready video and the photo, in order; never a processing or failed video",
		);
		const video = item.angles[0] as unknown as {
			poster: { url: string };
			sources: { url: string; type: string; width: number; height: number }[];
			durationMs: number;
		};
		assert.include(video.poster.url, publicVideo);
		assert.deepEqual(
			video.sources.map(({ width, height, type }) => ({ width, height, type })),
			[
				{ width: 720, height: 1280, type: "video/mp4" },
				{ width: 1080, height: 1920, type: "video/mp4" },
			],
		);
		for (const source of video.sources) assert.include(source.url, publicVideo);
		assert.equal(video.durationMs, 12_000);
		assert.include(item.angles[1].url as string, publicPhoto);
		assert.equal(item.shownName, "Sita R.");
		assert.equal(item.caption, "Healed after six weeks.");
		assert.equal(item.placement, "Left forearm");
		assert.deepEqual(item.styles, [{ slug: "fine-line", name: "Fine line" }]);
		assert.deepEqual(item.artist, { slug: s.artist.slug, name: s.artist.name });
		assert.equal(item.date, "2026-10-01");
		// Never a private key, a media row, the client or the project.
		const text = JSON.stringify(body);
		for (const secret of [
			"client_post_photo",
			"client_post_video",
			"client_video_upload",
			s.client.name,
			s.client.id,
			s.project.id,
			...media.map((row) => row.id),
		]) {
			assert.notInclude(text, secret);
		}
	});

	test("leaves out a post waiting, declined, unpublished, unpublished yet approved, without the studio-page consent, taken down or deleted", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-fresh-b");
		const projects = [s.project];
		for (let n = 0; n < 7; n++) projects.push(await anotherProject(s));
		const posts = await inTenant(s.tenant, async () => ({
			shown: await seedShownPost(s.tenant, projects[0]),
			waiting: await seedShownPost(s.tenant, projects[1], {
				status: "waiting",
				published: false,
			}),
			declined: await seedShownPost(s.tenant, projects[2], {
				status: "declined",
				published: false,
			}),
			unpublished: await seedShownPost(s.tenant, projects[3], {
				status: "unpublished",
				published: false,
			}),
			// Approved but its copies not made (published_at null): never served.
			notPublished: await seedShownPost(s.tenant, projects[4], {
				published: false,
			}),
			// Published for Discover only: not the studio's page.
			discoverOnly: await seedShownPost(s.tenant, projects[5], {
				consentStudioPage: false,
				consentDiscover: true,
			}),
			takenDown: await seedShownPost(s.tenant, projects[6], {
				published: false,
				takenDown: true,
			}),
			deleted: await seedShownPost(s.tenant, projects[7], {
				published: false,
			}),
		}));
		await inTenant(s.tenant, () =>
			ClientPost.query()
				.where("id", posts.deleted.post.id)
				.update({ deleted_at: new Date() }),
		);
		const body = (await client.get(freshInkUrl(s.tenant.slug))).body() as {
			data: PostItem[];
		};
		assert.deepEqual(ids(body.data), [posts.shown.post.id]);
	});

	test("tags only an artist the studio shows; a post whose lead has no public photo is left out", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-fresh-c");
		const { post } = await inTenant(s.tenant, () =>
			seedShownPost(s.tenant, s.project),
		);
		await inTenant(s.tenant, () =>
			Artist.query().where("id", s.artist.id).update({ visible: false }),
		);
		const body = (await client.get(freshInkUrl(s.tenant.slug))).body() as {
			data: PostItem[];
		};
		assert.deepEqual(ids(body.data), [post.id]);
		assert.isNull(body.data[0].artist);
		assert.notInclude(JSON.stringify(body), s.artist.slug);
	});

	test("pages newest published first with a cursor", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-fresh-d");
		const projects = [
			s.project,
			await anotherProject(s),
			await anotherProject(s),
		];
		const made = await inTenant(s.tenant, async () => {
			const rows = [];
			for (const [n, project] of projects.entries()) {
				rows.push(
					(await seedShownPost(s.tenant, project, { publishedAt: at(n + 1) }))
						.post,
				);
			}
			return rows;
		});
		const first = (
			await client.get(freshInkUrl(s.tenant.slug, "?limit=2"))
		).body() as { data: PostItem[]; nextCursor: string };
		assert.deepEqual(ids(first.data), [made[2].id, made[1].id]);
		const second = (
			await client.get(
				freshInkUrl(s.tenant.slug, `?limit=2&cursor=${first.nextCursor}`),
			)
		).body() as { data: PostItem[]; nextCursor: string | null };
		assert.deepEqual(ids(second.data), [made[0].id]);
		assert.isNull(second.nextCursor);
		assertApiError(
			await client.get(freshInkUrl(s.tenant.slug, "?cursor=not!a!cursor")),
			422,
			"validation_failed",
		);
	});

	test("a post approved through the dashboard is listed with the public copy publishing made", async ({
		client,
		assert,
	}) => {
		const s = await studio("sp-fresh-f");
		const { token } = await inTenant(s.tenant, () =>
			issueReviewLink(s.tenant, s.project, s.owner.id),
		);
		await addPhoto(client, s.tenant.slug, token);
		(
			await reviewRequest(client, "PUT", s.tenant.slug, "", token).json(
				reviewBody({
					review: undefined,
					consentStudioPage: true,
					post: { caption: "Healed after six weeks.", styles: [] },
				}),
			)
		).assertStatus(200);
		const post = await inTenant(s.tenant, () =>
			ClientPost.query().where("project_id", s.project.id).firstOrFail(),
		);
		assert.deepEqual(
			(
				(await client.get(freshInkUrl(s.tenant.slug))).body() as {
					data: unknown[];
				}
			).data,
			[],
			"waiting for the studio: not shown",
		);
		(
			await client
				.post(`/t/${s.tenant.slug}/reviews/posts/${post.id}/approve`)
				.loginAs(s.owner)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(302);

		const body = (await client.get(freshInkUrl(s.tenant.slug))).body() as {
			data: PostItem[];
		};
		assert.deepEqual(ids(body.data), [post.id]);
		const name = new URL(body.data[0].url).pathname.split("/").at(-1) ?? "";
		assert.include(await storedFiles(s.tenant, "fresh_ink_photo"), name);
	});
});

async function addPhoto(client: ApiClient, slug: string, token: string) {
	const response = await reviewRequest(
		client,
		"POST",
		slug,
		"/photos",
		token,
	).file("photo", await testImages.png(900, 700), {
		filename: "healed.png",
		contentType: "image/png",
	});
	response.assertStatus(201);
}
