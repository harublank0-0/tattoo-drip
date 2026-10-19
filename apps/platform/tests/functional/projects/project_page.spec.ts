import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
	makeQuote,
	makeReferenceImage,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const KTM = "Asia/Kathmandu";

/** A last valid day `days` from today in Kathmandu (the test studio's zone). */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

const page = (projectId: string) => `/t/black-needle/projects/${projectId}`;

test.group("Project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the project, its current quote, history and message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const lastDay = dayFromNow(10);
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant, {
				name: "Sita Rai",
				phone: "+9779812345678",
			});
			const project = await makeProject(tenant, customer, { status: "quoted" });
			await makeQuote(tenant, project, {
				version: 1,
				fixedPrice: 1_200_000,
				depositAmount: 200_000,
			});
			await makeQuote(tenant, project, {
				version: 2,
				expiresAt: expiresAtFor(lastDay, KTM),
			});
			return project;
		});

		const response = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("projects/show");
		const props = response.inertiaProps;
		assert.deepEqual(props.project, {
			id: project.id,
			status: "quoted",
			brief: "A small fine-line moth on the forearm",
			clientName: "Sita Rai",
			artistName: null,
		});
		assert.deepInclude(props.quote, {
			version: 2,
			kind: "fixed",
			priceText: "NPR 15,000",
			totalText: "NPR 15,000",
			depositText: "NPR 3,000",
			validUntil: lastDay,
			expired: false,
			fixedPrice: 15_000,
			hourlyRate: null,
			estimatedHours: null,
			depositAmount: 3_000,
		});
		assert.deepEqual(
			props.history.map(({ version }: { version: number }) => version),
			[1],
		);
		assert.isTrue(props.canQuote);
		assert.isTrue(props.canAccept);
		assert.match(
			props.message.whatsappUrl,
			/^https:\/\/wa\.me\/9779812345678\?text=Hi%20Sita%2C%20here%20is%20your%20quote%20from%20Black%20Needle/,
		);
		assert.equal(
			props.message.viberUrl,
			"viber://chat?number=%2B9779812345678",
		);
		assert.deepEqual(props.form, {
			depositPercent: null,
			defaultValidUntil: dayFromNow(14),
			minDate: todayIn(KTM),
			maxDate: DateTime.fromISO(todayIn(KTM))
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
		});
	});

	test("an expired quote can be revised but not accepted or sent", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isTrue(props.quote.expired);
		assert.isFalse(props.canAccept);
		assert.isNull(props.message);
		assert.isTrue(props.canQuote);
	});

	test("a client without a phone gets no chat links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, customer, { status: "quoted" });
			await makeQuote(tenant, project);
			return project;
		});

		const response = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		assert.isNull(response.inertiaProps.message);
		assert.isTrue(response.inertiaProps.canAccept);
	});

	test("a project with no quote, and a booked one that can't be re-quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { fresh, booked } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const fresh = await makeProject(tenant, customer);
			const booked = await makeProject(tenant, customer, { status: "booked" });
			await makeQuote(tenant, booked);
			return { fresh, booked };
		});

		const first = (
			await client.get(page(fresh.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isNull(first.quote);
		assert.deepEqual(first.history, []);
		assert.isTrue(first.canQuote);
		assert.isFalse(first.canAccept);
		assert.isFalse(first.canSetPrice);

		const later = (
			await client.get(page(booked.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isFalse(later.canQuote);
		assert.isFalse(later.canAccept);
		assert.isFalse(later.canSetPrice);

		// A booked project with no quote can get its price once (TAT-66).
		const priceless = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);
		const pricelessProps = (
			await client.get(page(priceless.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isTrue(pricelessProps.canSetPrice);
	});

	test("the assigned artist sees the page; another artist gets a 404", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
			});
		});

		const own = await client.get(page(project.id)).withInertia().loginAs(asha);
		own.assertStatus(200);
		assert.equal(own.inertiaProps.project.artistName, "Sita");

		const other = await client.get(page(project.id)).withInertia().loginAs(ram);
		other.assertStatus(404);
	});

	test("the page lists the project's sessions with their time, kind and artist", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			// 10:00 UTC on 2 Nov is 15:45 in Kathmandu.
			await makeSession(tenant, project, sita);
			await makeSession(tenant, project, sita, {
				kind: "touch_up",
				status: "cancelled",
				startsAt: DateTime.utc(2026, 12, 1, 4, 15),
				endsAt: DateTime.utc(2026, 12, 1, 5, 15),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.sessions.map(({ id: _id, ...rest }: { id: string }) => rest),
			[
				{
					whenText: "Mon 2 Nov 2026, 15:45–17:45",
					kind: "tattoo",
					status: "scheduled",
					artistName: "Sita",
				},
				{
					whenText: "Tue 1 Dec 2026, 10:00–11:00",
					kind: "touch_up",
					status: "cancelled",
					artistName: "Sita",
				},
			],
		);
	});

	test("the quote's expiry shows until the project is booked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const expected = {
			quoted: true,
			cancelled: true,
			booked: false,
			in_progress: false,
		} as const;
		const projects = await inTenant(tenant, async () => {
			const made: Record<string, string> = {};
			for (const status of Object.keys(expected) as (keyof typeof expected)[]) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				await makeQuote(tenant, project);
				made[status] = project.id;
			}
			return made;
		});

		for (const [status, shown] of Object.entries(expected)) {
			const props = (
				await client.get(page(projects[status])).withInertia().loginAs(owner)
			).inertiaProps;
			assert.equal(props.quoteExpiryShown, shown, status);
			assert.deepEqual(props.sessions, [], status);
		}
	});
});

