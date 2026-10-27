import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import { chatLinks } from "#modules/clients/contact_links";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import { sessionStartText, sessionTimeText } from "#modules/scheduling/times";
import {
	artistMoneyFixture,
	figuresOf,
	newFigures,
} from "#tests/helpers/artist_money";
import { proofFor } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makeDepositLink,
	makeInquiry,
	makePayment,
	makeProject,
	makeQuote,
	makeReferenceImage,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
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
			piece: "A small fine-line moth on the forearm",
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
			props.sessions.map(
				({
					whenText,
					kind,
					status,
					artistName,
				}: {
					whenText: string;
					kind: string;
					status: string;
					artistName: string | null;
				}) => ({ whenText, kind, status, artistName }),
			),
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
		// The Next step card says what the "booked without a session" banner did (TAT-108).
		assert.notProperty(props, "bookedWithoutSession");
		assert.equal(props.notes, "Prefers mornings.");
		assert.equal(props.contactedText, "contacted yesterday");
		assert.equal(props.assignment.artistId, asha.id);
		assert.lengthOf(props.assignment.choices, 2);
		assert.deepInclude(props.assignment.choices, { id: asha.id, name: "Sita" });
	});

	test("a booked project without a tattoo session has it as its next step", async ({
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

		assert.equal(props.nextStep.kind, "book_session");
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

test.group("Project page: session actions (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	type Row = {
		id: string;
		outcomes: string[];
		awaitingBooking: boolean;
		move: { date: string; startTime: string; hours: number } | null;
	};

	test("an owner gets each scheduled session's outcomes and move values, and the form's days", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const now = DateTime.now().startOf("minute");
		const { project, started, later, done } = await inTenant(
			tenant,
			async () => {
				const sita = await makeArtist(tenant);
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "booked",
					artistId: sita.id,
				});
				return {
					project,
					started: await makeSession(tenant, project, sita, {
						startsAt: now.minus({ minutes: 120 }),
						endsAt: now.minus({ minutes: 30 }),
					}),
					later: await makeSession(tenant, project, sita, {
						startsAt: now.plus({ days: 3 }),
						endsAt: now.plus({ days: 3, minutes: 150 }),
					}),
					done: await makeSession(tenant, project, sita, {
						kind: "consultation",
						status: "completed",
						startsAt: now.minus({ days: 3 }),
						endsAt: now.minus({ days: 3 }).plus({ hours: 1 }),
					}),
				};
			},
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;
		const row = (id: string): Row =>
			props.sessions.find((session: Row) => session.id === id);

		const today = todayIn(KTM);
		assert.deepEqual(props.sessionDates, {
			today,
			max: DateTime.fromISO(today, { zone: "utc" })
				.plus({ years: 1 })
				.toFormat("yyyy-MM-dd"),
		});
		assert.deepEqual(row(started.id).outcomes, [
			"completed",
			"no_show",
			"cancelled",
		]);
		assert.isFalse(row(started.id).awaitingBooking);
		// Its date depends on whether two hours ago was still today in Kathmandu.
		const startedMove = row(started.id).move;
		assert.equal(
			startedMove?.startTime,
			started.startsAt.setZone(KTM).toFormat("HH:mm"),
		);
		assert.equal(startedMove?.hours, 1.5);
		assert.deepEqual(row(later.id).outcomes, ["cancelled"]);
		assert.deepEqual(row(later.id).move, {
			date: later.startsAt.setZone(KTM).toFormat("yyyy-MM-dd"),
			startTime: later.startsAt.setZone(KTM).toFormat("HH:mm"),
			hours: 2.5,
		});
		assert.deepEqual(row(done.id).outcomes, []);
		assert.isFalse(row(done.id).awaitingBooking);
		assert.isNull(row(done.id).move);
	});

	test("an artist gets actions only on their own sessions, and Done waits for a booked project", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const now = DateTime.now().startOf("minute");
		const { project, mine, theirs } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			sita.userId = asha.id;
			await sita.save();
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
				artistId: sita.id,
			});
			return {
				project,
				mine: await makeSession(tenant, project, sita, {
					startsAt: now.minus({ minutes: 120 }),
					endsAt: now.minus({ minutes: 60 }),
				}),
				theirs: await makeSession(tenant, project, anu, {
					kind: "consultation",
					startsAt: now.minus({ minutes: 120 }),
					endsAt: now.minus({ minutes: 60 }),
				}),
			};
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		const row = (id: string): Row =>
			props.sessions.find((session: Row) => session.id === id);

		assert.deepEqual(row(mine.id).outcomes, ["no_show", "cancelled"]);
		assert.isTrue(row(mine.id).awaitingBooking);
		assert.isNotNull(row(mine.id).move);
		assert.deepEqual(row(theirs.id).outcomes, []);
		assert.isFalse(row(theirs.id).awaitingBooking);
		assert.isNull(row(theirs.id).move);
	});
});

