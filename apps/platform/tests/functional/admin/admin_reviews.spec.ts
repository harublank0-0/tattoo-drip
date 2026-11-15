import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ClientPost from "#modules/reviews/models/client_post";
import ClientReview from "#modules/reviews/models/client_review";
import { adminUser } from "#tests/helpers/admin";
import { send } from "#tests/helpers/discover";
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const reviewOf = (studio: Studio) =>
	inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.firstOrFail(),
	);

const postOf = (studio: Studio, id = studio.freshInkPost.id) =>
	inTenant(studio.tenant, () => ClientPost.findOrFail(id));

function report(studio: Studio, reason = "hate") {
	return inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.update({
				reported_at: new Date(Date.now() - 1000),
				report_reason: reason,
				report_note: "Please check",
			}),
	);
}

test.group("Admin reviews", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the Reports page lists each studio's reported reviews, oldest first; an owner gets a 404", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await inTenant(b.tenant, () =>
			ClientReview.withTrashed()
				.where("id", b.clientReview.id)
				.update({
					reported_at: new Date(Date.now() - 5000),
					report_reason: "threats",
				}),
		);
		await report(a);
		(await client.get("/admin/reports").loginAs(a.owner)).assertStatus(404);
		const page = await client
			.get("/admin/reports")
			.loginAs(await adminUser())
			.withInertia();
		page.assertStatus(200);
		const props = page.inertiaProps as any;
		const rows = props.reports as {
			studioName: string;
			reviewId: string;
			reasonLabel: string;
		}[];
		const ids = rows.map((row) => row.reviewId);
		assert.isBelow(
			ids.indexOf(b.clientReview.id),
			ids.indexOf(a.clientReview.id),
		);
		const rowA = rows.find((row) => row.reviewId === a.clientReview.id);
		assert.equal(rowA?.studioName, a.tenant.name);
		assert.equal(rowA?.reasonLabel, "Hate");
		assert.deepInclude(props.takedownReasons, { value: "hate", label: "Hate" });
		assert.deepInclude(props.takedownReasons, {
			value: "client_request",
			label: "Client's request",
		});
	});

	test("taking a reported review down records the reason and note and closes the report; restoring lifts it", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await report(a);
		const admin = await adminUser();
		const base = `/admin/reviews/${a.clientReview.id}`;
		const down = await send(client, admin, "post", `${base}/takedown`, {
			reason: "hate",
			note: "  Report #12 ",
		});
		down.assertStatus(302);
		down.assertFlashMessage(
			"success",
			"The review is off every public surface.",
		);
		const row = await reviewOf(a);
		assert.isNotNull(row.takenDownAt);
		assert.equal(row.takedownReason, "hate");
		assert.equal(row.takedownNote, "Report #12");
		assert.isNotNull(row.reportResolvedAt);

		const page = await client
			.get("/admin/reports")
			.loginAs(admin)
			.withInertia();
		assert.notInclude(
			(page.inertiaProps as any).reports.map((r: any) => r.reviewId),
			a.clientReview.id,
		);

		// Taking it down again succeeds: the first takedown's time stays, the
		// reason and note are replaced.
		const again = await send(client, admin, "post", `${base}/takedown`, {
			reason: "other",
			note: "Second look",
		});
		again.assertStatus(302);
		again.assertFlashMessage(
			"success",
			"The review is off every public surface.",
		);
		const repeated = await reviewOf(a);
		assert.equal(repeated.takenDownAt?.toMillis(), row.takenDownAt?.toMillis());
		assert.equal(repeated.takedownReason, "other");
		assert.equal(repeated.takedownNote, "Second look");

		const up = await send(client, admin, "post", `${base}/restore`);
		up.assertStatus(302);
		up.assertFlashMessage(
			"success",
			"Takedown lifted. The review follows the client's and the studio's choices again.",
		);
		const back = await reviewOf(a);
		assert.isNull(back.takenDownAt);
		assert.isNull(back.takedownNote);
	});

	test("dismissing a report closes it and keeps the review up; a second dismiss is an error flash", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await report(a);
		const admin = await adminUser();
		const path = `/admin/reviews/${a.clientReview.id}/dismiss`;
		const first = await send(client, admin, "post", path);
		first.assertStatus(302);
		first.assertFlashMessage("success", "Report closed. The review stays up.");
		const row = await reviewOf(a);
		assert.isNotNull(row.reportResolvedAt);
		assert.isNull(row.takenDownAt);

		const second = await send(client, admin, "post", path);
		second.assertStatus(302);
		second.assertFlashMessage("error", "That review has no open report.");
	});

	test("a reply is taken down and restored on its own; the review stays up", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		const base = `/admin/reviews/${a.clientReview.id}/reply`;
		const down = await send(client, admin, "post", `${base}/takedown`, {
			reason: "personal_data",
		});
		down.assertStatus(302);
		down.assertFlashMessage(
			"success",
			"The reply is off every public surface.",
		);
		let row = await reviewOf(a);
		assert.equal(row.replyTakedownReason, "personal_data");
		assert.isNull(row.takenDownAt);

		const up = await send(client, admin, "post", `${base}/restore`);
		up.assertFlashMessage(
			"success",
			"Takedown lifted. The reply follows the client's and the studio's choices again.",
		);
		row = await reviewOf(a);
		assert.isNull(row.replyTakenDownAt);
	});

	test("a post is taken down and restored", async ({ client, assert }) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		const base = `/admin/posts/${a.approvedPost.id}`;
		const down = await send(client, admin, "post", `${base}/takedown`, {
			reason: "client_request",
		});
		down.assertStatus(302);
		down.assertFlashMessage(
			"success",
			"The post is off every public surface and its public copies are deleted.",
		);
		// An approved post nobody published: restoring it needs no stored photo.
		let post = await postOf(a, a.approvedPost.id);
		assert.isNotNull(post.takenDownAt);
		assert.equal(post.takedownReason, "client_request");

		const up = await send(client, admin, "post", `${base}/restore`);
		up.assertFlashMessage(
			"success",
			"Takedown lifted. The post follows the client's and the studio's choices again.",
		);
		post = await postOf(a, a.approvedPost.id);
		assert.isNull(post.takenDownAt);
	});

	test("a post takedown while storage can't delete its copies says so and changes nothing", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		const broken = failDeletes("public", (key) =>
			key.includes("/fresh_ink_photo/"),
		);
		let response: Awaited<ReturnType<typeof send>>;
		try {
			response = await send(
				client,
				admin,
				"post",
				`/admin/posts/${a.freshInkPost.id}/takedown`,
				{ reason: "other" },
			);
		} finally {
			broken.restore();
		}
		response.assertStatus(302);
		response.assertFlashMessage(
			"error",
			"Storage couldn't delete the post's public copies, so nothing changed. Try again once storage recovers.",
		);
		const post = await postOf(a);
		assert.isNull(post.takenDownAt);
		assert.isNotNull(post.publishedAt);
	});

	test("an unknown reason, a 501-character note or a non-uuid id is refused and changes nothing", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		const base = `/admin/reviews/${a.clientReview.id}/takedown`;
		for (const body of [
			{ reason: "rude" },
			{ reason: "" },
			{ reason: "hate", note: "x".repeat(501) },
		]) {
			const response = await send(client, admin, "post", base, body);
			response.assertStatus(302);
			assertValidationError(
				response,
				"note" in body && body.note ? "note" : "reason",
			);
		}
		// 500 code points of emoji (1000 UTF-16 units) is allowed.
		const ok = await send(client, admin, "post", base, {
			reason: "hate",
			note: "😀".repeat(500),
		});
		ok.assertFlashMessage("success", "The review is off every public surface.");
		await send(
			client,
			admin,
			"post",
			`/admin/reviews/${a.clientReview.id}/restore`,
		);

		const bad = await send(
			client,
			admin,
			"post",
			"/admin/reviews/not-a-uuid/takedown",
			{ reason: "hate" },
		);
		bad.assertStatus(302);
		bad.assertFlashMessage("error", "Give the id as a uuid.");
		const missing = await send(
			client,
			admin,
			"post",
			`/admin/posts/${randomUUID()}/takedown`,
			{ reason: "hate" },
		);
		missing.assertFlashMessage("error", "No studio has a post with this id.");
		assert.isNull((await reviewOf(a)).takenDownAt);
	});

	test("an owner gets a 404 on every action", async ({ client }) => {
		const { a } = await twoStudios();
		for (const path of [
			`/admin/reviews/${a.clientReview.id}/takedown`,
			`/admin/reviews/${a.clientReview.id}/restore`,
			`/admin/reviews/${a.clientReview.id}/dismiss`,
			`/admin/reviews/${a.clientReview.id}/reply/takedown`,
			`/admin/reviews/${a.clientReview.id}/reply/restore`,
			`/admin/posts/${a.freshInkPost.id}/takedown`,
			`/admin/posts/${a.freshInkPost.id}/restore`,
		]) {
			(
				await send(client, a.owner, "post", path, { reason: "hate" })
			).assertStatus(404);
		}
	});
});
