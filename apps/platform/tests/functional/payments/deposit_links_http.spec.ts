import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import { chatLinks } from "#modules/clients/contact_links";
import { depositPageUrl, tokenFor } from "#modules/payments/deposit_links";
import DepositLink from "#modules/payments/models/deposit_link";
import { formatDay } from "#modules/projects/quotes";
import env from "#start/env";
import { depositReady, depositServices } from "#tests/helpers/deposits";
import { makeArtist, makePayment } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "deposit-needle-65";
const KTM = "Asia/Kathmandu";
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const linkRoute = (id: string) => `${page(id)}/deposit-link`;
const URL_SHAPE = new RegExp(
	`^http://${SLUG}\\.localhost:3000/deposit#[A-Za-z0-9_-]{43}$`,
);
const { links } = depositServices();

async function ready() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
	const { project, client, method } = await inTenant(tenant, () =>
		depositReady(tenant),
	);
	return { owner, tenant, project, client, method };
}

/** The project page's deposit prop for `user`. */
async function panelFor(client: ApiClient, user: User, projectId: string) {
	const response = await client
		.get(page(projectId))
		.withInertia()
		.loginAs(user);
	response.assertStatus(200);
	return response.inertiaProps.deposit;
}

function makeLink(client: ApiClient, user: User, projectId: string) {
	return client
		.post(linkRoute(projectId))
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

const linkOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		DepositLink.query().where("project_id", projectId).first(),
	);

test.group("The deposit link on the project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("before a link, the panel offers one", async ({ client, assert }) => {
		const { owner, project } = await ready();

		assert.deepEqual(await panelFor(client, owner, project.id), {
			link: null,
			problem: null,
			message: null,
			proofReceivedText: null,
			devHost: true,
		});
	});

	test("the panel warns while links point at this machine (the dev host) and stops when STOREFRONT_URL names a real host", async ({
		client,
		assert,
	}) => {
		const { owner, project } = await ready();
		const before = env.get("STOREFRONT_URL");
		assert.isTrue(
			(await panelFor(client, owner, project.id)).devHost,
			".env.test points at the dev host",
		);

		env.set("STOREFRONT_URL", "https://{tenant}.example.com");
		try {
			assert.isFalse((await panelFor(client, owner, project.id)).devHost);
		} finally {
			env.set("STOREFRONT_URL", before ?? "http://{tenant}.localhost:3000");
		}
	});

	test("an owner makes the link; the page shows it, the code, its last day and the chat message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, client: customer } = await ready();

		const response = await makeLink(client, owner, project.id);

		response.assertStatus(302);
		response.assertHeader("location", page(project.id));
		response.assertFlashMessage(
			"success",
			"Deposit link ready: send it to the client.",
		);
		const link = await linkOf(tenant, project.id);
		const panel = await panelFor(client, owner, project.id);
		const url = depositPageUrl(SLUG, tokenFor(link?.tokenNonce ?? ""));
		assert.match(panel.link.url, URL_SHAPE);
		assert.equal(panel.link.url, url);
		assert.equal(panel.link.referenceCode, link?.referenceCode);
		assert.equal(
			panel.link.expiresText,
			formatDay(link?.expiresAt.setZone(KTM).toFormat("yyyy-MM-dd") ?? ""),
		);
		assert.isNull(panel.problem);
		const text = `Hi Sita, please pay your deposit of NPR 3,000 to Black Needle. Write ${link?.referenceCode} in the payment remark, then send a screenshot of the payment on this page:\n${url}`;
		const chat = chatLinks(customer.phone ?? "", text);
		assert.deepEqual(panel.message, {
			text,
			whatsappUrl: chat.whatsapp,
			viberUrl: chat.viber,
		});
	});

	test("New link replaces it: another URL, the same code, and the old token is dead", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await makeLink(client, owner, project.id);
		const before = await panelFor(client, owner, project.id);

		const response = await makeLink(client, owner, project.id);

		response.assertFlashMessage(
			"success",
			"New link made. The old one no longer works.",
		);
		const after = await panelFor(client, owner, project.id);
		assert.notEqual(after.link.url, before.link.url);
		assert.equal(after.link.referenceCode, before.link.referenceCode);
		const oldToken = new URL(before.link.url).hash.slice(1);
		assert.isNull(
			await inTenant(tenant, () => links.resolve(tenant, oldToken)),
		);
	});

	test("an artist, even the assigned one, gets a 404 and no panel", async ({
		client,
		assert,
	}) => {
		const { tenant, project } = await ready();
		const asha = await artistIn(tenant, "asha@deposit-needle-65.example");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			project.artistId = profile.id;
			await project.save();
		});

		const response = await makeLink(client, asha, project.id);

		response.assertStatus(404);
		assert.isNull(await panelFor(client, asha, project.id));
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("a project that isn't waiting for a deposit shows no panel, and its POST says why", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await inTenant(tenant, async () => {
			project.status = "quoted";
			await project.save();
		});

		assert.isNull(await panelFor(client, owner, project.id));
		const response = await makeLink(client, owner, project.id);
		response.assertStatus(302);
		response.assertFlashMessage(
			"error",
			"A deposit link can only be made while the project waits for its deposit.",
		);
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("with no method on the deposit page, the panel says what to fix and the POST refuses", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, method } = await ready();
		await inTenant(tenant, async () => {
			method.showOnDepositPage = false;
			await method.save();
		});
		const fix =
			"Show a payment method on the deposit page first (Settings, Payments).";

		assert.equal((await panelFor(client, owner, project.id)).problem, fix);
		(await makeLink(client, owner, project.id)).assertFlashMessage(
			"error",
			fix,
		);
		assert.isNull(await linkOf(tenant, project.id));
	});

	test("an expired link shows no URL or message, and New link makes a working one", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await makeLink(client, owner, project.id);
		await inTenant(tenant, async () => {
			const link = await DepositLink.query()
				.where("project_id", project.id)
				.firstOrFail();
			link.expiresAt = DateTime.utc().minus({ seconds: 1 });
			await link.save();
		});

		const expired = await panelFor(client, owner, project.id);
		assert.isNull(expired.link.url);
		assert.isString(expired.link.referenceCode);
		assert.isNull(expired.message);

		await makeLink(client, owner, project.id);
		assert.match(
			(await panelFor(client, owner, project.id)).link.url,
			URL_SHAPE,
		);
	});

	test("a waiting screenshot shows when it came", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await ready();
		await inTenant(tenant, () =>
			makePayment(tenant, project, { method: "esewa" }),
		);

		assert.equal(
			(await panelFor(client, owner, project.id)).proofReceivedText,
			formatDay(DateTime.now().setZone(KTM).toFormat("yyyy-MM-dd")),
		);
	});
});
