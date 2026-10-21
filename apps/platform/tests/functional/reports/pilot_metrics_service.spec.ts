import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry from "#modules/inquiries/models/inquiry";
import InquiryService from "#modules/inquiries/services/inquiry_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import { noFacts } from "#modules/reports/pilot_metrics";
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const WINDOW = {
	from: DateTime.utc(2026, 11, 1),
	to: DateTime.utc(2026, 12, 1),
};
/** 10:00 UTC (or `hour`) on a day of November 2026. */
const nov = (day: number, hour = 10) => DateTime.utc(2026, 11, day, hour);
const verifiedOn = (at: DateTime) => ({
	status: "verified" as const,
	verifiedAt: at,
});

test.group("Pilot metrics reads (TAT-70)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("countReceived and countBookedAtDesk: the window's live inquiries, any status, and its live desk bookings", async ({
		assert,
	}) => {
		const inquiries = await app.container.make(InquiryService);
		const projects = await app.container.make(ProjectService);
		const { tenant } = await studioWithOwner("reads-a-70");
		const { tenant: other } = await studioWithOwner("reads-b-70");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeInquiry(tenant, client, { createdAt: nov(2) });
			await makeInquiry(tenant, client, {
				status: "declined",
				decidedAt: nov(3),
				createdAt: nov(3),
			});
			const accepted = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(5),
				createdAt: nov(4),
			});
			// Made from an inquiry: not a desk booking.
			await makeProject(tenant, client, {
				inquiryId: accepted.id,
				createdAt: nov(5),
			});
			const gone = await makeInquiry(tenant, client, { createdAt: nov(6) });
			await (await Inquiry.findOrFail(gone.id)).softDelete();
			// Outside the half-open window.
			await makeInquiry(tenant, client, {
				createdAt: DateTime.utc(2026, 10, 31, 23, 59),
			});
			await makeInquiry(tenant, client, { createdAt: WINDOW.to });

			await makeProject(tenant, client, {
				status: "booked",
				createdAt: nov(2),
			});
			const deleted = await makeProject(tenant, client, {
				status: "booked",
				createdAt: nov(10),
			});
			await (await TattooProject.findOrFail(deleted.id)).softDelete();
			await makeProject(tenant, client, {
				status: "booked",
				createdAt: DateTime.utc(2026, 10, 30),
			});
		});

		assert.equal(
			await inTenant(tenant, () => inquiries.countReceived(tenant, WINDOW)),
			3,
		);
		assert.equal(
			await inTenant(tenant, () => projects.countBookedAtDesk(tenant, WINDOW)),
			1,
		);
		// Another studio's context can't see these rows, even naming the tenant.
		assert.equal(
			await inTenant(other, () => inquiries.countReceived(tenant, WINDOW)),
			0,
		);
		assert.equal(
			await inTenant(other, () => projects.countBookedAtDesk(tenant, WINDOW)),
			0,
		);
	});

	test("firstVerifiedDeposits: each project's first verified deposit that no correction reverses, when that is in the window", async ({
		assert,
	}) => {
		const deposits = await app.container.make(DepositService);
		const projects = await app.container.make(ProjectService);
		const inquiries = await app.container.make(InquiryService);
		const { tenant } = await studioWithOwner("deposits-70");

		const made = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(1),
				createdAt: nov(1, 8),
			});
			const first = await makeProject(tenant, client, {
				inquiryId: inquiry.id,
				status: "booked",
			});
			await makePayment(tenant, first, verifiedOn(nov(3)));
			await makePayment(tenant, first, verifiedOn(nov(20)));

			// The first verification was reversed: the next one counts.
			const reversed = await makeProject(tenant, client, { status: "booked" });
			const mistake = await makePayment(tenant, reversed, verifiedOn(nov(2)));
			await makePayment(tenant, reversed, {
				kind: "correction",
				amount: -300_000,
				correctsPaymentId: mistake.id,
				...verifiedOn(nov(2, 11)),
			});
			await makePayment(tenant, reversed, verifiedOn(nov(8)));

			// First verified before the window: not this window's.
			const earlier = await makeProject(tenant, client, { status: "booked" });
			await makePayment(
				tenant,
				earlier,
				verifiedOn(DateTime.utc(2026, 10, 28)),
			);
			await makePayment(tenant, earlier, verifiedOn(nov(5)));

			// Waiting, rejected, or not a deposit: nothing.
			const waiting = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makePayment(tenant, waiting);
			await makePayment(tenant, waiting, {
				status: "rejected",
				verifiedAt: nov(4),
			});
			const balance = await makeProject(tenant, client, { status: "booked" });
			await makePayment(tenant, balance, {
				kind: "balance",
				...verifiedOn(nov(6)),
			});
			return { inquiry, first, reversed };
		});

		const rows = await inTenant(tenant, () =>
			deposits.firstVerifiedDeposits(tenant, WINDOW),
		);
		const byProject = new Map(
			rows.map(({ projectId, verifiedAt }) => [
				projectId,
				verifiedAt.toMillis(),
			]),
		);
		assert.deepEqual(
			[...byProject.entries()].sort(),
			[
				[made.first.id, nov(3).toMillis()],
				[made.reversed.id, nov(8).toMillis()],
			].sort(),
		);

		// Which projects came from an inquiry, and when that inquiry arrived.
		const inquiryOf = await inTenant(tenant, () =>
			projects.inquiryIdsFor(tenant, [made.first.id, made.reversed.id]),
		);
		assert.deepEqual(
			[...inquiryOf.entries()],
			[[made.first.id, made.inquiry.id]],
		);
		const received = await inTenant(tenant, () =>
			inquiries.receivedAt(tenant, [made.inquiry.id]),
		);
		assert.equal(
			received.get(made.inquiry.id)?.toMillis(),
			nov(1, 8).toMillis(),
		);
	});

	test("forStudio: the three facts from the studio's own data, and none from another studio's context", async ({
		assert,
	}) => {
		const metrics = await app.container.make(PilotMetricsService);
		const { tenant } = await studioWithOwner("facts-a-70");
		const { tenant: other } = await studioWithOwner("facts-b-70");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const artist = await makeArtist(tenant);
			// Two inquiries that became projects with verified deposits: 48 h and 12 h.
			const slow = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(1, 12),
				createdAt: nov(1, 10),
			});
			const quick = await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: nov(2, 6),
				createdAt: nov(2, 0),
			});
			for (const [inquiry, verified] of [
				[slow, nov(3, 10)],
				[quick, nov(2, 12)],
			] as const) {
				const project = await makeProject(tenant, client, {
					inquiryId: inquiry.id,
					status: "booked",
				});
				await makePayment(tenant, project, verifiedOn(verified));
			}
			// A desk booking: counted for the link share, not for the deposit time.
			const desk = await makeProject(tenant, client, {
				status: "booked",
				artistId: artist.id,
				createdAt: nov(4),
			});
			await makePayment(tenant, desk, verifiedOn(nov(5)));
			// Its sessions: one done, one missed, one past without an outcome, one cancelled.
			for (const [day, status] of [
				[6, "completed"],
				[7, "no_show"],
				[8, "scheduled"],
				[9, "cancelled"],
			] as const) {
				await makeSession(tenant, desk, artist, {
					status,
					startsAt: nov(day),
					endsAt: nov(day, 11),
				});
			}
		});

		const facts = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW, WINDOW.to),
		);
		assert.deepEqual(
			{ ...facts, depositHours: [...facts.depositHours].sort((a, b) => a - b) },
			{
				linkInquiries: 2,
				deskProjects: 1,
				depositHours: [12, 48],
				sessions: { completed: 1, noShow: 1, noOutcome: 1 },
			},
		);
		assert.deepEqual(
			await inTenant(other, () => metrics.forStudio(tenant, WINDOW)),
			noFacts(),
		);
	});

	test("forStudio: a window that reaches into the future doesn't count a session still to come as past without an outcome", async ({
		assert,
	}) => {
		const metrics = await app.container.make(PilotMetricsService);
		const { tenant } = await studioWithOwner("future-a-70");
		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const artist = await makeArtist(tenant);
			const project = await makeProject(tenant, client, {
				status: "booked",
				artistId: artist.id,
			});
			for (const [day, status] of [
				[6, "completed"],
				[8, "scheduled"],
				[9, "no_show"],
				// Still to come on the 10th: nobody can have recorded it yet.
				[20, "scheduled"],
			] as const) {
				await makeSession(tenant, project, artist, {
					status,
					startsAt: nov(day),
					endsAt: nov(day, 11),
				});
			}
		});

		const month = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW, nov(10)),
		);
		assert.deepEqual(month.sessions, {
			completed: 1,
			noShow: 1,
			noOutcome: 1,
		});
		// The same month judged after it ended: both scheduled ones are past.
		const later = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW, WINDOW.to),
		);
		assert.equal(later.sessions.noOutcome, 2);
	});

	test("forStudio: another studio's busy data never changes a studio's numbers", async ({
		assert,
	}) => {
		const metrics = await app.container.make(PilotMetricsService);
		const { tenant } = await studioWithOwner("alone-a-70");
		const { tenant: busy } = await studioWithOwner("alone-b-70");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeInquiry(tenant, client, { createdAt: nov(2) });
		});
		const before = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW),
		);

		// The other studio has inquiries, a desk booking, a deposit and sessions.
		await inTenant(busy, async () => {
			const client = await makeClient(busy);
			const artist = await makeArtist(busy);
			const inquiry = await makeInquiry(busy, client, {
				status: "accepted",
				decidedAt: nov(3),
				createdAt: nov(2),
			});
			await makeInquiry(busy, client, { createdAt: nov(4) });
			const project = await makeProject(busy, client, {
				inquiryId: inquiry.id,
				status: "booked",
				artistId: artist.id,
			});
			await makePayment(busy, project, verifiedOn(nov(5)));
			await makeProject(busy, client, { status: "booked", createdAt: nov(6) });
			await makeSession(busy, project, artist, {
				status: "no_show",
				startsAt: nov(7),
				endsAt: nov(7, 11),
			});
		});

		const after = await inTenant(tenant, () =>
			metrics.forStudio(tenant, WINDOW),
		);
		assert.deepEqual(after, before);
		assert.equal(after.linkInquiries, 1);
		const others = await inTenant(busy, () => metrics.forStudio(busy, WINDOW));
		assert.equal(others.linkInquiries, 2);
		assert.equal(others.deskProjects, 1);
		assert.lengthOf(others.depositHours, 1);
		assert.equal(others.sessions.noShow, 1);
	});
});
