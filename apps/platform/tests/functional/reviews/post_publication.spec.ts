import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import ImageService from "#modules/media/services/image_service";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import { postPublishable } from "#modules/reviews/rules";
import { publicKeys } from "#modules/reviews/services/post_publication_service";
import ReviewOperatorService from "#modules/reviews/services/review_operator_service";
import StudioReviewService from "#modules/reviews/services/studio_review_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";
import { testImages } from "#tests/helpers/images";
import {
	issueReviewLink,
	reviewBody,
	reviewReady,
	reviewRequest,
	reviewServices,
	storedFiles,
} from "#tests/helpers/reviews";
import { failDeletes } from "#tests/helpers/storage_failures";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Publishing Fresh ink (Reviews and Fresh ink, slice 2): a post's photos and
 * videos are copied to the public disk only once the studio approved it and
 * the client allowed a surface, and the public copies are deleted on every
 * way back: a decline (nothing to delete), an unpublish, a withdrawn
 * consent, a client's change of an approved post (a photo removed or the
 * caption changed), the client's delete, the privacy deletion and a
 * takedown; a restore publishes it again.
 */

type Ready = {
	tenant: Tenant;
	owner: User;
	token: string;
	projectId: string;
};

async function ready(slug: string): Promise<Ready> {
	const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
	const { project } = await inTenant(tenant, () => reviewReady(tenant));
	const { token } = await inTenant(tenant, () =>
		issueReviewLink(tenant, project, owner.id),
	);
	return { tenant, owner, token, projectId: project.id };
}

async function addPhoto(client: ApiClient, s: Ready, width = 900) {
	const response = await reviewRequest(
		client,
		"POST",
		s.tenant.slug,
		"/photos",
		s.token,
	).file("photo", await testImages.png(width, 700), {
		filename: "healed.png",
		contentType: "image/png",
	});
	response.assertStatus(201);
	return response;
}

/** The client's submit of the post, with these consents and caption. */
function submit(
	client: ApiClient,
	s: Ready,
	over: { studio?: boolean; caption?: string } = {},
) {
	return reviewRequest(client, "PUT", s.tenant.slug, "", s.token).json(
		reviewBody({
			review: undefined,
			consentStudioPage: over.studio ?? true,
			post: { caption: over.caption ?? "Healed after six weeks.", styles: [] },
		}),
	);
}

function post(s: Ready) {
	return inTenant(s.tenant, () =>
		ClientPost.query().where("project_id", s.projectId).firstOrFail(),
	);
}

function studio(client: ApiClient, s: Ready, action: string, id: string) {
	return client
		.post(`/t/${s.tenant.slug}/reviews/posts/${id}/${action}`)
		.loginAs(s.owner)
		.withCsrfToken()
		.redirects(0);
}

const published = (s: Ready) => storedFiles(s.tenant, "fresh_ink_photo");

