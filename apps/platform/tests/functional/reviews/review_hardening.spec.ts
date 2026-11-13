import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import SweepStuckVideosJob from "#modules/artists/jobs/sweep_stuck_videos_job";
import Client from "#modules/clients/models/client";
import { STUCK_AFTER_MINUTES, VIDEO_STUCK } from "#modules/media/video";
import { clientVideoUploadToken } from "#modules/reviews/client_video_uploads";
import ClearSubmittersJob, {
	clearStaleSubmitters,
} from "#modules/reviews/jobs/clear_submitters_job";
import FailStuckClientVideoJob from "#modules/reviews/jobs/fail_stuck_client_video_job";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import ClientVideoReservation from "#modules/reviews/models/client_video_reservation";
import ReviewLink from "#modules/reviews/models/review_link";
import { REVIEW_LIMITS } from "#modules/reviews/review_limits";
import { defaultShownName } from "#modules/reviews/rules";
import { API_LIMITS } from "#services/api_limits";
import BotChallenge from "#services/bot_challenge";
import { dispatchInTransaction } from "#services/queue";
import { assertApiError } from "#tests/helpers/api";
import { enableChallenge, siteverify } from "#tests/helpers/challenge";
import { testImages } from "#tests/helpers/images";
import {
	reviewBody,
	reviewRequest,
	reviewServices,
	seedPost,
	stageReviewClip,
	storedFiles,
} from "#tests/helpers/reviews";
import { sql } from "#tests/helpers/sql";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
import { makeClip } from "#tests/helpers/videos";
import { processQueued, registerJob } from "#tests/helpers/worker";

/**
 * The review fixes (findings 1 to 12): takedown and decline evasion, the
 * Discover consent, the limits against the API gate, stuck client videos,
 * private media, deleted rows, upload reservations, the privacy deletion,
 * the shown name, the new checks, the order-only write and the disputes
 * record.
 */

const at = (studio: Studio) => studio.tenant.slug;
const trx = () => db.connection() as TransactionClientContract;

function put(
	client: Parameters<typeof reviewRequest>[0],
	studio: Studio,
	body = reviewBody(),
) {
	return reviewRequest(client, "PUT", at(studio), "", studio.reviewToken).json(
		body,
	);
}

function photo(client: Parameters<typeof reviewRequest>[0], studio: Studio) {
	return testImages.png(1000, 800).then((data) =>
		reviewRequest(
			client,
			"POST",
			at(studio),
			"/photos",
			studio.reviewToken,
		).file("photo", data, {
			filename: "healed.png",
			contentType: "image/png",
		}),
	);
}

const failure = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: Error & { constraint?: string }) =>
			error.constraint ?? error.message,
	);

