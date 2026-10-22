import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { ALERT_EXCERPT_LENGTH, excerpt } from "#modules/notifications/alerts";
import TattooProject from "#modules/projects/models/tattoo_project";
import WaitingService from "#modules/projects/services/waiting_service";
import { groupOf } from "#modules/projects/waiting";
import { sessionStartText } from "#modules/scheduling/times";
import { proofFor } from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, inTenantAs, studioWithOwner } from "#tests/helpers/tenants";
import { KTM, seedGroups, studio } from "#tests/helpers/waiting_fixtures";

type Who = Parameters<ReturnType<ApiClient["get"]>["loginAs"]>[0];
type Line = { text: string; needsYou: boolean; hash: string | null };
type Row = {
	id: string;
	clientName: string | null;
	piece: string;
	artistName: string | null;
	status: string;
	line: Line | null;
	nextSessionText: string | null;
	contactedText: string | null;
};

const list = (slug: string, query = "") => `/t/${slug}/projects${query}`;

/** The list's props for `user`; the page is checked once, here. */
async function propsOf(client: ApiClient, slug: string, user: Who, query = "") {
	const response = await client
		.get(list(slug, query))
		.withInertia()
		.loginAs(user);
	response.assertStatus(200);
	response.assertInertiaComponent("projects/index");
	return response.inertiaProps;
}
const rowsOf = (props: { projects?: unknown }) => props.projects as Row[];
const idsOf = (props: { projects?: unknown }) =>
	rowsOf(props).map(({ id }) => id);

/**
 * What WaitingService.work says for `user`: the list is compared with this
 * answer, never with wording of its own, because Today, the badge and the
 * list must give one answer.
 */
async function workFor(
	tenant: { id: string; timezone: string },
	user: { id: string },
	role: "owner" | "artist",
) {
	const service = await app.container.make(WaitingService);
	return inTenantAs(tenant, user, () =>
		service.work(tenant, { userId: user.id, role }, DateTime.now()),
	);
}

/** The line a row should carry for a `work()` item. */
const lineOf = (item: {
	waiting: { side: string };
	text: string;
	hash: string | null;
}): Line => ({
	text: item.text,
	needsYou: item.waiting.side === "studio",
	hash: item.hash,
});

/** Every query string the views answer to. */
const VIEWS = [
	"",
	"?status=needs_you",
	"?waiting=proofs",
	"?waiting=prices",
	"?waiting=ending",
	"?waiting=deposits",
	"?waiting=sessions",
	"?waiting=on_client",
	"?status=closed",
	"?status=reviewing",
	"?sort=contact",
];

/** A session `days` days ahead, on the hour, two hours long. */
const sessionIn = (days: number) => {
	const startsAt = DateTime.now().plus({ days }).startOf("hour");
	return { startsAt, endsAt: startsAt.plus({ hours: 2 }) };
};

