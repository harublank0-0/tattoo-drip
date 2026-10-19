import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	MESSAGE_KINDS,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const PAGE = "/t/black-needle/settings/messages";

const rowsOf = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", tenant.id)
				.orderBy("kind")
		).map(({ kind, body }) => ({ kind, body })),
	);

test.group("Settings, Messages", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the page lists the six messages with their placeholders and example details", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client.get(PAGE).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/messages");
		const { messages, sample } = response.inertiaProps;
		assert.deepEqual(
			messages.map(({ kind }: { kind: string }) => kind),
			[...MESSAGE_KINDS],
		);
		assert.deepInclude(messages[1], {
			kind: "quote",
			label: "Quote",
			offered: "Offered under the quote while the client's answer is awaited.",
			text: DEFAULT_TEMPLATES.quote,
			defaultText: DEFAULT_TEMPLATES.quote,
		});
		assert.deepEqual(
			messages[1].placeholders.map(({ name }: { name: string }) => name),
			["client_name", "studio_name", "price", "deposit_note", "valid_until"],
		);
		assert.equal(sample.studio_name, "Black Needle");
		assert.equal(sample.client_name, "Sita");
	});

	test("saving keeps the studio's own text, with the flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put(PAGE)
			.form({
				...DEFAULT_TEMPLATES,
				aftercare: "Namaste {client_name}! Take care.",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", PAGE);
		response.assertFlashMessage("success", "Messages saved.");
		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "aftercare", body: "Namaste {client_name}! Take care." },
		]);
		const shown = (await client.get(PAGE).withInertia().loginAs(owner))
			.inertiaProps;
		assert.equal(shown.messages[5].text, "Namaste {client_name}! Take care.");
	});

	test("a wrong placeholder or a missing deposit link is a field error and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put(PAGE)
			.form({
				...DEFAULT_TEMPLATES,
				quote: "Hi {client name}, {price}",
				deposit_link: "Please pay {amount}.",
				aftercare: "x".repeat(1001),
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"quote",
			"{client name} can't be used here. This message can use {client_name}, {studio_name}, {price}, {deposit_note}, {valid_until}.",
		);
		assertValidationError(
			response,
			"deposit_link",
			"Keep {deposit_link}: it is the link the client pays on.",
		);
		assertValidationError(
			response,
			"aftercare",
			"Use at most 1,000 characters.",
		);
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("artists get a 404 on the page and the save", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		(await client.get(PAGE).withInertia().loginAs(artist)).assertStatus(404);
		const save = await client
			.put(PAGE)
			.form({ ...DEFAULT_TEMPLATES, quote: "Mine: {price}" })
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		save.assertStatus(404);
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("the project page sends the studio's own quote text", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Sita Rai" }),
				{ status: "quoted" },
			);
			await makeQuote(tenant, project);
			return project;
		});
		await client
			.put(PAGE)
			.form({ ...DEFAULT_TEMPLATES, quote: "Namaste {client_name}: {price}" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const props = (
			await client
				.get(`/t/black-needle/projects/${project.id}`)
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.message.text, "Namaste Sita: NPR 15,000");
	});
});
