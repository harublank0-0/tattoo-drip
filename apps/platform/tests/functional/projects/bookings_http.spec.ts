import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import Client from "#modules/clients/models/client";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import ProjectSession from "#modules/scheduling/models/project_session";
import { sessionTimeText } from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
	pipelineCounts,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const KTM = "Asia/Kathmandu";
const bookUrl = "/t/black-needle/projects";
const newUrl = (phone?: string) =>
	phone === undefined
		? "/t/black-needle/projects/new"
		: `/t/black-needle/projects/new?phone=${encodeURIComponent(phone)}`;
const projectUrl = (id: string) => `/t/black-needle/projects/${id}`;

/** yyyy-MM-dd `days` from today in Kathmandu (the test studios' zone). */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on `day` in Kathmandu. */
const at = (day: string, time = "14:00") =>
	DateTime.fromISO(`${day}T${time}`, { zone: KTM });

/** A booking form for a new client, Maya, as the browser sends it. */
const newClientForm = (
	artistId: string,
	over: Record<string, string> = {},
) => ({
	phone: "+9779812345678",
	name: "Maya Gurung",
	email: "",
	artistId,
	date: dayFromNow(3),
	startTime: "14:00",
	hours: "3",
	brief: "A small rose on the left wrist",
	priceKind: "none",
	...over,
});

const countsIn = (tenant: { id: string }) =>
	inTenant(tenant, () => pipelineCounts(tenant));

/** An artist member with a live profile ("Asha") linked to their account. */
async function linkedArtist(tenant: Tenant, slug = "asha") {
	const user = await artistIn(tenant, `${slug}@example.com`);
	const profile = await inTenant(tenant, () =>
		Artist.create({ tenantId: tenant.id, name: "Asha", slug, userId: user.id }),
	);
	return { user, profile };
}

test.group("Booking page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner starts at the lookup with the studio's artists", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Ram", slug: "ram" });
			await makeArtist(tenant);
		});

		const response = await client.get(newUrl()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/new");
		const props = response.inertiaProps;
		assert.isNull(props.lookup);
		assert.deepEqual(
			props.artists.map(({ name }: { name: string }) => name),
			["Ram", "Sita"],
		);
		assert.isTrue(props.isOwner);
		assert.deepEqual(props.dates, {
			today: dayFromNow(0),
			max: DateTime.fromISO(dayFromNow(0))
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
		});
	});

	test("a number is looked up in this studio only, however it is typed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		// The lookup is part of the booking form, so it needs an artist to book.
		await inTenant(tenant, () => makeArtist(tenant));
		const maya = await inTenant(tenant, () =>
			makeClient(tenant, {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
			}),
		);
		await inTenant(other, () =>
			makeClient(other, { name: "Elsewhere", phone: "+9779841111111" }),
		);
		const lookup = async (typed: string) =>
			(await client.get(newUrl(typed)).withInertia().loginAs(owner))
				.inertiaProps.lookup;

		for (const typed of ["9812345678", "981-234-5678", "+977 981 234 5678"]) {
			assert.deepEqual(
				await lookup(typed),
				{
					state: "found",
					phone: "+9779812345678",
					client: { id: maya.id, name: "Maya Gurung" },
				},
				typed,
			);
		}
		// Another studio's client: nobody here has the number.
		assert.deepEqual(await lookup("9841111111"), {
			state: "new",
			phone: "+9779841111111",
		});
		assert.deepEqual(await lookup("12ab"), {
			state: "invalid",
			typed: "12ab",
			message: "Enter a phone number, like 9812345678 or +977 1 4123456.",
		});
		assert.isNull(await lookup("   "));
	});

	test("an artist gets only their own profile; without one, none", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => makeArtist(tenant));
		const { user, profile } = await linkedArtist(tenant);
		const stranger = await artistIn(tenant, "ram@example.com");

		const own = (await client.get(newUrl()).withInertia().loginAs(user))
			.inertiaProps;
		assert.deepEqual(own.artists, [{ id: profile.id, name: "Asha" }]);
		assert.isFalse(own.isOwner);

		const none = (await client.get(newUrl()).withInertia().loginAs(stranger))
			.inertiaProps;
		assert.deepEqual(none.artists, []);
	});

	test("an artist's lookup shows the client's name only; owners are told apart by isOwner", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const maya = await inTenant(tenant, () =>
			makeClient(tenant, {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
				notes: "Allergic to latex",
			}),
		);
		const { user } = await linkedArtist(tenant);
		const found = {
			state: "found",
			phone: "+9779812345678",
			client: { id: maya.id, name: "Maya Gurung" },
		};

		// Nothing but the id (for the form) and the name: no email, no notes.
		const asArtist = (
			await client.get(newUrl("9812345678")).withInertia().loginAs(user)
		).inertiaProps;
		assert.deepEqual(asArtist.lookup, found);
		assert.isFalse(asArtist.isOwner);
		assert.notInclude(JSON.stringify(asArtist), "maya@example.com");
		assert.notInclude(JSON.stringify(asArtist), "latex");

		// Owners get the same lookup; isOwner is what shows them "View client".
		const asOwner = (
			await client.get(newUrl("9812345678")).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(asOwner.lookup, found);
		assert.isTrue(asOwner.isOwner);
	});

	test("an artist without a profile cannot look a number up", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () =>
			makeClient(tenant, { name: "Maya Gurung", phone: "+9779812345678" }),
		);
		const stranger = await artistIn(tenant, "ram@example.com");

		const props = (
			await client.get(newUrl("9812345678")).withInertia().loginAs(stranger)
		).inertiaProps;

		// They see the "not linked" card, and the client's id and name stay home.
		assert.deepEqual(props.artists, []);
		assert.isNull(props.lookup);
		assert.notInclude(JSON.stringify(props), "Maya");
	});
});

