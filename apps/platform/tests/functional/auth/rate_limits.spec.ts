import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	AUTH_LIMITS,
	loginEmailKey,
	loginIpKey,
} from "#modules/identity/services/auth_limits";

/**
 * Login and signup rate limits (TAT-8). Test requests come from loopback,
 * which config/app.ts trusts as a proxy, so X-Forwarded-For sets the client
 * address. The memory store starts empty in every test (tests/bootstrap.ts).
 */
const EMAIL = "ink@example.com";
const PASSWORD = "secret-password";
const WRONG = "Invalid user credentials";
const LOCKED = "Too many attempts. Try again in 15 minutes.";

function makeUser(email = EMAIL) {
	return User.create({ email, password: PASSWORD });
}

function login(
	client: ApiClient,
	forwardedFor: string,
	password: string,
	email = EMAIL,
) {
	return client
		.post("/login")
		.header("x-forwarded-for", forwardedFor)
		.header("referer", "/login")
		.form({ email, password })
		.withCsrfToken()
		.redirects(0);
}

const perIp = () => limiter.use({ ...AUTH_LIMITS.loginPerIp });
const perEmail = () => limiter.use({ ...AUTH_LIMITS.loginPerEmail });

test.group("Login rate limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("refuses an address after 10 failed logins, even with the right password", async ({
		client,
		assert,
	}) => {
		await makeUser();
		for (let i = 0; i < 10; i++) {
			const failed = await login(client, "203.0.113.1", "wrong-password");
			failed.assertFlashMessage("error", WRONG);
		}

		const refused = await login(client, "203.0.113.1", PASSWORD);
		refused.assertStatus(302);
		refused.assertHeader("location", "/login");
		refused.assertFlashMessage("error", LOCKED);

		// Through the trusted proxy, the rightmost untrusted entry counts, so a
		// made-up address in front buys nothing.
		const spoofed = await login(client, "198.51.100.1, 203.0.113.1", PASSWORD);
		spoofed.assertFlashMessage("error", LOCKED);

		const json = await login(client, "203.0.113.1", PASSWORD).header(
			"accept",
			"application/json",
		);
		json.assertStatus(429);
		assert.isAbove(Number(json.header("retry-after")), 0);

		const elsewhere = await login(client, "203.0.113.2", PASSWORD);
		elsewhere.assertHeader("location", "/dashboard");
	});

	test("parallel guesses from one address can't slip past the limit", async ({
		client,
		assert,
	}) => {
		await makeUser();

		const responses = await Promise.all(
			Array.from({ length: 15 }, () =>
				login(client, "203.0.113.5", "wrong-password"),
			),
		);
		const messages: unknown[] = responses.map((response) =>
			response.flashMessage("error"),
		);

		assert.lengthOf(
			messages.filter((message) => message === WRONG),
			10,
		);
		assert.lengthOf(
			messages.filter((message) => message === LOCKED),
			5,
		);
	});

	test("locks an email after 25 failed logins from any mix of addresses", async ({
		client,
	}) => {
		await makeUser();
		const attempts: [string, string, number][] = [
			["203.0.113.11", EMAIL, 10],
			["203.0.113.12", EMAIL, 10],
			["203.0.113.13", EMAIL.toUpperCase(), 5],
		];
		for (const [ip, email, count] of attempts) {
			for (let i = 0; i < count; i++) {
				const failed = await login(client, ip, "wrong-password", email);
				failed.assertFlashMessage("error", WRONG);
			}
		}

		const refused = await login(client, "203.0.113.14", PASSWORD);
		refused.assertHeader("location", "/login");
		refused.assertFlashMessage("error", LOCKED);

		await makeUser("other@example.com");
		const otherAccount = await login(
			client,
			"203.0.113.14",
			PASSWORD,
			"other@example.com",
		);
		otherAccount.assertHeader("location", "/dashboard");
	});

	test("a sign-in gives back its own attempts and leaves earlier failures counted", async ({
		client,
		assert,
	}) => {
		await makeUser();
		for (let i = 0; i < 3; i++) {
			await login(client, "203.0.113.21", "wrong-password");
		}

		const signedIn = await login(client, "203.0.113.21", PASSWORD);
		signedIn.assertHeader("location", "/dashboard");

		const address = await perIp().get(loginIpKey("203.0.113.21"));
		const email = await perEmail().get(loginEmailKey(EMAIL));
		assert.equal(address?.consumed, 3);
		assert.equal(email?.consumed, 3);
	});

	test("an address typed in another case is the same account, and shares its count", async ({
		client,
	}) => {
		// Emails are canonical (TAT-18): INK@ is ink@, so it signs in to the
		// same account and its failures count against the same address.
		await makeUser();
		for (const ip of ["203.0.113.61", "203.0.113.62"]) {
			for (let i = 0; i < 10; i++) {
				const failed = await login(
					client,
					ip,
					"wrong-password",
					"INK@Example.com",
				);
				failed.assertFlashMessage("error", WRONG);
			}
		}

		const own = await login(
			client,
			"203.0.113.64",
			PASSWORD,
			" Ink@EXAMPLE.com ",
		);
		own.assertHeader("location", "/dashboard");

		// 20 failures stand (the sign-in gave back only its own point): five
		// more are checked, the next is refused.
		for (let i = 0; i < 5; i++) {
			const checked = await login(client, "203.0.113.65", "wrong-password");
			checked.assertFlashMessage("error", WRONG);
		}
		const refused = await login(client, "203.0.113.65", "wrong-password");
		refused.assertFlashMessage("error", LOCKED);
	});

	test("an unknown email is counted like a registered one", async ({
		client,
		assert,
	}) => {
		await makeUser();

		const known = await login(client, "203.0.113.31", "wrong-password");
		const unknown = await login(
			client,
			"203.0.113.32",
			"wrong-password",
			"nobody@example.com",
		);

		known.assertFlashMessage("error", WRONG);
		unknown.assertFlashMessage("error", WRONG);
		const knownCount = await perEmail().get(loginEmailKey(EMAIL));
		const unknownCount = await perEmail().get(
			loginEmailKey("nobody@example.com"),
		);
		assert.equal(knownCount?.consumed, 1);
		assert.equal(unknownCount?.consumed, 1);
	});
});

test.group("Rate limits between tests", () => {
	test("leaves a count behind", async () => {
		await perIp().consume(loginIpKey("203.0.113.41"));
	});

	test("starts with every count empty (tests/bootstrap.ts)", async ({
		assert,
	}) => {
		assert.isNull(await perIp().get(loginIpKey("203.0.113.41")));
	});
});

test.group("Signup rate limit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("refuses an address after 10 signup attempts", async ({
		client,
		assert,
	}) => {
		const signup = (ip: string, body: Record<string, string>) =>
			client
				.post("/signup")
				.header("x-forwarded-for", ip)
				.header("referer", "/signup")
				.form(body)
				.withCsrfToken()
				.redirects(0);
		const valid = {
			fullName: "Ada Ink",
			email: "ada@example.com",
			password: PASSWORD,
			passwordConfirmation: PASSWORD,
		};

		// Invalid bodies count too: every request does.
		for (let i = 0; i < 10; i++) {
			const invalid = await signup("203.0.113.51", {});
			invalid.assertHeader("location", "/signup");
		}

		const refused = await signup("203.0.113.51", valid);
		refused.assertHeader("location", "/signup");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 60 minutes.",
		);
		assert.isNull(await User.findBy("email", "ada@example.com"));

		const elsewhere = await signup("203.0.113.52", valid);
		elsewhere.assertHeader("location", "/onboarding");
	});
});
