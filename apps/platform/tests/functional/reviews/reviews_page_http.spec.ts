import router from "@adonisjs/core/services/router";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import TattooProject from "#modules/projects/models/tattoo_project";
import ClientPost from "#modules/reviews/models/client_post";
import ClientReview from "#modules/reviews/models/client_review";
import env from "#start/env";
import { makeArtist, makeProject } from "#tests/helpers/pipeline";
import { seedPost } from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * The Reviews page (Reviews and Fresh ink, slice 2): who sees which posts
 * and reviews, the studio's decisions, its reply and its report, and that
 * nothing lets a studio hide or edit a review or edit a post.
 */

const page = (studio: Studio, query = "") =>
	`/t/${studio.tenant.slug}/reviews${query}`;

/** Links the studio's artist member to its profile (every seeded project is the profile's). */
function linkArtist(studio: Studio) {
	return inTenant(studio.tenant, () =>
		Artist.query()
			.where("id", studio.artistProfile.id)
			.update({ user_id: studio.artist.id }),
	);
}

function review(studio: Studio) {
	return inTenant(studio.tenant, () =>
		ClientReview.findOrFail(studio.clientReview.id),
	);
}

test.group("Reviews page: who sees what", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the waiting post, the approved one under its filter and every review", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const waiting = await client.get(page(a)).loginAs(a.owner).withInertia();
		waiting.assertStatus(200);
		const props = waiting.inertiaProps as {
			posts: { id: string; canApprove: boolean; canDecline: boolean }[];
			waitingCount: number;
		};
		assert.deepEqual(
			props.posts.map(({ id }) => id),
			[a.waitingPost.id],
			"the draft is the client's own and never listed",
		);
		assert.isTrue(props.posts[0].canApprove);
		assert.isTrue(props.posts[0].canDecline);
		assert.equal(props.waitingCount, 1);

		const approved = await client
			.get(page(a, "?status=approved"))
			.loginAs(a.owner)
			.withInertia();
		const shown = (
			approved.inertiaProps as {
				posts: { id: string; canUnpublish: boolean; canApprove: boolean }[];
			}
		).posts;
		// Newest decision first: the published post twoStudios seeds for the
		// studio page's Fresh ink (slice 3), then the approved one.
		assert.deepEqual(
			shown.map(({ id }) => id),
			[a.freshInkPost.id, a.approvedPost.id],
		);
		for (const row of shown) {
			assert.isTrue(row.canUnpublish);
			assert.isFalse(row.canApprove);
		}

		const reviews = await client
			.get(page(a, "?view=reviews"))
			.loginAs(a.owner)
			.withInertia();
		const rows = (
			reviews.inertiaProps as {
				reviews: {
					id: string;
					rating: number;
					body: string;
					reply: { text: string };
				}[];
			}
		).reviews;
		assert.deepEqual(
			rows.map(({ id }) => id),
			[a.clientReview.id],
		);
		assert.equal(rows[0].rating, 5);
		assert.equal(rows[0].reply.text, "Thank you for coming in!");
	});

	test("an artist sees only the posts and reviews of projects assigned to their own profile", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// Without a linked profile: nothing.
		const none = await client.get(page(a)).loginAs(a.artist).withInertia();
		none.assertStatus(200);
		assert.deepEqual((none.inertiaProps as { posts: unknown[] }).posts, []);
		assert.equal(
			(none.inertiaProps as { waitingCount: number }).waitingCount,
			0,
		);

		await linkArtist(a);
		const mine = await client.get(page(a)).loginAs(a.artist).withInertia();
		assert.deepEqual(
			(mine.inertiaProps as { posts: { id: string }[] }).posts.map(
				({ id }) => id,
			),
			[a.waitingPost.id],
		);
		assert.deepEqual(
			(mine.inertiaProps as { artists: unknown[] }).artists,
			[],
			"no artist filter for an artist",
		);

		// The project moves to another artist: the artist sees nothing and can't act.
		const other = await inTenant(a.tenant, () =>
			makeArtist(a.tenant, "other-artist-2"),
		);
		await inTenant(a.tenant, () =>
			TattooProject.query()
				.where("id", a.reviewedProject.id)
				.update({ artist_id: other.id }),
		);
		const gone = await client.get(page(a)).loginAs(a.artist).withInertia();
		assert.deepEqual((gone.inertiaProps as { posts: unknown[] }).posts, []);
		(
			await client
				.post(page(a, `/posts/${a.waitingPost.id}/approve`))
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
		(
			await client
				.put(page(a, `/${a.clientReview.id}/reply`))
				.form({ reply: "Thanks!" })
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
		(
			await client
				.post(page(a, `/${a.clientReview.id}/report`))
				.form({ reason: "hate" })
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
		assert.equal(
			(await inTenant(a.tenant, () => ClientPost.findOrFail(a.waitingPost.id)))
				.status,
			"waiting",
		);
	});

	test("an owner narrows by artist; another studio's artist id is ignored", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const other = await inTenant(a.tenant, () =>
			makeArtist(a.tenant, "narrow-artist-2"),
		);
		const mine = await client
			.get(page(a, `?artist=${a.artistProfile.id}`))
			.loginAs(a.owner)
			.withInertia();
		assert.equal(
			(mine.inertiaProps as { artistId: string }).artistId,
			a.artistProfile.id,
		);
		assert.lengthOf((mine.inertiaProps as { posts: unknown[] }).posts, 1);
		const theirs = await client
			.get(page(a, `?artist=${other.id}`))
			.loginAs(a.owner)
			.withInertia();
		assert.lengthOf((theirs.inertiaProps as { posts: unknown[] }).posts, 0);
		const foreign = await client
			.get(page(a, `?artist=${b.artistProfile.id}`))
			.loginAs(a.owner)
			.withInertia();
		assert.isNull(
			(foreign.inertiaProps as { artistId: string | null }).artistId,
		);
		assert.lengthOf((foreign.inertiaProps as { posts: unknown[] }).posts, 1);
	});

	test("a taken-down post leaves Waiting and the count and is listed under Declined, said so", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, () =>
			ClientPost.query()
				.whereIn("id", [a.waitingPost.id, a.approvedPost.id])
				.update({ taken_down_at: new Date(), takedown_reason: "hate" }),
		);
		const props = async (query: string) =>
			(await client.get(page(a, query)).loginAs(a.owner).withInertia())
				.inertiaProps as {
				posts: {
					id: string;
					statusText: string;
					takenDown: string | null;
					canApprove: boolean;
					canDecline: boolean;
					canUnpublish: boolean;
				}[];
				waitingCount: number;
			};
		const waiting = await props("");
		assert.deepEqual(waiting.posts, []);
		assert.equal(waiting.waitingCount, 0);
		// Only the post they did not take down (twoStudios' published one) is left.
		assert.deepEqual(
			(await props("?status=approved")).posts.map(({ id }) => id),
			[a.freshInkPost.id],
		);
		const declined = await props("?status=declined");
		assert.sameMembers(
			declined.posts.map(({ id }) => id),
			[a.waitingPost.id, a.approvedPost.id],
		);
		for (const row of declined.posts) {
			assert.equal(row.statusText, "Taken down by TattooDrip");
			assert.isString(row.takenDown);
			assert.isFalse(row.canApprove || row.canDecline || row.canUnpublish);
		}
	});

	test("a taken-down review can't be replied to, and its report says it was taken down", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, () =>
			ClientReview.query().where("id", a.clientReview.id).update({
				reported_at: new Date(),
				report_reason: "hate",
				taken_down_at: new Date(),
				takedown_reason: "hate",
				report_resolved_at: new Date(),
			}),
		);
		const listed = await client
			.get(page(a, "?view=reviews"))
			.loginAs(a.owner)
			.withInertia();
		const [row] = (
			listed.inertiaProps as {
				reviews: {
					canReply: boolean;
					canReport: boolean;
					report: { outcome: string };
				}[];
			}
		).reviews;
		assert.isFalse(row.canReply);
		assert.isFalse(row.canReport);
		assert.equal(row.report.outcome, "removed");
	});

	test("25 a page, like the portfolio; a page past the last is the last", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, async () => {
			for (let index = 0; index < 25; index++) {
				const project = await makeProject(a.tenant, a.pipeline.client, {
					status: "completed",
					artistId: a.artistProfile.id,
				});
				await seedPost(a.tenant, project, { submitted: true });
			}
		});
		const first = await client.get(page(a)).loginAs(a.owner).withInertia();
		const firstProps = first.inertiaProps as {
			posts: unknown[];
			page: { current: number; last: number; total: number };
			waitingCount: number;
		};
		assert.lengthOf(firstProps.posts, 25);
		assert.deepEqual(firstProps.page, { current: 1, last: 2, total: 26 });
		assert.equal(firstProps.waitingCount, 26);
		const past = await client
			.get(page(a, "?page=9"))
			.loginAs(a.owner)
			.withInertia();
		const pastProps = past.inertiaProps as {
			posts: unknown[];
			page: { current: number };
		};
		assert.equal(pastProps.page.current, 2);
		assert.lengthOf(pastProps.posts, 1);
	});

	test("the nav's count is the posts waiting for the member, shared on every page", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const today = await client
			.get(`/t/${a.tenant.slug}/today`)
			.loginAs(a.owner)
			.withInertia();
		assert.equal(
			(today.inertiaProps as { reviewsCount: number }).reviewsCount,
			1,
		);
		const artist = await client
			.get(`/t/${a.tenant.slug}/today`)
			.loginAs(a.artist)
			.withInertia();
		assert.equal(
			(artist.inertiaProps as { reviewsCount: number }).reviewsCount,
			0,
		);
	});
});

