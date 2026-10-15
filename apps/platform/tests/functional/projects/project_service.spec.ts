import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime, Settings } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import { ProjectRuleError, QuoteRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { MANUAL_MOVE_NAMES, type ManualMove } from "#modules/projects/moves";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService, {
	type NewQuote,
} from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

type TenantRef = { id: string };

const statusOf = async (project: TattooProject) =>
	(await TattooProject.findOrFail(project.id)).status;

/** A project in `status` whose only quote expired an hour ago. */
async function expiredQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	depositAmount = 300_000,
) {
	const project = await makeProject(tenant, await makeClient(tenant), {
		status,
	});
	const quote = await makeQuote(tenant, project, {
		depositAmount,
		expiresAt: DateTime.utc().minus({ hours: 1 }),
	});
	return { project, quote };
}

const fixed = (expiresAt = DateTime.utc().plus({ days: 14 })): NewQuote => ({
	kind: "fixed",
	fixedPrice: 1_500_000,
	depositAmount: 300_000,
	expiresAt,
});

/** The QuoteRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof QuoteRuleError) return error.reason;
		throw error;
	}
}

const queuedJobs = async () =>
	Number((await db.from("queue_jobs").count("* as n"))[0].n);

/** The ProjectRuleError reason `work` throws, or null if it succeeds. */
async function refusalOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof ProjectRuleError) return error.reason;
		throw error;
	}
}

/** The project rules' manual moves, written out apart from moves.ts. */
const EXPECTED_FROM: Record<ManualMove, ProjectStatus[]> = {
	hold: ["quoted"],
	resume: ["on_hold"],
	decline: ["reviewing"],
	withdraw: ["reviewing", "quoted", "on_hold", "deposit_pending"],
};
const EXPECTED_TO: Record<ManualMove, ProjectStatus> = {
	hold: "on_hold",
	resume: "quoted",
	decline: "declined",
	withdraw: "cancelled",
};

test.group("ProjectService.findFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner finds any live project of the tenant", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: artist.id,
			});

			const found = await projects.findFor(tenant, member, project.id);
			assert.equal(found.id, project.id);
			await assert.rejects(
				() => projects.findFor(tenant, member, randomUUID()),
				/Row not found/,
			);
		});
	});

	test("an artist finds only projects assigned to their own profile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const other = await makeArtist(tenant, "ram");
			const client = await makeClient(tenant);
			const assigned = await makeProject(tenant, client, { artistId: mine.id });
			const elsewhere = await makeProject(tenant, client, {
				artistId: other.id,
			});
			const unassigned = await makeProject(tenant, client);

			const asha = { userId: user.id, role: "artist" as const };
			assert.equal(
				(await projects.findFor(tenant, asha, assigned.id)).id,
				assigned.id,
			);
			for (const project of [elsewhere, unassigned]) {
				await assert.rejects(
					() => projects.findFor(tenant, asha, project.id),
					/Row not found/,
				);
			}

			// An artist with no profile of their own sees no project at all.
			const ram = { userId: stranger.id, role: "artist" as const };
			await assert.rejects(
				() => projects.findFor(tenant, ram, unassigned.id),
				/Row not found/,
			);
		});
	});

	test("another tenant's project is not found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const project = await inTenant(a, async () =>
			makeProject(a, await makeClient(a)),
		);

		await inTenant(b, async () => {
			await assert.rejects(
				() =>
					projects.findFor(b, { userId: ownerB.id, role: "owner" }, project.id),
				/Row not found/,
			);
		});
	});
});

test.group("ProjectService.expireQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("cancels a quoted or on-hold project once its current quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of ["quoted", "on_hold"] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isTrue(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), "cancelled", status);
			}
		});
	});

	test("cancels an accepted project whose deposit is not settled", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.equal(await statusOf(project), "cancelled");
		});
	});

	test("spares an accepted project whose deposit is settled or zero", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const paid = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, paid.project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			assert.isFalse(
				await projects.expireQuote(tenant, paid.project.id, paid.quote.id),
			);
			assert.equal(await statusOf(paid.project), "deposit_pending");

			const free = await expiredQuote(tenant, "deposit_pending", 0);
			assert.isFalse(
				await projects.expireQuote(tenant, free.project.id, free.quote.id),
			);
			assert.equal(await statusOf(free.project), "deposit_pending");
		});
	});

	test("spares a quoted or on-hold project whose deposit was already paid", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of ["quoted", "on_hold"] as const) {
				// Paid, then revised: the project went back from deposit_pending.
				const { project, quote } = await expiredQuote(tenant, status);
				await makePayment(tenant, project, {
					status: "verified",
					verifiedAt: DateTime.utc(),
				});
				assert.isFalse(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), status, status);
			}
		});
	});

	test("still cancels a quoted project with a zero deposit that nobody accepted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted", 0);
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.equal(await statusOf(project), "cancelled");
		});
	});

	test("leaves every other status alone", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"booked",
				"in_progress",
				"completed",
				"healing_check",
				"declined",
				"cancelled",
			] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isFalse(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("ignores a quote that has not expired or is no longer current", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const live = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().plus({ days: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, project.id, live.id));

			// v1's job runs after v2 replaced it; v2 has expired too, but v2's own
			// job decides that.
			const revised = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const v1 = await makeQuote(tenant, revised, {
				version: 1,
				expiresAt: DateTime.utc().minus({ days: 2 }),
			});
			await makeQuote(tenant, revised, {
				version: 2,
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, revised.id, v1.id));

			assert.equal(await statusOf(project), "quoted");
			assert.equal(await statusOf(revised), "quoted");
		});
	});

	test("cancels the project's scheduled sessions so the artist's time is free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			const artist = await makeArtist(tenant);
			const held = await makeSession(tenant, project, artist);
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			await held.refresh();
			await done.refresh();
			assert.equal(held.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});

	test("a second run, a missing project and a deleted one change nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));

			assert.isFalse(
				await projects.expireQuote(tenant, randomUUID(), randomUUID()),
			);

			const gone = await expiredQuote(tenant, "quoted");
			await gone.project.softDelete();
			assert.isFalse(
				await projects.expireQuote(tenant, gone.project.id, gone.quote.id),
			);
		});
	});
});

