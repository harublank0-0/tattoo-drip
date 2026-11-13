import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import ReviewLink from "#modules/reviews/models/review_link";
import { dbClient } from "#services/db_context";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";

/**
 * The review tables' own rules (migration 1791920000000): row-level
 * security, the composite tenant keys, one live link, review and post per
 * project, the rating and length checks, and the angles model's places.
 */

const failure = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: Error & { constraint?: string }) =>
			error.constraint ?? error.message,
	);

function reviewOf(studio: Studio, over: Record<string, unknown> = {}) {
	return ClientReview.create({
		tenantId: studio.tenant.id,
		projectId: studio.reviewProject.id,
		clientId: studio.pipeline.client.id,
		artistId: studio.artistProfile.id,
		rating: 5,
		body: "Healed beautifully, lines crisp.",
		shownName: "Sita R.",
		consentStudioPage: false,
		consentDiscover: false,
		...over,
	});
}

test.group("Review tables", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security: another studio's context sees none of A's rows", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await inTenant(a.tenant, () => reviewOf(a));
		for (const table of [
			"review_links",
			"client_reviews",
			"client_posts",
			"client_post_media",
		]) {
			const seen = await inTenant(b.tenant, async () => {
				const { rows } = await dbClient().rawQuery(
					`select count(*)::int as n from ${table} where tenant_id = ?`,
					[a.tenant.id],
				);
				return rows[0].n as number;
			});
			assert.equal(seen, 0, table);
			const own = await inTenant(a.tenant, async () => {
				const { rows } = await dbClient().rawQuery(
					`select count(*)::int as n from ${table} where tenant_id = ?`,
					[a.tenant.id],
				);
				return rows[0].n as number;
			});
			assert.isAbove(own, 0, `${table}: the positive control`);
		}
		// Nor can B write a row as A.
		assert.isNotNull(await failure(inTenant(b.tenant, () => reviewOf(a))));
	});

	test("the composite keys refuse another studio's project, client or artist", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		for (const over of [
			{ projectId: b.reviewProject.id },
			{ clientId: b.pipeline.client.id },
			{ artistId: b.artistProfile.id },
		]) {
			assert.match(
				String(await failure(inTenant(a.tenant, () => reviewOf(a, over)))),
				/fk|foreign/i,
			);
		}
		assert.match(
			String(
				await failure(
					inTenant(a.tenant, () =>
						ClientPostMedia.create({
							tenantId: a.tenant.id,
							postId: b.clientPost.id,
							kind: "photo",
							position: 1,
							imageKey: "x",
							width: 1,
							height: 1,
						}),
					),
				),
			),
			/fk|foreign/i,
		);
	});

	test("one live link per project; a revoked one stays as history", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		const second = () =>
			ReviewLink.create({
				tenantId: a.tenant.id,
				projectId: a.reviewProject.id,
				tokenNonce: "A".repeat(22),
				tokenHash: "a".repeat(64),
				createdBy: null,
				createdAt: DateTime.now(),
				expiresAt: DateTime.now().plus({ months: 12 }),
				revokedAt: null,
			});
		assert.equal(
			await failure(inTenant(a.tenant, second)),
			"review_links_one_live",
		);
		await inTenant(a.tenant, () =>
			ReviewLink.query()
				.where("project_id", a.reviewProject.id)
				.update({ revoked_at: new Date() }),
		);
		assert.isNull(await failure(inTenant(a.tenant, second)));
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ReviewLink.create({
						tenantId: a.tenant.id,
						projectId: a.reviewProject.id,
						tokenNonce: "not a nonce",
						tokenHash: "b".repeat(64),
						createdAt: DateTime.now(),
						expiresAt: DateTime.now().plus({ months: 12 }),
					}),
				),
			),
			"review_links_token_nonce_format",
		);
	});

	test("reviews: whole stars 1 to 5, 20 to 2,000 characters, one live review per project", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		assert.equal(
			await failure(inTenant(a.tenant, () => reviewOf(a, { rating: 0 }))),
			"client_reviews_rating",
		);
		assert.equal(
			await failure(inTenant(a.tenant, () => reviewOf(a, { rating: 6 }))),
			"client_reviews_rating",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () => reviewOf(a, { body: "x".repeat(19) })),
			),
			"client_reviews_body_length",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () => reviewOf(a, { body: "x".repeat(2001) })),
			),
			"client_reviews_body_length",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					reviewOf(a, { reportedAt: DateTime.now(), reportReason: "rude" }),
				),
			),
			"client_reviews_report_reason",
		);
		const first = await inTenant(a.tenant, () => reviewOf(a));
		assert.equal(
			await failure(inTenant(a.tenant, () => reviewOf(a))),
			"client_reviews_one_per_project",
		);
		await inTenant(a.tenant, () => first.softDelete());
		assert.isNull(await failure(inTenant(a.tenant, () => reviewOf(a))));
	});

	test("posts: up to three styles, a decision exactly when not waiting, one live post per project", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ClientPost.query()
						.where("id", a.clientPost.id)
						.update({ styles: ["a", "b", "c", "d"] }),
				),
			),
			"client_posts_styles",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ClientPost.query()
						.where("id", a.clientPost.id)
						.update({ status: "approved" }),
				),
			),
			"client_posts_decision",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ClientPost.create({
						tenantId: a.tenant.id,
						projectId: a.reviewProject.id,
						clientId: a.pipeline.client.id,
						artistId: a.artistProfile.id,
						shownName: "Sita R.",
					}),
				),
			),
			"client_posts_one_per_project",
		);
	});

	test("media: eight places, a video never at the lead, a swap in one statement", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		const photo = (position: number) =>
			ClientPostMedia.create({
				tenantId: a.tenant.id,
				postId: a.clientPost.id,
				kind: "photo",
				position,
				imageKey: `tenants/${a.tenant.id}/client_post_photo/${randomUUID()}.jpg`,
				width: 10,
				height: 10,
			});
		assert.equal(
			await failure(inTenant(a.tenant, () => photo(8))),
			"client_post_media_position",
		);
		assert.equal(
			await failure(inTenant(a.tenant, () => photo(0))),
			"client_post_media_place",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ClientPostMedia.create({
						tenantId: a.tenant.id,
						postId: a.clientPost.id,
						kind: "video",
						position: 0,
						videoState: "processing",
						videoStagingKey: `work_video_upload/tenants/${a.tenant.id}/${randomUUID()}`,
					}),
				),
			),
			"client_post_media_video_never_leads",
		);
		assert.equal(
			await failure(
				inTenant(a.tenant, () =>
					ClientPostMedia.create({
						tenantId: a.tenant.id,
						postId: a.clientPost.id,
						kind: "video",
						position: 1,
						videoState: "ready",
						videoStagingKey: `work_video_upload/tenants/${a.tenant.id}/${randomUUID()}`,
					}),
				),
			),
			"client_post_media_video_ready",
		);
		const second = await inTenant(a.tenant, () => photo(1));
		// The deferrable unique place: two rows swap places in one UPDATE.
		await inTenant(a.tenant, () =>
			dbClient().rawQuery(
				"update client_post_media set position = 1 - position where post_id = ?",
				[a.clientPost.id],
			),
		);
		const swapped = await inTenant(a.tenant, () =>
			ClientPostMedia.query().where("id", second.id).firstOrFail(),
		);
		assert.equal(swapped.position, 0);
	});
});
