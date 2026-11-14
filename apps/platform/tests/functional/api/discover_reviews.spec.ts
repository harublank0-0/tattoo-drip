import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import { verifyReferral } from "#modules/discovery/referral";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiError } from "#tests/helpers/api";
import { reviewReady, seedReview, seedShownPost } from "#tests/helpers/reviews";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Reviews and Fresh ink on Discover (slice 4) against PostgreSQL: a
 * profile's reviews with its rating (only from 3, ruling 10), a profile's
 * Fresh ink and the global feed, read through the `discovery` views with no
 * context (docs/discover/api.md, "Reviews and Fresh ink"). Every visibility
 * rule (the client's Discover consent, a takedown, a delete, the studio's
 * decision, publication, a reply taken down, unready videos, a hidden
 * artist, an unlisted or suspended studio and its return), the
 * exact fields, paging, the 404s and 422s, and cross-tenant isolation.
 */

const CACHED = "public, max-age=60, stale-while-revalidate=60";
const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
const at = (minutes: number) => T0.plus({ minutes });

const REVIEW_FIELDS = [
	"artist",
	"body",
	"date",
	"id",
	"rating",
	"reply",
	"shownName",
	"studio",
];
const POST_FIELDS = [
	"alt",
	"angles",
	"artist",
	"artistAcceptingInquiries",
	"bookingUrl",
	"caption",
	"date",
	"height",
	"id",
	"location",
	"placement",
	"shownName",
	"storefrontUrl",
	"studio",
	"styles",
	"url",
	"variants",
	"width",
];

type Item = { id: string };
const ids = (response: ApiResponse) =>
	(response.body().data as Item[]).map((row) => row.id);
const text = (response: ApiResponse) => JSON.stringify(response.body());

async function list(tenant: Tenant, city = "kathmandu") {
	await inTenant(tenant, () =>
		dbClient().rawQuery(
			`update tenants set discovery_listed = true, discovery_listed_at = ?,
			 place_id = (select id from places where country_code = 'NP' and slug = ?)
			 where id = ?`,
			[T0.toJSDate(), city, tenant.id],
		),
	);
}

async function sql(tenant: { id: string }, query: string, bindings: unknown[]) {
	await inTenant(tenant, () => dbClient().rawQuery(query, bindings as never));
}

/** One more completed project of `artist` (one review and one post per project). */
async function project(tenant: Tenant, artist: Artist): Promise<TattooProject> {
	const made = await inTenant(tenant, () =>
		reviewReady(tenant, {
			artistSlug: `x-${Math.random().toString(36).slice(2, 8)}`,
			clientName: "Asha Gurung",
		}),
	);
	await inTenant(tenant, () =>
		made.project.merge({ artistId: artist.id }).save(),
	);
	return made.project;
}

/**
 * Black Needle (listed, Kathmandu) with its artist "review-artist" and a
 * second artist; Lotus Ink (listed, Pokhara); a never-listed studio. Each
 * has Discover-consented reviews.
 */
async function world() {
	const needle = await studioWithOwner("dr-black-needle", "Black Needle");
	await list(needle.tenant);
	const ready = await inTenant(needle.tenant, () => reviewReady(needle.tenant));
	const other = await inTenant(needle.tenant, () =>
		reviewReady(needle.tenant, {
			artistSlug: "dr-second",
			clientName: "Bina Tamang",
		}),
	);

	const lotus = await studioWithOwner("dr-lotus-ink", "Lotus Ink");
	await list(lotus.tenant, "pokhara");
	const lotusReady = await inTenant(lotus.tenant, () =>
		reviewReady(lotus.tenant, { clientName: "Ram Thapa" }),
	);

	const hidden = await studioWithOwner("dr-unlisted", "Unlisted Ink");
	const hiddenReady = await inTenant(hidden.tenant, () =>
		reviewReady(hidden.tenant, { clientName: "Ghost Client" }),
	);

	return { needle, ready, other, lotus, lotusReady, hidden, hiddenReady };
}

