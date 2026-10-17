import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Client from "#modules/clients/models/client";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const clientsUrl = (path = "") => `/t/black-needle/clients${path}`;

test.group("Clients list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees clients newest first with their counts and activity", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
			});
			await makeProject(tenant, sita);
			await makeProject(tenant, sita);
			const ram = await makeClient(tenant, { name: "Ram Thapa" });
			await makeInquiry(tenant, ram);
		});

		const response = await client
			.get(clientsUrl())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("clients/index");
		const props = response.inertiaProps;
		assert.equal(props.search, "");
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
		assert.deepEqual(
			props.clients.map(({ name }: { name: string }) => name),
			["Ram Thapa", "Sita Rai"],
		);
		assert.deepInclude(props.clients[1], {
			name: "Sita Rai",
			phone: "+9779812345678",
			projects: 2,
			lastActivityText: "today",
		});
		assert.equal(props.clients[0].projects, 0);
	});

	test("?q= searches by name or phone", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" });
			await makeClient(tenant, { name: "Ram Thapa" });
		});

		const byName = (
			await client.get(clientsUrl("?q=rai")).withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(byName.search, "rai");
		assert.deepEqual(
			byName.clients.map(({ name }: { name: string }) => name),
			["Sita Rai"],
		);

		const byPhone = (
			await client.get(clientsUrl("?q=981-234")).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(
			byPhone.clients.map(({ name }: { name: string }) => name),
			["Sita Rai"],
		);
	});

	test("artists get a 404", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		const response = await client
			.get(clientsUrl())
			.withInertia()
			.loginAs(artist);
		response.assertStatus(404);
	});
});

test.group("Client profile", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("shows the details, projects, inquiries, references and links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { sita, project, inquiry } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const sita = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
				email: "sita@example.com",
				notes: "Prefers evenings.",
			});
			const inquiry = await makeInquiry(tenant, sita, {
				idea: "A koi on the calf",
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, sita, {
				inquiryId: inquiry.id,
				brief: "A koi on the calf",
				artistId: artist.id,
				status: "quoted",
			});
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			return { sita, project, inquiry };
		});

		const response = await client
			.get(clientsUrl(`/${sita.id}`))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("clients/show");
		const props = response.inertiaProps;
		assert.deepInclude(props.client, {
			id: sita.id,
			name: "Sita Rai",
			phone: "+9779812345678",
			email: "sita@example.com",
			notes: "Prefers evenings.",
			anonymized: false,
		});
		assert.isString(props.client.sinceText);
		assert.deepEqual(props.links, {
			whatsapp: "https://wa.me/9779812345678",
			viber: "viber://chat?number=%2B9779812345678",
			call: "tel:+9779812345678",
		});
		assert.deepInclude(props.projects[0], {
			id: project.id,
			brief: "A koi on the calf",
			status: "quoted",
			artistName: "Sita",
		});
		assert.deepInclude(props.inquiries[0], {
			id: inquiry.id,
			idea: "A koi on the calf",
			status: "accepted",
		});
		assert.lengthOf(props.references, 1);
		assert.include(props.references[0].url, "reference_image/");
	});

	test("a client with nothing yet shows empty lists and nulls", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const quiet = await inTenant(tenant, () =>
			makeClient(tenant, { email: null, notes: null }),
		);

		const props = (
			await client
				.get(clientsUrl(`/${quiet.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.isNull(props.client.email);
		assert.isNull(props.client.notes);
		assert.deepEqual(props.projects, []);
		assert.deepEqual(props.inquiries, []);
		assert.deepEqual(props.references, []);
		assert.isNotNull(props.links);
	});

	test("an anonymized client shows no details and no links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const gone = await inTenant(tenant, () =>
			makeClient(tenant, { phone: null, anonymizedAt: DateTime.utc() }),
		);

		const props = (
			await client
				.get(clientsUrl(`/${gone.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.isTrue(props.client.anonymized);
		assert.isNull(props.client.phone);
		assert.isNull(props.links);
	});

	test("artists get a 404 on a profile", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const sita = await inTenant(tenant, () => makeClient(tenant));

		const response = await client
			.get(clientsUrl(`/${sita.id}`))
			.withInertia()
			.loginAs(artist);
		response.assertStatus(404);
	});
});

test.group("Editing a client", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const save = (http: ApiClient, id: string, form: Record<string, string>) =>
		http
			.put(clientsUrl(`/${id}`))
			.form(form)
			.withCsrfToken();

	test("the edit page shows the current details", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () =>
			makeClient(tenant, { name: "Sita", phone: "+9779812345678" }),
		);

		const response = await client
			.get(clientsUrl(`/${sita.id}/edit`))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("clients/edit");
		assert.deepInclude(response.inertiaProps.client, {
			id: sita.id,
			name: "Sita",
			phone: "+9779812345678",
		});
	});

	test("saving normalizes the phone and returns to the profile", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeClient(tenant));

		const response = await save(client, sita.id, {
			name: "  Sita Rai ",
			phone: "9812345678",
			email: "",
			notes: "Prefers evenings.",
		})
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", clientsUrl(`/${sita.id}`));
		response.assertFlashMessage("success", "Client updated.");
		const saved = await inTenant(tenant, () => Client.findOrFail(sita.id));
		assert.deepEqual(
			[saved.name, saved.phone, saved.email, saved.notes],
			["Sita Rai", "+9779812345678", null, "Prefers evenings."],
		);
	});

	test("another client's number is a field error naming them", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779801112223" });
			return makeClient(tenant, { name: "Sita" });
		});

		const response = await save(client, sita.id, {
			name: "Sita",
			phone: "+9779801112223",
			email: "",
			notes: "",
		})
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"phone",
			"Another client already has this number: Ram Thapa.",
		);
		const saved = await inTenant(tenant, () => Client.findOrFail(sita.id));
		assert.notEqual(saved.phone, "+9779801112223");
	});

	test("an invalid email is a field error", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeClient(tenant));

		const response = await save(client, sita.id, {
			name: "Sita",
			phone: "9812345678",
			email: "not-an-email",
			notes: "",
		})
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "email");
	});

	test("an anonymized client can't be edited", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const gone = await inTenant(tenant, () =>
			makeClient(tenant, { phone: null, anonymizedAt: DateTime.utc() }),
		);

		const page = await client
			.get(clientsUrl(`/${gone.id}/edit`))
			.loginAs(owner)
			.redirects(0);
		page.assertHeader("location", clientsUrl(`/${gone.id}`));
		page.assertFlashMessage(
			"error",
			"This client's details were deleted and can't be edited.",
		);

		const put = await save(client, gone.id, {
			name: "Back",
			phone: "9812345678",
			email: "",
			notes: "",
		})
			.loginAs(owner)
			.redirects(0);
		put.assertHeader("location", clientsUrl(`/${gone.id}`));
		put.assertFlashMessage(
			"error",
			"This client's details were deleted and can't be edited.",
		);
	});

	test("artists get a 404 on edit and save", async ({ client }) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const sita = await inTenant(tenant, () => makeClient(tenant));

		(
			await client
				.get(clientsUrl(`/${sita.id}/edit`))
				.withInertia()
				.loginAs(artist)
		).assertStatus(404);
		(
			await save(client, sita.id, {
				name: "X",
				phone: "9812345678",
				email: "",
				notes: "",
			})
				.loginAs(artist)
				.redirects(0)
		).assertStatus(404);
	});
});
