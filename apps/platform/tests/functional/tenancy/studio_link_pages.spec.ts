import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import env from "#start/env";
import { addArtist } from "#tests/helpers/artists";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner, twoStudios } from "#tests/helpers/tenants";

const DEV_HOST = "http://{tenant}.localhost:3000";

/** Runs `fn` with STOREFRONT_URL set, then puts the test default back. */
async function withStorefrontUrl<T>(value: string, fn: () => Promise<T>) {
	const before = env.get("STOREFRONT_URL");
	env.set("STOREFRONT_URL", value);
	try {
		return await fn();
	} finally {
		env.set("STOREFRONT_URL", before ?? DEV_HOST);
	}
}

test.group(
	"The studio link and the setup checklist on the pages (TAT-101)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a new owner's Today carries the four steps, none done, and the studio link", async ({
			client,
			assert,
		}) => {
			const { owner } = await studioWithOwner("fresh-ink", "Fresh Ink");

			const response = await client
				.get("/t/fresh-ink/today")
				.withInertia()
				.loginAs(owner);

			const { setup, studioPage } = response.inertiaProps;
			assert.deepEqual(
				setup.steps.map(({ key, done, next }: Record<string, unknown>) => [
					key,
					done,
					next,
				]),
				[
					["artists", false, true],
					["payments", false, false],
					["policy", false, false],
					["inquiry", false, false],
				],
			);
			assert.equal(setup.doneCount, 0);
			assert.isFalse(setup.complete);
			assert.equal(studioPage.url, "http://fresh-ink.localhost:3000");
			assert.isTrue(
				studioPage.devHost,
				"STOREFRONT_URL is the dev host in tests: the card warns",
			);
		});

		test("the ticks follow what the owner adds: an artist, then a method on the deposit page", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("tick-ink", "Tick Ink");
			const done = async () =>
				(
					await client.get("/t/tick-ink/today").withInertia().loginAs(owner)
				).inertiaProps.setup.steps.map(({ done }: { done: boolean }) => done);
			assert.deepEqual(await done(), [false, false, false, false]);

			await addArtist(tenant, owner);
			assert.deepEqual(await done(), [true, false, false, false]);

			await inTenant(tenant, () =>
				new PaymentMethodService(new ImageService()).create(tenant, {
					kind: "esewa",
					label: "eSewa",
					accountNumber: "9801234567",
					accountName: "Tick Ink",
					showOnDepositPage: true,
				}),
			);
			assert.deepEqual(await done(), [true, true, false, false]);

			await inTenant(tenant, () =>
				new TenancyService().updateDepositSettings(tenant, {
					defaultDepositPercent: 30,
					depositPolicy: "30% holds your date.",
				}),
			);
			await inTenant(tenant, async () =>
				makeInquiry(tenant, await makeClient(tenant)),
			);
			// All four done: Today stops drawing the checklist and the link.
			const props = (
				await client.get("/t/tick-ink/today").withInertia().loginAs(owner)
			).inertiaProps;
			assert.isNull(props.setup);
			assert.isNull(props.studioPage);
		});

		test("the Inbox no longer carries the checklist; its empty New view keeps the studio link", async ({
			client,
			assert,
		}) => {
			const { owner } = await studioWithOwner("dec-ink", "Dec Ink");

			const fresh = await client
				.get("/t/dec-ink/inbox")
				.withInertia()
				.loginAs(owner);
			const decided = await client
				.get("/t/dec-ink/inbox?view=decided")
				.withInertia()
				.loginAs(owner);

			assert.notProperty(fresh.inertiaProps, "setup");
			assert.notProperty(decided.inertiaProps, "setup");
			assert.equal(
				fresh.inertiaProps.studioPage.url,
				"http://dec-ink.localhost:3000",
			);
			assert.isNull(decided.inertiaProps.studioPage);
		});

		test("a studio never sees another studio's progress or link", async ({
			client,
			assert,
		}) => {
			const { a, b } = await twoStudios();
			const { owner } = await studioWithOwner("lonely-ink", "Lonely Ink");

			const fresh = await client
				.get("/t/lonely-ink/today")
				.withInertia()
				.loginAs(owner);
			const asA = await client
				.get("/t/studio-a/today")
				.withInertia()
				.loginAs(a.owner);

			assert.equal(fresh.inertiaProps.setup.doneCount, 0);
			assert.equal(
				fresh.inertiaProps.studioPage.url,
				"http://lonely-ink.localhost:3000",
			);
			assert.equal(
				asA.inertiaProps.studioPage.url,
				"http://studio-a.localhost:3000",
			);
			assert.notInclude(
				JSON.stringify(asA.inertiaProps.studioPage),
				b.tenant.slug,
			);
		});

		test("Settings, Profile always shows the link: Open, Copy and Share all use the one URL", async ({
			client,
			assert,
		}) => {
			const { owner } = await studioWithOwner("black-needle", "Black Needle");

			await withStorefrontUrl("https://{tenant}.example.com", async () => {
				const response = await client
					.get("/t/black-needle/settings/profile")
					.withInertia()
					.loginAs(owner);

				const { studioPage, addressHost } = response.inertiaProps;
				assert.equal(studioPage.url, "https://black-needle.example.com");
				assert.equal(
					studioPage.shareUrl,
					`https://wa.me/?text=${encodeURIComponent(studioPage.url)}`,
				);
				assert.isFalse(studioPage.devHost);
				assert.deepEqual(addressHost, { prefix: "", suffix: ".example.com" });
			});
		});

		test("the link follows a renamed slug", async ({ client, assert }) => {
			const { owner, tenant } = await studioWithOwner("old-name", "Old Name");
			await inTenant(tenant, () =>
				new TenancyService().changeSlug(tenant, "new-name"),
			);

			const response = await client
				.get("/t/new-name/settings/profile")
				.withInertia()
				.loginAs(owner);

			assert.equal(
				response.inertiaProps.studioPage.url,
				"http://new-name.localhost:3000",
			);
		});

		test("artist cards carry their own page link; a hidden artist has none", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner(
				"black-needle",
				"Black Needle",
			);
			await addArtist(tenant, owner, { name: "Ada", slug: "ada" });
			await addArtist(tenant, owner, {
				name: "Bea",
				slug: "bea",
				visible: false,
			});

			const response = await withStorefrontUrl(
				"https://{tenant}.example.com",
				async () =>
					client.get("/t/black-needle/artists").withInertia().loginAs(owner),
			);

			const byName = Object.fromEntries(
				response.inertiaProps.artists.map(
					({ name, pageUrl }: { name: string; pageUrl: string | null }) => [
						name,
						pageUrl,
					],
				),
			);
			assert.deepEqual(byName, {
				Ada: "https://black-needle.example.com/artists/ada",
				Bea: null,
			});
		});

		test("onboarding shows the real host, not a hard-coded domain", async ({
			client,
			assert,
		}) => {
			const { default: User } = await import("#models/user");
			const { DateTime } = await import("luxon");
			const user = await User.create({
				email: "new@onboarding-101.example",
				password: "secret-password",
				emailVerifiedAt: DateTime.now(),
			});

			const dev = await client.get("/onboarding").withInertia().loginAs(user);
			assert.deepEqual(dev.inertiaProps.addressHost, {
				prefix: "",
				suffix: ".localhost:3000",
			});

			const live = await withStorefrontUrl("https://{tenant}.example.com", () =>
				client.get("/onboarding").withInertia().loginAs(user),
			);
			assert.deepEqual(live.inertiaProps.addressHost, {
				prefix: "",
				suffix: ".example.com",
			});
		});
	},
);