const discoverReview = (
	tenant: Tenant,
	of: Pick<TattooProject, "id" | "clientId" | "artistId">,
	over: Parameters<typeof seedReview>[2] = {},
) =>
	inTenant(tenant, () =>
		seedReview(tenant, of, { consentDiscover: true, ...over }),
	);

const discoverPost = (
	tenant: Tenant,
	of: Pick<TattooProject, "id" | "clientId" | "artistId">,
	over: Parameters<typeof seedShownPost>[2] = {},
) =>
	inTenant(tenant, () =>
		seedShownPost(tenant, of, { consentDiscover: true, ...over }),
	);

test.group("Discover reviews (slice 4)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio's reviews: Discover-consented only, newest first, the documented fields, no client data", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const second = await project(w.needle.tenant, w.ready.artist);
		const older = await discoverReview(w.needle.tenant, w.ready.project, {
			rating: 4,
			body: "The line work healed evenly, really happy with it.",
			reply: "Thank you, Sita!",
			createdAt: at(1),
		});
		const newer = await discoverReview(w.needle.tenant, second, {
			rating: 5,
			shownName: "A. G.",
			createdAt: at(2),
		});
		// Allowed on the studio's own page only: never on Discover.
		await inTenant(w.needle.tenant, () =>
			seedReview(w.needle.tenant, w.other.project, {
				body: "Only for the studio's own page, never Discover.",
				createdAt: at(3),
			}),
		);

		const response = await client.get(
			"/api/v1/discover/studios/dr-black-needle/reviews",
		);
		response.assertStatus(200);
		assert.equal(response.header("cache-control"), CACHED);
		assert.isString(response.header("etag"));
		const body = response.body();
		assert.sameMembers(Object.keys(body), ["data", "nextCursor", "rating"]);
		assert.deepEqual(ids(response), [newer.id, older.id]);
		for (const item of body.data) {
			assert.sameMembers(Object.keys(item), REVIEW_FIELDS);
		}
		assert.deepEqual(body.data[1], {
			id: older.id,
			rating: 4,
			body: "The line work healed evenly, really happy with it.",
			shownName: "Sita R.",
			date: "2026-10-01",
			artist: {
				id: w.ready.artist.id,
				slug: w.ready.artist.slug,
				name: w.ready.artist.name,
			},
			studio: { slug: "dr-black-needle", name: "Black Needle", type: "studio" },
			reply: {
				body: "Thank you, Sita!",
				date: (older.repliedAt as DateTime)
					.setZone(w.needle.tenant.timezone)
					.toISODate() as string,
			},
		});
		assert.isNull(body.rating, "two reviews: no average (ruling 10)");
		assert.isNull(body.nextCursor);
		for (const secret of [
			"Sita Rai",
			"Only for the studio's own page",
			w.ready.client.id,
			w.ready.project.id,
			"consent",
			"report",
			"takedown",
		]) {
			assert.notInclude(text(response), secret, secret);
		}
	});

	test("the rating counts only from 3 reviews, rounded to one decimal, from every page", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const p2 = await project(w.needle.tenant, w.ready.artist);
		const p3 = await project(w.needle.tenant, w.ready.artist);
		await discoverReview(w.needle.tenant, w.ready.project, {
			rating: 5,
			createdAt: at(1),
		});
		await discoverReview(w.needle.tenant, p2, { rating: 4, createdAt: at(2) });
		const url = "/api/v1/discover/studios/dr-black-needle/reviews";
		assert.isNull((await client.get(url)).body().rating);

		await discoverReview(w.needle.tenant, p3, { rating: 4, createdAt: at(3) });
		const first = await client.get(`${url}?limit=1`);
		assert.deepEqual(first.body().rating, { average: 4.3, count: 3 });
		assert.lengthOf(first.body().data, 1);
		const next = await client.get(
			`${url}?limit=1&cursor=${first.body().nextCursor}`,
		);
		assert.deepEqual(next.body().rating, { average: 4.3, count: 3 });
		const last = await client.get(
			`${url}?limit=1&cursor=${next.body().nextCursor}`,
		);
		assert.isNull(last.body().nextCursor);
		assert.sameMembers(
			[...ids(first), ...ids(next), ...ids(last)],
			ids(await client.get(url)),
		);

		// A review taken off Discover leaves the count: below 3 again.
		await sql(
			w.needle.tenant,
			"update client_reviews set consent_discover = false where project_id = ?",
			[p3.id],
		);
		assert.isNull((await client.get(url)).body().rating);
	});

	test("an artist's reviews and rating are their own; a hidden or another studio's artist is a 404", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const p2 = await project(w.needle.tenant, w.ready.artist);
		const p3 = await project(w.needle.tenant, w.ready.artist);
		for (const [index, of] of [w.ready.project, p2, p3].entries()) {
			await discoverReview(w.needle.tenant, of, {
				rating: 3,
				createdAt: at(index),
			});
		}
		const below = await discoverReview(w.needle.tenant, w.other.project, {
			rating: 5,
			createdAt: at(10),
		});
		const artistUrl = (slug: string) =>
			`/api/v1/discover/studios/dr-black-needle/artists/${slug}/reviews`;

		const own = await client.get(artistUrl(w.ready.artist.slug));
		own.assertStatus(200);
		assert.lengthOf(own.body().data, 3);
		assert.deepEqual(own.body().rating, { average: 3, count: 3 });
		const few = await client.get(artistUrl("dr-second"));
		assert.deepEqual(ids(few), [below.id]);
		assert.isNull(few.body().rating, "a below-threshold artist: no average");
		const studio = await client.get(
			"/api/v1/discover/studios/dr-black-needle/reviews",
		);
		assert.deepEqual(studio.body().rating, { average: 3.5, count: 4 });

		// Lotus Ink's artist under Black Needle's slug, and an unknown one.
		assertApiError(await client.get(artistUrl("dr-nobody")), 404, "not_found");
		await sql(
			w.needle.tenant,
			"update artists set visible = false where id = ?",
			[w.other.artist.id],
		);
		assertApiError(await client.get(artistUrl("dr-second")), 404, "not_found");
		// The hidden artist's review leaves the studio's list and rating too.
		const after = await client.get(
			"/api/v1/discover/studios/dr-black-needle/reviews",
		);
		assert.notInclude(ids(after), below.id);
		assert.deepEqual(after.body().rating, { average: 3, count: 3 });
	});

	test("taken down, deleted, consent withdrawn and a reply taken down: each as the rule says", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const p2 = await project(w.needle.tenant, w.ready.artist);
		const p3 = await project(w.needle.tenant, w.ready.artist);
		const p4 = await project(w.needle.tenant, w.ready.artist);
		const shown = await discoverReview(w.needle.tenant, w.ready.project, {
			reply: "Thanks!",
		});
		const takenDown = await discoverReview(w.needle.tenant, p2);
		const deleted = await discoverReview(w.needle.tenant, p3);
		const withdrawn = await discoverReview(w.needle.tenant, p4);
		await sql(
			w.needle.tenant,
			"update client_reviews set taken_down_at = now(), takedown_reason = 'other' where id = ?",
			[takenDown.id],
		);
		await sql(
			w.needle.tenant,
			"update client_reviews set deleted_at = now() where id = ?",
			[deleted.id],
		);
		await sql(
			w.needle.tenant,
			"update client_reviews set consent_discover = false where id = ?",
			[withdrawn.id],
		);
		await sql(
			w.needle.tenant,
			"update client_reviews set reply_taken_down_at = now(), reply_takedown_reason = 'hate' where id = ?",
			[shown.id],
		);
		const response = await client.get(
			"/api/v1/discover/studios/dr-black-needle/reviews",
		);
		assert.deepEqual(ids(response), [shown.id]);
		assert.isNull(
			response.body().data[0].reply,
			"the reply is down, the review stays",
		);
		assert.notInclude(text(response), "Thanks!");
	});

	test("a studio that unlists or is suspended takes its reviews off at once; listing again brings them back", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const review = await discoverReview(w.needle.tenant, w.ready.project);
		const url = "/api/v1/discover/studios/dr-black-needle/reviews";
		for (const [off, on] of [
			[
				"update tenants set discovery_listed = false where id = ?",
				"update tenants set discovery_listed = true where id = ?",
			],
			[
				"update tenants set discovery_suspended_at = now() where id = ?",
				"update tenants set discovery_suspended_at = null where id = ?",
			],
		]) {
			await sql(w.needle.tenant, off, [w.needle.tenant.id]);
			assertApiError(await client.get(url), 404, "not_found");
			assertApiError(
				await client.get(
					`/api/v1/discover/studios/dr-black-needle/artists/${w.ready.artist.slug}/reviews`,
				),
				404,
				"not_found",
			);
			await sql(w.needle.tenant, on, [w.needle.tenant.id]);
			assert.deepEqual(ids(await client.get(url)), [review.id]);
		}
		// A never-listed studio's consented reviews: the same 404.
		await discoverReview(w.hidden.tenant, w.hiddenReady.project);
		assertApiError(
			await client.get("/api/v1/discover/studios/dr-unlisted/reviews"),
			404,
			"not_found",
		);
	});

	test("cross-tenant: one studio's reviews never answer under another", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const mine = await discoverReview(w.needle.tenant, w.ready.project);
		const theirs = await discoverReview(w.lotus.tenant, w.lotusReady.project);
		const needle = await client.get(
			"/api/v1/discover/studios/dr-black-needle/reviews",
		);
		const lotus = await client.get(
			"/api/v1/discover/studios/dr-lotus-ink/reviews",
		);
		assert.deepEqual(ids(needle), [mine.id]);
		assert.deepEqual(ids(lotus), [theirs.id]);
		// Lotus Ink's artist slug under Black Needle: not theirs (both are "review-artist").
		const crossed = await client.get(
			`/api/v1/discover/studios/dr-black-needle/artists/${w.lotusReady.artist.slug}/reviews`,
		);
		assert.deepEqual(ids(crossed), [mine.id]);
		assert.notInclude(text(crossed), theirs.id);
	});

	test("an independent artist's reviews, under their business's slug only", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner("dr-solo-owner", "Solo Owner");
		const solo = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Asha Solo",
			slug: "dr-asha-solo",
			timezone: "Asia/Kathmandu",
		});
		await list(solo, "lalitpur");
		const ready = await inTenant(solo, () => reviewReady(solo));
		// The profile is the business's first-made shown artist (its owner's).
		const profile = await inTenant(solo, () =>
			Artist.query()
				.where("tenant_id", solo.id)
				.orderBy("created_at", "asc")
				.orderBy("id", "asc")
				.firstOrFail(),
		);
		await inTenant(solo, () =>
			ready.project.merge({ artistId: profile.id }).save(),
		);
		const review = await discoverReview(solo, ready.project);
		const response = await client.get(
			"/api/v1/discover/artists/dr-asha-solo/reviews",
		);
		response.assertStatus(200);
		assert.deepEqual(ids(response), [review.id]);
		assert.equal(response.body().data[0].studio.type, "independent");
		// Not a studio: the studio route is a 404, and the reverse.
		assertApiError(
			await client.get("/api/v1/discover/studios/dr-asha-solo/reviews"),
			404,
			"not_found",
		);
		await studioWithOwner("dr-plain-studio", "Plain Studio").then(
			({ tenant }) => list(tenant),
		);
		assertApiError(
			await client.get("/api/v1/discover/artists/dr-plain-studio/reviews"),
			404,
			"not_found",
		);
	});

	test("malformed cursors and limits are 422s; malformed slugs the router's 404", async ({
		client,
	}) => {
		await world();
		for (const query of [
			"?limit=0",
			"?limit=49",
			"?cursor=%25%25",
			"?cursor=abc",
		]) {
			assertApiError(
				await client.get(
					`/api/v1/discover/studios/dr-black-needle/reviews${query}`,
				),
				422,
				"validation_failed",
			);
			assertApiError(
				await client.get(`/api/v1/discover/fresh-ink${query}`),
				422,
				"validation_failed",
			);
		}
		for (const query of ["?style=nope", "?city=kathmandu", "?country=NPL"]) {
			assertApiError(
				await client.get(`/api/v1/discover/fresh-ink${query}`),
				422,
				"validation_failed",
			);
		}
		assertApiError(
			await client.get("/api/v1/discover/studios/X/reviews"),
			404,
			"not_found",
		);
	});
});