test.group(
	"Review fixes: takedown and decline evasion (finding 1)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a taken-down review deleted by the client can't be written again until restored", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			(await put(client, a)).assertStatus(200);
			await inTenant(a.tenant, () =>
				ClientReview.query().where("project_id", a.reviewProject.id).update({
					taken_down_at: new Date(),
					takedown_reason: "hate",
				}),
			);
			(
				await reviewRequest(client, "DELETE", at(a), "/review", a.reviewToken)
			).assertStatus(200);
			const page = (
				await reviewRequest(client, "GET", at(a), "", a.reviewToken)
			).body().data;
			assert.isNull(page.review);
			assert.equal(page.blocks.review, "taken_down");
			assertApiError(await put(client, a), 409, "taken_down");
			// An operator restores it (clears the takedown): writing works again.
			await inTenant(a.tenant, () =>
				ClientReview.withTrashed()
					.where("project_id", a.reviewProject.id)
					.update({
						taken_down_at: null,
						takedown_reason: null,
					}),
			);
			(await put(client, a)).assertStatus(200);
		});

		test("a taken-down post deleted by the client: no new post", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			await inTenant(a.tenant, () =>
				ClientPost.query().where("id", a.clientPost.id).update({
					taken_down_at: new Date(),
					takedown_reason: "personal_data",
				}),
			);
			(
				await reviewRequest(client, "DELETE", at(a), "/post", a.reviewToken)
			).assertStatus(200);
			const page = (
				await reviewRequest(client, "GET", at(a), "", a.reviewToken)
			).body().data;
			assert.equal(page.blocks.post, "taken_down");
			assertApiError(await photo(client, a), 409, "taken_down");
		});

		test("a declined post may be deleted and posted again once: two posts per project in all", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			const decline = () =>
				inTenant(a.tenant, () =>
					ClientPost.query()
						.where("project_id", a.reviewProject.id)
						.whereNull("deleted_at")
						.update({
							status: "declined",
							decided_at: new Date(),
							submitted_at: new Date(),
						}),
				);
			await decline();
			(
				await reviewRequest(client, "DELETE", at(a), "/post", a.reviewToken)
			).assertStatus(200);
			(await photo(client, a)).assertStatus(201);
			await decline();
			(
				await reviewRequest(client, "DELETE", at(a), "/post", a.reviewToken)
			).assertStatus(200);
			const page = (
				await reviewRequest(client, "GET", at(a), "", a.reviewToken)
			).body().data;
			assert.equal(page.blocks.post, "post_limit");
			assertApiError(await photo(client, a), 409, "post_limit");
			assert.lengthOf(
				await inTenant(a.tenant, () =>
					ClientPost.withTrashed().where("project_id", a.reviewProject.id),
				),
				2,
			);
		});
	},
);

test.group(
	"Review fixes: consents, deleted rows and the delete's scrub (findings 2, 6, 22)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("unlisted, a Discover consent never stored can't be ticked", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			await inTenant(a.tenant, () =>
				reviewServices().publication.disable(a.tenant),
			);
			const response = await put(
				client,
				a,
				reviewBody({ consentDiscover: true }),
			);
			assert.isFalse(response.body().data.review.consentDiscover);
		});

		test("the delete scrubs the review and the post, and a later submit never touches the deleted rows", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			(await put(client, a)).assertStatus(200);
			await reviewRequest(client, "DELETE", at(a), "/review", a.reviewToken);
			await reviewRequest(client, "DELETE", at(a), "/post", a.reviewToken);
			const [review] = await inTenant(a.tenant, () =>
				ClientReview.onlyTrashed().where("project_id", a.reviewProject.id),
			);
			assert.isNull(review.rating);
			assert.equal(review.body, "");
			assert.equal(review.shownName, "");
			assert.isFalse(review.consentStudioPage);
			const [post] = await inTenant(a.tenant, () =>
				ClientPost.onlyTrashed().where("project_id", a.reviewProject.id),
			);
			assert.equal(post.shownName, "");
			assert.isNull(post.caption);
			assert.deepEqual(post.styles, []);

			// A new review's shared name and consents land on the live row only.
			(
				await put(
					client,
					a,
					reviewBody({ shownName: "New Name", consentStudioPage: true }),
				)
			).assertStatus(200);
			const trashed = await inTenant(a.tenant, () =>
				ClientReview.onlyTrashed()
					.where("project_id", a.reviewProject.id)
					.firstOrFail(),
			);
			assert.equal(trashed.shownName, "");
			assert.isFalse(trashed.consentStudioPage);
			const trashedPost = await inTenant(a.tenant, () =>
				ClientPost.onlyTrashed()
					.where("project_id", a.reviewProject.id)
					.firstOrFail(),
			);
			assert.equal(trashedPost.shownName, "");
		});
	},
);