test.group("Booking a session", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner books a new client: a booked project with its session, no quote", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeArtist(tenant));
		const day = dayFromNow(3);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(sita.id, { date: day, email: "maya@example.com" }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const saved = await inTenant(tenant, async () => {
			const maya = await Client.query()
				.where("tenant_id", tenant.id)
				.where("phone", "+9779812345678")
				.firstOrFail();
			const project = await TattooProject.query()
				.where("client_id", maya.id)
				.firstOrFail();
			return {
				maya,
				project,
				sessions: await ProjectSession.query().where("project_id", project.id),
				quotes: await Quote.query().where("project_id", project.id),
			};
		});
		response.assertHeader("location", projectUrl(saved.project.id));
		response.assertFlashMessage(
			"success",
			`Session booked: Maya Gurung with Sita, ${sessionTimeText(at(day), at(day).plus({ hours: 3 }), KTM)}.`,
		);
		assert.include(saved.maya.serialize(), {
			name: "Maya Gurung",
			email: "maya@example.com",
			notes: null,
		});
		assert.include(saved.project.serialize(), {
			status: "booked",
			artistId: sita.id,
			inquiryId: null,
			brief: "A small rose on the left wrist",
		});
		assert.lengthOf(saved.sessions, 1);
		assert.include(saved.sessions[0].serialize(), {
			kind: "tattoo",
			status: "scheduled",
			artistId: sita.id,
		});
		assert.equal(saved.sessions[0].startsAt.toMillis(), at(day).toMillis());
		assert.equal(
			saved.sessions[0].endsAt.toMillis(),
			at(day).plus({ hours: 3 }).toMillis(),
		);
		assert.lengthOf(saved.quotes, 0);
	});

	test("a returning client is booked as they are, with a fixed price", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { sita, maya } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			maya: await makeClient(tenant, {
				name: "Maya Gurung",
				email: "old@example.com",
				notes: "Allergic to latex",
			}),
		}));
		const before = await inTenant(tenant, async () =>
			(await Client.findOrFail(maya.id)).serialize(),
		);
		const day = dayFromNow(5);

		const response = await client
			.post(bookUrl)
			.form({
				clientId: maya.id,
				artistId: sita.id,
				date: day,
				startTime: "10:30",
				hours: "2.5",
				brief: "Flash: a swallow",
				priceKind: "fixed",
				fixedPrice: "8000",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			`Session booked: Maya Gurung with Sita, ${sessionTimeText(at(day, "10:30"), at(day, "10:30").plus({ minutes: 150 }), KTM)}.`,
		);
		await inTenant(tenant, async () => {
			assert.deepEqual((await Client.findOrFail(maya.id)).serialize(), before);
			const project = await TattooProject.query()
				.where("client_id", maya.id)
				.firstOrFail();
			const quotes = await Quote.query().where("project_id", project.id);
			assert.lengthOf(quotes, 1);
			assert.include(quotes[0].serialize(), {
				version: 1,
				kind: "fixed",
				fixedPrice: 800_000,
				depositAmount: 0,
			});
			assert.equal(
				quotes[0].expiresAt.toMillis(),
				expiresAtFor(day, KTM).toMillis(),
			);
		});
	});

	test("an artist books themselves and can open the project", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { user, profile } = await linkedArtist(tenant);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(profile.id))
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		const location = response.headers().location;
		assert.match(location, /^\/t\/black-needle\/projects\/[0-9a-f-]{36}$/);
		const page = await client.get(location).withInertia().loginAs(user);
		page.assertStatus(200);
		assert.equal(page.inertiaProps.project.artistName, "Asha");
	});

	test("the form's own mistakes come back as field errors and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, () => makeArtist(tenant));
		const before = await countsIn(tenant);

		for (const [over, field, message] of [
			[{ name: "" }, "name", "Enter the client's name."],
			[{ phone: "", name: "" }, "phone", "Look the client's phone up first."],
			[
				{ date: dayFromNow(-1) },
				"date",
				"Pick a date from today to a year from now.",
			],
			[
				{ hours: "2.1" },
				"hours",
				"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
			],
			[{ brief: "" }, "brief", "Describe the tattoo."],
			[{ priceKind: "fixed" }, "fixedPrice", "Enter the price."],
		] as const) {
			const response = await client
				.post(bookUrl)
				.form(newClientForm(sita.id, over))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(response, field, message);
		}
		assert.deepEqual(await countsIn(tenant), before);
	});

	test("another studio's client id is a 404 and changes neither studio", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const { sita, mine } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			mine: await makeClient(tenant),
		}));
		const theirs = await inTenant(other, () => makeClient(other));
		const form = (clientId: string, day: string) => ({
			clientId,
			artistId: sita.id,
			date: day,
			startTime: "14:00",
			hours: "2",
			brief: "A rose",
			priceKind: "none",
		});

		// The control: the same form with this studio's client books.
		const own = await client
			.post(bookUrl)
			.form(form(mine.id, dayFromNow(3)))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		own.assertStatus(302);

		const before = await countsIn(tenant);
		const otherBefore = await countsIn(other);
		const response = await client
			.post(bookUrl)
			.form(form(theirs.id, dayFromNow(4)))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		response.assertStatus(404);
		assert.deepEqual(await countsIn(tenant), before);
		assert.deepEqual(await countsIn(other), otherBefore);
	});
});

