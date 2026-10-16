import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry from "#modules/inquiries/models/inquiry";
import TattooProject from "#modules/projects/models/tattoo_project";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

test.group("Inbox badge", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the new-inquiry count on every tenant page; artists get null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer);
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		const ownerProps = (
			await client.get("/t/black-needle/projects").withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.inboxCount, 2);

		const artistResponse = await client
			.get("/t/black-needle/projects")
			.withInertia()
			.loginAs(artist);
		artistResponse.assertStatus(200);
		assert.isNull(artistResponse.inertiaProps.inboxCount);
	});
});

const inbox = (query = "") => `/t/black-needle/inbox${query}`;

test.group("Inbox pages", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the New tab lists waiting inquiries, oldest first, with their details", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			const first = await makeInquiry(tenant, sita, {
				idea: "A koi on the calf",
				preferredArtistId: artist.id,
			});
			await makeReferenceImage(tenant, { inquiryId: first.id });
			await makeReferenceImage(tenant, { inquiryId: first.id, position: 1 });
			await makeInquiry(tenant, await makeClient(tenant, { name: "Ram" }));
			await makeInquiry(tenant, sita, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		const response = await client.get(inbox()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("inquiries/index");
		const props = response.inertiaProps;
		assert.equal(props.view, "new");
		assert.equal(props.newCount, 2);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
		assert.deepInclude(props.inquiries[0], {
			contactName: "Sita Rai",
			idea: "A koi on the calf",
			placement: "Forearm",
			approximateSize: "8 cm",
			preferredArtistName: "Sita",
			receivedText: "received today",
			references: 2,
			status: "new",
		});
		assert.equal(props.inquiries[1].contactName, "Ram");
		assert.equal(props.inquiries[1].references, 0);
	});

	test("the Decided tab links accepted inquiries to their project", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { accepted, projectId } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const accepted = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc().minus({ days: 1 }),
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: accepted.id,
			});
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
			return { accepted, projectId: project.id };
		});

		const props = (
			await client.get(inbox("?view=decided")).withInertia().loginAs(owner)
		).inertiaProps;

		assert.equal(props.view, "decided");
		assert.deepEqual(
			props.inquiries.map(({ status }: { status: string }) => status),
			["declined", "accepted"],
		);
		const row = props.inquiries.find(
			({ id }: { id: string }) => id === accepted.id,
		);
		assert.equal(row.projectId, projectId);
		assert.isString(row.decidedOn);

		// A decided inquiry's page links its project and offers no actions.
		const shown = (
			await client
				.get(inbox(`/${accepted.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.isNull(shown.accept);
		assert.equal(shown.projectId, projectId);
	});

	test("the inquiry page shows everything, signed references, and the accept choices", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, artist } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const customer = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
				email: "sita@example.com",
			});
			const inquiry = await makeInquiry(tenant, customer, {
				preferredArtistId: artist.id,
				budget: "NPR 20,000",
			});
			await makeReferenceImage(tenant, { inquiryId: inquiry.id });
			return { inquiry, artist };
		});

		const response = await client
			.get(inbox(`/${inquiry.id}`))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("inquiries/show");
		const props = response.inertiaProps;
		assert.deepInclude(props.inquiry, {
			id: inquiry.id,
			status: "new",
			contactName: "Sita Rai",
			contactPhone: "+9779812345678",
			contactEmail: "sita@example.com",
			idea: "A small fine-line moth",
			budget: "NPR 20,000",
			source: "instagram",
			preferredArtistName: "Sita",
		});
		assert.lengthOf(props.references, 1);
		assert.include(props.references[0].url, "reference_image/");
		assert.match(props.references[0].url, /signature=/);
		assert.deepEqual(props.accept.artistId, artist.id);
		assert.deepInclude(props.accept.choices, { id: artist.id, name: "Sita" });
		assert.isNull(props.projectId);
	});

	test("missing details stay null, and a deleted preferred artist pre-selects none", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await makeInquiry(tenant, await makeClient(tenant), {
				preferredArtistId: artist.id,
				contactEmail: null,
				budget: null,
			});
			await artist.softDelete();
			return inquiry;
		});

		const props = (
			await client
				.get(inbox(`/${inquiry.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.isNull(props.inquiry.contactEmail);
		assert.isNull(props.inquiry.budget);
		assert.isNull(props.inquiry.preferredArtistName);
		assert.deepEqual(props.references, []);
		assert.isNull(props.accept.artistId);
	});

	test("artists get a 404 on the inbox and on an inquiry", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		for (const url of [inbox(), inbox(`/${inquiry.id}`)]) {
			const response = await client.get(url).withInertia().loginAs(artist);
			response.assertStatus(404);
		}
	});
});

test.group("Deciding an inquiry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const statusOf = (tenant: { id: string }, id: string) =>
		inTenant(tenant, async () => (await Inquiry.findOrFail(id)).status);

	test("accepting creates the project and lands on it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, artist } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));
			return { inquiry, artist };
		});

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: artist.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const project = await inTenant(tenant, () =>
			TattooProject.query().where("inquiry_id", inquiry.id).firstOrFail(),
		);
		response.assertHeader("location", `/t/black-needle/projects/${project.id}`);
		response.assertFlashMessage(
			"success",
			"Inquiry accepted: project created.",
		);
		assert.equal(project.artistId, artist.id);
		assert.equal(await statusOf(tenant, inquiry.id), "accepted");
	});

	test("declining closes the inquiry and returns to the inbox", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		const response = await client
			.post(inbox(`/${inquiry.id}/decline`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/inbox");
		response.assertFlashMessage("success", "Inquiry declined.");
		assert.equal(await statusOf(tenant, inquiry.id), "declined");
	});

	test("a stale page accepting a declined inquiry gets a flash, no project", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant), {
				status: "declined",
				decidedAt: DateTime.utc(),
			}),
		);

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", `/t/black-needle/inbox/${inquiry.id}`);
		response.assertFlashMessage("error", "This inquiry was already decided.");
		assert.lengthOf(
			await inTenant(tenant, () =>
				TattooProject.query().where("inquiry_id", inquiry.id),
			),
			0,
		);
	});

	test("declining a decided inquiry gets the same flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant), {
				status: "accepted",
				decidedAt: DateTime.utc(),
			}),
		);

		const response = await client
			.post(inbox(`/${inquiry.id}/decline`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", `/t/black-needle/inbox/${inquiry.id}`);
		response.assertFlashMessage("error", "This inquiry was already decided.");
		assert.equal(await statusOf(tenant, inquiry.id), "accepted");
	});

	test("a removed artist is a field error and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, gone } = await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant);
			await gone.softDelete();
			return {
				inquiry: await makeInquiry(tenant, await makeClient(tenant)),
				gone,
			};
		});

		const response = await client
			.post(inbox(`/${inquiry.id}/accept`))
			.form({ artistId: gone.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"artistId",
			"Choose an artist from the list.",
		);
		assert.equal(await statusOf(tenant, inquiry.id), "new");
	});

	test("artists get a 404 on accept and decline", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		for (const action of ["accept", "decline"]) {
			const response = await client
				.post(inbox(`/${inquiry.id}/${action}`))
				.form({ artistId: "" })
				.withCsrfToken()
				.loginAs(artist)
				.redirects(0);
			response.assertStatus(404);
		}
		assert.equal(await statusOf(tenant, inquiry.id), "new");
	});
});
