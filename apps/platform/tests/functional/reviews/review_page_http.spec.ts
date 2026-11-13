import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import ReviewLink from "#modules/reviews/models/review_link";
import { REVIEW_LIMITS } from "#modules/reviews/review_limits";
import { TAKEDOWN_SENTENCES } from "#modules/reviews/rules";
import BotChallenge from "#services/bot_challenge";
import env from "#start/env";
import { assertApiError } from "#tests/helpers/api";
import { enableChallenge, siteverify, verdict } from "#tests/helpers/challenge";
import { testImages } from "#tests/helpers/images";
import {
	reviewBody,
	reviewRequest,
	reviewRows,
	reviewServices,
	seedPost,
	storedFiles,
} from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";

const at = (studio: Studio) => studio.tenant.slug;

/** A PNG photo part sent to the review page's photo route. */
async function sendPhoto(
	client: Parameters<typeof reviewRequest>[0],
	studio: Studio,
	token: string = studio.reviewToken,
) {
	return reviewRequest(client, "POST", at(studio), "/photos", token).file(
		"photo",
		await testImages.png(),
		{ filename: "healed.png", contentType: "image/png" },
	);
}

function liveReview(studio: Studio) {
	return inTenant(studio.tenant, () =>
		ClientReview.query().where("project_id", studio.reviewProject.id).first(),
	);
}

function livePost(studio: Studio) {
	return inTenant(studio.tenant, () =>
		ClientPost.query().where("project_id", studio.reviewProject.id).first(),
	);
}

