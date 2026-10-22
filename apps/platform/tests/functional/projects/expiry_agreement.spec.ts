import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import { depositSettled } from "#modules/payments/ledger";
import { expiryCancels } from "#modules/projects/expiry";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import WaitingService from "#modules/projects/services/waiting_service";
import { depositServices } from "#tests/helpers/deposits";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { projects } = depositServices();

/** What the expiry sweep does and what Today's rule says must be the same answer (TAT-107 fix 2). */
test.group("The expiry sweep and Today share one rule", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const CASES: {
		name: string;
		status: ProjectStatus;
		depositAmount: number;
		paid: number;
	}[] = [
		{
			name: "deposit_pending, nothing paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 0,
		},
		{
			name: "deposit_pending, half paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 150_000,
		},
		{
			name: "deposit_pending, fully paid",
			status: "deposit_pending",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "deposit_pending, zero deposit",
			status: "deposit_pending",
			depositAmount: 0,
			paid: 0,
		},
		{
			name: "quoted, nothing paid",
			status: "quoted",
			depositAmount: 300_000,
			paid: 0,
		},
		{
			name: "quoted, fully paid",
			status: "quoted",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "quoted, zero deposit",
			status: "quoted",
			depositAmount: 0,
			paid: 0,
		},
		{
			name: "on_hold, fully paid",
			status: "on_hold",
			depositAmount: 300_000,
			paid: 300_000,
		},
		{
			name: "on_hold, nothing paid",
			status: "on_hold",
			depositAmount: 300_000,
			paid: 0,
		},
	];

	test("expireQuote cancels exactly the projects expiryCancels says it does", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("expiry-agree-107");
		for (const { name, status, depositAmount, paid } of CASES) {
			const { project, quote, payments } = await inTenant(tenant, async () => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const quote = await makeQuote(tenant, project, {
					depositAmount,
					expiresAt: DateTime.utc().minus({ hours: 1 }),
				});
				const payments = paid
					? [
							await makePayment(tenant, project, {
								amount: paid,
								status: "verified",
								verifiedAt: DateTime.utc().minus({ days: 2 }),
							}),
						]
					: [];
				return { project, quote, payments };
			});
			const expected = expiryCancels({
				status,
				depositAmount,
				depositSettled: depositSettled(quote, payments),
			});

			const cancelled = await inTenant(tenant, () =>
				projects.expireQuote(tenant, project.id, quote.id),
			);

			assert.equal(cancelled, expected, name);
			const after = await inTenant(tenant, () =>
				TattooProject.findOrFail(project.id),
			);
			assert.equal(after.status, expected ? "cancelled" : status, name);
		}
	});
});

/**
 * Today shows exactly the projects the sweep leaves alone (TAT-107 fix round 2): a
 * decision about the deposit made at or after the expiry (a rejection, a partial
 * verification, a reversal) spares the project, so it stays on Today with the badge; one made
 * before the expiry does not, and the project is hidden because the sweep cancels it.
 */