test.group("ProjectService.issueQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the first quote is version 1 and the project becomes quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const quote = await projects.issueQuote(tenant, project, fixed(), null);

			assert.equal(quote.version, 1);
			assert.equal(await statusOf(project), "quoted");
		});
	});

	test("every quotable status takes a revision and becomes quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
			] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const shown = await makeQuote(tenant, project);
				const quote = await projects.issueQuote(
					tenant,
					project,
					fixed(),
					shown.id,
				);

				assert.equal(quote.version, 2, status);
				assert.equal(await statusOf(project), "quoted", status);
			}
		});
	});

	test("a project past deposit_pending cannot be quoted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"booked",
				"in_progress",
				"completed",
				"healing_check",
				"declined",
				"cancelled",
			] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				assert.equal(
					await reasonOf(() =>
						projects.issueQuote(tenant, project, fixed(), null),
					),
					"project_closed",
					status,
				);
				assert.isNull(await quotes.current(tenant, project), status);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("a quote that is already expired is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(
						tenant,
						project,
						fixed(DateTime.utc().minus({ minutes: 1 })),
						null,
					),
				),
				"expired",
			);
			assert.equal(await statusOf(project), "reviewing");
		});
	});

	test("a quote that expired while waiting for the project lock is refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const start = DateTime.utc();
			const input = fixed(start.plus({ seconds: 30 }));

			// A clock that runs a minute on every reading: the quote is still valid
			// at the first check and long expired once the lock is held.
			const realNow = Settings.now;
			let tick = start.toMillis();
			Settings.now = () => {
				const reading = tick;
				tick += 60_000;
				return reading;
			};
			let reason: string | null = null;
			try {
				reason = await reasonOf(() =>
					projects.issueQuote(tenant, project, input, null),
				);
			} finally {
				Settings.now = realNow;
			}

			assert.equal(reason, "expired");
			assert.isNull(await quotes.current(tenant, project));
			assert.equal(await statusOf(project), "reviewing");
		});
	});

	test("a revision based on a superseded quote is refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const shown = await makeQuote(tenant, project);
			await makeQuote(tenant, project, { version: 2 });

			// The page showed v1 but v2 exists now; and a form that showed no
			// quote at all is just as stale.
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(tenant, project, fixed(), shown.id),
				),
				"quote_changed",
			);
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(tenant, project, fixed(), null),
				),
				"quote_changed",
			);
			assert.lengthOf(await quotes.history(tenant, project), 2);
			assert.equal(await statusOf(project), "quoted");
		});
	});

	test("the second of two first quotes is refused", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			assert.equal(
				(await projects.issueQuote(tenant, project, fixed(), null)).version,
				1,
			);
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(tenant, project, fixed(), null),
				),
				"quote_changed",
			);
			assert.lengthOf(await quotes.history(tenant, project), 1);
		});
	});

	test("queues ExpireQuoteJob to run when the quote expires", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		const quote = await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			return projects.issueQuote(tenant, project, fixed(), null);
		});

		const expected = quote.expiresAt.toMillis() - Date.now();
		fake.assertPushed(ExpireQuoteJob, {
			payload: {
				tenantId: tenant.id,
				projectId: quote.projectId,
				quoteId: quote.id,
			},
			delay: (delay) =>
				delay !== undefined && Math.abs(delay - expected) < 60_000,
		});
		assert.isAbove(expected, 0);
	});

	test("a rolled-back save leaves no quote and no job", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const before = await queuedJobs();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			await assert.rejects(
				() =>
					withTransaction(async () => {
						await projects.issueQuote(tenant, project, fixed(), null);
						throw new Error("roll back");
					}),
				"roll back",
			);
			assert.isNull(await quotes.current(tenant, project));
			assert.equal(await statusOf(project), "reviewing");
		});
		assert.equal(await queuedJobs(), before);
	});
});

