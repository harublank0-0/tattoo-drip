import { randomUUID } from "node:crypto";
import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ClientPost from "#modules/reviews/models/client_post";
import ClientReview from "#modules/reviews/models/client_review";
import { TAKEDOWN_SENTENCES } from "#modules/reviews/rules";
import { reviewRequest } from "#tests/helpers/reviews";
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
// No #commands alias exists, so the commands are imported by path.
import ReviewsDismiss from "../../../commands/reviews_dismiss.js";
import ReviewsReports from "../../../commands/reviews_reports.js";
import ReviewsRestore from "../../../commands/reviews_restore.js";
import ReviewsTakedown from "../../../commands/reviews_takedown.js";

/**
 * TattooDrip's operator commands for reviews and Fresh ink (ruling 12,
 * slice 2): takedown and restore of a review, a reply or a post, the list
 * of open reports and closing one. Each finds the item's studio through a
 * SECURITY DEFINER lookup and acts in that studio's own context.
 */

function reviewOf(studio: Studio) {
	return inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.firstOrFail(),
	);
}

async function exec(
	command:
		| typeof ReviewsTakedown
		| typeof ReviewsRestore
		| typeof ReviewsDismiss
		| typeof ReviewsReports,
	args: string[],
) {
	const run = await ace.create(command, args);
	await run.exec();
	return run;
}