test.group(
	"Review fixes: limits, reservations and upload tokens (findings 3, 7)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("the review page's writes and uploads stay below the API gate's writes per caller", ({
			assert,
		}) => {
			const gate = API_LIMITS.callerWrites;
			for (const kind of ["anonymous", "storefront"] as const) {
				assert.isBelow(
					REVIEW_LIMITS.write.perAddress.requests +
						REVIEW_LIMITS.upload.perAddress.requests,
					gate[kind].requests,
					kind,
				);
				assert.equal(gate[kind].duration, "1 hour");
			}
			assert.equal(REVIEW_LIMITS.write.perAddress.duration, "1 hour");
			assert.equal(REVIEW_LIMITS.upload.perAddress.duration, "1 hour");
		});

		test("signs outstanding never exceed the post's places, and an expired sign gives its place back", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			const sign = () =>
				reviewRequest(client, "POST", at(a), "/videos/sign", a.reviewToken)
					.header(
						"x-forwarded-for",
						`203.0.113.${Math.floor(Math.random() * 200) + 1}`,
					)
					.json({ type: "video/mp4", size: 1000 });
			// The seeded post has one photo: seven places left.
			for (let i = 0; i < 7; i++) (await sign()).assertStatus(200);
			assertApiError(await sign(), 409, "post_full");
			assert.lengthOf(
				await inTenant(a.tenant, () => ClientVideoReservation.query()),
				7,
			);
			await inTenant(a.tenant, () =>
				ClientVideoReservation.query()
					.where(
						"id",
						ClientVideoReservation.query().select("id").orderBy("id").limit(1),
					)
					.update({
						expires_at: DateTime.now().minus({ minutes: 1 }).toJSDate(),
					}),
			);
			(await sign()).assertStatus(200);
			assert.lengthOf(
				await inTenant(a.tenant, () => ClientVideoReservation.query()),
				7,
			);
		});

		test("finishing an upload takes its reservation's place; another project's upload token is refused", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			const signed = await reviewRequest(
				client,
				"POST",
				at(a),
				"/videos/sign",
				a.reviewToken,
			).json({
				type: "video/mp4",
				size: 4,
			});
			const { token } = signed.body().data;
			const reservation = await inTenant(a.tenant, () =>
				ClientVideoReservation.query().firstOrFail(),
			);
			await drive
				.use("private")
				.put(reservation.stagingKey, Buffer.from("mp4!"));
			(
				await reviewRequest(
					client,
					"POST",
					at(a),
					"/videos",
					a.reviewToken,
				).json({ upload: token })
			).assertStatus(201);
			assert.lengthOf(
				await inTenant(a.tenant, () => ClientVideoReservation.query()),
				0,
			);

			// Another project's post in the same studio: its token is no good here.
			const other = await inTenant(a.tenant, () =>
				seedPost(a.tenant, a.finishProject as never),
			);
			const clip = await makeClip({ width: 160, height: 120, seconds: 1 });
			const theirs = await stageReviewClip(a.tenant, other.post.id, clip);
			assertApiError(
				await reviewRequest(
					client,
					"POST",
					at(a),
					"/videos",
					a.reviewToken,
				).json({ upload: theirs.token }),
				422,
				"validation_failed",
			);
			const forged = clientVideoUploadToken({
				tenantId: a.tenant.id,
				postId: randomUUID(),
				key: reservation.stagingKey,
				type: "video/mp4",
				size: 4,
			});
			assertApiError(
				await reviewRequest(
					client,
					"POST",
					at(a),
					"/videos",
					a.reviewToken,
				).json({ upload: forged }),
				422,
				"validation_failed",
			);
		});
	},
);

