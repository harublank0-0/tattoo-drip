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
import ProjectService, {
	type Member,
	PROJECTS_PER_PAGE,
} from "#modules/projects/services/project_service";
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

/** An owner: the service never reads the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

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

test.group("ProjectService.findManyFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the live projects among the ids; artists only those assigned to them", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const other = await makeArtist(tenant, "sita");
			const client = await makeClient(tenant);
			const assigned = await makeProject(tenant, client, { artistId: mine.id });
			const elsewhere = await makeProject(tenant, client, {
				artistId: other.id,
			});
			const deleted = await makeProject(tenant, client, { artistId: mine.id });
			await deleted.softDelete();
			const ids = [assigned.id, elsewhere.id, deleted.id, randomUUID()];
			const found = async (member: Member) =>
				(await projects.findManyFor(tenant, member, ids))
					.map(({ id }) => id)
					.sort();

			assert.deepEqual(
				await found({ userId: owner.id, role: "owner" }),
				[assigned.id, elsewhere.id].sort(),
			);
			assert.deepEqual(await found({ userId: user.id, role: "artist" }), [
				assigned.id,
			]);
			// No profile of their own: nothing.
			assert.deepEqual(
				await found({ userId: stranger.id, role: "artist" }),
				[],
			);
			assert.deepEqual(
				await projects.findManyFor(
					tenant,
					{ userId: owner.id, role: "owner" },
					[],
				),
				[],
			);
		});
	});

	test("another tenant's projects are never found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const theirs = await inTenant(b, async () =>
			makeProject(b, await makeClient(b)),
		);

		await inTenant(b, async () => {
			// Visible to row-level security here, but asked for as studio A's.
			assert.deepEqual(
				await projects.findManyFor(a, { userId: ownerB.id, role: "owner" }, [
					theirs.id,
				]),
				[],
			);
		});
	});
});

test.group("ProjectService.expireQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

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

	test("queues an early run again, and ignores a quote that is no longer current", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const live = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().plus({ days: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, project.id, live.id));
			const expected = live.expiresAt.toMillis() - Date.now();
			fake.assertPushed(ExpireQuoteJob, {
				payload: {
					tenantId: tenant.id,
					projectId: project.id,
					quoteId: live.id,
				},
				delay: (delay) =>
					delay !== undefined && Math.abs(delay - expected) < 60_000,
			});

			// v1's job runs after v2 replaced it; v2 has expired too, but v2's own
			// job decides that. Nothing is queued for v1.
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
			fake.assertPushedCount(1);

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
			const quote = await projects.issueQuote(
				tenant,
				OWNER,
				project,
				fixed(),
				null,
			);

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
					OWNER,
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
						projects.issueQuote(tenant, OWNER, project, fixed(), null),
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
						OWNER,
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
					projects.issueQuote(tenant, OWNER, project, input, null),
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
					projects.issueQuote(tenant, OWNER, project, fixed(), shown.id),
				),
				"quote_changed",
			);
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(tenant, OWNER, project, fixed(), null),
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
				(await projects.issueQuote(tenant, OWNER, project, fixed(), null))
					.version,
				1,
			);
			assert.equal(
				await reasonOf(() =>
					projects.issueQuote(tenant, OWNER, project, fixed(), null),
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
			return projects.issueQuote(tenant, OWNER, project, fixed(), null);
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
						await projects.issueQuote(tenant, OWNER, project, fixed(), null);
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
				await projects.acceptQuote(tenant, OWNER, project, quote.id),
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
				await projects.acceptQuote(tenant, OWNER, project, quote.id),
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
				await projects.acceptQuote(tenant, OWNER, project, quote.id),
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
					await reasonOf(() =>
						projects.acceptQuote(tenant, OWNER, project, quote.id),
					),
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
				await reasonOf(() =>
					projects.acceptQuote(tenant, OWNER, project, shown.id),
				),
				"quote_changed",
			);
			assert.equal(
				await reasonOf(() =>
					projects.acceptQuote(tenant, OWNER, project, randomUUID()),
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
				await reasonOf(() =>
					projects.acceptQuote(tenant, OWNER, project, quote.id),
				),
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
							await projects.move(tenant, OWNER, project, move),
							EXPECTED_TO[move],
							label,
						);
						assert.equal(await statusOf(project), EXPECTED_TO[move], label);
					} else {
						assert.equal(
							await refusalOf(() =>
								projects.move(tenant, OWNER, project, move),
							),
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
				await projects.move(tenant, OWNER, project, "withdraw"),
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

			await projects.updateNotes(
				tenant,
				OWNER,
				project,
				"  Prefers mornings.  ",
			);
			assert.equal((await reload(project)).notes, "Prefers mornings.");

			await projects.updateNotes(tenant, OWNER, project, "   ");
			assert.isNull((await reload(project)).notes);

			await projects.updateNotes(tenant, OWNER, project, "Again");
			await projects.updateNotes(tenant, OWNER, project, null);
			assert.isNull((await reload(project)).notes);
		});
	});

	test("markContacted records the time", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const before = DateTime.now().minus({ seconds: 1 });

			await projects.markContacted(tenant, OWNER, project);
			const at = (await reload(project)).lastContactedAt;
			assert.isNotNull(at);
			assert.isTrue((at as DateTime) >= before);
		});
	});
});

test.group("ProjectService.list and countByStatus", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const briefsOf = (list: TattooProject[]) => list.map(({ brief }) => brief);

	/** One project per status, each with its status as its brief. */
	async function oneOfEach(tenant: TenantRef) {
		const client = await makeClient(tenant);
		for (const status of PROJECT_STATUSES) {
			await makeProject(tenant, client, { status, brief: status });
		}
	}

	test("filters by active, closed or one status", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			await oneOfEach(tenant);

			const active = await projects.list(tenant, member, "active", 1);
			assert.sameMembers(briefsOf(active.projects), [
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
				"booked",
				"in_progress",
				"healing_check",
			]);
			const closed = await projects.list(tenant, member, "closed", 1);
			assert.sameMembers(briefsOf(closed.projects), [
				"declined",
				"cancelled",
				"completed",
			]);
			const quoted = await projects.list(tenant, member, "quoted", 1);
			assert.deepEqual(briefsOf(quoted.projects), ["quoted"]);
		});
	});

	test("active sorts for follow-up; closed sorts newest first", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			await makeProject(tenant, client, {
				brief: "1 day ago",
				lastContactedAt: DateTime.utc().minus({ days: 1 }),
			});
			await makeProject(tenant, client, { brief: "never, first" });
			await makeProject(tenant, client, {
				brief: "5 days ago",
				lastContactedAt: DateTime.utc().minus({ days: 5 }),
			});
			await makeProject(tenant, client, { brief: "never, second" });

			const active = await projects.list(tenant, member, "active", 1);
			assert.deepEqual(briefsOf(active.projects), [
				"never, first",
				"never, second",
				"5 days ago",
				"1 day ago",
			]);

			const old = await makeProject(tenant, client, {
				status: "declined",
				brief: "closed long ago",
			});
			const recent = await makeProject(tenant, client, {
				status: "cancelled",
				brief: "closed recently",
			});
			await TattooProject.query()
				.where("id", old.id)
				.update({ updated_at: DateTime.utc().minus({ days: 10 }).toISO() });
			await TattooProject.query()
				.where("id", recent.id)
				.update({ updated_at: DateTime.utc().minus({ days: 1 }).toISO() });

			const closed = await projects.list(tenant, member, "closed", 1);
			assert.deepEqual(briefsOf(closed.projects), [
				"closed recently",
				"closed long ago",
			]);
		});
	});

	test("pages of 25", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (let i = 0; i < PROJECTS_PER_PAGE + 1; i++) {
				await makeProject(tenant, client);
			}

			const first = await projects.list(tenant, member, "active", 1);
			assert.lengthOf(first.projects, PROJECTS_PER_PAGE);
			assert.equal(first.total, PROJECTS_PER_PAGE + 1);
			assert.equal(first.lastPage, 2);
			assert.lengthOf(
				(await projects.list(tenant, member, "active", 2)).projects,
				1,
			);
			assert.lengthOf(
				(await projects.list(tenant, member, "active", 99)).projects,
				0,
			);
		});
	});

	test("an artist lists and counts only their own projects", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const client = await makeClient(tenant);
			await makeProject(tenant, client, { artistId: mine.id, brief: "mine" });
			await makeProject(tenant, client, {
				artistId: mine.id,
				status: "quoted",
				brief: "mine quoted",
			});
			await makeProject(tenant, client, { brief: "unassigned" });

			const asha = { userId: user.id, role: "artist" as const };
			assert.sameMembers(
				briefsOf((await projects.list(tenant, asha, "active", 1)).projects),
				["mine", "mine quoted"],
			);
			assert.deepEqual(await projects.countByStatus(tenant, asha), {
				reviewing: 1,
				quoted: 1,
			});

			// No profile of their own: nothing.
			const ram = { userId: stranger.id, role: "artist" as const };
			assert.lengthOf(
				(await projects.list(tenant, ram, "active", 1)).projects,
				0,
			);
			assert.deepEqual(await projects.countByStatus(tenant, ram), {});

			// Their profile deleted: nothing either.
			await mine.softDelete();
			assert.lengthOf(
				(await projects.list(tenant, asha, "active", 1)).projects,
				0,
			);
		});
	});

	test("an owner counts every live project by status", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			await oneOfEach(tenant);
			await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const gone = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await gone.softDelete();

			const counts = await projects.countByStatus(tenant, member);
			assert.equal(counts.quoted, 2, "the deleted one is not counted");
			assert.equal(counts.reviewing, 1);
			assert.equal(counts.completed, 1);
		});
	});

	test("another tenant lists and counts nothing", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		await inTenant(a, () => oneOfEach(a));
		const member = { userId: ownerB.id, role: "owner" as const };

		await inTenant(b, async () => {
			assert.lengthOf(
				(await projects.list(b, member, "active", 1)).projects,
				0,
			);
			assert.deepEqual(await projects.countByStatus(b, member), {});
		});
	});
});

