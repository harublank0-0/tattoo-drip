import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	INVITATION_TOKEN_KEY,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { invite } from "#tests/helpers/invitations";
import { studioWithOwner } from "#tests/helpers/tenants";

const MESSAGE = "Too many tries. Wait a few minutes and open the link again.";
const tokens = new AccountTokenService();
const UNKNOWN = "a".repeat(43);

type Link = {
	name: string;
	path: (token: string) => string;
	/** A live token of this kind. */
	live: () => Promise<string>;
	/** Where the session keeps a staged token. */
	key: string;
};

const LINKS: Link[] = [
	{
		name: "a password reset link",
		path: (token) => `/reset-password/${token}`,
		live: async () =>
			tokens.issue(
				await User.create({
					email: "ink@throttled-reset-119.example",
					password: "secret-password",
				}),
				"reset_password",
			),
		key: SESSION_TOKEN_KEYS.reset_password,
	},
	{
		name: "an email confirmation link",
		path: (token) => `/verify-email/${token}`,
		live: async () =>
			tokens.issue(
				await User.create({
					email: "ink@throttled-verify-119.example",
					password: "secret-password",
				}),
				"verify_email",
			),
		key: SESSION_TOKEN_KEYS.verify_email,
	},
	{
		name: "an invitation link",
		path: (token) => `/invitations/${token}`,
		live: async () => {
			const { owner, tenant } = await studioWithOwner(
				"throttled-inv-119",
				"Throttled Inv",
			);
			return (await invite(tenant, owner)).token;
		},
		key: INVITATION_TOKEN_KEY,
	},
];

/** Spends the link routes' 30 requests per address in 15 minutes. */
async function spendLimit(client: ApiClient, path: string, ip: string) {
	for (let i = 0; i < 30; i++) {
		await client.get(path).header("x-forwarded-for", ip).redirects(0);
	}
}

test.group("A throttled account link says so (TAT-119)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	for (const [at, link] of LINKS.entries()) {
		const ip = `203.0.113.${160 + at}`;

		test(`${link.name} over the limit goes straight to the sign-in page with the message, whether the token is live or not`, async ({
			client,
			assert,
		}) => {
			const live = await link.live();
			await spendLimit(client, link.path(UNKNOWN), ip);

			for (const token of [live, UNKNOWN]) {
				const refused = await client
					.get(link.path(token))
					.header("x-forwarded-for", ip)
					.header("referer", "/somewhere-else")
					.redirects(0);
				refused.assertStatus(302);
				// Straight to the final page: the flash is read once, so a hop
				// through / (which redirects again) would use it up.
				refused.assertHeader("location", "/login");
				refused.assertFlashMessage("error", MESSAGE);
				// Nothing of the link is kept, whatever the token is.
				refused.assertSessionMissing(link.key);

				// And the message reaches the page the person lands on.
				const landed = await client
					.get(link.path(token))
					.header("x-forwarded-for", ip)
					.redirects(4)
					.withInertia();
				landed.assertInertiaComponent("auth/login");
				assert.equal(landed.body().flash.error, MESSAGE);
			}
		});
	}

	test("a JSON client keeps the limiter's 429", async ({ client }) => {
		const path = LINKS[1].path(UNKNOWN);
		await spendLimit(client, path, "203.0.113.170");

		const refused = await client
			.get(path)
			.header("x-forwarded-for", "203.0.113.170")
			.header("accept", "application/json")
			.redirects(0);

		refused.assertStatus(429);
	});

	test("a signed-in person goes to the dashboard and ends on their studio with the message", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner("throttled-in-119", "Throttled In");
		for (const [at, link] of [LINKS[1], LINKS[2]].entries()) {
			const ip = `203.0.113.${180 + at}`;
			await spendLimit(client, link.path(UNKNOWN), ip);

			const refused = await client
				.get(link.path(UNKNOWN))
				.header("x-forwarded-for", ip)
				.loginAs(owner)
				.redirects(0);
			refused.assertHeader("location", "/dashboard");
			refused.assertFlashMessage("error", MESSAGE);

			// /dashboard and the studio home redirect on to the inbox; the
			// message survives both hops.
			const landed = await client
				.get(link.path(UNKNOWN))
				.header("x-forwarded-for", ip)
				.loginAs(owner)
				.redirects(6)
				.withInertia();
			landed.assertInertiaComponent("inquiries/index");
			assert.equal(landed.body().flash.error, MESSAGE);
		}
	});

	test("a form's throttle still goes back to the form with its minutes", async ({
		client,
	}) => {
		for (let i = 0; i < 30; i++) {
			await client
				.post("/reset-password")
				.header("x-forwarded-for", "203.0.113.190")
				.header("referer", "/reset-password")
				.form({})
				.withCsrfToken()
				.redirects(0);
		}

		const refused = await client
			.post("/reset-password")
			.header("x-forwarded-for", "203.0.113.190")
			.header("referer", "/reset-password")
			.form({})
			.withCsrfToken()
			.redirects(0);

		refused.assertHeader("location", "/reset-password");
		refused.assertFlashMessage(
			"error",
			"Too many attempts. Try again in 15 minutes.",
		);
	});
});
