import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient, ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import StudioContentService from "#modules/studio_content/services/studio_content_service";
import Tenant from "#modules/tenancy/models/tenant";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** Settings → FAQ & policies (spec: 2026-11-06-studio-faq-and-policies-design.md). */

const content = new StudioContentService();
const base = (slug: string) => `/t/${slug}/settings/faq-policies`;
const page = (client: ApiClient, user: User, slug: string) =>
	client.get(base(slug)).withInertia().loginAs(user);
const put = (
	client: ApiClient,
	user: User,
	path: string,
	body: Record<string, unknown>,
) => client.put(path).json(body).withCsrfToken().loginAs(user).redirects(0);

/** The bag's key holds the dots ("entries.0.question"): look it up as one key. */
const assertFieldError = (response: ApiResponse, field: string) =>
	response.assert?.isDefined(
		(response.flashMessage("inputErrorsBag") ?? {})[field],
		`expected a validation error on "${field}"`,
	);

const entry = (n: number) => ({
	question: `Question ${n}?`,
	answer: `Answer ${n}.`,
});
const section = (n: number) => ({ title: `Section ${n}`, text: `Text ${n}.` });

test.group("Settings: FAQ & policies", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the page carries the studio's lists in order, the policies date and whether Good to know is shown", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await content.saveFaq(tenant, [entry(2), entry(1)]);
			await content.savePolicies(tenant, [section(1)]);
			await Tenant.query()
				.where("id", tenant.id)
				.update({ policies_updated_at: new Date("2026-11-06T05:00:00Z") });
		});

		const response = await page(client, owner, tenant.slug);
		response.assertStatus(200);
		response.assertInertiaComponent("settings/faq_policies");
		const props = response.inertiaProps;
		assert.deepEqual(props.faq, [entry(2), entry(1)]);
		assert.deepEqual(props.policies, [section(1)]);
		// The studio's day in Kathmandu (the fixture's timezone).
		assert.equal(props.policiesUpdatedOn, "6 November 2026");
		assert.isBoolean(props.shownOnPage);
	});

	test("saving the FAQ replaces it and goes back with a success flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () => content.saveFaq(tenant, [entry(1)]));

		const response = await put(client, owner, `${base(tenant.slug)}/faq`, {
			entries: [entry(3), { question: "  Spaces?  ", answer: " Trimmed. " }],
		});

		response.assertStatus(302);
		response.assertHeader("location", base(tenant.slug));
		response.assertFlashMessage("success", "FAQ saved.");
		assert.deepEqual(await inTenant(tenant, () => content.faq(tenant)), [
			entry(3),
			{ question: "Spaces?", answer: "Trimmed." },
		]);
	});

	test("saving policies replaces them and dates them; an unchanged save keeps the date", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const datedAt = async () =>
			(await inTenant(tenant, () => Tenant.findOrFail(tenant.id)))
				.policiesUpdatedAt;
		const path = `${base(tenant.slug)}/policies`;

		(await put(client, owner, path, { sections: [section(1)] })).assertStatus(
			302,
		);
		assert.deepEqual(
			await inTenant(tenant, () => content.policySections(tenant)),
			[section(1)],
		);
		const first = await datedAt();
		assert.isNotNull(first);

		const old = new Date("2020-01-01T00:00:00Z");
		await inTenant(tenant, () =>
			Tenant.query()
				.where("id", tenant.id)
				.update({ policies_updated_at: old }),
		);
		(await put(client, owner, path, { sections: [section(1)] })).assertStatus(
			302,
		);
		assert.equal((await datedAt())?.toMillis(), old.getTime());
	});

	test("an empty question, a 2001-character answer or 21 entries is a field error; nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, () => content.saveFaq(tenant, [entry(1)]));
		const path = `${base(tenant.slug)}/faq`;

		const empty = await put(client, owner, path, {
			entries: [{ question: "   ", answer: "x" }],
		});
		empty.assertStatus(302);
		assertFieldError(empty, "entries.0.question");

		const long = await put(client, owner, path, {
			entries: [{ question: "q", answer: "a".repeat(2001) }],
		});
		assertFieldError(long, "entries.0.answer");

		const many = await put(client, owner, path, {
			entries: Array.from({ length: 21 }, (_, n) => entry(n)),
		});
		assertFieldError(many, "entries");

		const policies = await put(client, owner, `${base(tenant.slug)}/policies`, {
			sections: [{ title: "t".repeat(81), text: "x" }],
		});
		assertFieldError(policies, "sections.0.title");

		assert.deepEqual(await inTenant(tenant, () => content.faq(tenant)), [
			entry(1),
		]);
	});

	test("an artist gets a 404 for each route", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant, "artist@example.com");

		(await page(client, artist, tenant.slug)).assertStatus(404);
		(
			await put(client, artist, `${base(tenant.slug)}/faq`, { entries: [] })
		).assertStatus(404);
		(
			await put(client, artist, `${base(tenant.slug)}/policies`, {
				sections: [],
			})
		).assertStatus(404);
	});
});