test.group("Today and the sweep agree on expired quotes", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const now = DateTime.now();
	const EXPIRED = now.minus({ days: 3 });
	const EARLY = now.minus({ days: 5 });
	const LATE = now.minus({ days: 1 });
	type Timeline = (
		tenant: { id: string },
		project: TattooProject,
	) => Promise<unknown>;
	const pay = (
		tenant: { id: string },
		project: TattooProject,
		over: Parameters<typeof makePayment>[2],
	) => makePayment(tenant, project, over);
	const decided = (verifiedAt: DateTime) => ({
		verifiedAt,
		createdAt: verifiedAt.minus({ hours: 1 }),
	});

	const SCENARIOS: {
		name: string;
		status: ProjectStatus;
		timeline: Timeline;
		spared: boolean;
		/** What the owner's Today says about it while it stays; null when it is hidden. */
		ownerReason: string | null;
	}[] = [
		{
			name: "nothing paid",
			status: "deposit_pending",
			timeline: async () => undefined,
			spared: false,
			ownerReason: null,
		},
		{
			name: "a screenshot still waits",
			status: "deposit_pending",
			timeline: (tenant, project) => pay(tenant, project, { createdAt: LATE }),
			spared: true,
			ownerReason: "proof_to_check",
		},
		{
			name: "a rejection after the expiry",
			status: "deposit_pending",
			timeline: (tenant, project) =>
				pay(tenant, project, { status: "rejected", ...decided(LATE) }),
			spared: true,
			ownerReason: "deposit_link_missing",
		},
		{
			name: "a rejection before the expiry",
			status: "deposit_pending",
			timeline: (tenant, project) =>
				pay(tenant, project, { status: "rejected", ...decided(EARLY) }),
			spared: false,
			ownerReason: null,
		},
		{
			name: "a partial verification after the expiry",
			status: "deposit_pending",
			timeline: (tenant, project) =>
				pay(tenant, project, {
					amount: 100_000,
					status: "verified",
					...decided(LATE),
				}),
			spared: true,
			ownerReason: "deposit_link_missing",
		},
		{
			name: "a partial verification before the expiry",
			status: "deposit_pending",
			timeline: (tenant, project) =>
				pay(tenant, project, {
					amount: 100_000,
					status: "verified",
					...decided(EARLY),
				}),
			spared: false,
			ownerReason: null,
		},
		{
			name: "a reversal after the expiry",
			status: "deposit_pending",
			timeline: async (tenant, project) => {
				const deposit = await pay(tenant, project, {
					status: "verified",
					...decided(EARLY),
				});
				await pay(tenant, project, {
					kind: "correction",
					amount: -300_000,
					correctsPaymentId: deposit.id,
					status: "verified",
					...decided(LATE),
				});
			},
			spared: true,
			ownerReason: "deposit_link_missing",
		},
		{
			name: "a reversal before the expiry",
			status: "deposit_pending",
			timeline: async (tenant, project) => {
				const deposit = await pay(tenant, project, {
					status: "verified",
					...decided(EARLY.minus({ days: 1 })),
				});
				await pay(tenant, project, {
					kind: "correction",
					amount: -300_000,
					correctsPaymentId: deposit.id,
					status: "verified",
					...decided(EARLY),
				});
			},
			spared: false,
			ownerReason: null,
		},
		{
			name: "the deposit paid in full before the expiry",
			status: "deposit_pending",
			timeline: (tenant, project) =>
				pay(tenant, project, { status: "verified", ...decided(EARLY) }),
			spared: true,
			ownerReason: "no_session",
		},
		{
			name: "quoted, a partial verification after the expiry",
			status: "quoted",
			timeline: (tenant, project) =>
				pay(tenant, project, {
					amount: 100_000,
					status: "verified",
					...decided(LATE),
				}),
			spared: true,
			ownerReason: "price_sent",
		},
		{
			name: "quoted, a partial verification before the expiry",
			status: "quoted",
			timeline: (tenant, project) =>
				pay(tenant, project, {
					amount: 100_000,
					status: "verified",
					...decided(EARLY),
				}),
			spared: false,
			ownerReason: null,
		},
	];

	test("a project is on Today and in the badge exactly when the sweep leaves it alone", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("expiry-today-107");
		const user = await artistIn(tenant, "asha@expiry-today-107.example");
		const asha = await inTenant(tenant, () =>
			Artist.create({
				tenantId: tenant.id,
				name: "Asha",
				slug: "asha",
				userId: user.id,
			}),
		);
		const waiting = await app.container.make(WaitingService);
		const service = await app.container.make(ProjectService);
		const members = {
			owner: { userId: owner.id, role: "owner" as const },
			artist: { userId: user.id, role: "artist" as const },
		};

		type Who = typeof members.owner | typeof members.artist;
		for (const { name, status, timeline, spared, ownerReason } of SCENARIOS) {
			const { project, quote } = await inTenant(tenant, async () => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
					artistId: asha.id,
				});
				const quote = await makeQuote(tenant, project, {
					depositAmount: 300_000,
					expiresAt: EXPIRED,
				});
				await timeline(tenant, project);
				return { project, quote };
			});
			const reasonFor = (member: Who) =>
				inTenant(tenant, async () => {
					const work = await waiting.work(tenant, member, now);
					return (
						[...work.needsYou, ...work.onClient].find(
							(item) => item.project.id === project.id,
						)?.waiting.reason ?? null
					);
				});
			// Today is read before the sweep runs (it would cancel the project).
			const ownerSees = await reasonFor(members.owner);
			const artistSees = await reasonFor(members.artist);
			const cancelled = await inTenant(tenant, () =>
				service.expireQuote(tenant, project.id, quote.id),
			);

			assert.equal(cancelled, !spared, `${name}: the sweep`);
			assert.equal(ownerSees, ownerReason, `${name}: the owner's Today`);
			assert.equal(ownerSees !== null, !cancelled, `${name}: owner vs sweep`);
			assert.equal(artistSees !== null, !cancelled, `${name}: artist vs sweep`);
		}
	});
});
