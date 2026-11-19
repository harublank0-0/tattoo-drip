import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import type { SendMailPayload } from "#jobs/send_mail_job";
import { StorageFullError } from "#modules/media/errors";
import StorageNearlyFullMail from "#modules/notifications/emails/storage_nearly_full_mail";
import StorageAlertJob from "#modules/storage/jobs/storage_alert_job";
import StoredFile from "#modules/storage/models/stored_file";
import { reserveStorage } from "#modules/storage/reservations";
import Tenant from "#modules/tenancy/models/tenant";
import env from "#start/env";
import { captureLogs } from "#tests/helpers/logs";
import {
	enforceStorage,
	MB,
	smallStudio,
	unsetStorageEnforcement,
} from "#tests/helpers/storage";
import { artistIn, inTenant } from "#tests/helpers/tenants";

/** `n` megabytes, in whole bytes. */
const mb = (n: number) => Math.round(n * MB);

/** The alert jobs queued for `tenant`. */
function alertJobs(fake: ReturnType<typeof queue.fake>, tenant: Tenant) {
	return fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "StorageAlertJob")
		.map(({ job }) => job.payload as { tenantId: string })
		.filter(({ tenantId }) => tenantId === tenant.id);
}

const reserve = (tenant: Tenant, bytes: number) =>
	inTenant(tenant, () =>
		reserveStorage({
			tenantId: tenant.id,
			purpose: "artist_work_photo",
			bytes,
			minutes: 15,
		}),
	);

const markerOf = (tenant: Tenant) =>
	inTenant(
		tenant,
		async () => (await Tenant.findOrFail(tenant.id)).storageAlertedAt,
	);

const setMarker = (tenant: Tenant) =>
	inTenant(tenant, () =>
		Tenant.query()
			.where("id", tenant.id)
			.update({ storage_alerted_at: new Date() }),
	);

/**
 * The 95% email, noticed (the storage meter, step 3): an upload's
 * reservation queues StorageAlertJob when usage reaches 95% of a 1 MB test
 * allowance and the studio's marker is unset; under 90% it clears the
 * marker. Only with enforcement on; observe mode logs.
 */
test.group("Storage: noticing 95%", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		queue.restore();
		unsetStorageEnforcement();
	});

	test("a reservation that reaches 95% queues one alert; one that stays under queues none", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const under = await smallStudio("alert-under", mb(0.5));
		await reserve(under.tenant, mb(0.1));
		assert.lengthOf(alertJobs(fake, under.tenant), 0);

		const over = await smallStudio("alert-over", mb(0.94));
		await reserve(over.tenant, mb(0.02));
		assert.deepEqual(alertJobs(fake, over.tenant), [
			{ tenantId: over.tenant.id },
		]);
	});

	test("a refused upload at 96% still queues the alert", async ({ assert }) => {
		const fake = queue.fake();
		enforceStorage(true);
		const s = await smallStudio("alert-refused", mb(0.96));

		const error = await reserve(s.tenant, mb(0.1)).catch((e) => e);

		assert.instanceOf(error, StorageFullError);
		assert.lengthOf(alertJobs(fake, s.tenant), 1);
	});

	test("once the marker is set, nothing more is queued; under 90% an upload clears it", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const full = await smallStudio("alert-marked", mb(0.96));
		await setMarker(full.tenant);
		await reserve(full.tenant, mb(0.01));
		assert.lengthOf(alertJobs(fake, full.tenant), 0);
		assert.isNotNull(await markerOf(full.tenant));

		const freed = await smallStudio("alert-freed", mb(0.5));
		await setMarker(freed.tenant);
		await reserve(freed.tenant, mb(0.01));
		assert.isNull(await markerOf(freed.tenant));
	});

	test("in observe mode nothing is queued and the crossing is logged", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(false);
		const s = await smallStudio("alert-observe", mb(0.94));
		const logs = captureLogs();
		try {
			await reserve(s.tenant, mb(0.02));
		} finally {
			logs.restore();
		}
		assert.lengthOf(alertJobs(fake, s.tenant), 0);
		assert.isTrue(
			logs
				.everything()
				.some((line) => line.includes("Package rule would email")),
		);
		assert.isNull(await markerOf(s.tenant));
	});
});

/** The emails the fake queue holds: SendMailJob payloads. */
const mails = (fake: ReturnType<typeof queue.fake>) =>
	fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => job.payload as SendMailPayload);