test.group("Refused bookings", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a busy artist: the start time gets the error and nothing is saved, the second of two identical forms included", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const day = dayFromNow(4);
		const sita = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const busy = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			await makeSession(tenant, busy, sita, {
				startsAt: at(day, "15:00"),
				endsAt: at(day, "18:00"),
			});
			return sita;
		});
		const send = (over: Record<string, string>) =>
			client
				.post(bookUrl)
				.form(newClientForm(sita.id, { date: day, ...over }))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
		const before = await countsIn(tenant);

		// 14:00 to 16:00 runs into the 15:00 session.
		const busy = await send({ startTime: "14:00", hours: "2" });
		assertValidationError(
			busy,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		assert.deepEqual(await countsIn(tenant), before);

		// The same free slot sent twice (a double tap): one booking only.
		const first = await send({ startTime: "10:00", hours: "2" });
		first.assertStatus(302);
		// Another new client, with a number nextPhone() never makes.
		const twice = await send({
			startTime: "10:00",
			hours: "2",
			phone: "+9779851234567",
			name: "Someone Else",
		});
		assertValidationError(
			twice,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		const after = await countsIn(tenant);
		assert.equal(after.projects, before.projects + 1);
		assert.equal(after.clients, before.clients + 1);
	});

	test("a number added meanwhile: the phone error names its client", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const sita = await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779812345678" });
			return makeArtist(tenant);
		});
		const before = await countsIn(tenant);

		const response = await client
			.post(bookUrl)
			.form(newClientForm(sita.id))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"phone",
			"This number now belongs to Ram Thapa. Check the client and book again.",
		);
		assert.deepEqual(await countsIn(tenant), before);
	});

	test("an artist can't book someone else; an owner can't book a deleted or another studio's artist", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const { user } = await linkedArtist(tenant);
		const { sita, gone } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			return { sita, gone };
		});
		const elsewhere = await inTenant(other, () => makeArtist(other));
		const before = await countsIn(tenant);
		const otherBefore = await countsIn(other);

		for (const [actor, artistId] of [
			[user, sita.id],
			[owner, gone.id],
			[owner, elsewhere.id],
		] as const) {
			const response = await client
				.post(bookUrl)
				.form(newClientForm(artistId))
				.withCsrfToken()
				.loginAs(actor)
				.redirects(0);
			assertValidationError(
				response,
				"artistId",
				"Choose an artist from the list.",
			);
		}
		assert.deepEqual(await countsIn(tenant), before);
		assert.deepEqual(await countsIn(other), otherBefore);
	});

	test("a client whose details were deleted goes back to the lookup", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { sita, anonymous } = await inTenant(tenant, async () => ({
			sita: await makeArtist(tenant),
			anonymous: await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.now(),
			}),
		}));
		const before = await countsIn(tenant);

		const response = await client
			.post(bookUrl)
			.form({
				clientId: anonymous.id,
				artistId: sita.id,
				date: dayFromNow(3),
				startTime: "14:00",
				hours: "2",
				brief: "A rose",
				priceKind: "none",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", newUrl());
		response.assertFlashMessage(
			"error",
			"This client's details were deleted. Look the number up again.",
		);
		assert.deepEqual(await countsIn(tenant), before);
	});
});