test.group("Projects list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the open projects with their piece, line, next session and counts", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-rows-109", "List Ink");
		const brief =
			"हातमा एउटा सानो पुतली र फूलको चित्र बनाउन चाहन्छु, रेखाहरू नरम राख्नुहोस् र रंग हल्का। ".repeat(
				4,
			);
		const made = await inTenant(s.tenant, async () => {
			const sita = await makeClient(s.tenant, { name: "Sita Rai" });
			const ram = await makeClient(s.tenant, { name: "Ram Thapa" });
			const maya = await makeClient(s.tenant, { name: "Maya Gurung" });
			const quoted = await makeProject(s.tenant, sita, {
				status: "quoted",
				artistId: s.sitaProfile.id,
				brief,
				lastContactedAt: DateTime.now().minus({ days: 2 }),
			});
			await makeQuote(s.tenant, quoted);
			const withSession = await makeProject(s.tenant, ram, {
				status: "booked",
			});
			const session = await makeSession(
				s.tenant,
				withSession,
				s.ashaProfile,
				sessionIn(5),
			);
			const noSession = await makeProject(s.tenant, maya, {
				status: "booked",
			});
			await makeProject(s.tenant, maya, { status: "declined" });
			return { quoted, withSession, session, noSession };
		});

		const props = await propsOf(client, "list-rows-109", s.owner);

		assert.equal(props.filter, "active");
		assert.isNull(props.waiting);
		assert.equal(props.sort, "needs");
		assert.equal(props.counts.active, 3);
		assert.equal(props.counts.closed, 1);
		assert.equal(props.counts.byStatus.booked, 2);
		assert.equal(props.counts.byStatus.on_hold, 0);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 3 });
		const work = await workFor(s.tenant, s.owner, "owner");
		assert.equal(props.counts.needsYou, work.needsYou.length);
		assert.equal(props.counts.needsYou, props.todayCount);

		const rows = rowsOf(props);
		const row = (id: string) => rows.find((one) => one.id === id) as Row;
		const waitingOn = (id: string) =>
			[...work.needsYou, ...work.onClient].find(
				({ project }) => project.id === id,
			);

		const quotedRow = row(made.quoted.id);
		assert.deepInclude(quotedRow, {
			clientName: "Sita Rai",
			status: "quoted",
			artistName: "Sita",
			contactedText: "Contacted 2 days ago",
			nextSessionText: null,
		});
		// The piece is the start of the brief, cut at a whole letter.
		assert.equal(quotedRow.piece, excerpt(brief, ALERT_EXCERPT_LENGTH));
		assert.isBelow(quotedRow.piece.length, brief.length);
		assert.isTrue(quotedRow.piece.endsWith("…"));
		const sent = waitingOn(made.quoted.id);
		assert.isDefined(sent);
		assert.deepEqual(quotedRow.line, lineOf(sent as never));

		// Nothing was said to this client: no contact line at all.
		const noSessionRow = row(made.noSession.id);
		assert.isNull(noSessionRow.contactedText);
		assert.deepEqual(
			noSessionRow.line,
			lineOf(waitingOn(made.noSession.id) as never),
		);
		assert.isTrue(noSessionRow.line?.needsYou);
		assert.equal(noSessionRow.line?.hash, "sessions");
		assert.isNull(noSessionRow.nextSessionText);

		// Booked with a session: nothing waits, so no line, and the session is the next step.
		const withSessionRow = row(made.withSession.id);
		assert.isNull(withSessionRow.line);
		assert.equal(
			withSessionRow.nextSessionText,
			sessionStartText(made.session.startsAt, KTM),
		);
		assert.match(
			withSessionRow.nextSessionText as string,
			/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})?, \d{2}:\d{2}$/,
		);

		// The old flags and the old words are gone from the props.
		const everything = JSON.stringify(props.projects);
		for (const gone of [
			"noSession",
			"proofWaiting",
			"depositToSettle",
			"quoteLapsed",
			"balanceOwed",
			"ever contacted",
		]) {
			assert.notInclude(everything, gone);
		}
	});

	test("filters, waiting views and sorts come from fixed lists", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("list-views-109");
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeProject(tenant, customer, { status: "quoted" });
			await makeProject(tenant, customer, { status: "cancelled" });
		});
		const view = async (query: string) => {
			const props = await propsOf(client, "list-views-109", owner, query);
			return {
				filter: props.filter,
				waiting: props.waiting,
				sort: props.sort,
				statuses: rowsOf(props).map(({ status }) => status),
			};
		};

		assert.deepEqual(await view("?status=closed"), {
			filter: "closed",
			waiting: null,
			sort: null,
			statuses: ["cancelled"],
		});
		assert.deepEqual(await view("?status=quoted"), {
			filter: "quoted",
			waiting: null,
			sort: "needs",
			statuses: ["quoted"],
		});
		assert.deepEqual(await view("?status=bogus&page=abc"), {
			filter: "active",
			waiting: null,
			sort: "needs",
			statuses: ["quoted"],
		});
		assert.deepEqual(await view("?page=99"), {
			filter: "active",
			waiting: null,
			sort: "needs",
			statuses: [],
		});

		assert.deepInclude(await view("?status=needs_you"), {
			filter: "needs_you",
			waiting: null,
			sort: null,
		});
		// A waiting view wins over the status and sits under Needs you.
		assert.deepInclude(await view("?waiting=proofs&status=closed"), {
			filter: "needs_you",
			waiting: "proofs",
			sort: null,
		});
		assert.deepInclude(await view("?waiting=on_client"), {
			filter: "active",
			waiting: "on_client",
			sort: null,
		});
		// Requests live in the Inbox, and anything unknown or repeated is ignored.
		for (const query of [
			"?waiting=requests",
			"?waiting=bogus",
			"?waiting[]=proofs",
			"?waiting=proofs&waiting=prices",
		]) {
			assert.deepInclude(
				await view(query),
				{ filter: "active", waiting: null, sort: "needs" },
				query,
			);
		}
		assert.equal((await view("?sort=bogus")).sort, "needs");
		assert.equal((await view("?sort=contact")).sort, "contact");
		assert.isNull((await view("?status=closed&sort=contact")).sort);
		assert.isNull((await view("?status=needs_you&sort=contact")).sort);
	});

	test("an artist sees only their own projects, with no artist name", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-artist-109");
		await inTenant(s.tenant, async () => {
			const customer = await makeClient(s.tenant, { name: "Theirs" });
			const other = await makeClient(s.tenant, { name: "Not theirs" });
			await makeProject(s.tenant, customer, { artistId: s.ashaProfile.id });
			await makeProject(s.tenant, other, { artistId: s.sitaProfile.id });
			await makeProject(s.tenant, other);
		});

		const props = await propsOf(client, "list-artist-109", s.asha);

		assert.deepEqual(
			rowsOf(props).map(({ clientName }) => clientName),
			["Theirs"],
		);
		assert.equal(props.counts.active, 1);
		// The total is theirs too: it must not count the studio's other projects.
		assert.deepEqual(props.page, { current: 1, last: 1, total: 1 });
		for (const row of rowsOf(props)) assert.isNull(row.artistName);
		assert.notInclude(JSON.stringify(props.projects), "Sita");
	});

	test("the open views put what needs you first, in Today's order", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-order-109");
		const rest = await inTenant(s.tenant, async () => {
			await seedGroups(s.tenant, null, 1);
			const customer = await makeClient(s.tenant, { name: "Quiet" });
			const booked = await makeProject(s.tenant, customer, {
				status: "booked",
				createdAt: DateTime.now().minus({ days: 20 }),
			});
			await makeSession(s.tenant, booked, s.ashaProfile, sessionIn(6));
			const working = await makeProject(s.tenant, customer, {
				status: "in_progress",
				createdAt: DateTime.now().minus({ days: 10 }),
			});
			return [booked.id, working.id];
		});

		const props = await propsOf(client, "list-order-109", s.owner);
		const work = await workFor(s.tenant, s.owner, "owner");

		const first = [...work.needsYou, ...work.onClient];
		assert.isAbove(work.needsYou.length, 0);
		assert.isAbove(work.onClient.length, 0);
		assert.deepEqual(idsOf(props), [
			...first.map(({ project }) => project.id),
			...rest,
		]);
		for (const item of first) {
			const row = rowsOf(props).find(({ id }) => id === item.project.id);
			assert.deepEqual(row?.line, lineOf(item), item.project.id);
		}
		for (const id of rest) {
			assert.isNull(rowsOf(props).find((row) => row.id === id)?.line, id);
		}
	});

	test("Needs you holds exactly the projects Today counts, and each Today group its own", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-needs-109");
		await inTenant(s.tenant, () => seedGroups(s.tenant, null, 2));
		const work = await workFor(s.tenant, s.owner, "owner");

		const needs = await propsOf(
			client,
			"list-needs-109",
			s.owner,
			"?status=needs_you",
		);
		assert.isAbove(work.needsYou.length, 5);
		assert.deepEqual(
			idsOf(needs),
			work.needsYou.map(({ project }) => project.id),
		);
		assert.equal(needs.page.total, needs.counts.needsYou);
		assert.equal(needs.counts.needsYou, needs.todayCount);
		for (const item of work.needsYou) {
			const row = rowsOf(needs).find(({ id }) => id === item.project.id);
			assert.deepEqual(row?.line, lineOf(item));
		}

		for (const key of ["proofs", "prices", "ending", "deposits", "sessions"]) {
			const group = await propsOf(
				client,
				"list-needs-109",
				s.owner,
				`?waiting=${key}`,
			);
			const expected = work.needsYou
				.filter(({ waiting }) => groupOf(waiting.reason) === key)
				.map(({ project }) => project.id);
			assert.isAbove(expected.length, 0, key);
			assert.deepEqual(idsOf(group), expected, key);
			assert.equal(group.page.total, expected.length, key);
			assert.equal(group.filter, "needs_you", key);
		}

		const onClient = await propsOf(
			client,
			"list-needs-109",
			s.owner,
			"?waiting=on_client",
		);
		assert.isAbove(work.onClient.length, 0);
		assert.deepEqual(
			idsOf(onClient),
			work.onClient.map(({ project }) => project.id),
		);
		assert.equal(onClient.filter, "active");
	});

	test("?waiting=proofs holds every withdrawn project whose screenshot nobody decided, as work() gives them", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-withdrawn-109");
		const withdrawn = await inTenant(s.tenant, async () => {
			const made = [];
			for (let at = 0; at < 6; at++) {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `Withdrew ${at + 1}` }),
					{
						status: "cancelled",
						artistId: s.ashaProfile.id,
						createdAt: DateTime.now().minus({ days: 10 - at }),
					},
				);
				await makeQuote(s.tenant, project);
				await proofFor(s.tenant, project, {
					createdAt: DateTime.now().minus({ days: 8 - at }),
				});
				made.push(project);
			}
			// A live project with a screenshot too, and a withdrawn one whose screenshot was decided.
			const live = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Still here" }),
				{ status: "deposit_pending", artistId: s.ashaProfile.id },
			);
			await makeQuote(s.tenant, live);
			await proofFor(s.tenant, live);
			const decided = await makeProject(
				s.tenant,
				await makeClient(s.tenant, { name: "Decided" }),
				{ status: "cancelled", artistId: s.ashaProfile.id },
			);
			await makeQuote(s.tenant, decided);
			await proofFor(s.tenant, decided, {
				status: "rejected",
				verifiedAt: DateTime.now(),
			});
			return { made, live, decided };
		});
		const work = await workFor(s.tenant, s.owner, "owner");
		const expected = work.needsYou
			.filter(({ waiting }) => groupOf(waiting.reason) === "proofs")
			.map(({ project }) => project.id);

		const proofs = await propsOf(
			client,
			"list-withdrawn-109",
			s.owner,
			"?waiting=proofs",
		);

		for (const project of withdrawn.made) {
			assert.include(idsOf(proofs), project.id, project.id);
		}
		assert.include(idsOf(proofs), withdrawn.live.id);
		assert.notInclude(idsOf(proofs), withdrawn.decided.id);
		assert.deepEqual(idsOf(proofs), expected);
		assert.equal(proofs.page.total, expected.length);
		for (const row of rowsOf(proofs)) {
			assert.isTrue(row.line?.needsYou, row.id);
			assert.equal(row.line?.hash, "payments", row.id);
		}
		assert.equal(
			rowsOf(proofs).find(({ id }) => id === withdrawn.made[0].id)?.status,
			"cancelled",
		);
		const needs = await propsOf(
			client,
			"list-withdrawn-109",
			s.owner,
			"?status=needs_you",
		);
		assert.equal(needs.counts.needsYou, needs.todayCount);
		assert.equal(needs.page.total, needs.todayCount);
		for (const project of withdrawn.made) {
			assert.include(idsOf(needs), project.id);
		}

		// An artist never acts on money: the screenshots are not theirs to check,
		// and a withdrawn project is closed for them. Whatever work() holds for
		// them is what the views show, and nothing more.
		const artistWork = await workFor(s.tenant, s.asha, "artist");
		const artistProofs = await propsOf(
			client,
			"list-withdrawn-109",
			s.asha,
			"?waiting=proofs",
		);
		assert.deepEqual(
			idsOf(artistProofs),
			artistWork.needsYou
				.filter(({ waiting }) => groupOf(waiting.reason) === "proofs")
				.map(({ project }) => project.id),
		);
		assert.deepEqual(idsOf(artistProofs), []);
		const artistNeeds = await propsOf(
			client,
			"list-withdrawn-109",
			s.asha,
			"?status=needs_you",
		);
		assert.deepEqual(
			idsOf(artistNeeds),
			artistWork.needsYou.map(({ project }) => project.id),
		);
		for (const project of withdrawn.made) {
			assert.notInclude(idsOf(artistNeeds), project.id);
		}
	});

	test("the contact sort puts the longest since contact first", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("list-contact-109");
		await inTenant(tenant, async () => {
			// Created in another order than they are contacted in.
			const project = async (
				name: string,
				createdDaysAgo: number,
				contactedDaysAgo: number | null,
			) =>
				makeProject(tenant, await makeClient(tenant, { name }), {
					createdAt: DateTime.now().minus({ days: createdDaysAgo }),
					lastContactedAt:
						contactedDaysAgo === null
							? null
							: DateTime.now().minus({ days: contactedDaysAgo }),
				});
			await project("Nine days", 12, 9);
			await project("Never", 11, null);
			await project("Two days", 10, 2);
		});

		const props = await propsOf(
			client,
			"list-contact-109",
			owner,
			"?sort=contact",
		);

		assert.equal(props.sort, "contact");
		assert.deepEqual(
			rowsOf(props).map(({ clientName }) => clientName),
			["Never", "Nine days", "Two days"],
		);
		assert.deepEqual(
			rowsOf(props).map(({ contactedText }) => contactedText),
			[null, "Contacted 9 days ago", "Contacted 2 days ago"],
		);
	});

	test("pages of 25 in every open view", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner("list-pages-109");
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			for (let at = 0; at < 27; at++) {
				await makeProject(tenant, customer, {
					status: "reviewing",
					createdAt: DateTime.now().minus({ minutes: 100 - at }),
				});
			}
		});

		for (const query of ["", "?status=needs_you", "?status=reviewing"]) {
			const sep = query ? "&" : "?";
			const at = (page: number) =>
				propsOf(client, "list-pages-109", owner, `${query}${sep}page=${page}`);
			const [one, two, three] = [await at(1), await at(2), await at(3)];
			assert.lengthOf(rowsOf(one), 25, query);
			assert.lengthOf(rowsOf(two), 2, query);
			assert.lengthOf(rowsOf(three), 0, query);
			assert.deepEqual(one.page, { current: 1, last: 2, total: 27 }, query);
			assert.equal(three.page.current, 3, query);
			assert.equal(
				new Set([...idsOf(one), ...idsOf(two)]).size,
				27,
				`${query}: no project on two pages`,
			);
		}
	});

	test("no view ever shows another studio's projects", async ({
		client,
		assert,
	}) => {
		const a = await studio("list-iso-a-109", "Iso A");
		const b = await studio("list-iso-b-109", "Iso B");
		const seed = (s: typeof a, label: string) =>
			inTenant(s.tenant, async () => {
				const made = await seedGroups(s.tenant, null, 1, label);
				const closed = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `${label}Closed` }),
					{ status: "declined" },
				);
				const planned = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name: `${label}Planned` }),
					{ status: "booked" },
				);
				await makeSession(s.tenant, planned, s.ashaProfile, sessionIn(4));
				return [
					...made.proof,
					...made.price,
					...made.ending,
					...made.deposit,
					...made.booked,
					...made.sent,
					closed,
					planned,
				].map(({ id }) => id);
			});
		const ownIds = await seed(a, "A: ");
		const theirIds = await seed(b, "B: ");

		for (const query of VIEWS) {
			const props = await propsOf(client, "list-iso-a-109", a.owner, query);
			const everything = JSON.stringify(props);
			// A control: the view is not empty, and every row is studio A's.
			assert.isAbove(rowsOf(props).length, 0, query);
			for (const row of rowsOf(props)) {
				assert.include(ownIds, row.id, query);
				assert.match(row.clientName ?? "", /^A: /, query);
			}
			for (const secret of [...theirIds, "B: ", "Iso B"]) {
				assert.notInclude(everything, secret, query);
			}
		}
	});

	test("an artist's views hold only their own projects and no owner facts", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-facts-109");
		const made = await inTenant(s.tenant, async () => {
			const project = async (
				name: string,
				status: "deposit_pending" | "completed" | "reviewing",
				artistId: string,
			) => {
				const made = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name }),
					{ status, artistId },
				);
				if (status !== "reviewing") await makeQuote(s.tenant, made);
				if (status === "deposit_pending") await proofFor(s.tenant, made);
				return made;
			};
			const asha = s.ashaProfile.id;
			const sita = s.sitaProfile.id;
			return {
				mine: [
					await project("Mine with a shot", "deposit_pending", asha),
					await project("Mine finished", "completed", asha),
					await project("Mine to price", "reviewing", asha),
				],
				// Another artist's, with the same facts.
				theirs: [
					await project("Theirs with a shot", "deposit_pending", sita),
					await project("Theirs finished", "completed", sita),
				],
			};
		});
		const mine = made.mine.map(({ id }) => id);

		// The owner does see the facts, so their absence below proves something.
		const ownerClosed = await propsOf(
			client,
			"list-facts-109",
			s.owner,
			"?status=closed",
		);
		assert.include(JSON.stringify(ownerClosed.projects), "still due");

		const artistWork = await workFor(s.tenant, s.asha, "artist");
		const workLines = new Map(
			[...artistWork.needsYou, ...artistWork.onClient].map((item) => [
				item.project.id,
				lineOf(item),
			]),
		);
		for (const query of VIEWS) {
			const props = await propsOf(client, "list-facts-109", s.asha, query);
			assert.equal(props.page.total, rowsOf(props).length, query);
			for (const row of rowsOf(props)) {
				assert.include(mine, row.id, `${query}: ${row.clientName}`);
				assert.isNull(row.artistName, query);
				// A line is only what work() gives this artist; no money fact.
				assert.deepEqual(row.line, workLines.get(row.id) ?? null, query);
			}
			const everything = JSON.stringify(props.projects);
			for (const hidden of [
				"still due",
				"price has ended",
				"deposit was kept",
				"Theirs",
				"Sita",
				...made.theirs.map(({ id }) => id),
			]) {
				assert.notInclude(everything, hidden, query);
			}
		}
		const proofs = await propsOf(
			client,
			"list-facts-109",
			s.asha,
			"?waiting=proofs",
		);
		assert.deepEqual(idsOf(proofs), []);
	});

	test("every view costs the same queries for one and three of each", async ({
		client,
		assert,
	}) => {
		const s = await studio("list-queries-109");
		const seed = (copies: number, label: string, firstDay: number) =>
			inTenant(s.tenant, async () => {
				await seedGroups(s.tenant, null, copies, label);
				for (let at = 0; at < copies; at++) {
					const owing = await makeProject(
						s.tenant,
						await makeClient(s.tenant, { name: `${label}Owing ${at}` }),
						{ status: "completed" },
					);
					await makeQuote(s.tenant, owing);
					const withdrawn = await makeProject(
						s.tenant,
						await makeClient(s.tenant, { name: `${label}Withdrawn ${at}` }),
						{ status: "cancelled" },
					);
					await makeQuote(s.tenant, withdrawn);
					await makePayment(s.tenant, withdrawn, {
						status: "verified",
						verifiedAt: DateTime.now(),
					});
					const planned = await makeProject(
						s.tenant,
						await makeClient(s.tenant, { name: `${label}Planned ${at}` }),
						{ status: "booked" },
					);
					await makeSession(
						s.tenant,
						planned,
						s.ashaProfile,
						sessionIn(firstDay + at),
					);
				}
				// Everything is Asha's, so the artist's views fill up too.
				await TattooProject.query()
					.where("tenant_id", s.tenant.id)
					.update({ artistId: s.ashaProfile.id });
			});
		const count = async (user: Who, query: string) => {
			const { result, queries } = await recordQueries(() =>
				client.get(list("list-queries-109", query)).withInertia().loginAs(user),
			);
			result.assertStatus(200);
			return queries.length;
		};
		const views: [string, Who, string][] = [
			["owner", s.owner, ""],
			["owner", s.owner, "?status=needs_you"],
			["owner", s.owner, "?waiting=deposits"],
			["owner", s.owner, "?waiting=on_client"],
			["owner", s.owner, "?status=closed"],
			["owner", s.owner, "?sort=contact"],
			["artist", s.asha, ""],
			["artist", s.asha, "?status=needs_you"],
		];

		await seed(1, "One ", 3);
		const few = new Map<string, number>();
		for (const [who, user, query] of views) {
			await count(user, query); // warm up
			few.set(`${who}${query}`, await count(user, query));
		}
		await seed(2, "More ", 10);
		for (const [who, user, query] of views) {
			assert.equal(
				await count(user, query),
				few.get(`${who}${query}`),
				`${who} ${query || "(default)"}`,
			);
		}
	});
});