test.group("Discover Fresh ink (slice 4)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the feed: consented, approved, published posts, newest first, public copies and the booking fields", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const older = await discoverPost(w.needle.tenant, w.ready.project, {
			media: [
				"photo",
				"video-ready",
				"photo",
				"video-processing",
				"video-failed",
			],
			styles: ["fine-line"],
			publishedAt: at(1),
		});
		const newer = await discoverPost(w.lotus.tenant, w.lotusReady.project, {
			styles: ["blackwork"],
			publishedAt: at(2),
		});
		// The studio's own page only: never on Discover.
		await discoverPost(w.needle.tenant, w.other.project, {
			consentDiscover: false,
			publishedAt: at(3),
		});
		// A never-listed studio's consented post.
		await discoverPost(w.hidden.tenant, w.hiddenReady.project, {
			publishedAt: at(4),
		});

		const response = await client.get("/api/v1/discover/fresh-ink");
		response.assertStatus(200);
		assert.equal(response.header("cache-control"), CACHED);
		assert.deepEqual(ids(response), [newer.post.id, older.post.id]);
		const post = response.body().data[1];
		assert.sameMembers(Object.keys(post), POST_FIELDS);
		assert.match(post.url, /\/fresh_ink_photo\//);
		assert.deepEqual(
			post.angles.map((angle: { kind: string }) => angle.kind),
			["video", "photo"],
			"ready videos only, in the client's order",
		);
		assert.match(post.angles[0].poster.url, /\/fresh_ink_video\//);
		assert.match(post.angles[0].sources[0].url, /\/fresh_ink_video\//);
		assert.deepEqual(post.artist, {
			id: w.ready.artist.id,
			slug: w.ready.artist.slug,
			name: w.ready.artist.name,
		});
		assert.deepEqual(post.studio, {
			slug: "dr-black-needle",
			name: "Black Needle",
			type: "studio",
		});
		assert.equal(post.location.slug, "kathmandu");
		assert.isTrue(post.artistAcceptingInquiries);
		assert.equal(post.shownName, "Sita R.");
		assert.deepEqual(post.styles, [{ slug: "fine-line", name: "Fine line" }]);
		const booking = new URL(post.bookingUrl);
		assert.equal(booking.pathname, "/book");
		assert.equal(booking.searchParams.get("artist"), w.ready.artist.slug);
		assert.isTrue(
			verifyReferral(booking.searchParams.get("ref") ?? "", w.needle.tenant.id)
				.valid,
		);
		assert.equal(new URL(post.storefrontUrl).host, booking.host);
		// Never a private key, a client's name or id, or the other posts.
		for (const secret of [
			"client_post_",
			"Sita Rai",
			w.ready.client.id,
			w.ready.project.id,
			"Ghost Client",
		]) {
			assert.notInclude(text(response), secret, secret);
		}
	});

	test("waiting, declined, unpublished, taken down, deleted or unpublished-copies posts are never shown", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const shown = await discoverPost(w.needle.tenant, w.ready.project);
		const hiddenPosts: string[] = [];
		for (const over of [
			{ status: "waiting" as const, published: false },
			{ status: "declined" as const, published: false },
			{ status: "unpublished" as const, published: false },
			{ published: false },
			{ takenDown: true, published: false },
		]) {
			const of = await project(w.needle.tenant, w.ready.artist);
			hiddenPosts.push((await discoverPost(w.needle.tenant, of, over)).post.id);
		}
		const deleted = await discoverPost(
			w.needle.tenant,
			await project(w.needle.tenant, w.ready.artist),
		);
		await sql(
			w.needle.tenant,
			"update client_posts set deleted_at = now(), published_at = null where id = ?",
			[deleted.post.id],
		);
		hiddenPosts.push(deleted.post.id);
		for (const url of [
			"/api/v1/discover/fresh-ink",
			"/api/v1/discover/studios/dr-black-needle/fresh-ink",
			`/api/v1/discover/studios/dr-black-needle/artists/${w.ready.artist.slug}/fresh-ink`,
		]) {
			const response = await client.get(url);
			assert.include(ids(response), shown.post.id, url);
			for (const id of hiddenPosts) assert.notInclude(ids(response), id, url);
		}
	});

	test("a hidden artist's, an unlisted or suspended studio's posts leave every list, and come back", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const post = await discoverPost(w.needle.tenant, w.ready.project);
		const feed = () => client.get("/api/v1/discover/fresh-ink");
		assert.include(ids(await feed()), post.post.id);
		for (const [off, on, target] of [
			[
				"update tenants set discovery_listed = false where id = ?",
				"update tenants set discovery_listed = true where id = ?",
				w.needle.tenant.id,
			],
			[
				"update tenants set discovery_suspended_at = now() where id = ?",
				"update tenants set discovery_suspended_at = null where id = ?",
				w.needle.tenant.id,
			],
			[
				"update artists set discovery_listed = false where id = ?",
				"update artists set discovery_listed = true where id = ?",
				w.ready.artist.id,
			],
		]) {
			await sql(w.needle.tenant, off, [target]);
			assert.notInclude(ids(await feed()), post.post.id, off);
			await sql(w.needle.tenant, on, [target]);
			assert.include(ids(await feed()), post.post.id, on);
		}
		assertApiError(
			await client.get("/api/v1/discover/studios/dr-unlisted/fresh-ink"),
			404,
			"not_found",
		);
	});

	test("each post says whether its artist takes new requests (the artwork page's rule)", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const post = await discoverPost(w.needle.tenant, w.ready.project);
		await sql(
			w.needle.tenant,
			"update artists set accepting_inquiries = false where id = ?",
			[w.ready.artist.id],
		);
		const feed = await client.get("/api/v1/discover/fresh-ink");
		const shown = (
			feed.body().data as { id: string; artistAcceptingInquiries: boolean }[]
		).find((each) => each.id === post.post.id);
		assert.isFalse(shown?.artistAcceptingInquiries);
		const profile = await client.get(
			"/api/v1/discover/studios/dr-black-needle/fresh-ink",
		);
		assert.isFalse(profile.body().data[0].artistAcceptingInquiries);
	});

	test("filters by style and by place, and pages by cursor without repeats", async ({
		client,
		assert,
	}) => {
		const w = await world();
		const posts: string[] = [];
		for (let i = 0; i < 3; i++) {
			const of =
				i === 0
					? w.ready.project
					: await project(w.needle.tenant, w.ready.artist);
			posts.push(
				(
					await discoverPost(w.needle.tenant, of, {
						styles: ["fine-line"],
						publishedAt: at(i),
					})
				).post.id,
			);
		}
		const lotus = await discoverPost(w.lotus.tenant, w.lotusReady.project, {
			styles: ["blackwork"],
			publishedAt: at(10),
		});

		const style = await client.get(
			"/api/v1/discover/fresh-ink?style=blackwork",
		);
		assert.deepEqual(ids(style), [lotus.post.id]);
		const city = await client.get(
			"/api/v1/discover/fresh-ink?country=np&city=kathmandu",
		);
		assert.deepEqual(ids(city), [...posts].reverse());
		const elsewhere = await client.get("/api/v1/discover/fresh-ink?country=IN");
		assert.deepEqual(ids(elsewhere), []);

		const first = await client.get(
			"/api/v1/discover/fresh-ink?country=NP&city=kathmandu&limit=2",
		);
		assert.lengthOf(ids(first), 2);
		const next = await client.get(
			`/api/v1/discover/fresh-ink?country=NP&city=kathmandu&limit=2&cursor=${first.body().nextCursor}`,
		);
		assert.deepEqual([...ids(first), ...ids(next)], [...posts].reverse());
		assert.isNull(next.body().nextCursor);

		// The studio's profile: its own posts only (cross-tenant).
		const profile = await client.get(
			"/api/v1/discover/studios/dr-lotus-ink/fresh-ink",
		);
		assert.deepEqual(ids(profile), [lotus.post.id]);
	});
});
