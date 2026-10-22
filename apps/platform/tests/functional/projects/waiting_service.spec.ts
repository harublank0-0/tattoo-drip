import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { expiresAtFor, todayIn } from "#modules/projects/quotes";
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import WaitingService from "#modules/projects/services/waiting_service";
import type {
	ClientWaitReason,
	NeedsYouReason,
} from "#modules/projects/waiting";
import { proofFor } from "#tests/helpers/payments";
import {
	makeClient,
	makeDepositLink,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const KTM = "Asia/Kathmandu";
const waiting = () => app.container.make(WaitingService);

/** The studio's date `days` from today, as the day a quote is valid through. */
const dayIn = (now: DateTime, days: number) =>
	DateTime.fromISO(todayIn(KTM, now), { zone: "utc" })
		.plus({ days })
		.toFormat("yyyy-MM-dd");

type Studio = Awaited<ReturnType<typeof studio>>;

/** A studio with an owner, an artist member (Asha, linked to her profile) and a second profile (Sita). */
async function studio(slug = "waiting-107") {
	const { owner, tenant } = await studioWithOwner(slug);
	const user = await artistIn(tenant, `asha@${slug}.example`);
	const profiles = await inTenant(tenant, async () => ({
		asha: await Artist.create({
			tenantId: tenant.id,
			name: "Asha",
			slug: "asha",
			userId: user.id,
		}),
		sita: await Artist.create({
			tenantId: tenant.id,
			name: "Sita",
			slug: "sita",
		}),
	}));
	const ownerMember: Member = { userId: owner.id, role: "owner" };
	const ashaMember: Member = { userId: user.id, role: "artist" };
	return { owner, tenant, ownerMember, ashaMember, ...profiles };
}

/**
 * One project per reason, all assigned to Asha, plus two that wait for
 * nothing. `copies` repeats the set (distinct clients). Call inside
 * `inTenant(tenant, …)`.
 */
async function everyReason(
	{ tenant, asha }: Pick<Studio, "tenant" | "asha">,
	now: DateTime,
	copies = 1,
) {
	const made: Record<string, string[]> = {};
	const add = (key: string, id: string) => {
		made[key] = [...(made[key] ?? []), id];
	};
	for (let at = 0; at < copies; at++) {
		const client = await makeClient(tenant);
		const project = async (status: ProjectStatus) =>
			makeProject(tenant, client, { status, artistId: asha.id });
		const ending = expiresAtFor(dayIn(now, 1), KTM);

		const proof = await project("deposit_pending");
		await makeQuote(tenant, proof);
		await proofFor(tenant, proof);
		add("proof_to_check", proof.id);

		add("price_to_send", (await project("reviewing")).id);

		const endingSoon = await project("quoted");
		await makeQuote(tenant, endingSoon, { expiresAt: ending });
		add("quote_ending", endingSoon.id);

		const noLink = await project("deposit_pending");
		await makeQuote(tenant, noLink);
		add("deposit_link_missing", noLink.id);

		const unpaid = await project("deposit_pending");
		await makeQuote(tenant, unpaid);
		await makeDepositLink(tenant, unpaid, {
			updatedAt: now.minus({ days: 4 }),
		});
		add("deposit_unpaid", unpaid.id);

		add("no_session", (await project("booked")).id);

		const sent = await project("quoted");
		await makeQuote(tenant, sent);
		add("price_sent", sent.id);

		const hold = await project("on_hold");
		await makeQuote(tenant, hold);
		add("on_hold", hold.id);

		const fresh = await project("deposit_pending");
		await makeQuote(tenant, fresh);
		await makeDepositLink(tenant, fresh);
		add("deposit_link_sent", fresh.id);

		add("nothing:in_progress", (await project("in_progress")).id);
		add("nothing:completed", (await project("completed")).id);
	}
	return made;
}

const STUDIO_REASONS: NeedsYouReason[] = [
	"proof_to_check",
	"price_to_send",
	"quote_ending",
	"deposit_link_missing",
	"deposit_unpaid",
	"no_session",
];

/** The recorded queries that read the tables WaitingService asks about. */
const reads = (queries: string[]) =>
	queries.filter((sql) =>
		/from "(tattoo_projects|quotes|payments|deposit_links|project_sessions|artists)"/.test(
			sql,
		),
	);

test.group("WaitingService.work", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner's projects split into what needs the studio and what waits on clients, with words and cards", async ({
		assert,
	}) => {
		const s = await studio();
		const now = DateTime.now();
		const made = await inTenant(s.tenant, () => everyReason(s, now));

		const { needsYou, onClient } = await inTenant(s.tenant, async () =>
			(await waiting()).work(s.tenant, s.ownerMember, now),
		);

		const reasonOfProject = (id: string) =>
			[...needsYou, ...onClient].find(({ project }) => project.id === id)
				?.waiting?.reason;
		for (const reason of STUDIO_REASONS) {
			assert.equal(reasonOfProject(made[reason][0]), reason, reason);
		}
		const clientReasons: ClientWaitReason[] = [
			"price_sent",
			"on_hold",
			"deposit_link_sent",
		];
		for (const reason of clientReasons) {
			assert.equal(reasonOfProject(made[reason][0]), reason, reason);
		}
		assert.sameMembers(
			needsYou.map(({ waiting: w }) => w?.reason),
			STUDIO_REASONS,
		);
		assert.sameMembers(
			onClient.map(({ waiting: w }) => w?.reason),
			clientReasons,
		);
		assert.isTrue(needsYou.every(({ waiting: w }) => w?.side === "studio"));
		assert.isTrue(onClient.every(({ waiting: w }) => w?.side === "client"));

		const find = (reason: string) =>
			[...needsYou, ...onClient].find(({ waiting: w }) => w?.reason === reason);
		assert.equal(find("price_to_send")?.text, "Accepted today, no price yet");
		assert.equal(find("price_to_send")?.hash, "quote-form");
		assert.equal(find("proof_to_check")?.hash, "payments");
		assert.equal(find("quote_ending")?.text, "The price ends tomorrow");
		assert.equal(find("quote_ending")?.hash, "quote");
		assert.equal(find("deposit_link_missing")?.text, "No deposit link yet");
		assert.equal(
			find("deposit_unpaid")?.text,
			"Deposit not paid, link made 4 days ago",
		);
		assert.equal(find("deposit_unpaid")?.hash, "deposit");
		assert.equal(
			find("no_session")?.text,
			"Booked, no session in the calendar",
		);
		assert.equal(find("no_session")?.hash, "sessions");
		assert.equal(find("price_sent")?.text, "Price sent today");
		assert.equal(find("on_hold")?.hash, null);
		assert.equal(
			find("deposit_link_sent")?.text,
			"Deposit link sent less than a day ago",
		);

		const everyone = [...needsYou, ...onClient].map(
			({ project }) => project.id,
		);
		assert.notInclude(everyone, made["nothing:in_progress"][0]);
		assert.notInclude(everyone, made["nothing:completed"][0]);
	});

	test("an artist gets only their own projects, no screenshots and no link reasons, and runs no link query", async ({
		assert,
	}) => {
		const s = await studio("waiting-artist-107");
		const now = DateTime.now();
		const made = await inTenant(s.tenant, async () => {
			const own = await everyReason(s, now);
			// The same kinds of project, assigned to Sita: not Asha's to see.
			const client = await makeClient(s.tenant);
			const other = await makeProject(s.tenant, client, {
				status: "reviewing",
				artistId: s.sita.id,
			});
			own.other = [other.id];
			return own;
		});

		const { result, queries } = await recordQueries(() =>
			inTenant(s.tenant, async () =>
				(await waiting()).work(s.tenant, s.ashaMember, now),
			),
		);
		const { needsYou, onClient } = result;

		const all = [...needsYou, ...onClient];
		const reasons = all.map(({ waiting: w }) => w?.reason);
		assert.notInclude(reasons, "proof_to_check");
		assert.notInclude(reasons, "deposit_link_missing");
		assert.notInclude(reasons, "deposit_unpaid");
		assert.notInclude(reasons, "deposit_link_sent");
		assert.notInclude(
			all.map(({ project }) => project.id),
			made.other[0],
		);
		// Every uncovered deposit is the client's to pay, whatever the link is.
		const due = all.filter(({ waiting: w }) => w?.reason === "deposit_due");
		assert.sameMembers(
			due.map(({ project }) => project.id),
			[
				// A waiting screenshot is the owner's to check, but the project is still the
				// artist's: they see it under what it would be without the screenshot.
				made.proof_to_check[0],
				made.deposit_link_missing[0],
				made.deposit_unpaid[0],
				made.deposit_link_sent[0],
			],
		);
		assert.isTrue(due.every(({ text }) => text === "Waiting for the deposit"));
		assert.deepEqual(
			queries.filter((sql) => sql.includes("deposit_links")),
			[],
		);
	});

	test("rows are oldest wait first", async ({ assert }) => {
		const s = await studio("waiting-sort-107");
		const now = DateTime.now();
		const ids = await inTenant(s.tenant, async () => {
			const client = await makeClient(s.tenant);
			const older = await makeProject(s.tenant, client, {
				status: "reviewing",
				createdAt: now.minus({ days: 5 }),
			});
			const newer = await makeProject(s.tenant, client, {
				status: "reviewing",
				createdAt: now.minus({ days: 1 }),
			});
			const soon = await makeProject(s.tenant, client, { status: "quoted" });
			await makeQuote(s.tenant, soon, {
				expiresAt: expiresAtFor(dayIn(now, 2), KTM),
			});
			const sooner = await makeProject(s.tenant, client, { status: "quoted" });
			await makeQuote(s.tenant, sooner, {
				expiresAt: expiresAtFor(dayIn(now, 0), KTM),
			});
			return { older, newer, soon, sooner };
		});

		const { needsYou } = await inTenant(s.tenant, async () =>
			(await waiting()).work(s.tenant, s.ownerMember, now),
		);

		const order = (reason: string) =>
			needsYou
				.filter(({ waiting: w }) => w?.reason === reason)
				.map(({ project }) => project.id);
		assert.deepEqual(order("price_to_send"), [ids.older.id, ids.newer.id]);
		assert.deepEqual(order("quote_ending"), [ids.sooner.id, ids.soon.id]);
	});

	test("needsYouCount is the number of rows that need the member, for both roles", async ({
		assert,
	}) => {
		const s = await studio("waiting-count-107");
		const now = DateTime.now();
		await inTenant(s.tenant, () => everyReason(s, now, 2));

		await inTenant(s.tenant, async () => {
			const service = await waiting();
			for (const member of [s.ownerMember, s.ashaMember]) {
				const { needsYou } = await service.work(s.tenant, member, now);
				assert.isAbove(needsYou.length, 0);
				assert.equal(
					await service.needsYouCount(s.tenant, member, now),
					needsYou.length,
					member.role,
				);
			}
		});
	});

	test("the queries do not grow with the projects: five at most", async ({
		assert,
	}) => {
		const s = await studio("waiting-queries-107");
		const now = DateTime.now();
		const counts: Record<string, number[]> = { owner: [], artist: [] };
		for (const copies of [1, 3]) {
			await inTenant(s.tenant, () => everyReason(s, now, copies === 1 ? 1 : 2));
			for (const member of [s.ownerMember, s.ashaMember]) {
				const { queries } = await recordQueries(() =>
					inTenant(s.tenant, async () =>
						(await waiting()).work(s.tenant, member, now),
					),
				);
				counts[member.role].push(reads(queries).length);
			}
		}
		assert.equal(counts.owner[1], counts.owner[0], "owner");
		assert.equal(counts.artist[1], counts.artist[0], "artist");
		assert.isAtMost(counts.owner[0], 5);
		assert.isAtMost(counts.artist[0], 5);
	});

	test("another studio's context sees nothing of this studio", async ({
		assert,
	}) => {
		const a = await studio("waiting-a-107");
		const b = await studio("waiting-b-107");
		const now = DateTime.now();
		await inTenant(a.tenant, () => everyReason(a, now));

		const fromB = await inTenant(b.tenant, async () =>
			(await waiting()).work(a.tenant, a.ownerMember, now),
		);
		assert.deepEqual(fromB.needsYou, []);
		assert.deepEqual(fromB.onClient, []);
		const own = await inTenant(b.tenant, async () =>
			(await waiting()).work(b.tenant, b.ownerMember, now),
		);
		assert.deepEqual(own.needsYou, []);
	});

	test("forProjects answers for the projects it is given, each with its own state", async ({
		assert,
	}) => {
		const s = await studio("waiting-for-107");
		const now = DateTime.now();
		const { projects, session } = await inTenant(s.tenant, async () => {
			const client = await makeClient(s.tenant);
			const booked = await makeProject(s.tenant, client, {
				status: "booked",
				artistId: s.asha.id,
			});
			const settled = await makeProject(s.tenant, client, {
				status: "booked",
				artistId: s.asha.id,
			});
			await makeSession(s.tenant, settled, s.asha);
			const reviewing = await makeProject(s.tenant, client, {
				status: "reviewing",
			});
			const closed = await makeProject(s.tenant, client, {
				status: "declined",
			});
			return {
				projects: [booked, settled, reviewing, closed],
				session: settled,
			};
		});

		const map = await inTenant(s.tenant, async () =>
			(await waiting()).forProjects(s.tenant, s.ownerMember, projects, now),
		);

		assert.sameMembers(
			[...map.keys()],
			projects.map(({ id }) => id),
		);
		assert.equal(map.get(projects[0].id)?.waiting?.reason, "no_session");
		assert.isNull(map.get(session.id)?.waiting ?? null);
		assert.equal(map.get(projects[2].id)?.waiting?.reason, "price_to_send");
		assert.isNull(map.get(projects[3].id)?.waiting ?? null);
		assert.isNull(map.get(projects[3].id)?.text ?? null);
	});

	test("a withdrawn project whose screenshot waits stays in the owner's work until it is decided (TAT-107 fix 1)", async ({
		assert,
	}) => {
		const s = await studio("waiting-withdrawn-107");
		const now = DateTime.now();
		const service = await waiting();
		const projects = await app.container.make(ProjectService);
		const { withdrawn, plain, decided, deleted } = await inTenant(
			s.tenant,
			async () => {
				const make = async (name: string) => {
					const project = await makeProject(
						s.tenant,
						await makeClient(s.tenant, { name }),
						{ status: "deposit_pending", artistId: s.asha.id },
					);
					await makeQuote(s.tenant, project);
					return project;
				};
				const withdrawn = await make("Withdrawn with a screenshot");
				const proof = await proofFor(s.tenant, withdrawn);
				const plain = await make("Withdrawn, nothing waiting");
				const decided = await make("Withdrawn, screenshot decided");
				await proofFor(s.tenant, decided, {
					status: "rejected",
					verifiedAt: DateTime.utc(),
				});
				const deleted = await make("Deleted with a screenshot");
				await proofFor(s.tenant, deleted);
				for (const project of [withdrawn, plain, decided, deleted]) {
					await projects.move(s.tenant, s.ownerMember, project, "withdraw");
				}
				await (await TattooProject.findOrFail(deleted.id)).softDelete();
				return { withdrawn, plain, decided, deleted, proof };
			},
		);

		const { needsYou } = await inTenant(s.tenant, () =>
			service.work(s.tenant, s.ownerMember, now),
		);

		// Only the cancelled project that still holds a waiting screenshot is work.
		assert.deepEqual(
			needsYou.map(({ project }) => [project.id, project.status]),
			[[withdrawn.id, "cancelled"]],
		);
		assert.equal(needsYou[0].waiting.reason, "proof_to_check");
		assert.equal(needsYou[0].hash, "payments");
		assert.notInclude(
			needsYou.map(({ project }) => project.id),
			plain.id,
		);
		assert.notInclude(
			needsYou.map(({ project }) => project.id),
			decided.id,
		);
		assert.notInclude(
			needsYou.map(({ project }) => project.id),
			deleted.id,
		);
		assert.equal(
			await inTenant(s.tenant, () =>
				service.needsYouCount(s.tenant, s.ownerMember, now),
			),
			1,
		);
		// An artist never acts on money, and a cancelled project is closed for them.
		const asArtist = await inTenant(s.tenant, () =>
			service.work(s.tenant, s.ashaMember, now),
		);
		assert.deepEqual(asArtist.needsYou, []);
		assert.deepEqual(asArtist.onClient, []);
	});

	test("screenshots are oldest first by when they were sent, not by the project's age", async ({
		assert,
	}) => {
		const s = await studio("waiting-proof-sort-107");
		const now = DateTime.now();
		const ids = await inTenant(s.tenant, async () => {
			const make = async (
				name: string,
				projectAge: number,
				sentAge: number,
			) => {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name }),
					{
						status: "deposit_pending",
						createdAt: now.minus({ days: projectAge }),
					},
				);
				await makeQuote(s.tenant, project);
				await proofFor(s.tenant, project, {
					createdAt: now.minus({ days: sentAge }),
				});
				return project.id;
			};
			// An old project with a fresh screenshot, a new one with an old screenshot.
			return {
				freshProof: await make("Old project, screenshot today", 30, 0),
				oldProof: await make("New project, screenshot 4 days ago", 5, 4),
			};
		});

		const { needsYou } = await inTenant(s.tenant, async () =>
			(await waiting()).work(s.tenant, s.ownerMember, now),
		);

		assert.deepEqual(
			needsYou.map(({ project }) => project.id),
			[ids.oldProof, ids.freshProof],
		);
	});

	test("a paid project whose quote has expired still needs its session (TAT-107 fix 2)", async ({
		assert,
	}) => {
		const s = await studio("waiting-expired-107");
		const now = DateTime.now();
		const made = await inTenant(s.tenant, async () => {
			const expired = { expiresAt: now.minus({ days: 2 }) };
			const make = async (status: ProjectStatus, name: string) => {
				const project = await makeProject(
					s.tenant,
					await makeClient(s.tenant, { name }),
					{ status, artistId: s.asha.id },
				);
				await makeQuote(s.tenant, project, expired);
				return project;
			};
			const pay = (project: TattooProject, amount = 300_000) =>
				makePayment(s.tenant, project, {
					amount,
					status: "verified",
					verifiedAt: DateTime.utc(),
				});
			const paid = await make("deposit_pending", "Paid, no session");
			await pay(paid);
			const half = await make("deposit_pending", "Half paid");
			await pay(half, 100_000);
			const unpaid = await make("deposit_pending", "Unpaid");
			const quotedPaid = await make("quoted", "Quoted, paid after a revision");
			await pay(quotedPaid);
			const quotedUnpaid = await make("quoted", "Quoted, unpaid");
			return { paid, half, unpaid, quotedPaid, quotedUnpaid };
		});

		const owner = await inTenant(s.tenant, async () =>
			(await waiting()).work(s.tenant, s.ownerMember, now),
		);
		const byReason = (
			items: { project: { id: string }; waiting: { reason: string } }[],
		) => Object.fromEntries(items.map((i) => [i.project.id, i.waiting.reason]));

		// The sweep cancels the unpaid and half-paid ones: they show nowhere.
		assert.deepEqual(byReason(owner.needsYou), {
			[made.paid.id]: "no_session",
		});
		assert.deepEqual(byReason(owner.onClient), {
			[made.quotedPaid.id]: "price_sent",
		});
		const artist = await inTenant(s.tenant, async () =>
			(await waiting()).work(s.tenant, s.ashaMember, now),
		);
		assert.deepEqual(byReason(artist.needsYou), {
			[made.paid.id]: "no_session",
		});
		assert.equal(
			await inTenant(s.tenant, async () =>
				(await waiting()).needsYouCount(s.tenant, s.ownerMember, now),
			),
			1,
		);
	});

	test("an empty list asks nothing", async ({ assert }) => {
		const s = await studio("waiting-empty-107");
		const { result, queries } = await recordQueries(() =>
			inTenant(s.tenant, async () =>
				(await waiting()).forProjects(s.tenant, s.ownerMember, []),
			),
		);
		assert.equal(result.size, 0);
		assert.deepEqual(reads(queries), []);
	});
});
