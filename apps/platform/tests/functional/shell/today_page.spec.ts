import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { todayIn } from "#modules/projects/quotes";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { proofFor } from "#tests/helpers/payments";
import {
	makeClient,
	makeDepositLink,
	makeInquiry,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import {
	artistIn,
	inTenant,
	studioWithOwner,
	twoStudios,
} from "#tests/helpers/tenants";
import {
	KTM,
	SITA_THAPA,
	seedGroups,
	studio,
} from "#tests/helpers/waiting_fixtures";

const page = (slug: string) => `/t/${slug}/today`;

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];

/** The props of Today for `user`. */
async function propsOf(client: ApiClient, slug: string, user: Who) {
	const response = await client.get(page(slug)).withInertia().loginAs(user);
	response.assertStatus(200);
	response.assertInertiaComponent("today/index");
	return response.inertiaProps;
}

type Group = {
	key: string;
	count: number;
	rows: {
		id: string;
		name: string;
		detail: string;
		meta: string | null;
		target: { route: string; id: string; hash: string | null };
	}[];
	more: { route: string; waiting: string | null } | null;
};
const groupsOf = (props: { needsYou?: unknown }) => props.needsYou as Group[];
const keysOf = (props: { needsYou?: unknown }) =>
	groupsOf(props).map(({ key }) => key);
const groupOf = (props: { needsYou?: unknown }, key: string) =>
	groupsOf(props).find((group) => group.key === key);

const idsIn = (props: unknown) => JSON.stringify(props);

