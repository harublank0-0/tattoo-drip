import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	SENT_TO_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import {
	AUTH_LIMITS,
	emailCountKey,
	loginEmailKey,
} from "#modules/identity/services/auth_limits";
import env from "#start/env";
import {
	altered,
	cookieNames,
	expireToken,
	flowOf,
	NO_FLOW,
	queuedMails,
} from "#tests/helpers/accounts";
import { assertValidationError } from "#tests/helpers/validation";

const KEY = SESSION_TOKEN_KEYS.reset_password;
const OLD = "the-old-password";
const NEW = "a-new-password";
const REFUSED = "Invalid or expired CSRF token";
const tokens = new AccountTokenService();

function makeUser(email = "ink@reset-18.example") {
	return User.create({ email, password: OLD });
}

/** POST /forgot-password from one client address. */
function ask(client: ApiClient, email: string, ip = "203.0.113.110") {
	return client
		.post("/forgot-password")
		.header("x-forwarded-for", ip)
		.header("referer", "/forgot-password")
		.form({ email })
		.withCsrfToken()
		.redirects(0);
}

/**
 * POST /reset-password with `token` in the session, as the link leaves it,
 * and the flow id of that token's row, as its page's hidden field posts it
 * (pass `flow` to post another; `null` leaves the field out).
 */
async function choose(
	client: ApiClient,
	token: string | null,
	password = NEW,
	confirmation = password,
	flow?: string | null,
) {
	const posted = flow === undefined ? await flowOf(token ?? "") : flow;
	return client
		.post("/reset-password")
		.withSession(token ? { [KEY]: token } : {})
		.header("referer", "/reset-password")
		.form({
			password,
			passwordConfirmation: confirmation,
			...(posted === null ? {} : { flow: posted }),
		})
		.withCsrfToken()
		.redirects(0);
}

async function signsIn(email: string, password: string) {
	try {
		await User.verifyCredentials(email, password);
		return true;
	} catch {
		return false;
	}
}