test.group("ProjectService.move: sessions and deposits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a decline cancels the scheduled sessions and keeps the others", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "reviewing",
			});
			const artist = await makeArtist(tenant);
			const consult = await makeSession(tenant, project, artist, {
				kind: "consultation",
			});
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.equal(
				await projects.move(tenant, OWNER, project, "decline"),
				"declined",
			);
			await consult.refresh();
			await done.refresh();
			assert.equal(consult.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});

	test("a withdrawal is refused while any verified deposit money is held", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			// Fully paid with no session yet; paid, then revised back to quoted
			// or on hold; and only partly paid: all hold the client's money.
			for (const [status, paid] of [
				["deposit_pending", 300_000],
				["quoted", 300_000],
				["on_hold", 300_000],
				["deposit_pending", 100_000],
			] as const) {
				const project = await makeProject(tenant, client, { status });
				await makeQuote(tenant, project);
				await makePayment(tenant, project, {
					amount: paid,
					status: "verified",
					verifiedAt: DateTime.utc(),
				});
				const label = `${status}, ${paid} paid`;
				assert.equal(
					await refusalOf(() =>
						projects.move(tenant, OWNER, project, "withdraw"),
					),
					"deposit_paid",
					label,
				);
				assert.equal(await statusOf(project), status, label);
			}
		});
	});

	test("a withdrawal still works when no deposit money is held", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const unpaid = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, unpaid);
			const submitted = await makeProject(tenant, client, {
				status: "deposit_pending",
			});
			await makeQuote(tenant, submitted);
			// Proof uploaded but not verified yet: no money is held.
			await makePayment(tenant, submitted, { status: "submitted" });
			const zero = await makeProject(tenant, client, { status: "quoted" });
			await makeQuote(tenant, zero, { depositAmount: 0 });

			for (const project of [unpaid, submitted, zero]) {
				assert.equal(
					await projects.move(tenant, OWNER, project, "withdraw"),
					"cancelled",
				);
			}
		});
	});

	test("a reversed payment no longer holds money", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
			});
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			await makePayment(tenant, project, {
				kind: "correction",
				amount: -300_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});

			assert.equal(
				await projects.move(tenant, OWNER, project, "withdraw"),
				"cancelled",
			);
		});
	});
});

