import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import Artist from "#modules/artists/models/artist";
import {
	emailShownName,
	freshInkIntro,
	freshInkSubject,
} from "#modules/notifications/alerts";
import FreshInkMail from "#modules/notifications/emails/fresh_ink_mail";
import StaffAlert from "#modules/notifications/models/staff_alert";
import FreshInkAlertJob from "#modules/reviews/jobs/fresh_ink_alert_job";
import ClientPost from "#modules/reviews/models/client_post";
import env from "#start/env";
import { queuedMails } from "#tests/helpers/accounts";
import { reviewBody, reviewRequest } from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";

/**
 * The Fresh ink staff alert (Reviews and Fresh ink, slice 2): queued with
 * the post's round in the transaction that put it in the studio's queue,
 * one alert and one email per member per post per round, ALERT_EMAILS
 * respected, and no client data in the email beyond the name they chose.
 */

async function run(payload: {
	tenantId: string;
	postId: string;
	round: number;
}) {
	const job = new FreshInkAlertJob();
	job.$hydrate(payload, {
		jobId: "fresh-ink-alert-spec",
		name: "FreshInkAlertJob",
		attempt: 1,
		queue: "default",
		priority: 0,
		acquiredAt: new Date(),
		stalledCount: 0,
	});
	await job.execute();
}

function pushed(fake: ReturnType<typeof queue.fake>, studio: Studio) {
	return fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "FreshInkAlertJob")
		.map(
			({ job }) =>
				job.payload as { tenantId: string; postId: string; round: number },
		)
		.filter(({ tenantId }) => tenantId === studio.tenant.id);
}

function alerts(studio: Studio) {
	return inTenant(studio.tenant, () =>
		StaffAlert.query().where("kind", "fresh_ink").orderBy("user_id"),
	);
}

