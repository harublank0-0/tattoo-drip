import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

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