test.group("Project page: scheduling (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner gets every artist, the project's as the default, and what the deposit still needs", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { project, sita, anu } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, project);
			return { project, sita, anu };
		});

		const { scheduling } = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.sameMembers(
			scheduling.artists.map(({ id }: { id: string }) => id),
			[sita.id, anu.id],
		);
		assert.equal(scheduling.artistId, sita.id);
		assert.isFalse(scheduling.artistFixed);
		assert.equal(
			scheduling.hint,
			"A tattoo session holds the date. The project is booked once the deposit is paid: NPR 3,000 still due.",
		);
	});

	test("the hint follows what the booking rule will do: a settled deposit books, a missing quote does not", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { noQuote, settled } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			const customer = await makeClient(tenant);
			const project = () =>
				makeProject(tenant, customer, {
					status: "deposit_pending",
					artistId: sita.id,
				});
			const settled = await project();
			await makeQuote(tenant, settled, { depositAmount: 0 });
			return { noQuote: await project(), settled };
		});
		const hint = async (id: string) =>
			(await client.get(page(id)).withInertia().loginAs(owner)).inertiaProps
				.scheduling.hint;

		// DepositService.isSettled: a zero deposit is settled, no quote is not.
		assert.equal(
			await hint(settled.id),
			"Scheduling a tattoo session books the project.",
		);
		assert.equal(
			await hint(noQuote.id),
			"A tattoo session holds the date. The project is booked once its deposit is settled.",
		);
	});

	test("an artist schedules only themselves; a finished or closed project offers nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const { booked, finished, closed, sita } = await inTenant(
			tenant,
			async () => {
				const sita = await makeArtist(tenant, "sita");
				sita.userId = asha.id;
				await sita.save();
				await makeArtist(tenant, "anu");
				const customer = await makeClient(tenant);
				const project = (status: "booked" | "completed" | "cancelled") =>
					makeProject(tenant, customer, { status, artistId: sita.id });
				return {
					sita,
					booked: await project("booked"),
					finished: await project("completed"),
					closed: await project("cancelled"),
				};
			},
		);

		const mine = (await client.get(page(booked.id)).withInertia().loginAs(asha))
			.inertiaProps;
		assert.deepEqual(mine.scheduling, {
			artists: [{ id: sita.id, name: "Sita" }],
			artistId: sita.id,
			artistFixed: true,
			kinds: ["tattoo", "consultation", "touch_up"],
			hint: null,
		});

		for (const project of [finished, closed]) {
			const props = (
				await client.get(page(project.id)).withInertia().loginAs(owner)
			).inertiaProps;
			assert.isNull(props.scheduling, project.status);
		}
	});
});

