import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import MessageTemplate from "#modules/notifications/models/message_template";
import TattooProject from "#modules/projects/models/tattoo_project";
import ReviewLink from "#modules/reviews/models/review_link";
import { REVIEW_TOKEN } from "#modules/reviews/review_links";
import env from "#start/env";
import { makeArtist } from "#tests/helpers/pipeline";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * "Ask for a review" on the project page (Reviews and Fresh ink, slice 2,
 * ruling 3): who sees it and may use it, the link's state, the review
 * request message in the studio's words, the recorded contact and Revoke.
 */

type ReviewProp = {
	link: {
		url: string;
		madeText: string;
		expiresText: string;
		sentText: string | null;
	} | null;
	lastText: string | null;
	text: string | null;
	message: { text: string; whatsappUrl: string } | null;
} | null;

const projectPath = (studio: Studio, id: string) =>
	`/t/${studio.tenant.slug}/projects/${id}`;

function liveLinks(studio: Studio, projectId: string) {
	return inTenant(studio.tenant, () =>
		ReviewLink.query().where("project_id", projectId).whereNull("revoked_at"),
	);
}

test.group("Ask for a review", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("shown once the tattoo work is done; the link, its dates and the message in the studio's words", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// A booked project: the work isn't done, so nothing is offered.
		const booked = await client
			.get(projectPath(a, a.sessionProject.id))
			.loginAs(a.owner)
			.withInertia();
		assert.isNull((booked.inertiaProps as { review: ReviewProp }).review);

		// The finish project (in progress, its tattoo session done): no link yet.
		const before = await client
			.get(projectPath(a, a.finishProject.id))
			.loginAs(a.owner)
			.withInertia();
		const empty = (before.inertiaProps as { review: ReviewProp }).review;
		assert.isNotNull(empty);
		assert.isNull(empty?.link);
		assert.isNull(empty?.message);

		const made = await client
			.post(`${projectPath(a, a.finishProject.id)}/review-link`)
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		made.assertStatus(302);
		made.assertFlashMessage(
			"success",
			"Review link ready: send it to the client.",
		);
		const page = await client
			.get(projectPath(a, a.finishProject.id))
			.loginAs(a.owner)
			.withInertia();
		const review = (page.inertiaProps as { review: ReviewProp }).review;
		const url = review?.link?.url ?? "";
		assert.match(
			url,
			/^http:\/\/[a-z0-9-]+\.localhost:3000\/review#[A-Za-z0-9_-]{43}$/,
		);
		assert.match(url.split("#")[1], REVIEW_TOKEN);
		assert.isNull(review?.link?.sentText, "not sent yet");
		assert.equal(
			review?.message?.text,
			`How did it heal? Tell us and show it off: ${url}`,
		);
		assert.include(review?.message?.whatsappUrl ?? "", "wa.me");

		// Asking again shows the same link.
		const again = await client
			.post(`${projectPath(a, a.finishProject.id)}/review-link`)
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		again.assertFlashMessage(
			"success",
			"This is the link you made before: send it again if you like.",
		);
		assert.lengthOf(await liveLinks(a, a.finishProject.id), 1);
	});

	test("the studio's own review request text, with the client's first name", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, () =>
			MessageTemplate.create({
				tenantId: a.tenant.id,
				kind: "review_request",
				body: "Hi {client_name}! Show us your healed {studio_name} tattoo: {review_link}",
			}),
		);
		const page = await client
			.get(projectPath(a, a.reviewProject.id))
			.loginAs(a.owner)
			.withInertia();
		const review = (page.inertiaProps as { review: ReviewProp }).review;
		assert.match(
			review?.message?.text ?? "",
			new RegExp(
				`^Hi \\S+! Show us your healed ${a.tenant.name} tattoo: http://\\S+/review#`,
			),
		);
	});

	test("a review request sent from a chat link records the contact and the link's sent day", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const response = await client
			.post(`${projectPath(a, a.reviewProject.id)}/contacted`)
			.json({ channel: "whatsapp", kind: "review_request" })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		response.assertStatus(302);
		const project = await inTenant(a.tenant, () =>
			TattooProject.findOrFail(a.reviewProject.id),
		);
		assert.equal(project.lastContactKind, "review_request");
		const [link] = await liveLinks(a, a.reviewProject.id);
		assert.isNotNull(link.sentAt);
		const page = await client
			.get(projectPath(a, a.reviewProject.id))
			.loginAs(a.owner)
			.withInertia();
		assert.isString(
			(page.inertiaProps as { review: ReviewProp }).review?.link?.sentText,
		);
		assert.include(
			(page.inertiaProps as { contactedText: string }).contactedText,
			"(Review request)",
		);
	});

	test("Revoke: the link stops working and a new one can be made", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const revoked = await client
			.delete(`${projectPath(a, a.reviewProject.id)}/review-link`)
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		revoked.assertFlashMessage(
			"success",
			"Link revoked. The client can't open it any more; what they posted stays.",
		);
		assert.lengthOf(await liveLinks(a, a.reviewProject.id), 0);
		const page = await client
			.get(projectPath(a, a.reviewProject.id))
			.loginAs(a.owner)
			.withInertia();
		const review = (page.inertiaProps as { review: ReviewProp }).review;
		assert.isNull(review?.link);
		assert.match(review?.lastText ?? "", /^The last link was revoked on /);
		(
			await client
				.post(`${projectPath(a, a.reviewProject.id)}/review-link`)
				.loginAs(a.owner)
				.withCsrfToken()
				.redirects(0)
		).assertFlashMessage(
			"success",
			"Review link ready: send it to the client.",
		);
		assert.lengthOf(await liveLinks(a, a.reviewProject.id), 1);
	});

	test("the project's artist may ask; an artist without the project gets a 404; work not done is refused", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		// The artist member isn't linked to the project's profile yet.
		(
			await client
				.post(`${projectPath(a, a.finishProject.id)}/review-link`)
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);
		await inTenant(a.tenant, () =>
			Artist.query()
				.where("id", a.artistProfile.id)
				.update({ user_id: a.artist.id }),
		);
		(
			await client
				.post(`${projectPath(a, a.finishProject.id)}/review-link`)
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertFlashMessage(
			"success",
			"Review link ready: send it to the client.",
		);
		const page = await client
			.get(projectPath(a, a.finishProject.id))
			.loginAs(a.artist)
			.withInertia();
		assert.isNotNull(
			(page.inertiaProps as { review: ReviewProp }).review?.link,
		);

		// Another artist's project.
		const other = await inTenant(a.tenant, () =>
			makeArtist(a.tenant, "ask-other-2"),
		);
		await inTenant(a.tenant, () =>
			TattooProject.query()
				.where("id", a.healingProject.id)
				.update({ artist_id: other.id }),
		);
		(
			await client
				.post(`${projectPath(a, a.healingProject.id)}/review-link`)
				.loginAs(a.artist)
				.withCsrfToken()
				.redirects(0)
		).assertStatus(404);

		// The session project's tattoo session is still to come.
		const early = await client
			.post(`${projectPath(a, a.sessionProject.id)}/review-link`)
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		early.assertFlashMessage(
			"error",
			"Ask for a review once the tattoo session is done.",
		);
		assert.lengthOf(await liveLinks(a, a.sessionProject.id), 0);
	});
});

