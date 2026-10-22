import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	INVITATION_TOKEN_KEY,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { confirmedUser, invite } from "#tests/helpers/invitations";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

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

	// Every state a signed-in person can be in when they open a link (TAT-119):
	// the throttled link sends them to /dashboard, whose redirects (to the
	// studio home and the list, or to /onboarding and on to /confirm-email)
	// must each keep the flash until the page that shows it.
	const STATES: Array<{
		name: string;
		landing: string;
		person: () => Promise<User>;
	}> = [
		{
			name: "verified, no studio (onboarding)",
			landing: "onboarding/create_tenant",
			person: () => confirmedUser("nostudio@throttled-119.example"),
		},
		{
			name: "unverified, no studio (onboarding, then /confirm-email)",
			landing: "auth/confirm_email",
			person: () =>
				User.create({
					email: "unverified@throttled-119.example",
					password: "secret-password",
				}),
		},
		{
			name: "unverified, one studio (the inbox)",
			landing: "inquiries/index",
			person: async () =>
				(await studioWithOwner("throttled-uv-119", "Throttled UV")).owner,
		},
		{
			name: "verified, one studio (the inbox)",
			landing: "inquiries/index",
			person: async () => {
				const { owner } = await studioWithOwner(
					"throttled-v-119",
					"Throttled V",
				);
				owner.emailVerifiedAt = DateTime.now();
				return owner.save();
			},
		},
		{
			name: "several studios (the oldest one's inbox)",
			landing: "inquiries/index",
			person: async () => {
				const first = await studioWithOwner("throttled-m1-119", "Throttled M1");
				const second = await studioWithOwner(
					"throttled-m2-119",
					"Throttled M2",
				);
				await inTenant(second.tenant, () =>
					TenantMembership.create({
						tenantId: second.tenant.id,
						userId: first.owner.id,
						role: "owner",
					}),
				);
				first.owner.emailVerifiedAt = DateTime.now();
				return first.owner.save();
			},
		},
		{
			name: "an artist member (their projects)",
			landing: "projects/index",
			person: async () => {
				const { tenant } = await studioWithOwner(
					"throttled-a-119",
					"Throttled A",
				);
				return artistIn(tenant, "artist@throttled-119.example");
			},
		},
	];

	for (const [at, state] of STATES.entries()) {
		test(`a signed-in person (${state.name}) ends on their page with the message, for a live and an unknown token`, async ({
			client,
			assert,
		}) => {
			const person = await state.person();
			const ip = `203.0.113.${200 + at}`;
			await spendLimit(client, LINKS[1].path(UNKNOWN), ip);
			// Live tokens of the two links a signed-in person can open.
			const live = [LINKS[1], LINKS[2]];
			const tokensOf = new Map(
				await Promise.all(
					live.map(async (link) => [link, await link.live()] as const),
				),
			);

			for (const link of live) {
				for (const token of [tokensOf.get(link) as string, UNKNOWN]) {
					const open = () =>
						client
							.get(link.path(token))
							.header("x-forwarded-for", ip)
							.loginAs(person);
					const refused = await open().redirects(0);
					refused.assertHeader("location", "/dashboard");
					refused.assertFlashMessage("error", MESSAGE);

					// Every hop from /dashboard to the page keeps the message.
					const landed = await open().redirects(8).withInertia();
					landed.assertInertiaComponent(state.landing);
					assert.equal(
						landed.body().flash.error,
						MESSAGE,
						`${link.name}, ${state.name}`,
					);
				}
			}
		});
	}

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