test.group("Reviews page: the studio's decisions", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("approve, then decline is refused; decline asks nothing more of the server; unpublish an approved post", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const approve = await client
			.post(page(a, `/posts/${a.waitingPost.id}/approve`))
			.form({ back: page(a, "?status=waiting") })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		approve.assertStatus(302);
		approve.assertHeader("location", page(a, "?status=waiting"));
		approve.assertFlashMessage(
			"success",
			"Approved. The client hasn't allowed any page yet, so it's kept for you.",
		);
		const approved = await inTenant(a.tenant, () =>
			ClientPost.findOrFail(a.waitingPost.id),
		);
		assert.equal(approved.status, "approved");
		assert.equal(approved.decidedBy, a.owner.id);

		const again = await client
			.post(page(a, `/posts/${a.waitingPost.id}/decline`))
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		again.assertFlashMessage(
			"error",
			"This post isn't waiting any more. The page shows it as it is now.",
		);

		const unpublish = await client
			.post(page(a, `/posts/${a.approvedPost.id}/unpublish`))
			.form({ back: "https://evil.example/" })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		// An outside back is ignored.
		unpublish.assertHeader("location", page(a));
		assert.equal(
			(await inTenant(a.tenant, () => ClientPost.findOrFail(a.approvedPost.id)))
				.status,
			"unpublished",
		);
	});

	test("a reply: posted, edited, one at most, 1,000 characters, and nothing else of the review changes", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const before = await review(a);
		const response = await client
			.put(page(a, `/${a.clientReview.id}/reply`))
			.form({
				reply: "  Thank you, Sita!  ",
				// A studio can never edit the client's words: these are ignored.
				rating: 1,
				body: "Terrible, never again, would not recommend at all.",
				shownName: "Someone else",
				consentStudioPage: false,
			})
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		response.assertStatus(302);
		response.assertFlashMessage("success", "Reply saved.");
		const after = await review(a);
		assert.equal(after.reply, "Thank you, Sita!");
		assert.equal(after.rating, before.rating);
		assert.equal(after.body, before.body);
		assert.equal(after.shownName, before.shownName);
		assert.equal(after.consentStudioPage, before.consentStudioPage);

		const long = await client
			.put(page(a, `/${a.clientReview.id}/reply`))
			.form({ reply: "ा".repeat(1001) })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		assertValidationError(long, "reply");
		const exact = await client
			.put(page(a, `/${a.clientReview.id}/reply`))
			.form({ reply: "ा".repeat(1000) })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		exact.assertFlashMessage("success", "Reply saved.");

		const removed = await client
			.delete(page(a, `/${a.clientReview.id}/reply`))
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		removed.assertFlashMessage("success", "Reply deleted.");
		const cleared = await review(a);
		assert.isNull(cleared.reply);
		assert.isNull(cleared.repliedAt);
		assert.equal(cleared.body, before.body);

		const posted = await client
			.put(page(a, `/${a.clientReview.id}/reply`))
			.form({ reply: "Thanks again." })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		posted.assertFlashMessage("success", "Reply posted.");
	});

	test("a report: a reason and an optional note, once while open; the review stays up", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const refused = await client
			.post(page(a, `/${a.clientReview.id}/report`))
			.form({ reason: "rude" })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		assertValidationError(refused, "reason");

		const response = await client
			.post(page(a, `/${a.clientReview.id}/report`))
			.form({ reason: "not_a_client", note: "Never tattooed here." })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		response.assertFlashMessage(
			"success",
			"Reported to TattooDrip. The review stays up until they decide.",
		);
		const reported = await review(a);
		assert.equal(reported.reportReason, "not_a_client");
		assert.equal(reported.reportNote, "Never tattooed here.");
		assert.equal(reported.reportedBy, a.owner.id);
		assert.isNull(
			reported.takenDownAt,
			"a reported review stays up (ruling 6)",
		);
		assert.isNull(reported.deletedAt);

		const twice = await client
			.post(page(a, `/${a.clientReview.id}/report`))
			.form({ reason: "hate" })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		twice.assertFlashMessage(
			"error",
			"You reported this already. TattooDrip will decide.",
		);
		assert.equal((await review(a)).reportReason, "not_a_client");

		const listed = await client
			.get(page(a, "?view=reviews&filter=reported"))
			.loginAs(a.owner)
			.withInertia();
		const rows = (
			listed.inertiaProps as {
				reviews: {
					id: string;
					canReport: boolean;
					report: { outcome: string };
				}[];
			}
		).reviews;
		assert.deepEqual(
			rows.map(({ id }) => id),
			[a.clientReview.id],
		);
		assert.isFalse(rows[0].canReport);
		assert.equal(rows[0].report.outcome, "open");
	});

	test("a deleted review is gone from the page and its routes", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, async () => {
			const row = await ClientReview.findOrFail(a.clientReview.id);
			await row.softDelete();
		});
		const listed = await client
			.get(page(a, "?view=reviews"))
			.loginAs(a.owner)
			.withInertia();
		assert.deepEqual(
			(listed.inertiaProps as { reviews: unknown[] }).reviews,
			[],
		);
		(
			await client
				.put(page(a, `/${a.clientReview.id}/reply`))
				.form({ reply: "Hello" })
				.loginAs(a.owner)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
	});

	test("no route edits or hides a review, or edits a post (rulings 6 and 7)", ({
		assert,
	}) => {
		const routes = Object.values(router.toJSON())
			.flat()
			.filter(({ pattern }) => pattern.startsWith("/t/:tenant/reviews"))
			.map(
				({ methods, pattern }) =>
					`${methods.filter((m) => m !== "HEAD").join(",")} ${pattern}`,
			)
			.sort();
		assert.deepEqual(routes, [
			"DELETE /t/:tenant/reviews/:id/reply",
			"GET /t/:tenant/reviews",
			"POST /t/:tenant/reviews/:id/report",
			"POST /t/:tenant/reviews/posts/:id/approve",
			"POST /t/:tenant/reviews/posts/:id/decline",
			"POST /t/:tenant/reviews/posts/:id/unpublish",
			"PUT /t/:tenant/reviews/:id/reply",
		]);
	});
});