test.group("ProjectService.acceptQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** A quoted project whose current quote is still valid. */
	async function quoted(tenant: TenantRef, depositAmount = 300_000) {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "quoted",
		});
		const quote = await makeQuote(tenant, project, { depositAmount });
		return { project, quote };
	}

	test("moves a quoted project to deposit_pending", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant);
			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"deposit_pending",
			);
			assert.equal(await statusOf(project), "deposit_pending");
		});
	});

	test("books at once when the deposit is zero and a tattoo session is held", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant, 0);
			await makeSession(tenant, project, await makeArtist(tenant));

			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"booked",
			);
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("waits for a session even when the deposit is already paid", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await quoted(tenant);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			assert.equal(
				await projects.acceptQuote(tenant, project, quote.id),
				"deposit_pending",
			);
		});
	});

	test("only a quoted project accepts", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"on_hold",
				"deposit_pending",
			] as const) {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				const quote = await makeQuote(tenant, project);
				assert.equal(
					await reasonOf(() => projects.acceptQuote(tenant, project, quote.id)),
					"not_quoted",
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("refuses a quote that was revised since the page loaded", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote: shown } = await quoted(tenant);
			await makeQuote(tenant, project, { version: 2 });

			assert.equal(
				await reasonOf(() => projects.acceptQuote(tenant, project, shown.id)),
				"quote_changed",
			);
			assert.equal(
				await reasonOf(() =>
					projects.acceptQuote(tenant, project, randomUUID()),
				),
				"quote_changed",
			);
			assert.equal(await statusOf(project), "quoted");
		});
	});

	test("refuses an expired quote", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted");
			assert.equal(
				await reasonOf(() => projects.acceptQuote(tenant, project, quote.id)),
				"expired",
			);
			assert.equal(await statusOf(project), "quoted");
		});
	});
});

test.group("ProjectService.move", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("every manual move works from exactly its allowed statuses", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const move of MANUAL_MOVE_NAMES) {
				for (const status of PROJECT_STATUSES) {
					const project = await makeProject(tenant, client, { status });
					const label = `${move} from ${status}`;
					if (EXPECTED_FROM[move].includes(status)) {
						assert.equal(
							await projects.move(tenant, project, move),
							EXPECTED_TO[move],
							label,
						);
						assert.equal(await statusOf(project), EXPECTED_TO[move], label);
					} else {
						assert.equal(
							await refusalOf(() => projects.move(tenant, project, move)),
							"move_not_allowed",
							label,
						);
						assert.equal(await statusOf(project), status, label);
					}
				}
			}
		});
	});

	test("a withdrawal cancels the scheduled sessions and keeps the others", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
			});
			const artist = await makeArtist(tenant);
			const held = await makeSession(tenant, project, artist);
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.equal(
				await projects.move(tenant, project, "withdraw"),
				"cancelled",
			);
			await held.refresh();
			await done.refresh();
			assert.equal(held.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});
});

test.group("ProjectService artist, notes and contact", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const reload = (project: TattooProject) =>
		TattooProject.findOrFail(project.id);

	test("an owner assigns and unassigns an artist; sessions keep theirs", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const asha = await makeArtist(tenant, "asha");
			const ram = await makeArtist(tenant, "ram");
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: asha.id,
			});
			const session = await makeSession(tenant, project, asha);

			await projects.assignArtist(tenant, member, project, ram.id);
			assert.equal((await reload(project)).artistId, ram.id);
			await session.refresh();
			assert.equal(session.artistId, asha.id);

			await projects.assignArtist(tenant, member, project, null);
			assert.isNull((await reload(project)).artistId);
		});
	});

	test("an artist member can't assign artists", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: mine.id,
			});

			await assert.rejects(
				() =>
					projects.assignArtist(
						tenant,
						{ userId: user.id, role: "artist" },
						project,
						null,
					),
				/Row not found/,
			);
			assert.equal((await reload(project)).artistId, mine.id);
		});
	});

	test("an unknown, deleted or other tenant's artist can't be assigned", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const member = { userId: owner.id, role: "owner" as const };
		const theirs = await inTenant(other, () => makeArtist(other, "theirs"));

		await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant, "gone");
			await gone.softDelete();
			const project = await makeProject(tenant, await makeClient(tenant));

			for (const artistId of [randomUUID(), gone.id, theirs.id]) {
				await assert.rejects(
					() => projects.assignArtist(tenant, member, project, artistId),
					/Row not found/,
				);
			}
			assert.isNull((await reload(project)).artistId);
		});
	});

	test("notes are trimmed, and empty notes clear", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));

			await projects.updateNotes(tenant, project, "  Prefers mornings.  ");
			assert.equal((await reload(project)).notes, "Prefers mornings.");

			await projects.updateNotes(tenant, project, "   ");
			assert.isNull((await reload(project)).notes);

			await projects.updateNotes(tenant, project, "Again");
			await projects.updateNotes(tenant, project, null);
			assert.isNull((await reload(project)).notes);
		});
	});

	test("markContacted records the time", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const before = DateTime.now().minus({ seconds: 1 });

			await projects.markContacted(tenant, project);
			const at = (await reload(project)).lastContactedAt;
			assert.isNotNull(at);
			assert.isTrue((at as DateTime) >= before);
		});
	});
});
