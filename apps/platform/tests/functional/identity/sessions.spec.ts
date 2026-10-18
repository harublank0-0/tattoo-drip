import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

const PASSWORD = "secret-password";

function makeUser() {
	return User.create({ email: "ink@sessions-18.example", password: PASSWORD });
}

/** What a completed password reset does to every session (TAT-18). */
function raiseVersion(user: User) {
	return User.query().where("id", user.id).increment("session_version", 1);
}

test.group("Session versions (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("signing in stores the account's id with its session version", async ({
		client,
	}) => {
		const user = await makeUser();

		const response = await client
			.post("/login")
			.form({ email: user.email, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);

		response.assertHeader("location", "/dashboard");
		response.assertSession("auth_web", `${user.id}.1`);
	});

	test("a session from before the version changed is signed out on its next request", async ({
		client,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		await raiseVersion(user);

		const old = await client.get("/dashboard").loginAs(before).redirects(0);
		old.assertStatus(302);
		old.assertHeader("location", "/login");

		const fresh = await client
			.get("/dashboard")
			.loginAs(await User.findOrFail(user.id))
			.redirects(0);
		fresh.assertHeader("location", "/onboarding");
	});

	test("a session holding a bare id, from before TAT-18, is signed out", async ({
		client,
	}) => {
		const user = await makeUser();

		const response = await client
			.get("/dashboard")
			.withSession({ auth_web: user.id })
			.redirects(0);

		response.assertHeader("location", "/login");
	});

	test("a signed-out session sees the guest pages again", async ({
		client,
	}) => {
		const user = await makeUser();
		const before = await User.findOrFail(user.id);
		await raiseVersion(user);

		const login = await client.get("/login").loginAs(before).redirects(0);

		login.assertStatus(200);
	});
});