test.group("Reviews page: the feature flag", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("off, every review route is a 404 and the shell has no Reviews count", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		env.set("REVIEWS_ENABLED", false);
		try {
			const sends = [
				client.get(page(a)),
				client.post(page(a, `/posts/${a.waitingPost.id}/approve`)),
				client.post(page(a, `/posts/${a.waitingPost.id}/decline`)),
				client.post(page(a, `/posts/${a.approvedPost.id}/unpublish`)),
				client
					.put(page(a, `/${a.clientReview.id}/reply`))
					.form({ reply: "Hi" }),
				client.delete(page(a, `/${a.clientReview.id}/reply`)),
				client
					.post(page(a, `/${a.clientReview.id}/report`))
					.form({ reason: "hate" }),
				client.post(
					`/t/${a.tenant.slug}/projects/${a.finishProject.id}/review-link`,
				),
				client.delete(
					`/t/${a.tenant.slug}/projects/${a.reviewProject.id}/review-link`,
				),
			];
			for (const send of sends) {
				(await send.loginAs(a.owner).withCsrfToken().redirects(0)).assertStatus(
					404,
				);
			}
			const today = await client
				.get(`/t/${a.tenant.slug}/today`)
				.loginAs(a.owner)
				.withInertia();
			assert.isNull(
				(today.inertiaProps as { reviewsCount: null }).reviewsCount,
			);
			const project = await client
				.get(`/t/${a.tenant.slug}/projects/${a.reviewProject.id}`)
				.loginAs(a.owner)
				.withInertia();
			assert.isNull((project.inertiaProps as { review: null }).review);
		} finally {
			env.set("REVIEWS_ENABLED", true);
		}
		assert.equal(
			(await inTenant(a.tenant, () => ClientPost.findOrFail(a.waitingPost.id)))
				.status,
			"waiting",
		);
		assert.equal((await review(a)).reply, "Thank you for coming in!");
	});
});
