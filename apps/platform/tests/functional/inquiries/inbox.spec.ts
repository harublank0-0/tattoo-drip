import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { chatLinks } from "#modules/clients/contact_links";
import Inquiry from "#modules/inquiries/models/inquiry";
import ImageService from "#modules/media/services/image_service";
import { excerpt } from "#modules/notifications/alerts";
import TattooProject from "#modules/projects/models/tattoo_project";
import { addFlashDesign } from "#tests/helpers/artists";
import { testImages } from "#tests/helpers/images";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
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

	test("the Inbox carries neither the pilot numbers nor the checklist: they moved to Today (TAT-107)", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		for (const view of ["", "?view=decided"]) {
			const props = (await client.get(inbox(view)).withInertia().loginAs(owner))
				.inertiaProps;
			assert.notProperty(props, "pilotMetrics", view);
			assert.notProperty(props, "setup", view);
		}
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
		assert.isString(props.inquiry.clientId);
		assert.lengthOf(props.references, 1);
		assert.include(props.references[0].url, "reference_image/");
		assert.match(props.references[0].url, /signature=/);
		// The helper's fake key names no copies: the thumbnail is the image.
		assert.equal(
			new URL(props.references[0].thumbnailUrl).pathname,
			new URL(props.references[0].url).pathname,
		);
		assert.deepEqual(props.accept.artistId, artist.id);
		assert.deepInclude(props.accept.choices, { id: artist.id, name: "Sita" });
		assert.isNull(props.projectId);
	});

	test("a flash request's row names the design with its thumbnail; other rows have none", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { moth } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const moth = await addFlashDesign(tenant, artist, { name: "Moth" });
			const sita = await makeClient(tenant, { name: "Sita Rai" });
			await makeInquiry(tenant, sita, {
				idea: "The Moth flash",
				flashDesignId: moth.id,
				preferredArtistId: artist.id,
			});
			await makeInquiry(tenant, await makeClient(tenant), {
				idea: "A custom idea",
			});
			return { moth };
		});

		const rows = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps.inquiries;

		const flash = rows.find(
			(row: { idea: string }) => row.idea === "The Moth flash",
		);
		assert.deepEqual(Object.keys(flash.flash).sort(), [
			"name",
			"taken",
			"thumbnailUrl",
		]);
		assert.isFalse(flash.flash.taken);
		assert.equal(flash.flash.name, "Moth");
		assert.match(flash.flash.thumbnailUrl, /\.320w\.png$/);
		assert.equal(
			new URL(flash.flash.thumbnailUrl).pathname.includes(moth.id),
			false,
			"the file's name is not the design's id",
		);
		const custom = rows.find(
			(row: { idea: string }) => row.idea === "A custom idea",
		);
		assert.isNull(custom.flash);
	});

	test("a new request for a claimed design is marked taken, a decided one is not", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { open, decided, free, repeatable } = await inTenant(
			tenant,
			async () => {
				const artist = await makeArtist(tenant);
				const taken = await addFlashDesign(tenant, artist, {
					name: "Taken",
					oneOfAKind: true,
					claimedAt: DateTime.now().minus({ days: 1 }),
				});
				const unclaimed = await addFlashDesign(tenant, artist, {
					name: "Free",
					oneOfAKind: true,
				});
				const again = await addFlashDesign(tenant, artist, { name: "Again" });
				const request = async (
					design: { id: string },
					over: Parameters<typeof makeInquiry>[2] = {},
				) =>
					makeInquiry(tenant, await makeClient(tenant), {
						flashDesignId: design.id,
						preferredArtistId: artist.id,
						...over,
					});
				return {
					open: await request(taken),
					decided: await request(taken, {
						status: "declined",
						decidedAt: DateTime.utc(),
					}),
					free: await request(unclaimed),
					repeatable: await request(again),
				};
			},
		);
		const row = (
			rows: { id: string; flash: { taken: boolean } }[],
			id: string,
		) => rows.find((candidate) => candidate.id === id)?.flash.taken;
		const claimOf = async (id: string) =>
			(
				await client
					.get(inbox(`/${id}`))
					.withInertia()
					.loginAs(owner)
			).inertiaProps.flash.claim;

		const newRows = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps.inquiries;
		const decidedRows = (
			await client.get(inbox("?view=decided")).withInertia().loginAs(owner)
		).inertiaProps.inquiries;

		assert.isTrue(row(newRows, open.id));
		assert.isFalse(row(newRows, free.id));
		assert.isFalse(row(newRows, repeatable.id));
		assert.isFalse(row(decidedRows, decided.id));
		assert.equal(await claimOf(open.id), "taken");
		assert.equal(await claimOf(decided.id), "none");
		assert.equal(await claimOf(free.id), "none");
		assert.equal(await claimOf(repeatable.id), "none");
	});

	test("the inbox costs the same queries for one flash row as for three", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await inTenant(tenant, () => makeArtist(tenant));
		const add = (count: number) =>
			inTenant(tenant, async () => {
				for (let n = 0; n < count; n++) {
					const design = await addFlashDesign(tenant, artist, {
						name: `Moth ${n}`,
					});
					await makeInquiry(tenant, await makeClient(tenant), {
						flashDesignId: design.id,
					});
				}
			});
		const queriesFor = async () =>
			(
				await recordQueries(() =>
					client.get(inbox()).withInertia().loginAs(owner),
				)
			).queries.length;

		await add(1);
		const one = await queriesFor();
		await add(2);
		const three = await queriesFor();

		assert.equal(three, one);
	});

	test("the inquiry page shows the design: picture, name, artist, size and price", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { inquiry, moth } = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const moth = await addFlashDesign(tenant, artist, {
				name: "Moth",
				price: 300_000,
			});
			const inquiry = await makeInquiry(tenant, await makeClient(tenant), {
				flashDesignId: moth.id,
				preferredArtistId: artist.id,
			});
			return { inquiry, moth };
		});
		const read = async () =>
			(
				await client
					.get(inbox(`/${inquiry.id}`))
					.withInertia()
					.loginAs(owner)
			).inertiaProps;

		const props = await read();

		assert.deepEqual(Object.keys(props.flash).sort(), [
			"artistName",
			"claim",
			"hidden",
			"imageUrl",
			"name",
			"oneOfAKind",
			"priceText",
			"size",
			"thumbnailUrl",
		]);
		assert.equal(props.flash.claim, "none");
		assert.isFalse(props.flash.oneOfAKind);
		assert.equal(props.flash.name, "Moth");
		assert.equal(props.flash.artistName, "Sita");
		assert.equal(props.flash.size, "About 3 in");
		assert.equal(props.flash.priceText, "NPR 3,000");
		assert.isFalse(props.flash.hidden);
		assert.match(props.flash.thumbnailUrl, /\.320w\.png$/);
		assert.match(props.flash.imageUrl, /\.1280w\.png$/);
		// The payload the page already had is untouched.
		assert.notProperty(props.inquiry, "flash");

		// Hiding the design afterwards keeps it on the page, marked.
		await inTenant(tenant, async () => {
			moth.hidden = true;
			await moth.save();
		});
		const hidden = await read();
		assert.isTrue(hidden.flash.hidden);
		assert.equal(hidden.flash.name, "Moth");

		// An ordinary inquiry has no design.
		const custom = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const plain = (
			await client
				.get(inbox(`/${custom.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.isNull(plain.flash);
	});

	test("a long idea is two lines' worth in the inbox and whole on its page (TAT-84)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const idea = Array.from({ length: 60 }, () => "सीता wants a koi").join(" ");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant, { name: "सीता थापा" }), {
				idea,
			}),
		);

		const row = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps.inquiries[0];
		assert.equal(row.idea, excerpt(idea, 280));
		assert.isBelow(row.idea.length, idea.length);
		assert.isTrue(row.idea.endsWith("…"));

		const page = (
			await client
				.get(inbox(`/${inquiry.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.equal(page.inquiry.idea, idea);
	});

	test("the inquiry page's grid shows the signed 320 px copy and opens the original", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () => {
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));
			const stored = await new ImageService().storeBytes(
				await testImages.jpeg(1000, 800),
				{ tenant, purpose: "reference_image" },
			);
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				imageKey: stored.key,
				width: 1000,
				height: 800,
			});
			return inquiry;
		});

		const { references } = (
			await client
				.get(inbox(`/${inquiry.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.lengthOf(references, 1);
		const thumbnail = new URL(references[0].thumbnailUrl);
		assert.match(thumbnail.pathname, /\.320w\.jpg$/);
		assert.isTrue(thumbnail.searchParams.has("signature"));
		assert.isTrue(thumbnail.searchParams.has("cacheControl"));
		// The link still opens the full image, signed as well.
		const original = new URL(references[0].url);
		assert.match(original.pathname, /\.320-640\.jpg$/);
		assert.isTrue(original.searchParams.has("signature"));
		const served = await client.get(thumbnail.pathname + thumbnail.search);
		served.assertHeader("cache-control", "private, no-store");
		// A served file is never sniffed into something else (TAT-16).
		served.assertHeader("x-content-type-options", "nosniff");
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

test.group("Inbox contact (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the inquiry's chat links record the contact; artists get a 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const send = (user: typeof owner) =>
			client
				.post(inbox(`/${inquiry.id}/contacted`))
				.form({ channel: "whatsapp", kind: "inquiry_received" })
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);
		const reload = () => inTenant(tenant, () => Inquiry.findOrFail(inquiry.id));

		(await send(artist)).assertStatus(404);
		assert.isNull((await reload()).lastContactedAt);

		const response = await send(owner);
		response.assertStatus(302);
		response.assertHeader("location", inbox(`/${inquiry.id}`));
		response.assertFlashMessage("success", "Marked as contacted.");
		const live = await reload();
		assert.equal(live.lastContactChannel, "whatsapp");
		assert.equal(live.lastContactKind, "inquiry_received");
	});

	test("a new inquiry's page offers the received message to the client's phone", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);

		const props = (
			await client
				.get(inbox(`/${inquiry.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		const text =
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.";
		assert.deepEqual(props.message, {
			kind: "inquiry_received",
			label: "Inquiry received",
			text,
			whatsappUrl: chatLinks("+9779812345678", text).whatsapp,
			viberUrl: "viber://chat?number=%2B9779812345678",
		});
		assert.deepEqual(props.contact, {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
		assert.equal(props.contactedText, "never contacted");
	});

	test("a tap on the phone number records a call with no message (TAT-100)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);
		const page = async () =>
			(
				await client
					.get(inbox(`/${inquiry.id}`))
					.withInertia()
					.loginAs(owner)
			).inertiaProps;
		assert.equal((await page()).contactedText, "never contacted");

		// What the number on the Details card posts: the channel alone.
		const response = await client
			.post(inbox(`/${inquiry.id}/contacted`))
			.form({ channel: "call" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		response.assertStatus(302);

		const live = await inTenant(tenant, () => Inquiry.findOrFail(inquiry.id));
		assert.equal(live.lastContactChannel, "call");
		assert.isNull(live.lastContactKind);
		const props = await page();
		assert.equal(props.contactedText, "contacted today by phone");
		// The same link the Message card's Call button uses.
		assert.equal(props.contact.callUrl, "tel:+9779812345678");
	});

	test("the page carries the channel of the last contact, which the card leads with (TAT-104)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);
		const lastChannel = async () =>
			(
				await client
					.get(inbox(`/${inquiry.id}`))
					.withInertia()
					.loginAs(owner)
			).inertiaProps.lastChannel;
		const tap = (body: Record<string, string>) =>
			client
				.post(inbox(`/${inquiry.id}/contacted`))
				.form(body)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		// Nobody was contacted yet: the key is there, and null.
		assert.isNull(await lastChannel());

		await tap({ channel: "viber", kind: "inquiry_received" });
		assert.equal(await lastChannel(), "viber");

		// The newest tap wins, whatever it was.
		await tap({ channel: "whatsapp", kind: "inquiry_received" });
		assert.equal(await lastChannel(), "whatsapp");
		await tap({ channel: "call" });
		assert.equal(await lastChannel(), "call");

		// "Mark contacted" names no channel.
		await tap({});
		assert.isNull(await lastChannel());
	});

	test("the inbox shows the last contact; a decided inquiry keeps only the plain links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { fresh, quiet, declined } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			return {
				fresh: await makeInquiry(tenant, customer),
				quiet: await makeInquiry(tenant, customer),
				declined: await makeInquiry(tenant, customer, {
					status: "declined",
					decidedAt: DateTime.utc(),
				}),
			};
		});
		await client
			.post(inbox(`/${fresh.id}/contacted`))
			.form({ channel: "whatsapp", kind: "inquiry_received" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const rows = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps.inquiries;
		const row = (id: string) =>
			rows.find((candidate: { id: string }) => candidate.id === id);
		assert.equal(
			row(fresh.id).contactedText,
			"contacted today on WhatsApp (Inquiry received)",
		);
		assert.isNull(row(quiet.id).contactedText);

		const shown = (
			await client
				.get(inbox(`/${declined.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.isNull(shown.message);
		assert.isNotNull(shown.contact);
	});
});