test.group("Project page: Message the client (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project under review offers the received message and the plain links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		const text =
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.";
		assert.deepEqual(props.contact, {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
		assert.deepEqual(props.messages, [
			{
				kind: "inquiry_received",
				label: "Inquiry received",
				text,
				whatsappUrl: chatLinks("+9779812345678", text).whatsapp,
				viberUrl: "viber://chat?number=%2B9779812345678",
			},
		]);
		assert.equal(props.messageKind, "inquiry_received");
	});

	test("a project at work names its next session, and a finished one adds aftercare", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const start = DateTime.now().plus({ days: 3 }).startOf("hour");
		const done = DateTime.now().minus({ days: 2 }).startOf("hour");
		const project = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const project = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Ram Thapa" }),
				{ status: "in_progress", artistId: artist.id },
			);
			await makeSession(tenant, project, artist, {
				status: "completed",
				startsAt: done,
				endsAt: done.plus({ hours: 2 }),
			});
			await makeSession(tenant, project, artist, {
				startsAt: start,
				endsAt: start.plus({ hours: 2 }),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.messages.map(({ kind }: { kind: string }) => kind),
			["booking_confirmation", "session_reminder", "aftercare"],
		);
		assert.equal(props.messageKind, "aftercare");
		const when = sessionTimeText(start, start.plus({ hours: 2 }), KTM);
		assert.equal(
			props.messages[0].text,
			`Hi Ram, your session at Black Needle is booked for ${when} with Sita. Reply here if you need to change it.`,
		);
		assert.match(
			props.messages[2].text,
			/^Hi Ram, thank you for your tattoo at Black Needle!/,
		);
	});

	test("the page carries the channel of the last contact, which the cards lead with (TAT-104)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(
				tenant,
				await makeClient(tenant, { phone: "+9779812345678" }),
				{ status: "quoted" },
			),
		);
		const lastChannel = async () =>
			(await client.get(page(project.id)).withInertia().loginAs(owner))
				.inertiaProps.lastChannel;
		const tap = (body: Record<string, string>) =>
			client
				.post(`${page(project.id)}/contacted`)
				.form(body)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		assert.isNull(await lastChannel());

		await tap({ channel: "viber", kind: "quote" });
		assert.equal(await lastChannel(), "viber");

		await tap({ channel: "copy", kind: "quote" });
		assert.equal(await lastChannel(), "copy");

		await tap({});
		assert.isNull(await lastChannel());
	});

	test("a project made from a contacted inquiry starts with the inquiry's channel (TAT-104)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, { phone: "+9779812345678" }),
			),
		);
		await client
			.post(`/t/black-needle/inbox/${inquiry.id}/contacted`)
			.form({ channel: "viber", kind: "inquiry_received" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		const accepted = await client
			.post(`/t/black-needle/inbox/${inquiry.id}/accept`)
			.form({ artistId: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		accepted.assertStatus(302);
		const projectId = accepted.header("location")?.split("/").pop() ?? "";

		const props = (
			await client.get(page(projectId)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.equal(props.lastChannel, "viber");
	});

	test("without a phone there is nothing to tap", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(
				tenant,
				await makeClient(tenant, { phone: null, anonymizedAt: DateTime.utc() }),
			),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isNull(props.contact);
		assert.deepEqual(props.messages, []);
		assert.isNull(props.messageKind);
	});
});

type Step = {
	kind: string;
	title: string;
	text: string | null;
	primary: string | null;
	secondary: string[];
	anchor: string | null;
	needsYou: boolean;
};

test.group("Project page: the Next step (TAT-108)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const stepFor = async (
		client: ApiClient,
		user: User,
		projectId: string,
	): Promise<Step> => {
		const response = await client
			.get(page(projectId))
			.withInertia()
			.loginAs(user);
		response.assertStatus(200);
		return response.inertiaProps.nextStep;
	};

	/** A studio with its owner and an artist member linked to the profile `asha`. */
	async function studioWithArtist() {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const profile = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return profile;
		});
		return { owner, asha, tenant, profile };
	}

	test("a project under review needs a price from both roles", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant, { name: "सीता थापा" }), {
				status: "reviewing",
				artistId: profile.id,
			}),
		);

		for (const user of [owner, asha]) {
			const step = await stepFor(client, user, project.id);
			assert.equal(step.kind, "send_price");
			assert.equal(step.title, "Send सीता a price");
			assert.equal(step.anchor, "quote-form");
			assert.equal(step.primary, "issue_quote");
			assert.isTrue(step.needsYou);
		}
	});

	test("a quoted project waits for the answer; Send is offered only with a phone", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { withPhone, withoutPhone } = await inTenant(tenant, async () => {
			const make = async (over = {}) => {
				const project = await makeProject(
					tenant,
					await makeClient(tenant, over),
					{ status: "quoted" },
				);
				await makeQuote(tenant, project);
				return project;
			};
			return {
				withPhone: await make(),
				withoutPhone: await make({ phone: null, anonymizedAt: DateTime.utc() }),
			};
		});

		const sent = await stepFor(client, owner, withPhone.id);
		assert.equal(sent.kind, "await_answer");
		assert.equal(sent.primary, "client_accepted");
		assert.sameMembers(sent.secondary, ["send_quote", "revise_quote"]);
		assert.isFalse(sent.needsYou);
		assert.equal(sent.anchor, "quote");

		const noPhone = await stepFor(client, owner, withoutPhone.id);
		assert.equal(noPhone.primary, "client_accepted");
		assert.deepEqual(noPhone.secondary, ["revise_quote"]);
	});

	test("a price that ends in two days is a reminder for the studio", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await makeQuote(tenant, project, {
				expiresAt: expiresAtFor(dayFromNow(2), KTM),
			});
			return project;
		});

		const step = await stepFor(client, owner, project.id);
		assert.equal(step.kind, "price_ending");
		assert.isTrue(step.needsYou);
		assert.equal(step.primary, "send_quote");
		assert.equal(step.anchor, "quote");
	});

	test("an on-hold project is resumed from the card", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "on_hold",
			});
			await makeQuote(tenant, project);
			return project;
		});

		const step = await stepFor(client, owner, project.id);
		assert.equal(step.kind, "on_hold");
		assert.equal(step.primary, "resume");
		assert.isNull(step.anchor);
	});

	test("a project waiting for its deposit: the link first, then the chase; an artist only waits", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const make = async (age: number | null) =>
			inTenant(tenant, async () => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "deposit_pending",
					artistId: profile.id,
				});
				await makeQuote(tenant, project);
				if (age !== null) {
					await makeDepositLink(tenant, project, {
						updatedAt: DateTime.utc().minus({ days: age }),
					});
				}
				return project;
			});
		const none = await make(null);
		const young = await make(1);
		const old = await make(4);

		const noLink = await stepFor(client, owner, none.id);
		assert.equal(noLink.kind, "make_link");
		assert.equal(noLink.anchor, "deposit");
		assert.equal(noLink.primary, "deposit_link");
		assert.equal((await stepFor(client, owner, young.id)).kind, "link_sent");
		const chase = await stepFor(client, owner, old.id);
		assert.equal(chase.kind, "chase_deposit");
		assert.equal(chase.title, "Remind Client about the deposit");

		// An artist learns that the deposit is awaited, nothing about links or money.
		for (const project of [none, young, old]) {
			const step = await stepFor(client, asha, project.id);
			assert.deepEqual(step, {
				kind: "await_deposit",
				title: "Waiting for the deposit",
				text: "An owner records it when it is paid.",
				primary: null,
				secondary: [],
				anchor: null,
				needsYou: false,
			});
		}
	});

	test("a waiting screenshot is the owner's card, on a withdrawn project too; an artist never sees it", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const { open, withdrawn } = await inTenant(tenant, async () => {
			const make = async (status: "deposit_pending" | "cancelled") => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
					artistId: profile.id,
				});
				await makeQuote(tenant, project);
				await proofFor(tenant, project);
				return project;
			};
			return {
				open: await make("deposit_pending"),
				withdrawn: await make("cancelled"),
			};
		});

		const step = await stepFor(client, owner, open.id);
		assert.equal(step.kind, "check_proof");
		assert.equal(step.anchor, "payments");
		assert.equal(step.primary, "verify_proof");
		assert.isTrue(step.needsYou);
		const cancelled = await stepFor(client, owner, withdrawn.id);
		assert.equal(cancelled.kind, "check_proof");
		assert.match(
			cancelled.text ?? "",
			/^The client withdrew while this screenshot/,
		);

		const forArtist = await stepFor(client, asha, open.id);
		assert.equal(forArtist.kind, "await_deposit");
		assert.isNull(forArtist.primary);
	});

	test("a closed project holding a deposit asks for its outcome; an artist sees it closed", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "cancelled",
				artistId: profile.id,
			});
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			return project;
		});

		const step = await stepFor(client, owner, project.id);
		assert.equal(step.kind, "record_outcome");
		assert.equal(step.primary, "record_outcome");
		assert.equal(step.anchor, "payments");
		const forArtist = await stepFor(client, asha, project.id);
		assert.equal(forArtist.kind, "closed");
		assert.equal(forArtist.title, "Cancelled");
		assert.isNull(forArtist.primary);
	});

	test("a booked project: no tattoo session is booked first, then the next one is named", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const start = DateTime.now().plus({ days: 1 }).startOf("hour");
		const { bare, scheduled } = await inTenant(tenant, async () => {
			const make = async () =>
				makeProject(tenant, await makeClient(tenant), {
					status: "booked",
					artistId: profile.id,
				});
			const scheduled = await make();
			await makeSession(tenant, scheduled, profile, {
				startsAt: start,
				endsAt: start.plus({ hours: 2 }),
			});
			return { bare: await make(), scheduled };
		});

		for (const user of [owner, asha]) {
			const step = await stepFor(client, user, bare.id);
			assert.equal(step.kind, "book_session");
			assert.equal(step.anchor, "sessions");
			assert.equal(step.primary, "schedule");
			assert.isTrue(step.needsYou);
			const next = await stepFor(client, user, scheduled.id);
			assert.equal(next.kind, "next_session");
			assert.equal(
				next.title,
				`Next session: ${sessionStartText(start, KTM, DateTime.now())}`,
			);
			assert.equal(next.text, "With Sita.");
			assert.isFalse(next.needsYou);
		}
	});

	test("a session that has started is recorded under Sessions; an artist is not asked about another artist's", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const now = DateTime.now().startOf("minute");
		const { own, others } = await inTenant(tenant, async () => {
			const anu = await makeArtist(tenant, "anu");
			const make = async (by: typeof profile) => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "booked",
					artistId: profile.id,
				});
				await makeSession(tenant, project, by, {
					startsAt: now.minus({ hours: 1 }),
					endsAt: now.plus({ hours: 1 }),
				});
				return project;
			};
			return { own: await make(profile), others: await make(anu) };
		});

		const step = await stepFor(client, owner, own.id);
		assert.equal(step.kind, "record_session");
		assert.equal(step.primary, "open_sessions");
		assert.isNull(step.anchor);
		assert.include(step.text ?? "", "with Sita has started");
		assert.equal((await stepFor(client, asha, own.id)).kind, "record_session");
		assert.equal(
			(await stepFor(client, owner, others.id)).kind,
			"record_session",
		);
		// Not theirs to record: nothing for them to do here.
		assert.equal((await stepFor(client, asha, others.id)).kind, "nothing");
	});

	test("in progress: the owner finishes, the artist schedules the next session", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), {
				status: "in_progress",
				artistId: profile.id,
			}),
		);

		const mine = await stepFor(client, owner, project.id);
		assert.equal(mine.kind, "finish");
		assert.equal(mine.primary, "finish");
		const theirs = await stepFor(client, asha, project.id);
		assert.equal(theirs.kind, "more_sessions");
		assert.equal(theirs.primary, "schedule");
	});

	test("a healing check offers the balance only with a fixed price still owed", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const { priced, priceless } = await inTenant(tenant, async () => {
			const make = async (quoted: boolean) => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "healing_check",
					artistId: profile.id,
				});
				if (quoted) await makeQuote(tenant, project);
				return project;
			};
			return { priced: await make(true), priceless: await make(false) };
		});

		const owing = await stepFor(client, owner, priced.id);
		assert.equal(owing.kind, "healing_check");
		assert.equal(owing.primary, "finish");
		assert.include(owing.secondary, "record_payment");
		const none = await stepFor(client, owner, priceless.id);
		assert.equal(none.kind, "healing_check");
		assert.notInclude(none.secondary, "record_payment");
		// The assigned artist sees the check, and no money.
		const forArtist = await stepFor(client, asha, priced.id);
		assert.equal(forArtist.kind, "healing_check");
		assert.notInclude(forArtist.secondary, "record_payment");
	});

	test("a completed project: the balance owed is the card; paid in full is closed; an artist sees closed", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, profile } = await studioWithArtist();
		const verified = (amount: number) => ({
			amount,
			status: "verified" as const,
			verifiedAt: DateTime.utc(),
			verifiedByUserId: owner.id,
		});
		const { owing, paid } = await inTenant(tenant, async () => {
			const make = async (paidAmount: number) => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "completed",
					artistId: profile.id,
				});
				await makeQuote(tenant, project);
				await makePayment(tenant, project, verified(paidAmount));
				return project;
			};
			return { owing: await make(300_000), paid: await make(1_500_000) };
		});

		const step = await stepFor(client, owner, owing.id);
		assert.equal(step.kind, "collect_balance");
		assert.equal(step.title, "NPR 12,000 still due");
		assert.equal(step.anchor, "payments");
		assert.equal(step.primary, "record_payment");
		const done = await stepFor(client, owner, paid.id);
		assert.equal(done.kind, "closed");
		assert.equal(done.title, "Completed");
		const forArtist = await stepFor(client, asha, owing.id);
		assert.equal(forArtist.kind, "closed");
		assert.isNull(forArtist.primary);
	});

	test("a declined project is closed", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "declined" }),
		);

		const step = await stepFor(client, owner, project.id);
		assert.equal(step.kind, "closed");
		assert.equal(step.title, "Declined");
		assert.isNull(step.primary);
	});

	test("an expired quote the sweep will cancel says the price has ended", async ({
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

		const step = await stepFor(client, owner, project.id);
		assert.equal(step.kind, "price_ended");
		assert.equal(step.primary, "revise_quote");
		assert.isFalse(step.needsYou);
	});
});