test.group("Fresh ink alerts", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the client's submit queues the alert for round 1; a change of an approved post queues round 2", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const fake = queue.fake();
		const submit = (caption: string) =>
			reviewRequest(client, "PUT", a.tenant.slug, "", a.reviewToken).json(
				reviewBody({
					review: undefined,
					post: { caption, styles: [] },
				}),
			);
		(await submit("Healed.")).assertStatus(200);
		assert.deepEqual(pushed(fake, a), [
			{ tenantId: a.tenant.id, postId: a.clientPost.id, round: 1 },
		]);
		// A change while waiting: no new round, no new alert.
		(await submit("Healed nicely.")).assertStatus(200);
		assert.lengthOf(pushed(fake, a), 1);

		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.clientPost.id).update({
				status: "approved",
				decided_at: new Date(),
			}),
		);
		(await submit("Two months on.")).assertStatus(200);
		assert.deepEqual(pushed(fake, a).at(-1), {
			tenantId: a.tenant.id,
			postId: a.clientPost.id,
			round: 2,
		});
	});

	test("owners and the project's artist get one alert and one email per round, never twice", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		await inTenant(a.tenant, () =>
			Artist.query()
				.where("id", a.artistProfile.id)
				.update({ user_id: a.artist.id }),
		);
		const fake = queue.fake();
		const payload = {
			tenantId: a.tenant.id,
			postId: a.waitingPost.id,
			round: 1,
		};
		await run(payload);
		await run(payload);

		assert.deepEqual(
			(await alerts(a))
				.map(({ userId, postId, postRound }) => [userId, postId, postRound])
				.sort(),
			[
				[a.owner.id, a.waitingPost.id, 1],
				[a.artist.id, a.waitingPost.id, 1],
			].sort(),
		);
		const mails = queuedMails(fake);
		assert.sameMembers(
			mails.map(({ to }) => to),
			[a.owner.email, a.artist.email],
		);
		for (const mail of mails) {
			assert.equal(mail.subject, freshInkSubject(a.tenant.name));
			assert.notInclude(mail.subject, "Sita");
			assert.match(
				String(mail.data.url),
				new RegExp(`/t/${a.tenant.slug}/reviews$`),
			);
			// The shown name only: never the client's full name, phone or email.
			assert.include(String(mail.data.intro), "Sita R.");
			const text = JSON.stringify(mail.data);
			assert.notInclude(text, a.pipeline.client.name);
			if (a.pipeline.client.phone)
				assert.notInclude(text, a.pipeline.client.phone);
		}

		// The next round alerts again.
		await inTenant(a.tenant, () =>
			ClientPost.query().where("id", a.waitingPost.id).update({
				waiting_round: 2,
			}),
		);
		await run({ ...payload, round: 2 });
		assert.lengthOf(await alerts(a), 4);
	});

	test("a decided post, a stale round, a taken-down post and ALERT_EMAILS off", async ({
		assert,
	}) => {
		const { a } = await twoStudios();
		const fake = queue.fake();
		// Approved meanwhile: nothing.
		await run({ tenantId: a.tenant.id, postId: a.approvedPost.id, round: 1 });
		// A round that isn't the post's.
		await run({ tenantId: a.tenant.id, postId: a.waitingPost.id, round: 2 });
		assert.lengthOf(await alerts(a), 0);
		assert.lengthOf(queuedMails(fake), 0);

		const { default: AlertService } = await import(
			"#modules/notifications/services/alert_service"
		);
		const { default: app } = await import("@adonisjs/core/services/app");
		const service = await app.container.make(AlertService);
		await inTenant(a.tenant, () =>
			service.freshInk(
				a.tenant,
				{
					postId: a.waitingPost.id,
					round: 1,
					artistId: null,
					shownName: "Sita R.",
				},
				{ emails: false },
			),
		);
		assert.lengthOf(await alerts(a), 1, "the in-app alert stays");
		assert.lengthOf(queuedMails(fake), 0, "no email");
	});

	test("the Alerts list names the shown name and opens the Reviews page; the bell doesn't count it", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		queue.fake();
		await run({ tenantId: a.tenant.id, postId: a.waitingPost.id, round: 1 });
		const page = await client
			.get(`/t/${a.tenant.slug}/alerts`)
			.loginAs(a.owner)
			.withInertia();
		const props = page.inertiaProps as {
			alerts: { id: string; title: string; detail: string }[];
			alertCount: number;
		};
		const row = props.alerts.find(
			({ title }) => title === "Fresh ink to approve",
		);
		assert.equal(row?.detail, "Sita R.: Open it on the Reviews page.");
		assert.equal(
			props.alertCount,
			0,
			"the Reviews tab counts it, not the bell",
		);
		const open = await client
			.post(`/t/${a.tenant.slug}/alerts/${row?.id}/open`)
			.loginAs(a.owner)
			.withCsrfToken()
			.redirects(0);
		open.assertStatus(302);
		open.assertHeader("location", `/t/${a.tenant.slug}/reviews`);

		// Reviews turned off later: the alert stays on the list and counts on the bell.
		env.set("REVIEWS_ENABLED", false);
		try {
			const off = await client
				.post(`/t/${a.tenant.slug}/alerts/${row?.id}/open`)
				.loginAs(a.owner)
				.withCsrfToken()
				.redirects(0);
			off.assertHeader("location", `/t/${a.tenant.slug}/alerts`);
		} finally {
			env.set("REVIEWS_ENABLED", true);
		}
	});
});

test.group("Fresh ink email", () => {
	test("its words: the shown name or 'A client', and whether it was changed", async ({
		assert,
	}) => {
		assert.equal(emailShownName("Sita R."), "Sita R.");
		assert.equal(emailShownName("सीता रा."), "सीता रा.");
		for (const unsafe of [
			"evil.com",
			"a@b.co",
			"http://x.y",
			"Room 101",
			"  ",
		]) {
			assert.equal(emailShownName(unsafe), "A client", unsafe);
		}
		assert.equal(
			freshInkIntro({
				shownName: "Sita R.",
				studioName: "Black Needle",
				edited: false,
				yourProject: false,
			}),
			"Sita R. sent Black Needle Fresh ink of their healed tattoo.",
		);
		assert.equal(
			freshInkIntro({
				shownName: "Sita R.",
				studioName: "Black Needle",
				edited: true,
				yourProject: true,
			}),
			"Sita R. changed their Fresh ink post for Black Needle (your project).",
		);

		const mail = new FreshInkMail({
			to: "owner@example.com",
			recipientName: null,
			studioName: "Black Needle",
			intro: "Sita R. sent Black Needle Fresh ink of their healed tattoo.",
			edited: false,
			url: "https://app.example/t/black-needle/reviews",
		});
		await mail.buildWithContents();
		mail.message.assertTo("owner@example.com");
		mail.message.assertSubject("Fresh ink to approve for Black Needle");
		mail.message.assertHtmlIncludes("Hi there,");
		mail.message.assertHtmlIncludes(
			"https://app.example/t/black-needle/reviews",
		);
		mail.message.assertTextIncludes(
			"Open Reviews: https://app.example/t/black-needle/reviews",
		);
	});
});
