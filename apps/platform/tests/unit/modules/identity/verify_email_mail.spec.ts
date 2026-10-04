import { test } from "@japa/runner";
import User from "#models/user";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

// Signed URLs always carry several query parameters, so the `&` matters.
const verifyUrl =
	"https://app.tattoo-drip.test/verify-email?token=abc&signature=xyz";

function makeUser(fullName: string | null) {
	const user = new User();
	user.email = "ink@example.com";
	user.fullName = fullName;
	return user;
}

async function render(user: User) {
	const mail = new VerifyEmailMail(user, verifyUrl);
	await mail.buildWithContents();
	return mail.message;
}

test.group("VerifyEmailMail", () => {
	test("is addressed to the user and leaves the sender to the config", async ({
		assert,
	}) => {
		const message = await render(makeUser("Ada Ink"));

		message.assertTo("ink@example.com");
		message.assertSubject("Verify your email");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("renders the html inside the shared layout", async () => {
		const message = await render(makeUser("Ada Ink"));

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Tattoo Drip");
		message.assertHtmlIncludes("Hi Ada Ink,");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/verify-email?token=abc&amp;signature=xyz"',
		);
	});

	test("prints the name and url as typed in the text version", async () => {
		const message = await render(makeUser("<b>Tom</b> & Jerry"));

		message.assertTextIncludes("Hi <b>Tom</b> & Jerry,");
		message.assertTextIncludes(verifyUrl);
	});

	test("escapes the name in the html version", async ({ assert }) => {
		const message = await render(makeUser("<b>Tom</b> & Jerry"));

		message.assertHtmlIncludes("Hi &lt;b&gt;Tom&lt;/b&gt; &amp; Jerry,");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>Tom</b>");
	});

	test("greets 'there' when the user has no name", async ({ assert }) => {
		for (const fullName of [null, ""]) {
			const message = await render(makeUser(fullName));

			message.assertHtmlIncludes("Hi there,");
			message.assertTextIncludes("Hi there,");
			assert.notInclude(String(message.nodeMailerMessage.html), "null");
		}
	});
});