test.group(
	"ProjectService: authorization is rechecked under the lock",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("an artist can't act on a project reassigned after they loaded it", async ({
			assert,
		}) => {
			const { tenant, owner } = await studioWithOwner();
			const asha = await artistIn(tenant, "asha@example.com");
			const ashaMember = { userId: asha.id, role: "artist" as const };
			const ownerMember = { userId: owner.id, role: "owner" as const };

			await inTenant(tenant, async () => {
				const mine = await makeArtist(tenant, "asha");
				mine.userId = asha.id;
				await mine.save();
				const bina = await makeArtist(tenant, "bina");
				const project = await makeProject(tenant, await makeClient(tenant), {
					artistId: mine.id,
					status: "quoted",
				});
				const quote = await makeQuote(tenant, project);

				// Asha's request loaded the project, then waited while the owner
				// reassigned it: the sequential equivalent is a stale project object.
				const stale = await projects.findFor(tenant, ashaMember, project.id);
				await projects.assignArtist(tenant, ownerMember, project, bina.id);

				const refused = [
					() => projects.move(tenant, ashaMember, stale, "hold"),
					() => projects.updateNotes(tenant, ashaMember, stale, "mine now"),
					() => projects.markContacted(tenant, ashaMember, stale),
					() =>
						projects.issueQuote(tenant, ashaMember, stale, fixed(), quote.id),
					() => projects.acceptQuote(tenant, ashaMember, stale, quote.id),
				];
				for (const act of refused) {
					await assert.rejects(act, /Row not found/);
				}
				const live = await TattooProject.findOrFail(project.id);
				assert.equal(live.status, "quoted");
				assert.isNull(live.notes);
				assert.isNull(live.lastContactedAt);
				assert.equal(live.artistId, bina.id);
				assert.lengthOf(await quotes.history(tenant, project), 1);
			});
		});

		test("an artist whose profile was deleted can't act; the assigned artist and owners can", async ({
			assert,
		}) => {
			const { tenant } = await studioWithOwner();
			const asha = await artistIn(tenant, "asha@example.com");
			const ashaMember = { userId: asha.id, role: "artist" as const };

			await inTenant(tenant, async () => {
				const mine = await makeArtist(tenant, "asha");
				mine.userId = asha.id;
				await mine.save();
				const project = await makeProject(tenant, await makeClient(tenant), {
					artistId: mine.id,
					status: "quoted",
				});

				// Still assigned to them: they can act.
				assert.equal(
					await projects.move(tenant, ashaMember, project, "hold"),
					"on_hold",
				);
				// An owner always can.
				assert.equal(
					await projects.move(tenant, OWNER, project, "resume"),
					"quoted",
				);

				await mine.softDelete();
				await assert.rejects(
					() => projects.move(tenant, ashaMember, project, "hold"),
					/Row not found/,
				);
				assert.equal(await statusOf(project), "quoted");
			});
		});
	},
);