test.group("Review page: reading it through the link", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the page: the studio, the artist and the day, the defaults, the draft; never stored", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const response = await reviewRequest(
			client,
			"GET",
			at(a),
			"",
			a.reviewToken,
		);

		response.assertStatus(200);
		assert.equal(response.header("cache-control"), "no-store");
		const page = response.body().data;
		// twoStudios lists each studio on Discover.
		assert.deepEqual(page.studio, { name: a.tenant.name, onDiscover: true });
		assert.equal(page.project.artistName, a.artistProfile.name);
		assert.match(page.project.tattooedOn, /^\d{4}-\d{2}-\d{2}$/);
		assert.isNull(page.review);
		assert.equal(page.post.status, "draft");
		assert.lengthOf(page.post.media, 1);
		assert.equal(page.post.media[0].id, a.clientPostPhoto.id);
		assert.equal(page.post.media[0].kind, "photo");
		assert.isAbove(page.styles.length, 0);
		// The shown name defaults to the first name and an initial, never more.
		const text = JSON.stringify(response.body());
		assert.notInclude(text, a.pipeline.client.phone as string);
		assert.notInclude(text, a.reviewToken);
	});

	test("the defaults: first name and initial, the request's style and placement", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// Give the seeded client a two-word name and drop the draft (whose
		// name would win).
		await inTenant(a.tenant, async () => {
			a.pipeline.client.name = "Maya Gurung";
			await a.pipeline.client.save();
			await ClientPostMedia.query().where("post_id", a.clientPost.id).delete();
			await ClientPost.query().where("id", a.clientPost.id).delete();
		});
		const page = (
			await reviewRequest(client, "GET", at(a), "", a.reviewToken)
		).body().data;
		assert.equal(page.defaults.shownName, "Maya G.");
		assert.isNull(page.post);
	});

	test("every link that doesn't work is the same 404: missing, malformed, guessed, another studio's, revoked, expired", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const misses: [string | null, string][] = [
			[null, "no header"],
			["short", "malformed"],
			["A".repeat(43), "a guess"],
			[b.reviewToken, "B's token under A"],
		];
		for (const [token, label] of misses) {
			const response = await reviewRequest(client, "GET", at(a), "", token);
			assertApiError(response, 404, "not_found");
			assert.notInclude(JSON.stringify(response.body()), b.reviewToken, label);
		}

		await inTenant(a.tenant, () =>
			ReviewLink.query()
				.where("project_id", a.reviewProject.id)
				.update({ revoked_at: new Date() }),
		);
		assertApiError(
			await reviewRequest(client, "GET", at(a), "", a.reviewToken),
			404,
			"not_found",
		);
		// Replay after a revoke: the write is the 404 too, and changes nothing.
		const before = await reviewRows(a.tenant);
		assertApiError(
			await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
				reviewBody(),
			),
			404,
			"not_found",
		);
		assert.deepEqual(await reviewRows(a.tenant), before);

		await inTenant(b.tenant, () =>
			ReviewLink.query()
				.where("project_id", b.reviewProject.id)
				.update({
					created_at: DateTime.now().minus({ months: 13 }).toJSDate(),
					expires_at: DateTime.now().minus({ days: 1 }).toJSDate(),
				}),
		);
		assertApiError(
			await reviewRequest(client, "GET", at(b), "", b.reviewToken),
			404,
			"not_found",
		);
	});

	test("the token is never read from the URL", async ({ client }) => {
		const { a } = await twoStudios();
		assertApiError(
			await client.get(
				`/api/v1/tenants/${at(a)}/review?token=${a.reviewToken}`,
			),
			404,
			"not_found",
		);
		assertApiError(
			await client.get(`/api/v1/tenants/${at(a)}/review/${a.reviewToken}`),
			404,
			"not_found",
		);
	});

	test("with the flag off every route is the 404, before anything is counted", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		env.set("REVIEWS_ENABLED", false);
		try {
			const before = await reviewRows(a.tenant);
			assertApiError(
				await reviewRequest(client, "GET", at(a), "", a.reviewToken),
				404,
				"not_found",
			);
			assertApiError(
				await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
					reviewBody(),
				),
				404,
				"not_found",
			);
			assertApiError(await sendPhoto(client, a), 404, "not_found");
			assert.deepEqual(await reviewRows(a.tenant), before);
		} finally {
			env.set("REVIEWS_ENABLED", true);
		}
		(await reviewRequest(client, "GET", at(a), "", a.reviewToken)).assertStatus(
			200,
		);
	});

	test("reads are limited per link and per address", async ({ client }) => {
		const { a } = await twoStudios();
		const perToken = REVIEW_LIMITS.read.perToken.requests;
		for (let i = 0; i < perToken; i++) {
			(
				await reviewRequest(client, "GET", at(a), "", a.reviewToken).header(
					"x-forwarded-for",
					`203.0.113.${(i % 200) + 1}`,
				)
			).assertStatus(200);
		}
		const limited = await reviewRequest(
			client,
			"GET",
			at(a),
			"",
			a.reviewToken,
		).header("x-forwarded-for", "198.51.100.7");
		assertApiError(limited, 429, "rate_limited");
		limited.assertHeader("retry-after", limited.header("retry-after"));

		// Guesses from one address are counted against it, malformed or not.
		const perAddress = REVIEW_LIMITS.read.perAddress.requests;
		for (let i = 0; i < perAddress; i++) {
			await reviewRequest(client, "GET", at(a), "", `guess-${i}`).header(
				"x-forwarded-for",
				"198.51.100.99",
			);
		}
		assertApiError(
			await reviewRequest(client, "GET", at(a), "", a.reviewToken).header(
				"x-forwarded-for",
				"198.51.100.99",
			),
			429,
			"rate_limited",
		);
	});
});