test.group("reviews operator commands", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	test("reviews:takedown review: off every surface, its report closed, the client's page says why; restore lifts it", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// The client's own review on the review page's project, reported by the studio.
		await inTenant(a.tenant, () =>
			ClientReview.create({
				tenantId: a.tenant.id,
				projectId: a.reviewProject.id,
				clientId: a.pipeline.client.id,
				artistId: a.artistProfile.id,
				rating: 1,
				body: "Something hateful that the studio reported to TattooDrip.",
				shownName: "Sita R.",
				consentStudioPage: true,
				consentDiscover: false,
				reportedAt: DateTime.now(),
				reportReason: "hate",
			}),
		);
		const own = await inTenant(a.tenant, () =>
			ClientReview.query()
				.where("project_id", a.reviewProject.id)
				.firstOrFail(),
		);
		const down = await exec(ReviewsTakedown, [
			"review",
			own.id,
			"--reason=hate",
			"--note=Report upheld",
		]);
		down.assertSucceeded();
		down.assertLogMatches(/The review is off every public surface/);
		const row = await inTenant(a.tenant, () => ClientReview.findOrFail(own.id));
		assert.isNotNull(row.takenDownAt);
		assert.equal(row.takedownReason, "hate");
		assert.equal(row.takedownNote, "Report upheld");
		assert.isNotNull(row.reportResolvedAt, "the takedown decides the report");

		// The client's page shows the reason's fixed sentence, never the note.
		const page = await reviewRequest(
			client,
			"GET",
			a.tenant.slug,
			"",
			a.reviewToken,
		);
		page.assertStatus(200);
		assert.deepEqual(
			page.body().data.review.takenDown.sentence,
			TAKEDOWN_SENTENCES.hate,
		);
		assert.notInclude(JSON.stringify(page.body()), "Report upheld");

		(await exec(ReviewsRestore, ["review", own.id])).assertSucceeded();
		const restored = await inTenant(a.tenant, () =>
			ClientReview.findOrFail(own.id),
		);
		assert.isNull(restored.takenDownAt);
		assert.isNull(restored.takedownNote);
		const back = await reviewRequest(
			client,
			"GET",
			a.tenant.slug,
			"",
			a.reviewToken,
		);
		assert.isNull(back.body().data.review.takenDown);
	});

	test("reviews:takedown reply and post; restore; refusals for an unknown kind, reason or id", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		(
			await exec(ReviewsTakedown, [
				"reply",
				a.clientReview.id,
				"--reason=personal_data",
			])
		).assertSucceeded();
		let review = await reviewOf(a);
		assert.equal(review.replyTakedownReason, "personal_data");
		assert.isNull(review.takenDownAt, "the review itself stays up");

		(
			await exec(ReviewsTakedown, ["post", a.approvedPost.id, "--reason=other"])
		).assertSucceeded();
		const post = await inTenant(a.tenant, () =>
			ClientPost.findOrFail(a.approvedPost.id),
		);
		assert.equal(post.takedownReason, "other");
		assert.isNull(post.publishedAt);

		(
			await exec(ReviewsRestore, ["reply", a.clientReview.id])
		).assertSucceeded();
		(await exec(ReviewsRestore, ["post", a.approvedPost.id])).assertSucceeded();
		review = await reviewOf(a);
		assert.isNull(review.replyTakenDownAt);
		assert.isNull(
			(await inTenant(a.tenant, () => ClientPost.findOrFail(a.approvedPost.id)))
				.takenDownAt,
		);

		for (const args of [
			["photo", a.clientReview.id, "--reason=hate"],
			["review", a.clientReview.id, "--reason=rude"],
			["review", a.clientReview.id],
			["review", "not-a-uuid", "--reason=hate"],
			["review", randomUUID(), "--reason=hate"],
			// A post's id is not a review's.
			["review", a.approvedPost.id, "--reason=hate"],
		]) {
			const run = await exec(ReviewsTakedown, args);
			run.assertFailed();
		}
		// Each studio's items through their own ids: B's review is found in B.
		(
			await exec(ReviewsTakedown, [
				"review",
				b.clientReview.id,
				"--reason=off_topic",
			])
		).assertSucceeded();
		assert.isNull((await reviewOf(a)).takenDownAt);
		assert.isNotNull((await reviewOf(b)).takenDownAt);
	});

	test("a post's takedown while storage can't delete its public copies fails and changes nothing", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.approvedPost.id).update({
				consent_studio_page: true,
				published_at: new Date(),
			}),
		);
		const broken = failDeletes("public", (key) =>
			key.includes("/fresh_ink_photo/"),
		);
		try {
			const run = await exec(ReviewsTakedown, [
				"post",
				a.approvedPost.id,
				"--reason=other",
			]);
			run.assertFailed();
			run.assertLogMatches(/Run it again once storage recovers/);
		} finally {
			broken.restore();
		}
		const post = await inTenant(a.tenant, () =>
			ClientPost.findOrFail(a.approvedPost.id),
		);
		assert.isNull(post.takenDownAt);
		assert.isNotNull(post.publishedAt);
		(
			await exec(ReviewsTakedown, ["post", a.approvedPost.id, "--reason=other"])
		).assertSucceeded();
	});

	test("reviews:reports lists the open reports, printed safely; reviews:dismiss closes one and keeps the review up", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await inTenant(a.tenant, () =>
			ClientReview.query().where("id", a.clientReview.id).update({
				reported_at: new Date(),
				report_reason: "off_topic",
				report_note: "Not about us \u001b[31mred",
				reported_by: a.owner.id,
			}),
		);
		const listed = await exec(ReviewsReports, []);
		listed.assertSucceeded();
		listed.assertLogMatches(new RegExp(`review ${a.clientReview.id}`));
		listed.assertLogMatches(/for off_topic: Not about us \\x1b\[31mred/);
		assert.notInclude(
			JSON.stringify(listed.logger.getLogs()),
			b.clientReview.id,
			"B has no open report",
		);

		(await exec(ReviewsDismiss, [a.clientReview.id])).assertSucceeded();
		const kept = await reviewOf(a);
		assert.isNotNull(kept.reportResolvedAt);
		assert.isNull(kept.takenDownAt);
		listed.ui.logger.getRenderer().flushLogs();
		const after = await exec(ReviewsReports, []);
		assert.notInclude(
			JSON.stringify(after.logger.getLogs()),
			a.clientReview.id,
		);
		(await exec(ReviewsDismiss, [a.clientReview.id])).assertFailed();
	});
});
