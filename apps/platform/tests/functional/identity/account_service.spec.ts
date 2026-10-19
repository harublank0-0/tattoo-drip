import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import User from "#models/user";
import AccountService from "#modules/identity/services/account_service";
import AccountTokenService from "#modules/identity/services/account_token_service";
import {
	AUTH_LIMITS,
	loginEmailKey,
} from "#modules/identity/services/auth_limits";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import {
	altered,
	expireToken,
	flowOf,
	queuedMails,
	tokenOf,
} from "#tests/helpers/accounts";

const tokens = new AccountTokenService();
const accounts = new AccountService(tokens);
const PASSWORD = "secret-password";

/** A link on this platform, as the emails write it. */
const appLink = (path: string) => new URL(path, env.get("APP_URL")).toString();

/** The service calls, with the flow id of the token's row as its page would post it. */
async function confirmWith(token: string, flow?: string) {
	return accounts.confirmEmail(token, flow ?? (await flowOf(token)));
}

async function resetWith(token: string, password: string, flow?: string) {
	return accounts.resetPassword(token, password, flow ?? (await flowOf(token)));
}

async function signsIn(email: string, password: string) {
	try {
		await User.verifyCredentials(email, password);
		return true;
	} catch {
		return false;
	}
}

test.group("AccountService (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("signing up a new address makes an unconfirmed account and emails it a confirmation link", async ({
		assert,
	}) => {
		const fake = queue.fake();

		await accounts.signUp({
			fullName: "Ada Ink",
			email: " Ada@Service-18.example ",
			password: PASSWORD,
		});

		const user = await User.findByOrFail("email", "ada@service-18.example");
		assert.equal(user.fullName, "Ada Ink");
		assert.isNull(user.emailVerifiedAt);
		assert.equal(user.sessionVersion, 1);
		assert.isTrue(await signsIn(user.email, PASSWORD));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[["ada@service-18.example", "Confirm your email address"]],
		);
		const url = String(mails[0].data.url);
		assert.isTrue(url.startsWith(appLink("/verify-email/")));
		assert.deepEqual(await tokens.state(tokenOf(url), "verify_email"), {
			state: "live",
			userId: user.id,
			email: user.email,
			flow: await flowOf(tokenOf(url)),
		});
	});

	test("signing up a taken address changes nothing and emails its owner a sign-in and a reset link", async ({
		assert,
	}) => {
		const owner = await User.create({
			fullName: "Owner",
			email: "taken@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();

		await accounts.signUp({
			fullName: "Someone Else",
			email: "TAKEN@service-18.example",
			password: "another-password",
		});

		const rows = await User.query().where("email", "taken@service-18.example");
		assert.lengthOf(rows, 1);
		assert.equal(rows[0].fullName, "Owner");
		assert.isTrue(await signsIn(owner.email, PASSWORD));
		assert.isFalse(await signsIn(owner.email, "another-password"));
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[owner.email, "You already have a Tattoo Drip account"]],
		);
		assert.equal(mails[0].data.signInUrl, appLink("/login"));
		const reset = String(mails[0].data.resetUrl);
		assert.isTrue(reset.startsWith(appLink("/reset-password/")));
		assert.containSubset(await tokens.state(tokenOf(reset), "reset_password"), {
			state: "live",
			userId: owner.id,
		});
		assert.notInclude(JSON.stringify(mails[0].data), "Someone Else");
	});

	test("a confirmation link confirms its account once", async ({ assert }) => {
		const user = await User.create({
			email: "once@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();
		await accounts.sendVerification(user);
		const token = tokenOf(queuedMails(fake)[0].data.url);
		const flow = await flowOf(token);

		const confirmed = await confirmWith(token, flow);

		assert.equal(confirmed?.id, user.id);
		const at = (await User.findOrFail(user.id)).emailVerifiedAt;
		assert.isNotNull(at);
		assert.isNull(await confirmWith(token, flow));
		assert.equal(
			(await User.findOrFail(user.id)).emailVerifiedAt?.toMillis(),
			at?.toMillis(),
		);
	});

	test("a link sent to an address the account no longer has confirms nothing", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "before@service-18.example",
			password: PASSWORD,
		});
		const token = await tokens.issue(user, "verify_email");
		await dbClient().rawQuery("update users set email = ? where id = ?", [
			"after@service-18.example",
			user.id,
		]);

		assert.isNull(await confirmWith(token));
		assert.isNull((await User.findOrFail(user.id)).emailVerifiedAt);
	});

	test("the operator's confirmation: unknown, confirmed (its link revoked), then already", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "pilot@service-18.example",
			password: PASSWORD,
		});
		const token = await tokens.issue(user, "verify_email");

		assert.equal(
			await accounts.markVerified("nobody@service-18.example"),
			"unknown",
		);
		assert.equal(
			await accounts.markVerified(" PILOT@service-18.example "),
			"confirmed",
		);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "unknown");
		assert.equal(
			await accounts.markVerified("pilot@service-18.example"),
			"already",
		);
	});

	test("a reset request emails a link only when an account uses the address", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "reset@service-18.example",
			password: PASSWORD,
		});
		const fake = queue.fake();

		await accounts.requestPasswordReset("nobody@service-18.example");
		await accounts.requestPasswordReset(" RESET@Service-18.example ");

		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Choose a new password"]],
		);
		assert.containSubset(
			await tokens.state(tokenOf(mails[0].data.url), "reset_password"),
			{ state: "live", userId: user.id },
		);
		const { rows } = await dbClient().rawQuery(
			"select count(*)::int as n from account_tokens where email = ?",
			["nobody@service-18.example"],
		);
		assert.equal(rows[0].n, 0);
	});

	test("a reset sets the password, signs every session out, confirms the address and emails a notice, once", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "done@service-18.example",
			password: PASSWORD,
		});
		const pending = await tokens.issue(user, "verify_email");
		const token = await tokens.issue(user, "reset_password");
		const flow = await flowOf(token);
		const fake = queue.fake();

		const changed = await resetWith(token, "a-new-password", flow);

		assert.equal(changed?.id, user.id);
		const after = await User.findOrFail(user.id);
		assert.equal(after.sessionVersion, 2);
		assert.isNotNull(after.emailVerifiedAt);
		assert.isTrue(await signsIn(user.email, "a-new-password"));
		assert.isFalse(await signsIn(user.email, PASSWORD));
		assert.equal(
			(await tokens.state(pending, "verify_email")).state,
			"unknown",
		);
		assert.equal(
			(await tokens.state(token, "reset_password")).state,
			"unknown",
		);
		const mails = queuedMails(fake);
		assert.deepEqual(
			mails.map(({ to, subject }) => [to, subject]),
			[[user.email, "Your Tattoo Drip password was changed"]],
		);
		assert.equal(mails[0].data.resetUrl, appLink("/forgot-password"));
		assert.match(
			String(mails[0].data.changedAt),
			/^\d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2} UTC$/,
		);
		assert.notInclude(JSON.stringify(mails[0].data), "/reset-password/");

		assert.isNull(await resetWith(token, "a-third-password", flow));
		assert.equal((await User.findOrFail(user.id)).sessionVersion, 2);
		assert.isTrue(await signsIn(user.email, "a-new-password"));
	});

	test("a reset clears the login failures counted for the account's stored address", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "locked@service-18.example",
			password: PASSWORD,
		});
		const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
		await perEmail.increment(loginEmailKey(user.email), 25);

		await resetWith(
			await tokens.issue(user, "reset_password"),
			"a-new-password",
		);

		assert.isNull(await perEmail.get(loginEmailKey(user.email)));
	});

	test("a reset doesn't clear the login failures of an address that differs only in non-ASCII case", async ({
		assert,
	}) => {
		// Canonical addresses keep non-ASCII case, so these are two accounts.
		const upper = await User.create({
			email: "Éva@lookalike-18.example",
			password: PASSWORD,
		});
		const lower = await User.create({
			email: "éva@lookalike-18.example",
			password: PASSWORD,
		});
		const perEmail = limiter.use({ ...AUTH_LIMITS.loginPerEmail });
		await perEmail.increment(loginEmailKey(upper.email), 7);
		await perEmail.increment(loginEmailKey(lower.email), 9);

		await resetWith(
			await tokens.issue(upper, "reset_password"),
			"a-new-password",
		);

		assert.isNull(await perEmail.get(loginEmailKey(upper.email)));
		assert.equal((await perEmail.get(loginEmailKey(lower.email)))?.consumed, 9);
	});

	test("a link works only with the flow id of its own row: another link's flow resets and confirms nothing", async ({
		assert,
	}) => {
		const a = await User.create({
			email: "a@flow-18.example",
			password: PASSWORD,
		});
		const b = await User.create({
			email: "b@flow-18.example",
			password: PASSWORD,
		});
		const resetA = await tokens.issue(a, "reset_password");
		const resetB = await tokens.issue(b, "reset_password");
		const confirmB = await tokens.issue(b, "verify_email");

		assert.isNull(
			await resetWith(resetB, "a-new-password", await flowOf(resetA)),
		);
		assert.isNull(await confirmWith(confirmB, await flowOf(resetA)));

		assert.isTrue(await signsIn(b.email, PASSWORD));
		assert.isNull((await User.findOrFail(b.id)).emailVerifiedAt);
		assert.equal((await tokens.state(resetB, "reset_password")).state, "live");
		assert.equal((await tokens.state(confirmB, "verify_email")).state, "live");
		assert.isNotNull(await resetWith(resetB, "a-new-password"));
	});

	test("an expired token, a confirmation token or an altered one resets nothing", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "kept@service-18.example",
			password: PASSWORD,
		});
		const expired = await tokens.issue(user, "reset_password");
		await expireToken(user.id, "reset_password");
		const confirmation = await tokens.issue(user, "verify_email");

		for (const token of [expired, confirmation, altered(confirmation)]) {
			assert.isNull(await resetWith(token, "a-new-password"));
		}

		assert.equal((await User.findOrFail(user.id)).sessionVersion, 1);
		assert.isTrue(await signsIn(user.email, PASSWORD));
	});
});