test.group("Review page: the review", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("submit, then edit: one review per project, the shared name and consents", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const first = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody());
		first.assertStatus(200);
		assert.equal(first.body().data.review.rating, 5);
		assert.equal(first.body().data.review.shownName, "Sita R.");
		assert.isTrue(first.body().data.review.consentStudioPage);
		assert.isFalse(first.body().data.review.consentDiscover);
		// The draft post takes the same name and consents.
		assert.equal(first.body().data.post.shownName, "Sita R.");
		assert.isTrue(first.body().data.post.consentStudioPage);
		assert.equal(first.body().data.post.status, "draft");

		const edited = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				shownName: "सीता",
				consentStudioPage: false,
				review: {
					rating: 4,
					body: "  Still lovely after a month of healing.  ",
				},
			}),
		);
		edited.assertStatus(200);
		const review = edited.body().data.review;
		assert.equal(review.rating, 4);
		assert.equal(review.body, "Still lovely after a month of healing.");
		assert.equal(review.shownName, "सीता");
		assert.isFalse(review.consentStudioPage);

		const rows = await inTenant(a.tenant, () =>
			ClientReview.withTrashed().where("project_id", a.reviewProject.id),
		);
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].clientId, a.pipeline.client.id);
		assert.equal(rows[0].artistId, a.artistProfile.id);
	});

	test("Discover consent counts only while the studio is listed", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const listed = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ consentDiscover: true }));
		listed.assertStatus(200);
		assert.isTrue(listed.body().data.studio.onDiscover);
		assert.isTrue(listed.body().data.review.consentDiscover);

		// Unlisted, a ticked consent stays only while the client keeps it
		// ticked: sending true keeps it, unticking withdraws it (finding 2).
		await inTenant(a.tenant, () =>
			reviewServices().publication.disable(a.tenant),
		);
		const kept = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ consentDiscover: true }));
		kept.assertStatus(200);
		assert.isFalse(kept.body().data.studio.onDiscover);
		assert.isTrue(kept.body().data.review.consentDiscover);
		const withdrawn = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ consentDiscover: false }));
		assert.isFalse(withdrawn.body().data.review.consentDiscover);
		// Once withdrawn it can't be ticked anew while unlisted.
		const again = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ consentDiscover: true }));
		assert.isFalse(again.body().data.review.consentDiscover);
		assert.isFalse(again.body().data.post.consentDiscover);
	});

	test("every field is checked again: rating, length in any script, name, types", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const refused: [Record<string, unknown>, string][] = [
			[
				reviewBody({ review: { rating: 0, body: "x".repeat(30) } }),
				"review.rating",
			],
			[
				reviewBody({ review: { rating: 6, body: "x".repeat(30) } }),
				"review.rating",
			],
			[
				reviewBody({ review: { rating: 3.5, body: "x".repeat(30) } }),
				"review.rating",
			],
			[
				reviewBody({ review: { rating: "5", body: "x".repeat(30) } }),
				"review.rating",
			],
			[
				reviewBody({ review: { rating: 5, body: "x".repeat(19) } }),
				"review.body",
			],
			[
				reviewBody({ review: { rating: 5, body: `   ${"x".repeat(19)}   ` } }),
				"review.body",
			],
			[
				reviewBody({ review: { rating: 5, body: "x".repeat(2001) } }),
				"review.body",
			],
			[
				reviewBody({ review: { rating: 5, body: `${"x".repeat(25)}\u0000` } }),
				"review.body",
			],
			[reviewBody({ shownName: "" }), "shownName"],
			[reviewBody({ shownName: "   " }), "shownName"],
			[reviewBody({ shownName: "x".repeat(41) }), "shownName"],
			[reviewBody({ shownName: "Sita\nRai" }), "shownName"],
			[reviewBody({ consentStudioPage: "yes" }), "consentStudioPage"],
		];
		for (const [body, field] of refused) {
			const response = await reviewRequest(
				client,
				"PUT",
				at(a),
				"",
				a.reviewToken,
			).json(body);
			assertApiError(response, 422, "validation_failed");
			assert.isArray(
				response.body().error.fields[field],
				JSON.stringify(body).slice(0, 80),
			);
		}
		assert.isNull(await liveReview(a));

		// The edges that pass: 20 and 2,000 characters, counted as people see
		// them (Devanagari and emoji are one character each, not UTF-16 units),
		// and a 40-character name.
		for (const body of ["x".repeat(20), "😀".repeat(2000), "न".repeat(2000)]) {
			(
				await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
					reviewBody({
						shownName: "स".repeat(40),
						review: { rating: 1, body },
					}),
				)
			).assertStatus(200);
		}
	});

	test("a submit with nothing to keep is refused", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const response = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json({
			shownName: "Sita R.",
			consentStudioPage: false,
			consentDiscover: false,
		});
		assertApiError(response, 422, "validation_failed");
		assert.isArray(response.body().error.fields.review);
	});

	test("delete: the review leaves the page and the client may write again", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
			reviewBody(),
		);
		const deleted = await reviewRequest(
			client,
			"DELETE",
			at(a),
			"/review",
			a.reviewToken,
		);
		deleted.assertStatus(200);
		assert.isNull(deleted.body().data.review);
		const trashed = await inTenant(a.tenant, () =>
			ClientReview.onlyTrashed().where("project_id", a.reviewProject.id),
		);
		assert.lengthOf(trashed, 1, "the studio's record stays, soft-deleted");
		(
			await reviewRequest(client, "DELETE", at(a), "/review", a.reviewToken)
		).assertStatus(200);
		const again = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody());
		again.assertStatus(200);
		assert.isNotNull(again.body().data.review);
	});

	test("a review TattooDrip took down: its fixed sentence, no edits, but its consents and delete work", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
			reviewBody(),
		);
		await inTenant(a.tenant, () =>
			ClientReview.query().where("project_id", a.reviewProject.id).update({
				taken_down_at: new Date(),
				takedown_reason: "personal_data",
				takedown_note: "Operator note: phone number in the text",
			}),
		);
		const page = await reviewRequest(client, "GET", at(a), "", a.reviewToken);
		const takenDown = page.body().data.review.takenDown;
		assert.equal(takenDown.reason, "personal_data");
		assert.equal(takenDown.sentence, TAKEDOWN_SENTENCES.personal_data);
		assert.notInclude(JSON.stringify(page.body()), "Operator note");

		assertApiError(
			await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
				reviewBody({
					review: { rating: 1, body: "Changing it after the takedown." },
				}),
			),
			409,
			"review_locked",
		);
		const consent = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json({
			shownName: "S.",
			consentStudioPage: false,
			consentDiscover: false,
		});
		consent.assertStatus(200);
		assert.isFalse(consent.body().data.review.consentStudioPage);
		assert.equal(consent.body().data.review.shownName, "S.");
		(
			await reviewRequest(client, "DELETE", at(a), "/review", a.reviewToken)
		).assertStatus(200);
	});

	test("the submit needs the bot challenge for this page's action", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const fake = siteverify((form) =>
			form.get("response") === "good"
				? verdict(at(a), { action: "review" })
				: form.get("response") === "intake"
					? verdict(at(a))
					: Response.json({
							success: false,
							"error-codes": ["invalid-input-response"],
						}),
		);
		enableChallenge(fake);
		try {
			assertApiError(
				await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
					reviewBody(),
				),
				403,
				"challenge_failed",
			);
			assertApiError(
				await reviewRequest(client, "PUT", at(a), "", a.reviewToken)
					.header("x-challenge-token", "intake")
					.json(reviewBody()),
				403,
				"challenge_failed",
			);
			assert.isNull(await liveReview(a));
			(
				await reviewRequest(client, "PUT", at(a), "", a.reviewToken)
					.header("x-challenge-token", "good")
					.json(reviewBody())
			).assertStatus(200);
			assert.isNotNull(await liveReview(a));
			// A dead link is the 404 before Cloudflare is asked.
			const calls = fake.calls.length;
			assertApiError(
				await reviewRequest(client, "PUT", at(a), "", "Z".repeat(43))
					.header("x-challenge-token", "good")
					.json(reviewBody()),
				404,
				"not_found",
			);
			assert.equal(fake.calls.length, calls);
		} finally {
			app.container.restore(BotChallenge);
		}
	});

	test("writes are limited per link", async ({ client }) => {
		const { a } = await twoStudios();
		const perToken = REVIEW_LIMITS.write.perToken.requests;
		for (let i = 0; i < perToken; i++) {
			(
				await reviewRequest(
					client,
					"DELETE",
					at(a),
					"/review",
					a.reviewToken,
				).header("x-forwarded-for", `203.0.113.${i + 1}`)
			).assertStatus(200);
		}
		assertApiError(
			await reviewRequest(client, "PUT", at(a), "", a.reviewToken)
				.header("x-forwarded-for", "198.51.100.3")
				.json(reviewBody()),
			429,
			"rate_limited",
		);
	});

	test("under an old slug a write is the 404", async ({ client }) => {
		const { a } = await twoStudios();
		const old = at(a);
		await inTenant(a.tenant, async () => {
			a.tenant.slug = "studio-a-renamed";
			await a.tenant.save();
		});
		assertApiError(
			await reviewRequest(client, "PUT", old, "", a.reviewToken).json(
				reviewBody(),
			),
			404,
			"not_found",
		);
		(
			await reviewRequest(
				client,
				"PUT",
				"studio-a-renamed",
				"",
				a.reviewToken,
			).json(reviewBody())
		).assertStatus(200);
	});
});