test.group("Fresh ink publishing: files", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("files reach the public disk only once approved and consented, under the private files' names", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-approve-2");
		await addPhoto(client, s);
		(await submit(client, s, { studio: false })).assertStatus(200);
		const waiting = await post(s);
		assert.deepEqual(await published(s), [], "waiting: nothing public");

		// Approved without a surface: kept for the studio, nothing public.
		(await studio(client, s, "approve", waiting.id)).assertStatus(302);
		const approved = await post(s);
		assert.equal(approved.status, "approved");
		assert.isNull(approved.publishedAt);
		assert.deepEqual(await published(s), []);

		// The client allows the studio page: published at once.
		(await submit(client, s, { studio: true })).assertStatus(200);
		const shown = await post(s);
		assert.isNotNull(shown.publishedAt);
		const privateFiles = await storedFiles(s.tenant, "client_post_photo");
		assert.isNotEmpty(privateFiles);
		assert.deepEqual(
			await published(s),
			privateFiles,
			"the photo and its copies",
		);
		const media = await inTenant(s.tenant, () =>
			ClientPostMedia.query().where("post_id", shown.id),
		);
		const [key] = publicKeys(media).photos;
		assert.isTrue(await drive.use("public").exists(key));
		assert.isFalse(await drive.use("private").exists(key));
	});

	test("withdrawing the last surface deletes the public copies; one surface left keeps them", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-consent-2");
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		(await studio(client, s, "approve", (await post(s)).id)).assertStatus(302);
		assert.isNotEmpty(await published(s));

		(await submit(client, s, { studio: false })).assertStatus(200);
		assert.deepEqual(await published(s), []);
		const row = await post(s);
		assert.isNull(row.publishedAt);
		assert.equal(
			row.status,
			"approved",
			"still approved: the studio's decision stays",
		);
	});

	test("a decline publishes nothing, and an unpublish deletes the public copies", async ({
		client,
		assert,
	}) => {
		const declined = await ready("pub-decline-2");
		await addPhoto(client, declined);
		(await submit(client, declined)).assertStatus(200);
		(
			await studio(client, declined, "decline", (await post(declined)).id)
		).assertStatus(302);
		assert.equal((await post(declined)).status, "declined");
		assert.deepEqual(await published(declined), []);

		const s = await ready("pub-unpublish-2");
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		const id = (await post(s)).id;
		(await studio(client, s, "approve", id)).assertStatus(302);
		assert.isNotEmpty(await published(s));
		(await studio(client, s, "unpublish", id)).assertStatus(302);
		assert.deepEqual(await published(s), []);
		const row = await post(s);
		assert.equal(row.status, "unpublished");
		assert.isNull(row.publishedAt);
		assert.isNotEmpty(
			await storedFiles(s.tenant, "client_post_photo"),
			"the private files stay: the client can still delete the post",
		);
	});

	test("a client's change of an approved post sends it back to waiting and deletes the public copies", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-edit-2");
		await addPhoto(client, s);
		await addPhoto(client, s, 800);
		(await submit(client, s)).assertStatus(200);
		const id = (await post(s)).id;
		(await studio(client, s, "approve", id)).assertStatus(302);
		assert.isNotEmpty(await published(s));

		// A new caption.
		(await submit(client, s, { caption: "Two months on." })).assertStatus(200);
		let row = await post(s);
		assert.equal(row.status, "waiting");
		assert.equal(row.waitingRound, 2);
		assert.isNull(row.publishedAt);
		assert.deepEqual(await published(s), []);

		// Approved again, then a photo removed: every public copy goes, the
		// removed one's included.
		(await studio(client, s, "approve", id)).assertStatus(302);
		assert.isNotEmpty(await published(s));
		const [first] = await inTenant(s.tenant, () =>
			ClientPostMedia.query().where("post_id", id).orderBy("position"),
		);
		(
			await reviewRequest(
				client,
				"DELETE",
				s.tenant.slug,
				`/media/${first.id}`,
				s.token,
			)
		).assertStatus(200);
		row = await post(s);
		assert.equal(row.status, "waiting");
		assert.equal(row.waitingRound, 3);
		assert.deepEqual(await published(s), []);
	});

	test("the client's delete and the privacy deletion delete the public copies", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-delete-2");
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		(await studio(client, s, "approve", (await post(s)).id)).assertStatus(302);
		assert.isNotEmpty(await published(s));
		(
			await reviewRequest(client, "DELETE", s.tenant.slug, "/post", s.token)
		).assertStatus(200);
		assert.deepEqual(await published(s), []);
		assert.deepEqual(await storedFiles(s.tenant, "client_post_photo"), []);

		const p = await ready("pub-forget-2");
		await addPhoto(client, p);
		(await submit(client, p)).assertStatus(200);
		const row = await post(p);
		(await studio(client, p, "approve", row.id)).assertStatus(302);
		assert.isNotEmpty(await published(p));
		await inTenant(p.tenant, () =>
			reviewServices().pages.forgetClient(p.tenant, row.clientId),
		);
		assert.deepEqual(await published(p), []);
	});

	test("a takedown deletes the public copies and a restore publishes them again", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-takedown-2");
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		const id = (await post(s)).id;
		(await studio(client, s, "approve", id)).assertStatus(302);
		const before = await published(s);
		assert.isNotEmpty(before);

		const operator = new ReviewOperatorService(
			reviewServices().postPublication,
		);
		await operator.takedown("post", id, "client_request", "Asked by email");
		assert.deepEqual(await published(s), []);
		const down = await post(s);
		assert.isNotNull(down.takenDownAt);
		assert.isNull(down.publishedAt);

		await operator.restore("post", id);
		assert.deepEqual(await published(s), before);
		assert.isNotNull((await post(s)).publishedAt);
	});

	test("a ready video's renditions and poster are copied and deleted with the post", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-video-2");
		await addPhoto(client, s);
		const row = await post(s);
		// A ready video as the worker leaves it, its files written by hand.
		const images = new ImageService();
		const poster = await images.storeBytes(await testImages.png(640, 360), {
			tenant: s.tenant,
			purpose: "client_post_video",
		});
		const rendition = `tenants/${s.tenant.id}/client_post_video/${randomUUID()}.640x360.mp4`;
		await drive
			.use("private")
			.put(rendition, Buffer.from("not really a video"));
		await inTenant(s.tenant, () =>
			ClientPostMedia.create({
				tenantId: s.tenant.id,
				postId: row.id,
				kind: "video",
				position: 1,
				videoState: "ready",
				videoStagingKey: `work_video_upload/tenants/${s.tenant.id}/${randomUUID()}`,
				imageKey: poster.key,
				width: 640,
				height: 360,
				videoDurationMs: 4000,
				videoKeys: [rendition],
				alt: null,
			}),
		);
		(await submit(client, s)).assertStatus(200);
		(await studio(client, s, "approve", row.id)).assertStatus(302);
		const copies = await storedFiles(s.tenant, "fresh_ink_video");
		assert.include(copies, rendition.split("/").at(-1) ?? "");
		assert.include(copies, poster.key.split("/").at(-1) ?? "");

		(await studio(client, s, "unpublish", row.id)).assertStatus(302);
		assert.deepEqual(await storedFiles(s.tenant, "fresh_ink_video"), []);
	});

	test("a waiting post with a video still processing can't be approved", async ({
		client,
		assert,
	}) => {
		const s = await ready("pub-processing-2");
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		const row = await post(s);
		await inTenant(s.tenant, () =>
			ClientPostMedia.create({
				tenantId: s.tenant.id,
				postId: row.id,
				kind: "video",
				position: 1,
				videoState: "processing",
				videoStagingKey: `work_video_upload/tenants/${s.tenant.id}/${randomUUID()}`,
				imageKey: null,
				width: null,
				height: null,
				alt: null,
			}),
		);
		const response = await studio(client, s, "approve", row.id);
		response.assertStatus(302);
		response.assertFlashMessage(
			"error",
			"A video is still processing. Approve the post once it's ready.",
		);
		assert.equal((await post(s)).status, "waiting");
		assert.deepEqual(await published(s), []);
	});
});