test.group("Review fixes: stuck client videos (finding 4)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => registerJob(FailStuckClientVideoJob));
	group.each.teardown(() => queue.restore());

	test("the read shows a stuck video as failed; the sweep fails it under its lock and deletes its upload", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const old = DateTime.utc().minus({ minutes: STUCK_AFTER_MINUTES + 5 });
		const make = (studio: Studio, createdAt: DateTime) =>
			inTenant(studio.tenant, () =>
				ClientPostMedia.create({
					tenantId: studio.tenant.id,
					postId: studio.clientPost.id,
					kind: "video",
					position: 1,
					videoState: "processing",
					videoStagingKey: `work_video_upload/tenants/${studio.tenant.id}/${randomUUID()}`,
					createdAt,
				}),
			);
		const stuck = await make(a, old);
		const young = await make(b, DateTime.utc().minus({ minutes: 10 }));
		await drive
			.use("private")
			.put(stuck.videoStagingKey as string, Buffer.from("x"));

		const page = (
			await reviewRequest(client, "GET", at(a), "", a.reviewToken)
		).body().data;
		assert.equal(page.post.media[1].state, "failed");
		assert.equal(page.post.media[1].failure, VIDEO_STUCK);

		const { rows } = await sql(
			{},
			"select * from public.stuck_client_video_candidates()",
		);
		const mine = (rows as { tenant_id: string; media_id: string }[]).filter(
			({ tenant_id }) => [a.tenant.id, b.tenant.id].includes(tenant_id),
		);
		assert.deepEqual(mine, [{ tenant_id: a.tenant.id, media_id: stuck.id }]);
		// With no context the app role reads none of those rows itself.
		assert.deepEqual(
			(
				await sql({}, "select id from client_post_media where id in (?, ?)", [
					stuck.id,
					young.id,
				])
			).rows,
			[],
		);

		const fake = queue.fake();
		const sweep = new SweepStuckVideosJob();
		sweep.$hydrate(
			{},
			{
				jobId: "sweep-client-videos",
				name: "SweepStuckVideosJob",
				attempt: 1,
				queue: "default",
				priority: 0,
				acquiredAt: new Date(),
				stalledCount: 0,
			},
		);
		await sweep.execute();
		const queued = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === FailStuckClientVideoJob.name)
			.map(({ payload }) => payload as { tenantId: string; mediaId: string })
			.filter(({ tenantId }) => [a.tenant.id, b.tenant.id].includes(tenantId));
		queue.restore();
		assert.deepEqual(queued, [{ tenantId: a.tenant.id, mediaId: stuck.id }]);
		await dispatchInTransaction(
			FailStuckClientVideoJob.dispatch(queued[0]),
			trx(),
		);
		await dispatchInTransaction(
			FailStuckClientVideoJob.dispatch(queued[0]),
			trx(),
		);
		await processQueued();

		const after = await inTenant(a.tenant, () =>
			ClientPostMedia.findOrFail(stuck.id),
		);
		assert.equal(after.videoState, "failed");
		assert.equal(after.videoFailure, VIDEO_STUCK);
		assert.isFalse(
			await drive.use("private").exists(stuck.videoStagingKey as string),
		);
		const untouched = await inTenant(b.tenant, () =>
			ClientPostMedia.findOrFail(young.id),
		);
		assert.equal(untouched.videoState, "processing");
	});
});

