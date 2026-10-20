import { test } from "@japa/runner";
import DepositProofMail, {
	type DepositProofMailData,
} from "#modules/notifications/emails/deposit_proof_mail";

const CARD =
	"https://app.tattoo-drip.test/t/black-needle/projects/0190#payments";

const owner: DepositProofMailData = {
	to: "owner@black-needle.example",
	recipientName: "Ram Thapa",
	studioName: "Black Needle",
	intro: "Sita sent Black Needle a deposit screenshot.",
	forOwner: true,
	url: CARD,
};

async function render(data: DepositProofMailData) {
	const mail = new DepositProofMail(data);
	await mail.buildWithContents();
	return mail.message;
}

test.group("DepositProofMail (TAT-88)", () => {
	test("goes to the member, with no client data in the subject and no from", async ({
		assert,
	}) => {
		const message = await render(owner);

		message.assertTo("owner@black-needle.example");
		message.assertSubject("Deposit screenshot for Black Needle");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("an owner's email asks them to check the screenshot on the Payments card", async () => {
		const message = await render(owner);

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Hi Ram Thapa,");
		message.assertHtmlIncludes("Sita sent Black Needle a deposit screenshot.");
		message.assertHtmlIncludes(
			"Check that the money reached your account, then verify or reject it on the Payments card.",
		);
		message.assertHtmlIncludes(`href="${CARD}"`);
		message.assertHtmlIncludes("Check the screenshot");
		message.assertHtmlIncludes(
			"You get these emails as a member of Black Needle on Tattoo Drip.",
		);
		message.assertTextIncludes(`Check the screenshot: ${CARD}`);
	});

	test("the project's artist is told an owner checks it, and can open the project", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			recipientName: null,
			intro: "Sita sent Black Needle a deposit screenshot for your project.",
			forOwner: false,
		});

		message.assertHtmlIncludes("Hi there,");
		message.assertHtmlIncludes("An owner of Black Needle will check it.");
		message.assertHtmlIncludes("Open the project");
		message.assertTextIncludes("An owner of Black Needle will check it.");
		message.assertTextIncludes(`Open the project: ${CARD}`);
		const html = String(message.nodeMailerMessage.html);
		assert.notInclude(html, "Check the screenshot");
		assert.notInclude(html, "null");
	});

	test("escapes the words in the HTML and keeps them as typed in the text", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			intro: '<b>सीता</b> & "Sita" sent Black Needle a deposit screenshot.',
		});

		message.assertHtmlIncludes("&lt;b&gt;सीता&lt;/b&gt; &amp;");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>सीता</b>");
		message.assertTextIncludes('<b>सीता</b> & "Sita" sent Black Needle');
	});
});