test.group("Project page: lifecycle props", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner gets the moves, notes, contact text and artist choices", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { project, asha } = await inTenant(tenant, async () => {
			const asha = await makeArtist(tenant, "asha");
			await makeArtist(tenant, "bina");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
				artistId: asha.id,
				notes: "Prefers mornings.",
				lastContactedAt: DateTime.now().minus({ days: 1 }),
			});
			await makeSession(tenant, project, asha, { kind: "consultation" });
			return { project, asha };
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(props.moves, ["hold", "withdraw"]);
		assert.equal(props.scheduledSessionCount, 1);
		assert.isFalse(props.bookedWithoutSession);
		assert.equal(props.notes, "Prefers mornings.");
		assert.equal(props.contactedText, "contacted yesterday");
		assert.equal(props.assignment.artistId, asha.id);
		assert.lengthOf(props.assignment.choices, 2);
		assert.deepInclude(props.assignment.choices, { id: asha.id, name: "Sita" });
	});

	test("a booked project without a tattoo session carries the warning", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isTrue(props.bookedWithoutSession);
		// A client can still withdraw from a booked project (TAT-66).
		assert.deepEqual(props.moves, ["withdraw"]);
		assert.equal(props.contactedText, "never contacted");
	});

	test("an artist sees the moves but gets no artist choices", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				status: "reviewing",
				artistId: profile.id,
			});
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;

		assert.deepEqual(props.moves, ["decline", "withdraw"]);
		assert.isNull(props.assignment);
	});
});

test.group("Project page: message and withdraw guards", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A project in `status` with a live quote, for a client with a phone. */
	async function withLiveQuote(
		tenant: { id: string },
		status: "quoted" | "on_hold" | "deposit_pending" | "cancelled",
	) {
		return inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status,
			});
			await makeQuote(tenant, project);
			return project;
		});
	}

	test("only a quoted or on-hold project offers the quote message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const offered = async (
			status: "quoted" | "on_hold" | "deposit_pending" | "cancelled",
		) => {
			const project = await withLiveQuote(tenant, status);
			const props = (
				await client.get(page(project.id)).withInertia().loginAs(owner)
			).inertiaProps;
			return props.message !== null;
		};

		assert.isTrue(await offered("quoted"));
		assert.isTrue(await offered("on_hold"));
		// Accepted, or withdrawn with the quote still valid: nothing to resend.
		assert.isFalse(await offered("deposit_pending"));
		assert.isFalse(await offered("cancelled"));
	});

	test("withdrawing stays offered, and the page names the deposit it holds", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const paid = await withLiveQuote(tenant, "deposit_pending");
		await inTenant(tenant, () =>
			makePayment(tenant, paid, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);
		const unpaid = await withLiveQuote(tenant, "deposit_pending");

		const heldProps = (
			await client.get(page(paid.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(heldProps.moves, ["withdraw"]);
		assert.equal(heldProps.depositHeldText, "NPR 3,000");
		assert.notProperty(heldProps, "withdrawBlocked");

		const freeProps = (
			await client.get(page(unpaid.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepEqual(freeProps.moves, ["withdraw"]);
		assert.isNull(freeProps.depositHeldText);
	});
});

test.group("Project page: the original request", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project from an inquiry shows the request and its references", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc(),
				budget: "NPR 20,000",
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: inquiry.id,
			});
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepInclude(props.request, {
			placement: "Forearm",
			approximateSize: "8 cm",
			preferredDates: "Any weekday in November",
			budget: "NPR 20,000",
			source: "instagram",
		});
		assert.lengthOf(props.request.references, 1);
		assert.include(props.request.references[0].url, "reference_image/");
	});

	test("a project made directly has no request", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant)),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.isNull(props.request);
	});

	test("the assigned artist sees the request and references too", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, customer, {
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const project = await makeProject(tenant, customer, {
				inquiryId: inquiry.id,
				artistId: profile.id,
			});
			await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				projectId: project.id,
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		assert.lengthOf(props.request.references, 1);
	});
});

test.group("Project page: the client link", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the client's id; the assigned artist gets null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const { project, customer } = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant);
			const project = await makeProject(tenant, customer, {
				artistId: profile.id,
			});
			return { project, customer };
		});

		const ownerProps = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.clientId, customer.id);

		const artistProps = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		assert.isNull(artistProps.clientId);
	});
});