test.group("Review fixes: private media (finding 5)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("client photos and their copies are private, read through signed URLs, deleted with their item", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const added = await photo(client, a);
		added.assertStatus(201);
		const item = added.body().data.post.media[1];
		assert.notMatch(item.image.url, /\/uploads\//);
		assert.match(item.image.url, /\/files\//);
		assert.match(item.image.url, /signature=/);
		for (const variant of item.image.variants)
			assert.match(variant.url, /signature=/);
		const files = await storedFiles(a.tenant, "client_post_photo");
		assert.isAbove(files.length, 1, "the photo and its copies");
		const publicDir = app.tmpPath(
			"storage",
			"public",
			"tenants",
			a.tenant.id,
			"client_post_photo",
		);
		assert.isFalse(
			await readFile(publicDir).then(
				() => true,
				() => false,
			),
		);
		(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${item.id}`,
				a.reviewToken,
			)
		).assertStatus(200);
		assert.deepEqual(await storedFiles(a.tenant, "client_post_photo"), []);
	});
});

test.group(
	"Review fixes: anonymised clients and the privacy deletion (finding 8)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("an anonymised client's link is dead", async ({ client }) => {
			const { a } = await twoStudios();
			await inTenant(a.tenant, () =>
				Client.query()
					.where("id", a.pipeline.client.id)
					.update({ anonymized_at: new Date() }),
			);
			assertApiError(
				await reviewRequest(client, "GET", at(a), "", a.reviewToken),
				404,
				"not_found",
			);
		});

		test("forgetClient erases the client's reviews, posts and files and revokes their links", async ({
			client,
			assert,
		}) => {
			const { a, b } = await twoStudios();
			(await put(client, a)).assertStatus(200);
			(await photo(client, a)).assertStatus(201);
			(await put(client, b)).assertStatus(200);
			await inTenant(a.tenant, () =>
				reviewServices().pages.forgetClient(a.tenant, a.pipeline.client.id),
			);

			const reviews = await inTenant(a.tenant, () =>
				ClientReview.withTrashed().where("client_id", a.pipeline.client.id),
			);
			assert.isNotEmpty(reviews);
			for (const review of reviews) {
				assert.isNotNull(review.deletedAt);
				assert.equal(review.body, "");
				assert.equal(review.shownName, "");
				assert.isNull(review.submitterDigest);
			}
			const posts = await inTenant(a.tenant, () =>
				ClientPost.withTrashed().where("client_id", a.pipeline.client.id),
			);
			for (const post of posts) {
				assert.isNotNull(post.deletedAt);
				assert.equal(post.shownName, "");
			}
			assert.lengthOf(
				await inTenant(a.tenant, () => ClientPostMedia.query()),
				0,
			);
			assert.deepEqual(await storedFiles(a.tenant, "client_post_photo"), []);
			const live = await inTenant(a.tenant, () =>
				ReviewLink.query().whereNull("revoked_at"),
			);
			assert.lengthOf(live, 0);
			assertApiError(
				await reviewRequest(client, "GET", at(a), "", a.reviewToken),
				404,
				"not_found",
			);
			// Studio B is untouched.
			(
				await reviewRequest(client, "GET", at(b), "", b.reviewToken)
			).assertStatus(200);
		});
	},
);

test.group(
	"Review fixes: the shown name and the new checks (findings 9, 10, 23)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("bidi controls, zero-width characters and invisible-only names are refused, by the API and the database", async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			for (const name of ["Sita‮ R.", "Si​ta", "⁦Sita⁩", "﻿", "​‌"]) {
				const response = await put(client, a, reviewBody({ shownName: name }));
				assertApiError(response, 422, "validation_failed");
				assert.isArray(
					response.body().error.fields.shownName,
					JSON.stringify(name),
				);
			}
			(await put(client, a)).assertStatus(200);
			for (const name of ["Sita‮", "​", " "]) {
				assert.equal(
					await failure(
						inTenant(a.tenant, () =>
							ClientReview.query()
								.where("project_id", a.reviewProject.id)
								.update({ shown_name: name }),
						),
					),
					"client_reviews_shown_name",
				);
			}
		});

		test("the default: first name and initial, or Client for a one-word handle or number", ({
			assert,
		}) => {
			assert.equal(defaultShownName("Sita Rai"), "Sita R.");
			assert.equal(defaultShownName("sita_rai99"), "Client");
			assert.equal(defaultShownName("@sita.ink"), "Client");
			assert.equal(defaultShownName("+9779812345678"), "Client");
			assert.equal(defaultShownName("Sita"), "Sita");
			assert.equal(defaultShownName("Sita​ Rai"), "Sita R.");
		});

		test("a draft is waiting, and a takedown note needs a takedown", async ({
			assert,
		}) => {
			const { a } = await twoStudios();
			assert.equal(
				await failure(
					inTenant(a.tenant, () =>
						ClientPost.query().where("id", a.clientPost.id).update({
							status: "declined",
							decided_at: new Date(),
						}),
					),
				),
				"client_posts_draft_waiting",
			);
			assert.equal(
				await failure(
					inTenant(a.tenant, () =>
						ClientPost.query()
							.where("id", a.clientPost.id)
							.update({ takedown_note: "note" }),
					),
				),
				"client_posts_takedown_note",
			);
		});
	},
);

test.group("Review fixes: the order-only write (finding 13)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => app.container.restore(BotChallenge));

	test("it writes the order alone: no challenge, no review, no consent, not blocked by a half-typed review", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const second = (await photo(client, a)).body().data.post.media[1].id;
		// Turnstile on and refusing: the order needs none.
		enableChallenge(siteverify(() => Response.json({ success: false })));
		const reordered = await reviewRequest(
			client,
			"PUT",
			at(a),
			"/post/order",
			a.reviewToken,
		).json({
			order: [second, a.clientPostPhoto.id],
		});
		reordered.assertStatus(200);
		assert.deepEqual(
			reordered.body().data.post.media.map((item: { id: string }) => item.id),
			[second, a.clientPostPhoto.id],
		);
		assert.isNull(reordered.body().data.review);
		assert.isFalse(reordered.body().data.post.consentStudioPage);

		assertApiError(
			await reviewRequest(
				client,
				"PUT",
				at(a),
				"/post/order",
				a.reviewToken,
			).json({ order: [second] }),
			422,
			"validation_failed",
		);
		// An approved post goes back to the studio.
		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.clientPost.id).update({
				status: "approved",
				decided_at: new Date(),
				submitted_at: new Date(),
			}),
		);
		const back = await reviewRequest(
			client,
			"PUT",
			at(a),
			"/post/order",
			a.reviewToken,
		).json({
			order: [a.clientPostPhoto.id, second],
		});
		assert.equal(back.body().data.post.status, "waiting");
	});
});

test.group("Review fixes: the disputes record (finding 12)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("each submit records a keyed digest and the time, never shown; the sweep clears them after 90 days", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const response = await put(client, a, reviewBody({ post: { styles: [] } }))
			.header("x-forwarded-for", "203.0.113.77")
			.header("user-agent", "Phone browser 1.0");
		response.assertStatus(200);
		const text = JSON.stringify(response.body());
		const review = await inTenant(a.tenant, () =>
			ClientReview.query()
				.where("project_id", a.reviewProject.id)
				.firstOrFail(),
		);
		assert.match(review.submitterDigest ?? "", /^[0-9a-f]{64}$/);
		assert.isNotNull(review.submitterRecordedAt);
		assert.notInclude(text, review.submitterDigest as string);
		assert.notInclude(text, "203.0.113.77");
		const post = await inTenant(a.tenant, () =>
			ClientPost.findOrFail(a.clientPost.id),
		);
		assert.equal(post.submitterDigest, review.submitterDigest);

		await inTenant(a.tenant, () =>
			ClientReview.query()
				.where("id", review.id)
				.update({
					submitter_recorded_at: DateTime.now().minus({ days: 91 }).toJSDate(),
				}),
		);
		const { rows } = await sql(
			{},
			"select tenant_id from public.stale_submitter_tenants()",
		);
		assert.include(
			(rows as { tenant_id: string }[]).map(({ tenant_id }) => tenant_id),
			a.tenant.id,
		);
		await inTenant(a.tenant, () => clearStaleSubmitters(a.tenant.id));
		const cleared = await inTenant(a.tenant, () =>
			ClientReview.findOrFail(review.id),
		);
		assert.isNull(cleared.submitterDigest);
		const kept = await inTenant(a.tenant, () =>
			ClientPost.findOrFail(a.clientPost.id),
		);
		assert.isNotNull(kept.submitterDigest, "a recent one stays");
		assert.equal(ClearSubmittersJob.name, "ClearSubmittersJob");
	});
});
