import { test } from "@japa/runner";
import NewInquiryMail, {
	type NewInquiryMailData,
} from "#modules/notifications/emails/new_inquiry_mail";

// A dashboard link carries a query string in no case today; the & still
// proves the HTML escapes and the text version doesn't.
const owner: NewInquiryMailData = {
	to: "owner@black-needle.example",
	recipientName: "Ram Thapa",
	studioName: "Black Needle",
	intro: "Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
	excerpt: "A koi on the calf",
	url: "https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&y=2",
};

async function render(data: NewInquiryMailData) {
	const mail = new NewInquiryMail(data);
	await mail.buildWithContents();
	return mail.message;
}

test.group("NewInquiryMail", () => {
	test("goes to the member, with no client data in the subject and no from", async ({
		assert,
	}) => {
		const message = await render(owner);

		message.assertTo("owner@black-needle.example");
		message.assertSubject("New inquiry for Black Needle");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("an owner's email quotes the idea and links the inquiry", async () => {
		const message = await render(owner);

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Hi Ram Thapa,");
		message.assertHtmlIncludes(
			"Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
		);
		message.assertHtmlIncludes("A koi on the calf");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&amp;y=2"',
		);
		message.assertHtmlIncludes(
			"You get these emails as a member of Black Needle on Tattoo Drip.",
		);
		message.assertTextIncludes(
			"Open the inquiry: https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&y=2",
		);
	});

	test("the asked-for artist's email has no inbox link", async ({ assert }) => {
		const message = await render({ ...owner, recipientName: null, url: null });

		message.assertHtmlIncludes("Hi there,");
		message.assertHtmlIncludes(
			"An owner of Black Needle will review it in the inbox.",
		);
		message.assertTextIncludes(
			"An owner of Black Needle will review it in the inbox.",
		);
		const html = String(message.nodeMailerMessage.html);
		assert.notInclude(html, "Open the inquiry");
		assert.notInclude(html, "null");
	});

	test("escapes the client's words in the HTML and keeps them as typed in the text", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			excerpt: '<b>koi</b> & "waves"',
		});

		message.assertHtmlIncludes("&lt;b&gt;koi&lt;/b&gt; &amp;");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>koi</b>");
		message.assertTextIncludes('"<b>koi</b> & "waves""');
	});
});