/** Runs StorageAlertJob for `tenant` as the worker would. */
async function runAlertJob(tenant: Tenant) {
	const job = new StorageAlertJob();
	job.$hydrate(
		{ tenantId: tenant.id },
		{
			jobId: "storage-alert-spec",
			name: "StorageAlertJob",
			attempt: 1,
			queue: "default",
			priority: 0,
			acquiredAt: new Date(),
			stalledCount: 0,
		},
	);
	await job.execute();
}

/**
 * The 95% email, sent (the storage meter, step 3): StorageAlertJob claims
 * the studio's marker and emails each owner once per crossing.
 */
test.group("Storage: the 95% email", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		queue.restore();
		unsetStorageEnforcement();
		env.set("ALERT_EMAILS", undefined as never);
		delete process.env.ALERT_EMAILS;
	});

	test("each owner gets one email, never twice; artists get none", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const s = await smallStudio("mail-once", mb(0.96));
		await artistIn(s.tenant, "artist@mail-once.example");

		await runAlertJob(s.tenant);
		await runAlertJob(s.tenant);

		const sent = mails(fake);
		assert.deepEqual(
			sent.map(({ mailMessage }) => mailMessage.message.to?.[0]),
			[s.owner.email],
		);
		const [mail] = sent;
		assert.equal(
			mail.mailMessage.message.subject,
			"Studio mail-once's storage is nearly full",
		);
		const data = mail.mailMessage.views.html?.data;
		assert.equal(data.percent, 96);
		assert.equal(data.limitText, "1 MB");
		assert.equal(
			data.url,
			`${env.get("APP_URL").replace(/\/$/, "")}/t/${s.tenant.slug}/settings/billing`,
		);
		assert.isNotNull(await markerOf(s.tenant));
	});

	test("the email renders its words and the Billing link, in HTML and text", async () => {
		const mail = new StorageNearlyFullMail({
			to: "owner@example.com",
			recipientName: null,
			studioName: "Black Needle",
			percent: 96,
			limitText: "5 GB",
			url: "https://app.example/t/black-needle/settings/billing",
		});
		await mail.buildWithContents();
		mail.message.assertTo("owner@example.com");
		mail.message.assertSubject("Black Needle's storage is nearly full");
		mail.message.assertHtmlIncludes("Hi there,");
		mail.message.assertHtmlIncludes(
			"Black Needle has used 96% of its 5 GB storage.",
		);
		mail.message.assertHtmlIncludes(
			"https://app.example/t/black-needle/settings/billing",
		);
		mail.message.assertTextIncludes(
			"See storage: https://app.example/t/black-needle/settings/billing",
		);
	});

	test("a job that finds usage back under 95% sends nothing and leaves the marker unset", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const s = await smallStudio("mail-freed", mb(0.6));

		await runAlertJob(s.tenant);

		assert.lengthOf(mails(fake), 0);
		assert.isNull(await markerOf(s.tenant));
	});

	test("with ALERT_EMAILS off the marker is set and nothing is sent", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		env.set("ALERT_EMAILS", false);
		const s = await smallStudio("mail-off", mb(0.97));

		await runAlertJob(s.tenant);

		assert.lengthOf(mails(fake), 0);
		assert.isNotNull(await markerOf(s.tenant));
	});

	test("after usage falls under 90% and an upload clears the marker, the next crossing emails again", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const s = await smallStudio("mail-again", mb(0.96));
		await runAlertJob(s.tenant);
		assert.lengthOf(mails(fake), 1);

		// Space freed: an upload under 90% rearms it.
		await inTenant(s.tenant, () =>
			StoredFile.query()
				.where("purpose", "artist_photo")
				.update({ bytes: mb(0.5) }),
		);
		await reserve(s.tenant, mb(0.01));
		assert.isNull(await markerOf(s.tenant));

		// Usage back over 95%: the next upload queues the alert, which sends.
		await inTenant(s.tenant, () =>
			StoredFile.query()
				.where("purpose", "artist_photo")
				.update({ bytes: mb(0.95) }),
		);
		await reserve(s.tenant, mb(0.01));
		assert.lengthOf(alertJobs(fake, s.tenant), 1);
		await runAlertJob(s.tenant);
		assert.lengthOf(mails(fake), 2);
	});
});