test.group("Password reset (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("asking for a link answers the same for every address; only an account's address gets an email", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const fake = queue.fake();

		const known = await ask(client, "INK@Reset-18.example", "203.0.113.111");
		const unknown = await ask(
			client,
			"nobody@reset-18.example",
			"203.0.113.112",
		);

		for (const response of [known, unknown]) {
			response.assertStatus(302);
			response.assertHeader("location", "/forgot-password/sent");
			response.assertFlashMissing("error");
		}
		known.assertFlashMessage(SENT_TO_FLASH, user.email);
		unknown.assertFlashMessage(SENT_TO_FLASH, "nobody@reset-18.example");
		assert.deepEqual(cookieNames(known), cookieNames(unknown));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Choose a new password"]],
		);
		assert.isTrue(
			String(mails[0].data.url).startsWith(
				new URL("/reset-password/", env.get("APP_URL")).toString(),
			),
		);
	});

	test("the sent page shows the address it was asked for, or none", async ({
		client,
		assert,
	}) => {
		const page = await client
			.get("/forgot-password/sent")
			.withFlashMessages({ [SENT_TO_FLASH]: "ink@reset-18.example" })
			.withInertia();
		page.assertInertiaComponent("auth/check_email");
		assert.containSubset(page.inertiaProps, {
			purpose: "reset",
			email: "ink@reset-18.example",
		});

		const reload = await client.get("/forgot-password/sent").withInertia();
		assert.containSubset(reload.inertiaProps, {
			purpose: "reset",
			email: null,
		});
	});

	test("three requests an hour per address named, registered or not, from anywhere", async ({
		client,
	}) => {
		for (const ip of ["203.0.113.121", "203.0.113.122", "203.0.113.123"]) {
			(await ask(client, "nobody@reset-18.example", ip)).assertHeader(
				"location",
				"/forgot-password/sent",
			);
		}

		const refused = await ask(
			client,
			"Nobody@Reset-18.example",
			"203.0.113.124",
		);
		refused.assertHeader("location", "/forgot-password");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		(
			await ask(client, "someone@reset-18.example", "203.0.113.124")
		).assertHeader("location", "/forgot-password/sent");
	});

	test("ten requests an hour per client address; a refused one never reaches the address count", async ({
		client,
		assert,
	}) => {
		for (let i = 0; i < 10; i++) {
			(
				await ask(client, `person${i}@reset-18.example`, "203.0.113.130")
			).assertHeader("location", "/forgot-password/sent");
		}

		const refused = await ask(
			client,
			"person10@reset-18.example",
			"203.0.113.130",
		);
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		assert.isNull(
			await limiter
				.use({ ...AUTH_LIMITS.resetPerEmail })
				.get(`reset_email_${emailCountKey("person10@reset-18.example")}`),
		);
	});

	test("the emailed link only moves its token into the session and opens the form without it", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const response = await client.get(`/reset-password/${token}`).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/reset-password");
		response.assertHeader("referrer-policy", "no-referrer");
		response.assertHeader("cache-control", "no-store");
		response.assertSession(KEY, token);
		assert.isTrue(await signsIn(user.email, OLD));
		(await client.get("/reset-password/not-a-token").redirects(0)).assertStatus(
			404,
		);
	});

	test("the form shows the account's address for a live link, never the token, and says when a link is dead", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const live = await client
			.get("/reset-password")
			.withSession({ [KEY]: token })
			.withInertia();
		live.assertInertiaComponent("auth/reset_password");
		assert.containSubset(live.inertiaProps, {
			state: "ready",
			email: user.email,
			flow: await flowOf(token),
		});
		assert.notInclude(JSON.stringify(live.body()), token);
		live.assertHeader("cache-control", "no-store");
		live.assertHeader("referrer-policy", "same-origin");

		const none = await client.get("/reset-password").withInertia();
		assert.containSubset(none.inertiaProps, { state: "invalid", email: null });

		await expireToken(user.id, "reset_password");
		const expired = await client
			.get("/reset-password")
			.withSession({ [KEY]: token })
			.withInertia();
		assert.containSubset(expired.inertiaProps, {
			state: "expired",
			email: null,
		});
	});

	test("a new password follows signup's rules, and an error changes nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		assertValidationError(await choose(client, token, "short"), "password");
		assertValidationError(
			await choose(client, token, "x".repeat(33)),
			"password",
		);
		assertValidationError(
			await choose(client, token, NEW, "something-else"),
			"passwordConfirmation",
		);

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal((await tokens.state(token, "reset_password")).state, "live");
	});

	test("a completed reset changes the password, signs every session out and signs nobody in", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		const token = await tokens.issue(user, "reset_password");

		const response = await choose(client, token);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
		response.assertFlashMessage(
			"success",
			"Password changed. Sign in with your new password.",
		);
		response.assertSessionMissing("auth_web");
		response.assertSessionMissing(KEY);
		assert.isTrue(await signsIn(user.email, NEW));
		assert.isFalse(await signsIn(user.email, OLD));
		const elsewhere = await client
			.get("/dashboard")
			.loginAs(before)
			.redirects(0);
		elsewhere.assertHeader("location", "/login");
	});

	test("a form can only act on the link it showed: another link staged in between is not changed", async ({
		client,
		assert,
	}) => {
		const a = await makeUser("a@reset-18.example");
		const b = await makeUser("b@reset-18.example");
		const tokenA = await tokens.issue(a, "reset_password");
		const tokenB = await tokens.issue(b, "reset_password");
		const pageA = await client
			.get("/reset-password")
			.withSession({ [KEY]: tokenA })
			.withInertia();
		const flowA = String(pageA.inertiaProps.flow);
		assert.equal(flowA, await flowOf(tokenA));
		assert.notEqual(flowA, await flowOf(tokenB));

		// B's link is opened in another tab, then A's form is submitted.
		const refused = await choose(client, tokenB, NEW, NEW, flowA);

		refused.assertHeader("location", "/reset-password");
		refused.assertFlashMissing("success");
		assert.isTrue(await signsIn(b.email, OLD));
		assert.isFalse(await signsIn(b.email, NEW));
		assert.isTrue(await signsIn(a.email, OLD));
		assert.equal((await tokens.state(tokenB, "reset_password")).state, "live");
		assert.equal((await tokens.state(tokenA, "reset_password")).state, "live");
		// The page now shows B's link and B's flow id, and that form works.
		const pageB = await client
			.get("/reset-password")
			.withSession({ [KEY]: tokenB })
			.withInertia();
		assert.containSubset(pageB.inertiaProps, {
			state: "ready",
			email: b.email,
			flow: await flowOf(tokenB),
		});
		const done = await choose(
			client,
			tokenB,
			NEW,
			NEW,
			String(pageB.inertiaProps.flow),
		);
		done.assertHeader("location", "/login");
		assert.isTrue(await signsIn(b.email, NEW));
		assert.isTrue(await signsIn(a.email, OLD));
	});

	test("a missing, malformed or foreign flow id is a dead link, never an error", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		for (const flow of [null, "", NO_FLOW, "not-a-flow-id", "' or true --"]) {
			const response = await choose(client, token, NEW, NEW, flow);
			response.assertStatus(302);
			response.assertHeader("location", "/reset-password");
			response.assertFlashMissing("success");
		}

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal((await tokens.state(token, "reset_password")).state, "live");
	});

	test("a reset link works once: a replay changes nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");
		const flow = await flowOf(token);
		(await choose(client, token, NEW, NEW, flow)).assertHeader(
			"location",
			"/login",
		);

		const replay = await choose(
			client,
			token,
			"a-third-password",
			undefined,
			flow,
		);

		replay.assertHeader("location", "/reset-password");
		replay.assertFlashMissing("success");
		assert.isTrue(await signsIn(user.email, NEW));
		assert.isFalse(await signsIn(user.email, "a-third-password"));
	});

	test("an expired link, an altered one, a confirmation link or none resets nothing", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const reset = await tokens.issue(user, "reset_password");
		const confirmation = await tokens.issue(user, "verify_email");

		for (const token of [altered(reset), confirmation, null]) {
			(await choose(client, token)).assertHeader("location", "/reset-password");
		}
		await expireToken(user.id, "reset_password");
		(await choose(client, reset)).assertHeader("location", "/reset-password");

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal((await User.findOrFail(user.id)).sessionVersion, 1);
	});

	test("a locked-out account signs in after its reset, which also confirms its address and emails a notice", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		await limiter
			.use({ ...AUTH_LIMITS.loginPerEmail })
			.increment(loginEmailKey(user.email), 25);
		const signIn = (password: string) =>
			client
				.post("/login")
				.header("referer", "/login")
				.form({ email: user.email, password })
				.withCsrfToken()
				.redirects(0);
		(await signIn(OLD)).assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
		const fake = queue.fake();

		await choose(client, await tokens.issue(user, "reset_password"));

		(await signIn(NEW)).assertHeader("location", "/dashboard");
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.deepEqual(
			queuedMails(fake).map(({ to, subject }) => [to, subject]),
			[[user.email, "Your Tattoo Drip password was changed"]],
		);
	});

	test("a signed-in visitor of the reset pages goes to the dashboard, and a link stores nothing for them", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		(
			await client.get("/forgot-password").loginAs(user).redirects(0)
		).assertHeader("location", "/dashboard");
		const link = await client
			.get(`/reset-password/${token}`)
			.loginAs(user)
			.redirects(0);
		link.assertHeader("location", "/dashboard");
		link.assertSessionMissing(KEY);
		assert.equal((await tokens.state(token, "reset_password")).state, "live");
	});

	test("a reset without this session's CSRF token is refused", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");

		const response = await client
			.post("/reset-password")
			.withSession({ [KEY]: token })
			.form({ password: NEW, passwordConfirmation: NEW })
			.redirects(0);

		response.assertFlashMessage("error", REFUSED);
		assert.isTrue(await signsIn(user.email, OLD));
	});

	test("the link routes count 30 requests per client address in 15 minutes", async ({
		client,
	}) => {
		const user = await makeUser();
		const token = await tokens.issue(user, "reset_password");
		const open = () =>
			client
				.get(`/reset-password/${token}`)
				.header("x-forwarded-for", "203.0.113.140")
				.header("referer", "/login")
				.redirects(0);
		for (let i = 0; i < 30; i++) {
			(await open()).assertHeader("location", "/reset-password");
		}

		// A link has no form to go back to: it says so on the sign-in page
		// (throttled_links.spec.ts follows it there, TAT-119).
		const refused = await open();
		refused.assertHeader("location", "/login");
		refused.assertFlashMessage(
			"error",
			"Too many tries. Wait a few minutes and open the link again.",
		);
	});
});