test.group("Review page: the Fresh ink post", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("photos: added in order through the image pipeline, up to eight", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		for (let i = 1; i < 8; i++) {
			(await sendPhoto(client, a)).assertStatus(201);
		}
		const page = (
			await reviewRequest(client, "GET", at(a), "", a.reviewToken)
		).body().data;
		assert.lengthOf(page.post.media, 8);
		assert.equal(
			page.post.media[0].id,
			a.clientPostPhoto.id,
			"the seeded photo still leads",
		);
		const added = page.post.media[1];
		assert.match(added.image.url, /\/client_post_photo\//);
		assert.isArray(added.image.variants);
		assert.lengthOf(await storedFiles(a.tenant, "client_post_photo"), 7);

		assertApiError(await sendPhoto(client, a), 409, "post_full");
		assert.lengthOf(
			await storedFiles(a.tenant, "client_post_photo"),
			7,
			"the refused photo isn't kept",
		);
	});

	test("a file that isn't an image is the photo field's error", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const response = await reviewRequest(
			client,
			"POST",
			at(a),
			"/photos",
			a.reviewToken,
		).file("photo", Buffer.from("not an image at all"), {
			filename: "healed.png",
			contentType: "image/png",
		});
		assertApiError(response, 422, "validation_failed");
		assert.isArray(response.body().error.fields.photo);
	});

	test("submit hands the post to the studio with the studio's styles; a style off its list is refused", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const refused = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({ review: undefined, post: { styles: ["not-a-style"] } }),
		);
		assertApiError(refused, 422, "validation_failed");
		assert.isArray(refused.body().error.fields["post.styles"]);
		const tooMany = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: { styles: ["fine-line", "realism", "dotwork", "blackwork"] },
			}),
		);
		assertApiError(tooMany, 422, "validation_failed");

		const saved = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: {
					caption: "  Six weeks in, fully healed.  ",
					styles: ["fine-line"],
					placement: "Left forearm",
				},
			}),
		);
		saved.assertStatus(200);
		const post = saved.body().data.post;
		assert.equal(post.status, "waiting");
		assert.equal(post.caption, "Six weeks in, fully healed.");
		assert.deepEqual(post.styles, ["fine-line"]);
		assert.isTrue(post.editable);
		const row = await livePost(a);
		assert.isNotNull(row?.submittedAt);

		const long = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: { caption: "x".repeat(281), styles: [] },
			}),
		);
		assertApiError(long, 422, "validation_failed");
		assert.isArray(long.body().error.fields["post.caption"]);
	});

	test("a post needs a photo: no submit without one, no video before one, no video leading", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// Without its photo the draft can't be submitted.
		await inTenant(a.tenant, () =>
			ClientPostMedia.query().where("id", a.clientPostPhoto.id).delete(),
		);
		const empty = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ review: undefined, post: { styles: [] } }));
		assertApiError(empty, 422, "validation_failed");
		assert.isArray(empty.body().error.fields.post);
		assertApiError(
			await reviewRequest(
				client,
				"POST",
				at(a),
				"/videos/sign",
				a.reviewToken,
			).json({
				type: "video/mp4",
				size: 1000,
			}),
			409,
			"post_needs_photo",
		);

		// With a photo and a video, the video can't be put first, and the last
		// photo can't go while the video stays.
		const photo = (await sendPhoto(client, a)).body().data.post.media[0];
		const video = await inTenant(a.tenant, () =>
			ClientPostMedia.create({
				tenantId: a.tenant.id,
				postId: a.clientPost.id,
				kind: "video",
				position: 1,
				videoState: "failed",
				videoFailure: "It's longer than 60 seconds.",
				videoStagingKey: `work_video_upload/tenants/${a.tenant.id}/${crypto.randomUUID()}`,
			}),
		);
		assertApiError(
			await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
				reviewBody({
					review: undefined,
					post: { styles: [], order: [video.id, photo.id] },
				}),
			),
			409,
			"post_needs_photo",
		);
		assertApiError(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${photo.id}`,
				a.reviewToken,
			),
			409,
			"post_needs_photo",
		);
		// The database holds the rule too.
		const direct = await inTenant(a.tenant, () =>
			ClientPostMedia.query().where("id", video.id).update({ position: 0 }),
		).catch((error) => error);
		assert.match(String(direct.message), /client_post_media/);
		// The video goes; then the photo can.
		(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${video.id}`,
				a.reviewToken,
			)
		).assertStatus(200);
		(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${photo.id}`,
				a.reviewToken,
			)
		).assertStatus(200);
	});

	test("reorder and remove: the first photo leads, the rest close up; a stale order is refused", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await sendPhoto(client, a);
		const media = (await sendPhoto(client, a)).body().data.post.media;
		const [one, two, three] = media.map((item: { id: string }) => item.id);

		const reordered = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: { styles: [], order: [three, one, two] },
			}),
		);
		reordered.assertStatus(200);
		assert.deepEqual(
			reordered.body().data.post.media.map((item: { id: string }) => item.id),
			[three, one, two],
		);
		const stale = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: { styles: [], order: [three, one] },
			}),
		);
		assertApiError(stale, 422, "validation_failed");

		const removed = await reviewRequest(
			client,
			"DELETE",
			at(a),
			`/media/${three}`,
			a.reviewToken,
		);
		removed.assertStatus(200);
		assert.deepEqual(
			removed.body().data.post.media.map((item: { id: string }) => item.id),
			[one, two],
		);
		const positions = await inTenant(a.tenant, () =>
			ClientPostMedia.query()
				.where("post_id", a.clientPost.id)
				.orderBy("position"),
		);
		assert.deepEqual(
			positions.map((row) => row.position),
			[0, 1],
		);
		assert.lengthOf(
			await storedFiles(a.tenant, "client_post_photo"),
			1,
			"its files went first",
		);
	});

	test("another link's media id is the 404 and changes nothing", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const before = await reviewRows(b.tenant);
		assertApiError(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${b.clientPostPhoto.id}`,
				a.reviewToken,
			),
			404,
			"not_found",
		);
		assert.deepEqual(await reviewRows(b.tenant), before);

		// And another project's post in the same studio.
		const other = await inTenant(a.tenant, () =>
			seedPost(a.tenant, a.finishProject as never),
		);
		assertApiError(
			await reviewRequest(
				client,
				"DELETE",
				at(a),
				`/media/${other.photo.id}`,
				a.reviewToken,
			),
			404,
			"not_found",
		);
	});

	test("an approved post goes back to the studio's queue when its content changes, not its consents", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
			reviewBody({ review: undefined, post: { styles: [] } }),
		);
		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.clientPost.id).update({
				status: "approved",
				decided_at: new Date(),
			}),
		);
		const consents = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ review: undefined, consentStudioPage: false }));
		assert.equal(consents.body().data.post.status, "approved");
		const caption = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(
			reviewBody({
				review: undefined,
				post: { caption: "New words", styles: [] },
			}),
		);
		assert.equal(caption.body().data.post.status, "waiting");
		assert.isNull((await livePost(a))?.decidedAt);
	});

	test("a declined post reads 'not shown'; its content is locked, its consents and delete are not", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
			reviewBody({ review: undefined, post: { styles: [] } }),
		);
		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.clientPost.id).update({
				status: "declined",
				decided_at: new Date(),
			}),
		);
		const page = (
			await reviewRequest(client, "GET", at(a), "", a.reviewToken)
		).body().data;
		assert.equal(page.post.status, "not_shown");
		assert.isFalse(page.post.editable);
		assert.notInclude(JSON.stringify(page), "declined");

		assertApiError(await sendPhoto(client, a), 409, "review_locked");
		assertApiError(
			await reviewRequest(client, "PUT", at(a), "", a.reviewToken).json(
				reviewBody({ review: undefined, post: { caption: "x", styles: [] } }),
			),
			409,
			"review_locked",
		);
		const consents = await reviewRequest(
			client,
			"PUT",
			at(a),
			"",
			a.reviewToken,
		).json(reviewBody({ review: undefined, consentStudioPage: false }));
		consents.assertStatus(200);
		assert.isFalse(consents.body().data.post.consentStudioPage);
	});

	test("delete: every photo's files first, then the items, the post soft-deleted", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await sendPhoto(client, a);
		assert.lengthOf(await storedFiles(a.tenant, "client_post_photo"), 1);
		const deleted = await reviewRequest(
			client,
			"DELETE",
			at(a),
			"/post",
			a.reviewToken,
		);
		deleted.assertStatus(200);
		assert.isNull(deleted.body().data.post);
		assert.deepEqual(await storedFiles(a.tenant, "client_post_photo"), []);
		const rows = await reviewRows(a.tenant);
		assert.lengthOf(rows.media, 0);
		assert.lengthOf(rows.posts, 1);
		assert.isNotNull(rows.posts[0].deletedAt);
		// A new photo starts a new draft.
		const again = await sendPhoto(client, a);
		assert.equal(again.status(), 201, JSON.stringify(again.body()));
		assert.equal(again.body().data.post.status, "draft");
	});
});