test.group("The review request message in Settings, Messages", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("listed and saved while reviews are on; off, it is hidden and its text kept", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const settings = `/t/${a.tenant.slug}/settings/messages`;
		const on = await client.get(settings).loginAs(a.owner).withInertia();
		const kinds = (
			on.inertiaProps as { messages: { kind: string; defaultText: string }[] }
		).messages;
		const request = kinds.find(({ kind }) => kind === "review_request");
		assert.equal(
			request?.defaultText,
			"How did it heal? Tell us and show it off: {review_link}",
		);
		const texts = Object.fromEntries(
			kinds.map(({ kind, defaultText }) => [kind, defaultText]),
		);
		const missing = await client
			.put(settings)
			.form({ ...texts, review_request: "Tell us how it healed!" })
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		assertValidationError(missing, "review_request");
		const saved = await client
			.put(settings)
			.form({
				...texts,
				review_request: "Tell us how it healed: {review_link}",
			})
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		saved.assertFlashMessage("success", "Messages saved.");
		const row = () =>
			inTenant(a.tenant, () =>
				MessageTemplate.query().where("kind", "review_request").first(),
			);
		assert.equal((await row())?.body, "Tell us how it healed: {review_link}");

		env.set("REVIEWS_ENABLED", false);
		try {
			const off = await client.get(settings).loginAs(a.owner).withInertia();
			assert.notInclude(
				(off.inertiaProps as { messages: { kind: string }[] }).messages.map(
					({ kind }) => kind,
				),
				"review_request",
			);
			const { review_request: _, ...six } = texts;
			(
				await client
					.put(settings)
					.form(six)
					.loginAs(a.owner)
					.withCsrfToken()
					.redirects(0)
			).assertFlashMessage("success", "Messages saved.");
		} finally {
			env.set("REVIEWS_ENABLED", true);
		}
		assert.equal(
			(await row())?.body,
			"Tell us how it healed: {review_link}",
			"kept while reviews are off",
		);
	});
});