test.group("Project page: queries (TAT-108)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the page costs the same number of queries with one and with three of everything", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const { profile, forOwner, forArtist } = await inTenant(
			tenant,
			async () => {
				const profile = await makeArtist(tenant, "asha");
				profile.userId = asha.id;
				await profile.save();
				const make = async (status: "deposit_pending" | "booked") => {
					const customer = await makeClient(tenant);
					const inquiry = await makeInquiry(tenant, customer, {
						status: "accepted",
						decidedAt: DateTime.utc(),
					});
					return makeProject(tenant, customer, {
						status,
						inquiryId: inquiry.id,
						artistId: profile.id,
					});
				};
				return {
					profile,
					forOwner: await make("deposit_pending"),
					forArtist: await make("booked"),
				};
			},
		);

		/** Adds the `at`th session, payment, reference and quote version to both projects. */
		const grow = (at: number) =>
			inTenant(tenant, async () => {
				for (const project of [forOwner, forArtist]) {
					const day = DateTime.utc(
						2026,
						11,
						2 + at * 2 + (project === forOwner ? 0 : 1),
						10,
					);
					await makeSession(tenant, project, profile, {
						startsAt: day,
						endsAt: day.plus({ hours: 2 }),
					});
					await makeQuote(tenant, project, { version: at });
					await makeReferenceImage(tenant, {
						inquiryId: project.inquiryId ?? undefined,
						projectId: project.id,
						position: at,
					});
				}
				await proofFor(tenant, forOwner);
				await makePayment(tenant, forArtist, {
					status: "verified",
					verifiedAt: DateTime.utc(),
					verifiedByUserId: owner.id,
				});
			});
		const count = async (user: User, projectId: string) => {
			const { result, queries } = await recordQueries(() =>
				client.get(page(projectId)).withInertia().loginAs(user),
			);
			result.assertStatus(200);
			return queries.length;
		};
		const views: [string, User, string][] = [
			["owner", owner, forOwner.id],
			["artist", asha, forArtist.id],
		];

		await grow(1);
		const few = new Map<string, number>();
		for (const [who, user, id] of views) {
			await count(user, id); // warm up
			few.set(who, await count(user, id));
		}
		await grow(2);
		await grow(3);
		for (const [who, user, id] of views) {
			assert.equal(await count(user, id), few.get(who), who);
		}
	});
});