test.group("Today", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner's Today groups what needs them, with counts, and each row opens its card", async ({
		client,
		assert,
	}) => {
		const s = await studio();
		const made = await inTenant(s.tenant, () =>
			seedGroups(s.tenant, s.sitaProfile.id),
		);

		const props = await propsOf(client, "today-107", s.owner);

		assert.deepEqual(keysOf(props), [
			"proofs",
			"requests",
			"prices",
			"ending",
			"deposits",
			"sessions",
		]);
		for (const group of props.needsYou as Group[]) {
			assert.equal(group.count, 1, group.key);
			assert.lengthOf(group.rows, 1, group.key);
			assert.isNull(group.more, group.key);
		}
		const row = (key: string) => (groupOf(props, key) as Group).rows[0];
		const projectTarget = (id: string, hash: string | null) => ({
			route: "tenant.projects.show",
			id,
			hash,
		});

		assert.deepEqual(row("proofs"), {
			id: made.proof[0].id,
			name: "Proof 1",
			detail: "Deposit screenshot to check",
			meta: null,
			target: projectTarget(made.proof[0].id, "payments"),
		});
		assert.deepEqual(row("requests"), {
			id: made.inquiry[0].id,
			name: SITA_THAPA,
			detail: "A small fine-line moth",
			meta: "Sent today · for Sita",
			target: {
				route: "tenant.inbox.show",
				id: made.inquiry[0].id,
				hash: null,
			},
		});
		assert.deepEqual(row("prices"), {
			id: made.price[0].id,
			name: "Price 1",
			detail: "Accepted today, no price yet",
			meta: null,
			target: projectTarget(made.price[0].id, "quote-form"),
		});
		assert.deepEqual(row("ending"), {
			id: made.ending[0].id,
			name: "Ending 1",
			detail: "The price ends tomorrow",
			meta: null,
			target: projectTarget(made.ending[0].id, "quote"),
		});
		assert.deepEqual(row("deposits"), {
			id: made.deposit[0].id,
			name: "Deposit 1",
			detail: "Deposit not paid, link made 4 days ago",
			meta: null,
			target: projectTarget(made.deposit[0].id, "deposit"),
		});
		assert.deepEqual(row("sessions"), {
			id: made.booked[0].id,
			name: "Booked 1",
			detail: "Booked, no session in the calendar",
			meta: null,
			target: projectTarget(made.booked[0].id, "sessions"),
		});
		// The badge counts the projects that need the studio, not the request
		// (the Inbox counts that): nothing is counted twice.
		assert.equal(props.todayCount, 5);
		assert.equal(props.inboxCount, 1);
		assert.match(props.dateText, /^[A-Z][a-z]+ \d{1,2} [A-Z][a-z]+$/);
		assert.equal(props.date, todayIn(KTM));
		assert.equal(props.timezone, KTM);
	});

	test("waiting on clients: what the client has yet to answer, with the last contact", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-wait-107");
		const sent = await inTenant(s.tenant, async () => {
			const project = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Waits" }),
				{ status: "quoted" },
			);
			await makeQuote(s.tenant, project);
			return project;
		});

		const first = await propsOf(client, "today-wait-107", s.owner);
		assert.equal(first.waiting.count, 1);
		assert.deepEqual(first.waiting.rows[0], {
			id: sent.id,
			name: "Waits",
			detail: "Price sent today",
			meta: "Never contacted",
			target: {
				route: "tenant.projects.show",
				id: sent.id,
				hash: "quote",
			},
		});
		assert.isNull(first.waiting.more);
		assert.deepEqual(keysOf(first), [], "waiting on a client needs nobody");

		await inTenant(s.tenant, async () => {
			const project = await TattooProject.findOrFail(sent.id);
			project.merge({
				artistId: s.ashaProfile.id,
				lastContactedAt: DateTime.utc(),
				lastContactChannel: "whatsapp",
			});
			await project.save();
		});
		const second = await propsOf(client, "today-wait-107", s.owner);
		assert.equal(
			second.waiting.rows[0].meta,
			"With Asha · contacted today on WhatsApp",
		);
	});

	test("more than five rows: five are shown, the count is the whole, and See all knows where to go", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-more-107");
		const ids = await inTenant(s.tenant, async () => {
			const out: string[] = [];
			for (let at = 0; at < 6; at++) {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `Wants a price ${at}` }),
					{
						status: "reviewing",
						createdAt: DateTime.utc().minus({ days: 6 - at }),
					},
				);
				out.push(project.id);
			}
			for (let at = 0; at < 7; at++) {
				await makeInquiry(
					s.tenant,
					await makeClient(s.tenant, { name: `Asker ${at}` }),
					{ contactName: `Asker ${at}` },
				);
			}
			return out;
		});

		const props = await propsOf(client, "today-more-107", s.owner);

		const prices = groupOf(props, "prices") as Group;
		assert.equal(prices.count, 6);
		assert.lengthOf(prices.rows, 5);
		assert.deepEqual(
			prices.rows.map(({ id }) => id),
			ids.slice(0, 5),
			"the longest wait first",
		);
		assert.deepEqual(prices.more, {
			route: "tenant.projects.index",
			waiting: "prices",
		});
		const requests = groupOf(props, "requests") as Group;
		assert.equal(requests.count, 7);
		assert.lengthOf(requests.rows, 5);
		assert.deepEqual(requests.more, {
			route: "tenant.inbox.index",
			waiting: null,
		});
		assert.deepEqual(
			requests.rows.map(({ name }) => name),
			["Asker 0", "Asker 1", "Asker 2", "Asker 3", "Asker 4"],
		);
	});

	test("See all opens the same rows on Projects", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-seeall-109");
		await inTenant(s.tenant, () => seedGroups(s.tenant, null, 6));

		const today = await propsOf(client, "today-seeall-109", s.owner);

		// Every project group that has a See all (a group with five rows or fewer has none).
		const withMore = groupsOf(today).filter(
			({ key, more }) => key !== "requests" && more !== null,
		);
		assert.isAbove(withMore.length, 0);
		for (const group of withMore) {
			assert.deepEqual(
				group.more,
				{ route: "tenant.projects.index", waiting: group.key },
				group.key,
			);
			const opened = await client
				.get(`/t/today-seeall-109/projects?waiting=${group.key}`)
				.withInertia()
				.loginAs(s.owner);
			opened.assertStatus(200);
			// The page the link opens: the count on the link, and the five rows Today showed first.
			assert.equal(opened.inertiaProps.page.total, group.count, group.key);
			assert.deepEqual(
				opened.inertiaProps.projects
					.slice(0, group.rows.length)
					.map(({ id }: { id: string }) => id),
				group.rows.map(({ id }) => id),
				group.key,
			);
		}
		// The owner's screenshots are never capped (TAT-107): every row shows and there is
		// no link. The list still holds them under ?waiting=proofs.
		const proofs = groupOf(today, "proofs") as Group;
		assert.equal(proofs.rows.length, proofs.count);
		assert.isNull(proofs.more);
		const proofsList = await client
			.get("/t/today-seeall-109/projects?waiting=proofs")
			.withInertia()
			.loginAs(s.owner);
		assert.deepEqual(
			proofsList.inertiaProps.projects.map(({ id }: { id: string }) => id),
			proofs.rows.map(({ id }) => id),
		);
		// Requests still go to the Inbox.
		assert.deepEqual((groupOf(today, "requests") as Group).more, {
			route: "tenant.inbox.index",
			waiting: null,
		});

		const waitingOn = today.waiting;
		assert.deepEqual(waitingOn.more, {
			route: "tenant.projects.index",
			waiting: "on_client",
		});
		const opened = await client
			.get("/t/today-seeall-109/projects?waiting=on_client")
			.withInertia()
			.loginAs(s.owner);
		assert.equal(opened.inertiaProps.page.total, waitingOn.count);
		assert.deepEqual(
			opened.inertiaProps.projects
				.slice(0, waitingOn.rows.length)
				.map(({ id }: { id: string }) => id),
			waitingOn.rows.map(({ id }: { id: string }) => id),
		);
	});

	test("an artist sees their own work only, and none of the owners' data", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-artist-107");
		const { mine, theirs, inquiry, session } = await inTenant(
			s.tenant,
			async () => {
				const name = (label: string) => makeClient(s.tenant, { name: label });
				const own = async (status: ProjectStatus, label: string) =>
					makeProject(s.tenant, await name(label), {
						status,
						artistId: s.ashaProfile.id,
					});
				const other = async (status: ProjectStatus, label: string) =>
					makeProject(s.tenant, await name(label), {
						status,
						artistId: s.sitaProfile.id,
					});

				const price = await own("reviewing", "Mine to price");
				const screenshot = await own("deposit_pending", "Mine with a shot");
				await makeQuote(s.tenant, screenshot);
				await proofFor(s.tenant, screenshot);
				const unpaid = await own("deposit_pending", "Mine unpaid");
				await makeQuote(s.tenant, unpaid);
				await makeDepositLink(s.tenant, unpaid);

				const foreign = await other("reviewing", "Sita's to price");
				const foreignShot = await other("deposit_pending", "Sita's shot");
				await makeQuote(s.tenant, foreignShot);
				await proofFor(s.tenant, foreignShot);

				const asker = await name("Request maker");
				const request = await makeInquiry(s.tenant, asker, {
					contactName: "Request maker",
					preferredArtistId: s.ashaProfile.id,
				});
				// Asha's session on Sita's project: its time, no client.
				const sessionDay = DateTime.now()
					.setZone(KTM)
					.set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
				const hidden = await makeSession(s.tenant, foreign, s.ashaProfile, {
					startsAt: sessionDay,
					endsAt: sessionDay.plus({ hours: 2 }),
				});
				return {
					mine: { price, screenshot, unpaid },
					theirs: { foreign, foreignShot },
					inquiry: request,
					session: hidden,
				};
			},
		);

		const props = await propsOf(client, "today-artist-107", s.asha);

		assert.deepEqual(keysOf(props), ["prices"]);
		assert.deepEqual(
			(groupOf(props, "prices") as Group).rows.map(({ id }) => id),
			[mine.price.id],
		);
		// A waiting screenshot is the owners' to check, but the project is still the
		// artist's: it shows as one waiting for the deposit, like the unpaid one
		// (TAT-107 fix 3), and never as the screenshot itself.
		assert.sameMembers(
			props.waiting.rows.map(({ id }: { id: string }) => id),
			[mine.screenshot.id, mine.unpaid.id],
		);
		for (const row of props.waiting.rows) {
			assert.equal(row.detail, "Waiting for the deposit");
		}
		assert.notInclude(keysOf(props), "proofs");
		for (const row of [
			...(groupOf(props, "prices") as Group).rows,
			...props.waiting.rows,
		]) {
			assert.notMatch(row.meta ?? "", /Asha|Sita|With/, row.name);
			assert.isTrue(
				row.meta === null || /^(Never c|C)ontacted/.test(row.meta),
				row.meta ?? "",
			);
		}
		const everything = idsIn(props);
		for (const hiddenValue of [
			theirs.foreign.id,
			theirs.foreignShot.id,
			"Sita's to price",
			"Sita's shot",
			inquiry.id,
			"Request maker",
		]) {
			assert.notInclude(everything, hiddenValue);
		}
		assert.isNull(props.setup);
		assert.isNull(props.studioPage);
		assert.isNull(props.pilotMetrics);
		assert.equal(props.sessions.scope, "artist");
		assert.deepEqual(
			props.sessions.rows.map(
				({ id, project }: { id: string; project: unknown }) => [id, project],
			),
			[[session.id, null]],
		);
	});

	test("an artist without a profile has nothing on Today", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-unlinked-107");
		await inTenant(s.tenant, () => seedGroups(s.tenant, s.ashaProfile.id));
		const stranger = await artistIn(s.tenant, "ram@today-unlinked-107.example");

		const props = await propsOf(client, "today-unlinked-107", stranger);

		assert.equal(props.sessions.scope, "unlinked");
		assert.deepEqual(props.sessions.rows, []);
		assert.deepEqual(props.needsYou, []);
		assert.equal(props.waiting.count, 0);
	});

	test("today's sessions are the studio's day, not the server's", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-day-107");
		const local = DateTime.now().setZone(KTM);
		const at = (day: DateTime, hour: number, minute = 0) =>
			day.startOf("day").set({ hour, minute });
		const made = await inTenant(s.tenant, async () => {
			const project = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Chair" }),
				{ status: "booked", artistId: s.ashaProfile.id },
			);
			const evening = await makeSession(s.tenant, project, s.ashaProfile, {
				startsAt: at(local, 18),
				endsAt: at(local, 20),
			});
			const morning = await makeSession(s.tenant, project, s.sitaProfile, {
				startsAt: at(local, 10),
				endsAt: at(local, 12),
			});
			// Half past midnight tomorrow, studio time: not today.
			await makeSession(s.tenant, project, s.ashaProfile, {
				startsAt: at(local.plus({ days: 1 }), 0, 30),
				endsAt: at(local.plus({ days: 1 }), 2, 30),
			});
			return { evening, morning };
		});

		const owners = await propsOf(client, "today-day-107", s.owner);
		assert.equal(owners.sessions.scope, "studio");
		assert.deepEqual(
			owners.sessions.rows.map(
				({ id, startText }: { id: string; startText: string }) => [
					id,
					startText,
				],
			),
			[
				[made.morning.id, "10:00"],
				[made.evening.id, "18:00"],
			],
		);
		assert.deepEqual(
			owners.sessions.rows.map(
				({ artistName }: { artistName: string }) => artistName,
			),
			["Sita", "Asha"],
		);

		const artists = await propsOf(client, "today-day-107", s.asha);
		assert.equal(artists.sessions.scope, "artist");
		assert.deepEqual(
			artists.sessions.rows.map(({ id }: { id: string }) => id),
			[made.evening.id],
		);
	});

	test("a new studio: the checklist and nothing else, until its four steps are done", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("fresh-ink", "Fresh Ink");

		const fresh = await propsOf(client, "fresh-ink", owner);
		assert.deepEqual(fresh.needsYou, []);
		assert.equal(fresh.waiting.count, 0);
		assert.deepEqual(fresh.sessions.rows, []);
		assert.deepEqual(
			fresh.setup.steps.map(({ key, done, next }: Record<string, unknown>) => [
				key,
				done,
				next,
			]),
			[
				["artists", false, true],
				["payments", false, false],
				["policy", false, false],
				["inquiry", false, false],
			],
		);
		assert.isFalse(fresh.setup.complete);
		assert.equal(fresh.studioPage.url, "http://fresh-ink.localhost:3000");
		assert.isTrue(fresh.studioPage.devHost);

		await addArtist(tenant, owner);
		await inTenant(tenant, () =>
			new PaymentMethodService(new ImageService()).create(tenant, {
				kind: "esewa",
				label: "eSewa",
				accountNumber: "9801234567",
				accountName: "Fresh Ink",
				showOnDepositPage: true,
			}),
		);
		await inTenant(tenant, () =>
			new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: 30,
				depositPolicy: "30% holds your date.",
			}),
		);
		const halfway = await propsOf(client, "fresh-ink", owner);
		assert.deepEqual(
			halfway.setup.steps.map(({ done }: { done: boolean }) => done),
			[true, true, true, false],
		);

		await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const done = await propsOf(client, "fresh-ink", owner);
		assert.isNull(done.setup);
		assert.isNull(done.studioPage);
	});

	test("the pilot numbers moved here from the Inbox", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer);
			// Booked at the desk: a project with no inquiry.
			await makeProject(tenant, customer, { status: "booked" });
			// Older than 30 days: not counted.
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
				createdAt: DateTime.utc().minus({ days: 31 }),
			});
		});

		const props = await propsOf(client, "black-needle", owner);

		assert.deepEqual(props.pilotMetrics, {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "50%",
					detail: "1 inquiry through the link, 1 booking at the desk",
				},
				{
					label: "Inquiry to deposit",
					value: "—",
					detail: "No deposits verified from an inquiry yet.",
				},
				{
					label: "No-shows",
					value: "—",
					detail: "No finished sessions yet.",
				},
			],
			note: null,
		});
	});

	test("the queries do not grow with the rows", async ({ client, assert }) => {
		const s = await studio("today-queries-107");
		const count = async () => {
			const { result, queries } = await recordQueries(() =>
				client.get(page("today-queries-107")).withInertia().loginAs(s.owner),
			);
			result.assertStatus(200);
			return queries.length;
		};
		await inTenant(s.tenant, () => seedGroups(s.tenant, s.sitaProfile.id, 1));
		const few = await count();
		await inTenant(s.tenant, () => seedGroups(s.tenant, s.sitaProfile.id, 2));
		const many = await count();

		assert.equal(many, few);
	});

	test("another studio's work never shows", async ({ client, assert }) => {
		const { a, b } = await twoStudios();
		await inTenant(a.tenant, () => seedGroups(a.tenant, null, 1, "A: "));
		await inTenant(b.tenant, () => seedGroups(b.tenant, null, 1, "B: "));
		const secrets = await inTenant(b.tenant, async () => {
			const projects = await TattooProject.query().where(
				"tenant_id",
				b.tenant.id,
			);
			const inquiries = await Inquiry.query().where("tenant_id", b.tenant.id);
			const clients = await Client.query().where("tenant_id", b.tenant.id);
			return [
				...projects.map(({ id }) => id),
				...inquiries.map(({ id }) => id),
				...clients.map(({ name }) => JSON.stringify(name)),
			];
		});

		const props = await propsOf(client, "studio-a", a.owner);

		// A control: studio A's own work is on its Today.
		assert.isAbove(props.needsYou.length, 0);
		const everything = idsIn(props);
		assert.isAbove(secrets.length, 10);
		for (const secret of secrets) {
			assert.notInclude(everything, secret);
		}
	});
	test("the badge costs a fixed number of queries on every page", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-badge-107");
		const projectsPage = async () => {
			const { result, queries } = await recordQueries(() =>
				client
					.get("/t/today-badge-107/projects")
					.withInertia()
					.loginAs(s.owner),
			);
			result.assertStatus(200);
			return { queries: queries.length, count: result.inertiaProps.todayCount };
		};
		await inTenant(s.tenant, () => seedGroups(s.tenant, s.sitaProfile.id, 1));
		const one = await projectsPage();
		await inTenant(s.tenant, () => seedGroups(s.tenant, s.sitaProfile.id, 3));
		const four = await projectsPage();

		assert.equal(one.count, 5);
		assert.equal(four.count, 20);
		assert.equal(four.queries, one.queries);
	});
	test("a withdrawn project whose screenshot waits stays on Today and in the badge until the owner decides", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-withdrawn-107");
		const make = (name: string) =>
			inTenant(s.tenant, async () => {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name }),
					{ status: "deposit_pending", artistId: s.ashaProfile.id },
				);
				await makeQuote(s.tenant, project);
				return { project, proof: await proofFor(s.tenant, project) };
			});
		const rejected = await make("Withdrew, will be rejected");
		const verified = await make("Withdrew, will be verified");
		const post = (path: string, form: Record<string, string> = {}) =>
			client
				.post(`/t/today-withdrawn-107${path}`)
				.form(form)
				.withCsrfToken()
				.loginAs(s.owner)
				.redirects(0);
		const proofRows = async () => {
			const props = await propsOf(client, "today-withdrawn-107", s.owner);
			return {
				ids: (groupOf(props, "proofs")?.rows ?? []).map(({ id }) => id),
				count: props.todayCount as number,
				props,
			};
		};

		assert.sameMembers((await proofRows()).ids, [
			rejected.project.id,
			verified.project.id,
		]);

		// The client withdraws: the project is cancelled, the screenshot is still undecided.
		for (const { project } of [rejected, verified]) {
			const response = await post(`/projects/${project.id}/moves`, {
				move: "withdraw",
			});
			response.assertFlashMessage(
				"success",
				"Client withdrew: project cancelled.",
			);
		}
		const afterWithdrawal = await proofRows();
		assert.sameMembers(afterWithdrawal.ids, [
			rejected.project.id,
			verified.project.id,
		]);
		assert.equal(afterWithdrawal.count, 2);
		const row = (groupOf(afterWithdrawal.props, "proofs") as Group).rows[0];
		assert.equal(row.detail, "Deposit screenshot to check");
		assert.equal(row.target.hash, "payments");

		// The destination works: the cancelled project's Payments card lists the screenshot to decide.
		const page = await client
			.get(`/t/today-withdrawn-107/projects/${rejected.project.id}`)
			.withInertia()
			.loginAs(s.owner);
		page.assertStatus(200);
		assert.equal(page.inertiaProps.project.status, "cancelled");
		assert.lengthOf(page.inertiaProps.payments.pending, 1);

		// A decision takes each one off Today and out of the badge.
		(await post(`/payments/${rejected.proof.id}/reject`)).assertStatus(302);
		const afterReject = await proofRows();
		assert.deepEqual(afterReject.ids, [verified.project.id]);
		assert.equal(afterReject.count, 1);
		(await post(`/payments/${verified.proof.id}/verify`)).assertStatus(302);
		const afterVerify = await proofRows();
		assert.deepEqual(afterVerify.ids, []);
		assert.equal(afterVerify.count, 0);

		// The artist never saw any of it: a cancelled project is closed for them.
		const artistProps = await propsOf(client, "today-withdrawn-107", s.asha);
		assert.deepEqual(artistProps.needsYou, []);
		assert.equal(artistProps.todayCount, 0);
	});

	test("a paid project with an expired quote still shows under Sessions to book (TAT-107 fix 2)", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-expired-107");
		const project = await inTenant(s.tenant, async () => {
			const made = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Paid, never booked" }),
				{ status: "deposit_pending", artistId: s.ashaProfile.id },
			);
			await makeQuote(s.tenant, made, {
				expiresAt: DateTime.utc().minus({ days: 3 }),
			});
			await makePayment(s.tenant, made, {
				status: "verified",
				verifiedAt: DateTime.utc().minus({ days: 5 }),
			});
			return made;
		});

		const owner = await propsOf(client, "today-expired-107", s.owner);
		assert.deepEqual(keysOf(owner), ["sessions"]);
		assert.equal(
			(groupOf(owner, "sessions") as Group).rows[0].detail,
			"Deposit paid, no session booked",
		);
		assert.equal(owner.todayCount, 1);
		const artist = await propsOf(client, "today-expired-107", s.asha);
		assert.deepEqual(
			(groupOf(artist, "sessions") as Group).rows.map(({ id }) => id),
			[project.id],
		);
		assert.equal(artist.todayCount, 1);
	});
	test("every screenshot to check is shown, with no See all: an unresolved payment is never hidden behind a link (fix round 2)", async ({
		client,
		assert,
	}) => {
		const s = await studio("today-uncapped-107");
		// Seven projects with a waiting screenshot, four of them withdrawn (closed), sent a day apart.
		const ids = await inTenant(s.tenant, async () => {
			const out: string[] = [];
			for (let at = 0; at < 7; at++) {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `Shot ${at}` }),
					{
						status: at < 4 ? "cancelled" : "deposit_pending",
						artistId: s.ashaProfile.id,
					},
				);
				await makeQuote(s.tenant, project);
				await proofFor(s.tenant, project, {
					createdAt: DateTime.utc().minus({ days: 7 - at }),
				});
				out.push(project.id);
			}
			// Another group still caps at five and says where to see the rest.
			for (let at = 0; at < 6; at++) {
				await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `Price ${at}` }),
					{ status: "reviewing" },
				);
			}
			return out;
		});

		const props = await propsOf(client, "today-uncapped-107", s.owner);

		const proofs = groupOf(props, "proofs") as Group;
		assert.equal(proofs.count, 7);
		assert.deepEqual(
			proofs.rows.map(({ id }) => id),
			ids,
			"all seven, the screenshot sent longest ago first",
		);
		assert.isNull(proofs.more);
		for (const row of proofs.rows) {
			assert.equal(row.target.hash, "payments");
		}
		const prices = groupOf(props, "prices") as Group;
		assert.equal(prices.count, 6);
		assert.lengthOf(prices.rows, 5);
		assert.isNotNull(prices.more);
		assert.equal(props.todayCount, 13);
	});
});
