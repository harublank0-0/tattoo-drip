import emitter from "@adonisjs/core/services/emitter";
import testUtils from "@adonisjs/core/services/test_utils";
import mail from "@adonisjs/mail/services/main";
import { test } from "@japa/runner";
import StaffAlert from "#modules/notifications/models/staff_alert";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued } from "#tests/helpers/worker";

test.group("New-inquiry alert through the worker", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		mail.restore();
		emitter.restore();
	});

	test("an intake's alert reaches the owner's mailbox and the dashboard", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"alert-flow-52",
			"Alert Flow",
		);
		mail.fake();
		const events = emitter.fake(["mail:sent"]);

		const response = await postInquiry(client, "alert-flow-52", intakeFields());
		response.assertStatus(201);
		const { id } = response.body().data;

		// NewInquiryAlertJob, then the SendMailJob it queued.
		await processQueued();

		const sent = events.find("mail:sent");
		assert.exists(sent);
		assert.include(JSON.stringify(sent?.data.message.to), owner.email);
		assert.equal(sent?.data.message.subject, "New inquiry for Alert Flow");
		assert.include(
			String(sent?.data.message.html),
			"Maya sent Alert Flow a new tattoo inquiry:",
		);
		assert.include(String(sent?.data.message.text), "Open the inquiry: ");
		assert.lengthOf(
			await inTenant(tenant, () => StaffAlert.query().where("inquiry_id", id)),
			1,
		);
	});
});