/**
 * Every money figure main (9ac7621) sent the assigned artist for `artistMoneyFixture()`: captured by
 * running the same fixture against main's project page (the "dump" spec in the report). docs/
 * requirements.md:87 gives an artist their projects' payments and balance, read-only (TAT-30), and
 * nothing more.
 */
const MAIN_ARTIST_FIGURES = [
	0, 1, 2, 4.5, 123, 555, 666, 777.3, 911.5, 1234.56, 2011.86, 2088.5, 2334,
	2500, 2877, 3000, 10623, 12500, 12988.14, 13500, 14088.5, 15000,
];

test.group(
	"Project page: what an artist is sent is what main sent them (TAT-108 fix round 2)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("the comparator names a figure the artist was never sent", ({
			assert,
		}) => {
			assert.deepEqual(
				figuresOf({ a: "Paid NPR 1,234.56 of NPR 15,000", b: 77.5 }),
				[77.5, 1234.56, 15000],
			);
			assert.deepEqual(
				newFigures({ line: "Paid NPR 999" }, MAIN_ARTIST_FIGURES),
				[999],
			);
			assert.deepEqual(
				newFigures({ line: "Paid NPR 2,011.86" }, MAIN_ARTIST_FIGURES),
				[],
			);
		});

		test("an artist's payload holds exactly the money figures main's did: nothing new, nothing lost", async ({
			client,
			assert,
		}) => {
			const { asha, projects } = await artistMoneyFixture();
			const seen = new Set<number>();
			for (const [name, project] of Object.entries(projects)) {
				const response = await client
					.get(page(project.id))
					.withInertia()
					.loginAs(asha);
				response.assertStatus(200);
				// Anything the branch adds (the summary line, the header, the Next step's words) may only
				// repeat a figure the artist already had.
				assert.deepEqual(
					newFigures(response.inertiaProps, MAIN_ARTIST_FIGURES),
					[],
					name,
				);
				for (const figure of figuresOf(response.inertiaProps)) seen.add(figure);
			}
			assert.deepEqual(
				[...seen].sort((a, b) => a - b),
				MAIN_ARTIST_FIGURES,
			);
		});

		test("the artist's money is read-only: no screenshot, no deposit link, no control", async ({
			client,
			assert,
		}) => {
			const { asha, projects } = await artistMoneyFixture();
			for (const [name, project] of Object.entries(projects)) {
				const props = (
					await client.get(page(project.id)).withInertia().loginAs(asha)
				).inertiaProps;
				const card = props.payments;
				assert.isNotNull(card, `${name}: the artist has the card`);
				assert.deepEqual(card.pending, [], `${name}: no screenshot to check`);
				assert.isNull(card.actions, `${name}: no payment or refund form`);
				assert.isNull(card.outcome.needed, `${name}: no outcome form`);
				for (const row of card.rows) {
					assert.isNull(row.proofUrl, `${name}: no screenshot link`);
					assert.isFalse(row.canReverse, `${name}: no Reverse`);
				}
				assert.isNull(props.deposit, `${name}: no deposit link or panel`);
				assert.isNull(
					props.finish?.action ?? null,
					`${name}: no finish action`,
				);
				assert.notInclude(
					JSON.stringify(props),
					"signature=",
					`${name}: no signed URL`,
				);
			}
		});

		test("the summary line and the ledger are the artist's too, the same as the owner's", async ({
			client,
			assert,
		}) => {
			const { owner, asha, projects } = await artistMoneyFixture();
			const read = async (user: User) =>
				(await client.get(page(projects.booked.id)).withInertia().loginAs(user))
					.inertiaProps.payments;

			const mine = await read(asha);
			const theirs = await read(owner);
			assert.equal(
				mine.summary,
				"Paid NPR 2,011.86 of NPR 15,000 · Balance NPR 12,988.14",
			);
			assert.equal(mine.summary, theirs.summary);
			assert.deepEqual(mine.balance, theirs.balance);
			assert.lengthOf(mine.rows, 2);
		});

		test("the schedule hint and the withdraw confirm name the deposit, as main's did", async ({
			client,
			assert,
		}) => {
			const { asha, projects } = await artistMoneyFixture();
			const props = (
				await client.get(page(projects.waiting.id)).withInertia().loginAs(asha)
			).inertiaProps;

			assert.equal(
				props.scheduling.hint,
				"A tattoo session holds the date. The project is booked once the deposit is paid: NPR 2,088.50 still due.",
			);
			assert.equal(props.depositHeldText, "NPR 911.50");
		});
	},
);
