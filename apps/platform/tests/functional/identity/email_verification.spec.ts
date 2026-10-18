import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	CONFIRMED_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { AUTH_LIMITS } from "#modules/identity/services/auth_limits";
import { digest } from "#services/rate_limits";
import {
	altered,
	expireToken,
	queuedMails,
	tokenOf,
} from "#tests/helpers/accounts";

const KEY = SESSION_TOKEN_KEYS.verify_email;
const REFUSED = "Invalid or expired CSRF token";
const tokens = new AccountTokenService();

function makeUser(email = "ink@verify-18.example") {
	return User.create({ email, password: "secret-password" });
}

const reload = (user: User) => User.findOrFail(user.id);

/** POST /verify-email with `token` in the session, as the link leaves it. */
function confirm(client: ApiClient, token: string | null) {
	return client
		.post("/verify-email")
		.withSession(token ? { [KEY]: token } : {})
		.withCsrfToken()
		.redirects(0);
}

/** "Send a new link", as the notice page and the banner post it. */
function resend(client: ApiClient, user: User) {
	return client
		.post("/confirm-email")
		.header("referer", "/confirm-email")
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

test.group("Email confirmation (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the emailed link only moves its token into the session and opens the page without it", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const response = await client.get(`/verify-email/${token}`).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/verify-email");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(KEY, token);
		assert.isNull((await reload(user)).emailVerifiedAt);
	});

	test("a malformed link is the router's 404", async ({ client }) => {
		(await client.get("/verify-email/short").redirects(0)).assertStatus(404);
		(
			await client.get(`/verify-email/${"a".repeat(42)}=`).redirects(0)
		).assertStatus(404);
	});

	test("the page shows what a live link confirms, never the token", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia();

		page.assertInertiaComponent("auth/verify_email");
		assert.containSubset(page.inertiaProps, {
			state: "ready",
			email: user.email,
			forSignedInUser: false,
			signedInEmail: null,
			canResend: false,
		});
		assert.notInclude(JSON.stringify(page.body()), token);
		page.assertHeader("cache-control", "no-store");
		page.assertHeader("referrer-policy", "same-origin");
	});

	test("confirming is a POST: it confirms the address once and signs nobody in; a replay finds a dead link", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const first = await confirm(client, token);
		first.assertHeader("location", "/verify-email");
		first.assertFlashMessage(CONFIRMED_FLASH, user.email);
		first.assertSessionMissing(KEY);
		first.assertSessionMissing("auth_web");
		const confirmedAt = (await reload(user)).emailVerifiedAt;
		assert.isNotNull(confirmedAt);

		const replay = await confirm(client, token);
		replay.assertFlashMissing(CONFIRMED_FLASH);
		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia();
		assert.equal(page.inertiaProps.state, "invalid");
		assert.equal(
			(await reload(user)).emailVerifiedAt?.toMillis(),
			confirmedAt?.toMillis(),
		);
	});

	test("after confirming, the page says so and offers the next step", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const guest = await client
			.get("/verify-email")
			.withFlashMessages({ [CONFIRMED_FLASH]: user.email })
			.withInertia();
		assert.containSubset(guest.inertiaProps, {
			state: "done",
			email: user.email,
			forSignedInUser: false,
			signedInEmail: null,
		});

		const owner = await client
			.get("/verify-email")
			.withFlashMessages({ [CONFIRMED_FLASH]: user.email })
			.withInertia()
			.loginAs(user);
		assert.containSubset(owner.inertiaProps, {
			state: "done",
			forSignedInUser: true,
			signedInEmail: user.email,
			canResend: false,
		});
	});

	test("an expired link confirms nothing, and the page offers a new one", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		await expireToken(user.id, "verify_email");

		(await confirm(client, token)).assertFlashMissing(CONFIRMED_FLASH);

		assert.isNull((await reload(user)).emailVerifiedAt);
		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia()
			.loginAs(user);
		assert.containSubset(page.inertiaProps, {
			state: "expired",
			canResend: true,
			signedInEmail: user.email,
		});
	});

	test("an altered link, a reset link or none confirms nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");
		const reset = await tokens.issue(user, "reset_password");

		for (const value of [altered(token), reset, null]) {
			(await confirm(client, value)).assertFlashMissing(CONFIRMED_FLASH);
			const page = await client
				.get("/verify-email")
				.withSession(value ? { [KEY]: value } : {})
				.withInertia();
			assert.equal(page.inertiaProps.state, "invalid");
		}

		assert.isNull((await reload(user)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "live");
	});

	test("a link confirms the account it was sent to, whoever is signed in", async ({
		client,
		assert,
	}) => {
		const owner = await makeUser("owner@verify-18.example");
		const other = await makeUser("other@verify-18.example");
		const token = await tokens.issue(owner, "verify_email");

		const page = await client
			.get("/verify-email")
			.withSession({ [KEY]: token })
			.withInertia()
			.loginAs(other);
		assert.containSubset(page.inertiaProps, {
			state: "ready",
			email: owner.email,
			forSignedInUser: false,
			signedInEmail: other.email,
		});

		await client
			.post("/verify-email")
			.withSession({ [KEY]: token })
			.withCsrfToken()
			.loginAs(other)
			.redirects(0);

		assert.isNotNull((await reload(owner)).emailVerifiedAt);
		assert.isNull((await reload(other)).emailVerifiedAt);
	});

	test("a confirmation without this session's CSRF token is refused", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "verify_email");

		const response = await client
			.post("/verify-email")
			.withSession({ [KEY]: token })
			.redirects(0);

		response.assertFlashMessage("error", REFUSED);
		assert.isNull((await reload(user)).emailVerifiedAt);
	});

	test("an unconfirmed account's own page shows its address; a confirmed one goes on, a guest signs in", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const page = await client.get("/confirm-email").withInertia().loginAs(user);
		page.assertInertiaComponent("auth/confirm_email");
		assert.deepEqual(page.inertiaProps.email, user.email);

		user.emailVerifiedAt = DateTime.now();
		await user.save();
		(
			await client
				.get("/confirm-email")
				.loginAs(await reload(user))
				.redirects(0)
		).assertHeader("location", "/dashboard");
		(await client.get("/confirm-email").redirects(0)).assertHeader(
			"location",
			"/login",
		);
	});

	test("'Send a new link' emails a link that replaces the old one", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const old = await tokens.issue(user, "verify_email");
		const fake = queue.fake();

		const response = await resend(client, user);

		response.assertHeader("location", "/confirm-email");
		response.assertFlashMessage(
			"success",
			`We sent a new link to ${user.email}.`,
		);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Confirm your email address"]],
		);
		assert.equal(
			(await tokens.state(tokenOf(mails[0].data.url), "verify_email")).state,
			"live",
		);
		assert.equal((await tokens.state(old, "verify_email")).state, "unknown");
	});

	test("one new link a minute, and five an hour, per account", async ({
		client,
	}) => {
		const user = await makeUser();
		queue.fake();

		(await resend(client, user)).assertFlashMessage(
			"success",
			`We sent a new link to ${user.email}.`,
		);
		(await resend(client, user)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 1 minute.",
		);

		await limiter.clear(["memory"]);
		await limiter
			.use({ ...AUTH_LIMITS.verifyResendPerUser })
			.increment(`verify_resend_${digest(user.id)}`, 5);
		(await resend(client, user)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
	});

	test("a confirmed account gets no link", async ({ client, assert }) => {
		const user = await makeUser();
		user.emailVerifiedAt = DateTime.now();
		await user.save();
		const fake = queue.fake();

		(await resend(client, await reload(user))).assertHeader(
			"location",
			"/dashboard",
		);

		assert.lengthOf(queuedMails(fake), 0);
	});
});