test.group("Fresh ink publishing: storage failures", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A studio whose client's post has a photo, submitted with the studio page allowed. */
	async function submitted(client: ApiClient, slug: string) {
		const s = await ready(slug);
		await addPhoto(client, s);
		(await submit(client, s)).assertStatus(200);
		return { s, id: (await post(s)).id };
	}

	test("a public copy that can't be deleted fails the change: the post stays approved and published", async ({
		client,
		assert,
	}) => {
		const { s, id } = await submitted(client, "pub-fail-del-2");
		(await studio(client, s, "approve", id)).assertStatus(302);
		const before = await published(s);
		assert.isNotEmpty(before);
		const broken = failDeletes("public", (key) =>
			key.includes("/fresh_ink_photo/"),
		);
		try {
			const response = await studio(client, s, "unpublish", id);
			response.assertFlashMessage(
				"error",
				"Couldn't remove the public photos, try again.",
			);
		} finally {
			broken.restore();
		}
		const row = await post(s);
		assert.equal(row.status, "approved");
		assert.isNotNull(row.publishedAt);
		assert.deepEqual(await published(s), before);
		// Once storage is back, the same change goes through.
		(await studio(client, s, "unpublish", id)).assertFlashMessage(
			"success",
			"Unpublished. It's off your page and its public copies are deleted.",
		);
		assert.deepEqual(await published(s), []);
	});

	test("the client's delete removes a public copy even when published_at lost track of it", async ({
		client,
		assert,
	}) => {
		const { s, id } = await submitted(client, "pub-stray-2");
		(await studio(client, s, "approve", id)).assertStatus(302);
		assert.isNotEmpty(await published(s));
		await inTenant(s.tenant, () =>
			ClientPost.query().where("id", id).update({ published_at: null }),
		);
		(
			await reviewRequest(client, "DELETE", s.tenant.slug, "/post", s.token)
		).assertStatus(200);
		assert.deepEqual(await published(s), []);
	});

	test("a rollback after a publish removes the copies", async ({
		client,
		assert,
	}) => {
		const { s, id } = await submitted(client, "pub-roll-pub-2");
		const service = await app.container.make(StudioReviewService);
		const owner = { userId: s.owner.id, role: "owner" as const };
		await assert.rejects(
			() =>
				inTenant(s.tenant, () =>
					withTransaction(async () => {
						await service.approve(s.tenant, owner, id);
						assert.isNotEmpty(await published(s));
						throw new Error("a later step failed");
					}),
				),
			/a later step failed/,
		);
		assert.deepEqual(await published(s), []);
		const row = await post(s);
		assert.equal(row.status, "waiting");
		assert.isNull(row.publishedAt);
	});

	test("a rollback after a withdrawal copies the files back", async ({
		client,
		assert,
	}) => {
		const { s, id } = await submitted(client, "pub-roll-wd-2");
		(await studio(client, s, "approve", id)).assertStatus(302);
		const before = await published(s);
		assert.isNotEmpty(before);
		const service = await app.container.make(StudioReviewService);
		const owner = { userId: s.owner.id, role: "owner" as const };
		await assert.rejects(
			() =>
				inTenant(s.tenant, () =>
					withTransaction(async () => {
						await service.unpublish(s.tenant, owner, id);
						assert.deepEqual(await published(s), []);
						throw new Error("a later step failed");
					}),
				),
			/a later step failed/,
		);
		assert.deepEqual(await published(s), before);
		const row = await post(s);
		assert.equal(row.status, "approved");
		assert.isNotNull(row.publishedAt);
	});
});

test.group("Fresh ink publishing: the rule", () => {
	test("postPublishable: approved, a surface allowed, not taken down, not deleted", ({
		assert,
	}) => {
		const base = {
			status: "approved" as const,
			consentStudioPage: true,
			consentDiscover: false,
			takenDownAt: null,
			deletedAt: null,
		};
		assert.isTrue(postPublishable(base));
		assert.isTrue(
			postPublishable({
				...base,
				consentStudioPage: false,
				consentDiscover: true,
			}),
		);
		assert.isFalse(postPublishable({ ...base, consentStudioPage: false }));
		for (const status of ["waiting", "declined", "unpublished"] as const) {
			assert.isFalse(postPublishable({ ...base, status }), status);
		}
		assert.isFalse(postPublishable({ ...base, takenDownAt: new Date() }));
		assert.isFalse(postPublishable({ ...base, deletedAt: new Date() }));
	});
});
