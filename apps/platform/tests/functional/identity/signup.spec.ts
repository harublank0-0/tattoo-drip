import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import { SENT_TO_FLASH } from "#modules/identity/account_tokens";
import env from "#start/env";
import { cookieNames, queuedMails } from "#tests/helpers/accounts";
import { assertValidationError } from "#tests/helpers/validation";

const PASSWORD = "secret-password";

function form(email: string, fullName = "Ada Ink") {
	return {
		fullName,
		email,
		password: PASSWORD,
		passwordConfirmation: PASSWORD,
	};
}

/** POST /signup from one client address. */
function signup(
	client: ApiClient,
	body: Record<string, string>,
	ip = "203.0.113.90",
) {
	return client
		.post("/signup")
		.header("x-forwarded-for", ip)
		.header("referer", "/signup")
		.form(body)
		.withCsrfToken()
		.redirects(0);
}

const appLink = (path: string) => new URL(path, env.get("APP_URL")).toString();

test.group("Signup (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new address gets an unconfirmed account, a confirmation email and the check-your-email page, signed out", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();

		const response = await signup(client, form("  Ada@Signup-18.example "));

		response.assertStatus(302);
		response.assertHeader("location", "/signup/sent");
		response.assertFlashMessage(SENT_TO_FLASH, "ada@signup-18.example");
		response.assertSessionMissing("auth_web");
		const user = await User.findByOrFail("email", "ada@signup-18.example");
		assert.equal(user.fullName, "Ada Ink");
		assert.isNull(user.emailVerifiedAt);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[["ada@signup-18.example", "Confirm your email address"]],
		);
		assert.isTrue(
			String(mails[0].data.url).startsWith(appLink("/verify-email/")),
		);
		assert.notInclude(JSON.stringify(mails[0].data), "Ada Ink");
	});

	test("a taken address answers exactly the same, and only its owner's mailbox hears the difference", async ({
		client,
		assert,
	}) => {
		await User.create({
			fullName: "Owner",
			email: "taken@signup-18.example",
			password: "the-owners-password",
		});
		const fake = queue.fake();

		const fresh = await signup(
			client,
			form("fresh@signup-18.example"),
			"203.0.113.91",
		);
		const taken = await signup(
			client,
			form("TAKEN@signup-18.example"),
			"203.0.113.92",
		);

		for (const response of [fresh, taken]) {
			response.assertStatus(302);
			response.assertHeader("location", "/signup/sent");
			response.assertSessionMissing("auth_web");
			response.assertFlashMissing("error");
			response.assertFlashMissing("inputErrorsBag");
		}
		taken.assertFlashMessage(SENT_TO_FLASH, "taken@signup-18.example");
		assert.deepEqual(cookieNames(taken), cookieNames(fresh));

		const owners = await User.query().where("email", "taken@signup-18.example");
		assert.lengthOf(owners, 1);
		assert.equal(owners[0].fullName, "Owner");
		await User.verifyCredentials(
			"taken@signup-18.example",
			"the-owners-password",
		);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[
				["fresh@signup-18.example", "Confirm your email address"],
				["taken@signup-18.example", "You already have a Tattoo Drip account"],
			],
		);
		assert.equal(mails[1].data.signInUrl, appLink("/login"));
		assert.isTrue(
			String(mails[1].data.resetUrl).startsWith(appLink("/reset-password/")),
		);
	});

	test("the check-your-email page shows the address it was sent to, or none", async ({
		client,
		assert,
	}) => {
		const page = await client
			.get("/signup/sent")
			.withFlashMessages({ [SENT_TO_FLASH]: "ada@signup-18.example" })
			.withInertia();
		page.assertInertiaComponent("auth/check_email");
		assert.containSubset(page.inertiaProps, {
			purpose: "signup",
			email: "ada@signup-18.example",
		});

		const reload = await client.get("/signup/sent").withInertia();
		assert.containSubset(reload.inertiaProps, {
			purpose: "signup",
			email: null,
		});
	});

	test("three signups an hour naming one address, from anywhere; a fourth is refused", async ({
		client,
		assert,
	}) => {
		queue.fake();
		for (const ip of ["203.0.113.161", "203.0.113.162", "203.0.113.163"]) {
			(await signup(client, form("busy@signup-18.example"), ip)).assertHeader(
				"location",
				"/signup/sent",
			);
		}

		const refused = await signup(
			client,
			form("Busy@Signup-18.example"),
			"203.0.113.164",
		);
		refused.assertHeader("location", "/signup");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		(
			await signup(client, form("other@signup-18.example"), "203.0.113.164")
		).assertHeader("location", "/signup/sent");
		assert.lengthOf(
			await User.query().where("email", "busy@signup-18.example"),
			1,
		);
	});

	test("a form error looks the same whether or not the address is taken", async ({
		client,
		assert,
	}) => {
		await User.create({ email: "taken@signup-18.example", password: PASSWORD });

		for (const [email, ip] of [
			["taken@signup-18.example", "203.0.113.150"],
			["free@signup-18.example", "203.0.113.151"],
		] as const) {
			const response = await signup(
				client,
				{ ...form(email), passwordConfirmation: "not-the-same" },
				ip,
			);
			response.assertHeader("location", "/signup");
			assertValidationError(response, "passwordConfirmation");
			assert.notProperty(
				response.flashMessage("inputErrorsBag") ?? {},
				"email",
			);
		}
		assert.isNull(await User.findBy("email", "free@signup-18.example"));
	});
});
