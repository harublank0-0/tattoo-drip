import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import { SessionEndedError } from "#modules/identity/errors";
import AccountService from "#modules/identity/services/account_service";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { sessionCookieName } from "#services/cookie_policy";
import { queuedMails } from "#tests/helpers/accounts";
import { recordQueries } from "#tests/helpers/query_count";
import { studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";
import { WRONG_CURRENT_PASSWORD } from "#validators/account_messages";

const SESSION = sessionCookieName(false);
const OLD = "the-old-password";
const NEW = "a-new-password";
const REFUSED = "Invalid or expired CSRF token";
const ENDED = "You were signed out on another device. Sign in again.";
const CHANGED = "Password changed. Other devices are signed out.";
const SIGNED_OUT =
	"Signed out of every other device. You're still signed in here.";
const tokens = new AccountTokenService();

/** An account, unconfirmed like a fresh signup. */
function makeUser(email: string) {
	return User.create({ email, password: OLD });
}

async function signsIn(email: string, password: string) {
	try {
		await User.verifyCredentials(email, password);
		return true;
	} catch {
		return false;
	}
}

/**
 * PUT /account/password from `user`'s session, as the page's form sends it
 * (add `.withInertia()` for the Inertia flavour). Returns the request, so a
 * test can read the session id it sends before awaiting it.
 */
function change(
	client: ApiClient,
	user: User,
	body: Record<string, string>,
	ip = "203.0.113.150",
) {
	return client
		.put("/account/password")
		.header("referer", "/account")
		.header("x-forwarded-for", ip)
		.form(body)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

function signOutOthers(client: ApiClient, user: User) {
	return client
		.post("/account/sign-out-others")
		.header("referer", "/account")
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

const right = {
	currentPassword: OLD,
	password: NEW,
	passwordConfirmation: NEW,
};

/** A body whose current password is wrong, with a fine new one. */
const wrong = {
	currentPassword: "not-my-password",
	password: "another-new-password",
	passwordConfirmation: "another-new-password",
};

test.group("Your account page (TAT-95)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("only a signed-in person opens it, with no secret in its props, never stored, for one membership query", async ({
		client,
		assert,
	}) => {
		const guest = await client.get("/account").redirects(0);
		guest.assertStatus(302);
		guest.assertHeader("location", "/login");

		// An unconfirmed account with no studio still opens it.
		const user = await makeUser("page@account-95.example");
		const { queries } = await recordQueries(async () => {
			const page = await client.get("/account").withInertia().loginAs(user);
			page.assertStatus(200);
			page.assertInertiaComponent("account/show");
			assert.containSubset(page.inertiaProps, { hasStudio: false });
			assert.equal(page.header("cache-control"), "private, no-store");
			const body = JSON.stringify(page.body());
			assert.notInclude(body, "$scrypt");
			assert.notInclude(body, "sessionVersion");
			assert.notInclude(body, "session_version");
		});
		assert.lengthOf(
			queries.filter((sql) => /tenant_memberships/.test(sql)),
			1,
		);
		assert.lengthOf(
			queries.filter((sql) => /(inquiries|projects|staff_alerts)/.test(sql)),
			0,
		);

		const { owner } = await studioWithOwner("account-95");
		const withStudio = await client
			.get("/account")
			.withInertia()
			.loginAs(owner);
		withStudio.assertInertiaComponent("account/show");
		assert.containSubset(withStudio.inertiaProps, { hasStudio: true });
	});

	test("a right change signs this device in again under a new session id and signs the others out", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const user = await makeUser("change@account-95.example");
		const other = await makeUser("other@account-95.example");
		await tokens.issue(other, "reset_password");

		const request = change(client, user, right);
		const planted = request.sessionClient.sessionId;
		const response = await request;

		response.assertStatus(302);
		response.assertHeader("location", "/account");
		response.assertFlashMessage("success", CHANGED);
		assert.isTrue(await signsIn(user.email, NEW));
		assert.isFalse(await signsIn(user.email, OLD));
		response.assertSession("auth_web", `${user.id}.${user.sessionVersion + 1}`);
		const issued = response.cookie(SESSION)?.value;
		assert.isString(issued);
		assert.notEqual(issued, planted);
		// The session that asked is now the only one of this account.
		const old = await client.get("/dashboard").loginAs(user).redirects(0);
		old.assertHeader("location", "/login");
		const fresh = await client
			.get("/account")
			.loginAs(await User.findOrFail(user.id));
		fresh.assertStatus(200);
		// One notice, to the stored address; nobody else is touched.
		assert.deepEqual(
			queuedMails(fake).map(({ to, subject }) => [to, subject]),
			[[user.email, "Your Tattoo Drip password was changed"]],
		);
		assert.isTrue(await signsIn(other.email, OLD));
		assert.equal(
			(await User.findOrFail(other.id)).sessionVersion,
			other.sessionVersion,
		);
	});

	test("a wrong current password is one field error and changes nothing, and no password reaches the flash", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const user = await makeUser("wrong@account-95.example");
		const reset = await tokens.issue(user, "reset_password");

		const response = await change(client, user, wrong).withInertia();

		assertValidationError(response, "currentPassword", WRONG_CURRENT_PASSWORD);
		assert.isTrue(await signsIn(user.email, OLD));
		assert.isFalse(await signsIn(user.email, wrong.password));
		assert.equal(
			(await User.findOrFail(user.id)).sessionVersion,
			user.sessionVersion,
		);
		assert.equal((await tokens.state(reset, "reset_password")).state, "live");
		assert.lengthOf(queuedMails(fake), 0);
		for (const field of [
			"currentPassword",
			"password",
			"passwordConfirmation",
		]) {
			assert.isUndefined(response.flashMessage(field), field);
		}
	});

	test("the new password follows signup's rules and differs from the current one; each refusal changes nothing", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const user = await makeUser("rules@account-95.example");
		const refusals: [Record<string, string>, string, string][] = [
			[
				{ ...right, password: "short12", passwordConfirmation: "short12" },
				"password",
				"Use 8 to 128 characters.",
			],
			[
				{
					...right,
					password: "x".repeat(129),
					passwordConfirmation: "x".repeat(129),
				},
				"password",
				"Use 8 to 128 characters.",
			],
			[
				{ ...right, password: OLD, passwordConfirmation: OLD },
				"password",
				"Choose a password different from your current one.",
			],
			[
				{ ...right, passwordConfirmation: "something-else" },
				"passwordConfirmation",
				"Type the same password again.",
			],
			[
				{ password: NEW, passwordConfirmation: NEW },
				"currentPassword",
				"Enter your current password.",
			],
		];

		for (const [body, field, message] of refusals) {
			const response = await change(client, user, body).withInertia();
			assertValidationError(response, field, message);
		}

		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal(
			(await User.findOrFail(user.id)).sessionVersion,
			user.sessionVersion,
		);
		assert.lengthOf(queuedMails(fake), 0);
	});

	test("128 characters are accepted", async ({ client, assert }) => {
		queue.fake();
		const user = await makeUser("long@account-95.example");
		const long = "z".repeat(128);

		const response = await change(client, user, {
			currentPassword: OLD,
			password: long,
			passwordConfirmation: long,
		});

		response.assertFlashMessage("success", CHANGED);
		assert.isTrue(await signsIn(user.email, long));
	});

	test("six wrong tries for an account: the sixth is refused unchecked, even with the right password, and keeps no password in the flash", async ({
		client,
		assert,
	}) => {
		queue.fake();
		const user = await makeUser("limit@account-95.example");

		for (let i = 0; i < 5; i++) {
			const response = await change(client, user, wrong).withInertia();
			assertValidationError(response, "currentPassword");
		}
		const sixth = await change(client, user, right);

		sixth.assertStatus(302);
		sixth.assertHeader("location", "/account");
		sixth.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
		assert.isTrue(await signsIn(user.email, OLD));
		for (const field of [
			"currentPassword",
			"password",
			"passwordConfirmation",
		]) {
			assert.isUndefined(sixth.flashMessage(field), field);
		}
	});

	test("ten wrong tries from one address across two accounts: an eleventh, for a third account, is refused", async ({
		client,
		assert,
	}) => {
		const a = await makeUser("a@account-95.example");
		const b = await makeUser("b@account-95.example");
		const c = await makeUser("c@account-95.example");

		for (let i = 0; i < 5; i++) {
			for (const user of [a, b]) {
				const response = await change(client, user, wrong).withInertia();
				assertValidationError(response, "currentPassword");
			}
		}
		const eleventh = await change(client, c, wrong);

		eleventh.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
		assert.isUndefined(eleventh.flashMessage("inputErrorsBag"));
		// Another address has its own count for the same account.
		const elsewhere = await change(
			client,
			c,
			wrong,
			"203.0.113.151",
		).withInertia();
		assertValidationError(elsewhere, "currentPassword");
	});

	test("a right try gives its point back: four wrong, a right change, then one wrong is still a field error", async ({
		client,
		assert,
	}) => {
		queue.fake();
		const user = await makeUser("refund@account-95.example");

		for (let i = 0; i < 4; i++) {
			await change(client, user, wrong).withInertia();
		}
		const changed = await change(client, user, right);
		changed.assertFlashMessage("success", CHANGED);
		const after = await User.findOrFail(user.id);

		// Without the refund the right try would have been the fifth point and
		// this the sixth, refused.
		const first = await change(client, after, wrong).withInertia();
		assertValidationError(first, "currentPassword");
		const next = await change(client, after, wrong);
		next.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
		assert.isTrue(await signsIn(user.email, NEW));
	});

	test("signing out other devices keeps this one under a new session id, changes no password and sends no email", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const user = await makeUser("signout@account-95.example");

		const request = signOutOthers(client, user);
		const planted = request.sessionClient.sessionId;
		const response = await request;

		response.assertStatus(302);
		response.assertHeader("location", "/account");
		response.assertFlashMessage("success", SIGNED_OUT);
		response.assertSession("auth_web", `${user.id}.${user.sessionVersion + 1}`);
		const issued = response.cookie(SESSION)?.value;
		assert.isString(issued);
		assert.notEqual(issued, planted);
		const old = await client.get("/dashboard").loginAs(user).redirects(0);
		old.assertHeader("location", "/login");
		assert.isTrue(await signsIn(user.email, OLD));
		assert.lengthOf(queuedMails(fake), 0);
	});

	test("the eleventh sign-out in an hour is refused and leaves the version where ten put it", async ({
		client,
		assert,
	}) => {
		queue.fake();
		const user = await makeUser("hourly@account-95.example");
		let current = user;

		for (let i = 0; i < 10; i++) {
			const response = await signOutOthers(client, current);
			response.assertHeader("location", "/account");
			response.assertFlashMessage("success", SIGNED_OUT);
			current = await User.findOrFail(user.id);
		}
		const eleventh = await signOutOthers(client, current);

		eleventh.assertHeader("location", "/account");
		assert.match(
			String(eleventh.flashMessage("error")),
			/^Too many attempts\. Try again in (59|60) minutes\.$/,
		);
		assert.equal(
			(await User.findOrFail(user.id)).sessionVersion,
			user.sessionVersion + 10,
		);
	});

	test("a session another request ended meanwhile is signed out and sent to sign in", async ({
		client,
		assert,
	}) => {
		queue.fake();
		const user = await makeUser("ended@account-95.example");
		const ended = {
			changePassword: async () => {
				throw new SessionEndedError();
			},
			signOutOtherSessions: async () => {
				throw new SessionEndedError();
			},
		};
		app.container.swap(
			AccountService,
			() => ended as unknown as AccountService,
		);

		try {
			const changed = await change(client, user, right);
			changed.assertStatus(302);
			changed.assertHeader("location", "/login");
			changed.assertFlashMessage("error", ENDED);
			changed.assertSessionMissing("auth_web");

			const signedOut = await signOutOthers(client, user);
			signedOut.assertHeader("location", "/login");
			signedOut.assertFlashMessage("error", ENDED);
			signedOut.assertSessionMissing("auth_web");
		} finally {
			app.container.restore(AccountService);
		}
		assert.isTrue(await signsIn(user.email, OLD));
	});

	test("both writes are refused without the CSRF token and change nothing", async ({
		client,
		assert,
	}) => {
		const fake = queue.fake();
		const user = await makeUser("csrf@account-95.example");

		const changed = await client
			.put("/account/password")
			.header("referer", "/account")
			.form(right)
			.loginAs(user)
			.redirects(0);
		const signedOut = await client
			.post("/account/sign-out-others")
			.header("referer", "/account")
			.loginAs(user)
			.redirects(0);

		changed.assertFlashMessage("error", REFUSED);
		signedOut.assertFlashMessage("error", REFUSED);
		assert.isTrue(await signsIn(user.email, OLD));
		assert.equal(
			(await User.findOrFail(user.id)).sessionVersion,
			user.sessionVersion,
		);
		assert.lengthOf(queuedMails(fake), 0);
	});
});
