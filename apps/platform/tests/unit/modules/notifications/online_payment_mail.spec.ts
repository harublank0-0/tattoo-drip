import { test } from "@japa/runner";
import ConnectionToVerifyMail from "#modules/notifications/emails/connection_to_verify_mail";
import OnlinePaymentMail, {
	type OnlinePaymentMailData,
} from "#modules/notifications/emails/online_payment_mail";

const CARD =
	"https://app.tattoo-drip.test/t/black-needle/projects/0190#payments";
const TRANSACTIONS = "https://app.tattoo-drip.test/t/black-needle/transactions";

const paid: OnlinePaymentMailData = {
	to: "owner@black-needle.example",
	recipientName: "Ram Thapa",
	studioName: "Black Needle",
	intro: "Sita paid Black Needle's deposit online.",
	held: false,
	url: CARD,
};

async function render(mail: OnlinePaymentMail | ConnectionToVerifyMail) {
	await mail.buildWithContents();
	return mail.message;
}

test.group("OnlinePaymentMail", () => {
	test("a recorded deposit: no client data in the subject, the Payments card link, no from", async ({
		assert,
	}) => {
		const message = await render(new OnlinePaymentMail(paid));

		message.assertTo("owner@black-needle.example");
		message.assertSubject("Deposit paid online for Black Needle");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes("Hi Ram Thapa,");
		message.assertHtmlIncludes("Sita paid Black Needle");
		message.assertHtmlIncludes("Nothing to check.");
		message.assertHtmlIncludes(`href="${CARD}"`);
		message.assertTextIncludes(`Open the project: ${CARD}`);
		assert.notInclude(String(message.nodeMailerMessage.html), "Transactions");
	});

	test("a held payment points owners at Transactions and a refund in PayBridgeNP", async ({
		assert,
	}) => {
		const message = await render(
			new OnlinePaymentMail({
				...paid,
				recipientName: null,
				held: true,
				intro:
					"Sita paid Black Needle online, but the payment didn't match its checkout, so it wasn't recorded as a deposit.",
				url: TRANSACTIONS,
			}),
		);

		message.assertSubject("Online payment to check for Black Needle");
		message.assertHtmlIncludes("Hi there,");
		message.assertHtmlIncludes("refund it in PayBridgeNP");
		message.assertHtmlIncludes(`href="${TRANSACTIONS}"`);
		message.assertTextIncludes(`Open Transactions: ${TRANSACTIONS}`);
		const html = String(message.nodeMailerMessage.html);
		assert.notInclude(html, "Nothing to check.");
		assert.notInclude(html, "null");
	});
});

test.group("ConnectionToVerifyMail", () => {
	test("names the studio and the PayBridgeNP merchant, links to the admin page, escapes the names", async ({
		assert,
	}) => {
		const message = await render(
			new ConnectionToVerifyMail({
				to: "admin@platform.example",
				studioName: "Black Needle",
				merchantName: "<b>Ink</b> Pvt. Ltd.",
				projectName: "Deposits",
				mode: "sandbox",
				url: "https://app.tattoo-drip.test/admin/payments",
			}),
		);

		message.assertTo("admin@platform.example");
		message.assertSubject("Studio payment connection to verify");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes(
			"Black Needle connected the PayBridgeNP project",
		);
		message.assertHtmlIncludes("&lt;b&gt;Ink&lt;/b&gt; Pvt. Ltd.");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/admin/payments"',
		);
		message.assertTextIncludes("(sandbox)");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>Ink</b>");
	});
});
