import { test } from "@japa/runner";
import BillingReviewMail, {
	type BillingReviewMailData,
} from "#modules/notifications/emails/billing_review_mail";

const URL = "https://app.tattoo-drip.test/admin/billing";

const reversed: BillingReviewMailData = {
	to: "admin@platform.example",
	kind: "reversed",
	studioSlug: "black-needle",
	mode: "live",
	reason: "void",
	reasonText: "voided",
	url: URL,
};

async function render(mail: BillingReviewMail) {
	await mail.buildWithContents();
	return mail.message;
}

test.group("BillingReviewMail", () => {
	test("a reversed invoice: the studio's slug and mode, what PayBridgeNP did, the admin page, no from", async ({
		assert,
	}) => {
		const message = await render(new BillingReviewMail(reversed));

		message.assertTo("admin@platform.example");
		message.assertSubject("Studio paid access ended");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes(
			"A paid live invoice of the studio “black-needle” was voided at PayBridgeNP",
		);
		message.assertHtmlIncludes(`href="${URL}"`);
		message.assertTextIncludes("was voided at PayBridgeNP");
		message.assertTextIncludes(`Open billing: ${URL}`);
		assert.notInclude(
			String(message.nodeMailerMessage.html),
			"granted no access",
		);
	});

	test("an unresolved invoice says it granted nothing and why, never which plan", async ({
		assert,
	}) => {
		const message = await render(
			new BillingReviewMail({
				...reversed,
				kind: "unresolved",
				mode: "sandbox",
				reason: null,
				reasonText: null,
			}),
		);

		message.assertSubject("Paid studio invoice not granted");
		message.assertHtmlIncludes(
			"A paid sandbox invoice of the studio “black-needle” granted no access",
		);
		message.assertTextIncludes("granted no access");
		message.assertTextIncludes(`Open billing: ${URL}`);
		assert.notInclude(String(message.nodeMailerMessage.text), "null");
		assert.notInclude(String(message.nodeMailerMessage.html), "voided");
	});
});
