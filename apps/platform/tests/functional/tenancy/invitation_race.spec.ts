import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { errors as lucidErrors } from "@adonisjs/lucid";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import type User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import { InvitationRuleError } from "#modules/tenancy/errors";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import InvitationService from "#modules/tenancy/services/invitation_service";
import MemberService from "#modules/tenancy/services/member_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import {
	confirmedUser,
	invitationFlow,
	invite,
} from "#tests/helpers/invitations";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Real concurrency (TAT-33): these tests run outside the global
 * transaction the other tests use, because two requests racing need two
 * connections and rows the other can see. Their studios are committed and
 * removed again in the group's teardown.
 */

const artists = new ArtistService(new ImageService());
const members = new MemberService(new TenancyService(), artists);
const invitations = new InvitationService(artists);

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** How a promise ended, as a value, so a refusal can be asserted on. */
type Settled<T> = { value: T } | { error: unknown };

const settle = <T>(work: Promise<T>): Promise<Settled<T>> =>
	work.then(
		(value) => ({ value }),
		(error: unknown) => ({ error }),
	);

const errorOf = (settled: Settled<unknown>) =>
	"error" in settled ? settled.error : undefined;

/**
 * The accepting side of the race, held at a known point: after the
 * invitation's row lock (and whatever lock accept takes before it), before
 * the membership exists.
 */
class HeldAccept extends InvitationService {
	readonly reached = deferred();
	readonly release = deferred();

	protected override async membershipOf(
		tenant: { id: string },
		userId: string,
	) {
		this.reached.resolve();
		await this.release.promise;
		return super.membershipOf(tenant, userId);
	}
}

/**
 * Runs `fn` in the studio's context on a connection of its own and says
 * which backend that is, so the test can watch that one backend.
 */
async function onItsOwnConnection<T>(tenant: Tenant, fn: () => Promise<T>) {
	const backend = deferred<number>();
	const outcome = settle(
		inTenant(tenant, async () => {
			const { rows } = await dbClient().rawQuery(
				"select pg_backend_pid() as pid",
			);
			backend.resolve(rows[0].pid as number);
			return fn();
		}),
	);
	return { pid: await backend.promise, outcome };
}

/**
 * Waits until the backend `pid` waits for a lock another backend holds
 * (true), or its work has ended without waiting (false). Only this backend
 * counts: another session of the database waiting for a lock must not
 * release the test early.
 */
async function waitUntilBlocked(pid: number, ended: Promise<unknown>) {
	let over = false;
	void ended.then(() => {
		over = true;
	});
	for (let attempt = 0; attempt < 200; attempt++) {
		if (over) return false;
		const { rows } = await db
			.connection("owner")
			.rawQuery(
				"select count(*)::int as n from pg_stat_activity where pid = ? and wait_event_type = 'Lock'",
				[pid],
			);
		if (rows[0].n > 0) return true;
		await sleep(25);
	}
	throw new Error(`backend ${pid} never waited for a lock`);
}

const slugs: string[] = [];

/** Removes a committed studio and its accounts, whatever the test left. */
async function forget(slug: string) {
	await db.connection("owner").transaction(async (trx) => {
		// The studio's rows go in any order; no foreign key stands in the way.
		await trx.rawQuery("set local session_replication_role = replica");
		const { rows: studios } = await trx.rawQuery(
			"select id from tenants where slug = ?",
			[slug],
		);
		const { rows: tables } = await trx.rawQuery(
			"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
		);
		for (const { id } of studios) {
			for (const { table_name: table } of tables) {
				await trx.rawQuery(`delete from "${table}" where tenant_id = ?`, [id]);
			}
			await trx.rawQuery("delete from tenants where id = ?", [id]);
		}
		await trx.rawQuery("delete from users where email like ?", [
			`%@${slug}.example`,
		]);
	});
}

/** A committed studio with an owner, a confirmed invitee and a pending invitation for them. */
async function studioWithInvitee() {
	const slug = `race-${randomBytes(4).toString("hex")}`;
	slugs.push(slug);
	const { owner, tenant } = await studioWithOwner(slug, "Race 33");
	const invitee = await confirmedUser(`ink@${slug}.example`);
	const first = await invite(tenant, owner, {
		email: invitee.email,
		role: "artist",
	});
	return { owner, tenant, invitee, first };
}

const rowsFor = (tenant: Tenant, email: string) =>
	inTenant(tenant, () =>
		TenantInvitation.query()
			.where("tenant_id", tenant.id)
			.where("email", email),
	);

const liveMembership = (tenant: Tenant, user: User) =>
	inTenant(tenant, () =>
		TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", user.id)
			.first(),
	);

/**
 * The invitee accepts while an owner sends the invitation again. The
 * accepting transaction is held after its locks; the owner's request starts
 * and, once it is waiting for a lock, accept goes on. Resolves with what each
 * side ended in.
 */
async function reinviteWhileAccepting(world: {
	owner: User;
	tenant: Tenant;
	invitee: User;
	first: { token: string };
}) {
	const { owner, tenant, invitee, first } = world;
	const accepting = new HeldAccept(artists);
	const joining = accepting.accept(
		invitee,
		first.token,
		invitationFlow(first.token),
	);
	await accepting.reached.promise;

	const reinviting = await onItsOwnConnection(tenant, () =>
		invite(tenant, owner, { email: invitee.email, role: "owner" }),
	);
	if (!(await waitUntilBlocked(reinviting.pid, reinviting.outcome))) {
		throw new Error(
			"the second invitation ended without waiting for the first",
		);
	}
	accepting.release.resolve();

	return { joined: await joining, again: await reinviting.outcome };
}

test.group(
	"InvitationService: sending again while the address joins (TAT-33)",
	(group) => {
		group.each.teardown(async () => {
			for (const slug of slugs.splice(0)) await forget(slug);
		});

		test("an invitation sent again during the accept is refused: a member's address keeps no invitation", async ({
			assert,
		}) => {
			const world = await studioWithInvitee();

			const { joined, again } = await reinviteWhileAccepting(world);

			assert.equal(joined.role, "artist");
			assert.isNotNull(await liveMembership(world.tenant, world.invitee));
			assert.deepEqual(
				(await rowsFor(world.tenant, world.invitee.email)).map(
					({ role }) => role,
				),
				[],
				"the address is a member now: no invitation may be left for it",
			);
			assert.instanceOf(errorOf(again), InvitationRuleError);
			assert.equal(
				(errorOf(again) as InvitationRuleError).reason,
				"already_member",
			);
		}).timeout(20000);

		test("a member removed after that race can't come back with a link left behind", async ({
			assert,
		}) => {
			const world = await studioWithInvitee();
			const { again } = await reinviteWhileAccepting(world);
			const membership = await inTenant(world.tenant, () =>
				TenantMembership.query()
					.where("tenant_id", world.tenant.id)
					.where("user_id", world.invitee.id)
					.firstOrFail(),
			);

			await inTenant(world.tenant, () =>
				members.remove(world.tenant, { userId: world.owner.id }, membership.id),
			);

			// Whatever link the owner's second request made (none, once the two
			// are serialised), using it must not restore the access.
			const leftover = "value" in again ? again.value.token : undefined;
			if (leftover) {
				await invitations
					.accept(world.invitee, leftover, invitationFlow(leftover))
					.catch((error: unknown) => {
						if (!(error instanceof InvitationRuleError)) throw error;
					});
			}
			assert.isNull(
				await liveMembership(world.tenant, world.invitee),
				"the removed member is not a member again",
			);
			assert.lengthOf(await rowsFor(world.tenant, world.invitee.email), 0);
		}).timeout(20000);
	},
);

/**
 * A committed studio with two owners: `owner` sends owner invitations,
 * `other` is who removes or demotes them. `alternate` is an address of
 * `owner`'s own, with an account that could accept a link sent to it.
 */
async function studioWithTwoOwners() {
	const slug = `race-${randomBytes(4).toString("hex")}`;
	slugs.push(slug);
	const { owner, tenant } = await studioWithOwner(slug, "Race 33");
	const other = await confirmedUser(`second@${slug}.example`);
	await inTenant(tenant, () =>
		TenantMembership.create({
			tenantId: tenant.id,
			userId: other.id,
			role: "owner",
		}),
	);
	const alternate = await confirmedUser(`alternate@${slug}.example`);
	const membership = await liveMembership(tenant, owner);
	if (!membership) throw new Error("the owner has no membership");
	return { owner, other, alternate, tenant, membership };
}

type TwoOwners = Awaited<ReturnType<typeof studioWithTwoOwners>>;

/**
 * The two ways an owner makes a link for their alternate address. Each
 * prepares what it needs (committed, before the race) and gives the step
 * that races. Renewing takes over an invitation the other owner made, so
 * the removal's cleanup, which looks for what the owner sent, can't see it.
 */
const ISSUES: {
	name: string;
	prepare: (world: TwoOwners) => Promise<() => Promise<{ token: string }>>;
}[] = [
	{
		name: "invites",
		prepare:
			async ({ tenant, owner, alternate }) =>
			() =>
				invite(tenant, owner, { email: alternate.email, role: "owner" }),
	},
	{
		name: "renews an invitation",
		prepare: async ({ tenant, owner, other, alternate }) => {
			const pending = await invite(tenant, other, {
				email: alternate.email,
				role: "owner",
			});
			return () =>
				inTenant(tenant, () => invitations.renew(tenant, owner, pending.id));
		},
	},
];

/** What the other owner does to the one who is sending the link. */
const CHANGES: {
	name: string;
	run: (world: TwoOwners) => Promise<unknown>;
}[] = [
	{
		name: "removes them",
		run: ({ tenant, other, membership }) =>
			members.remove(tenant, { userId: other.id }, membership.id),
	},
	{
		name: "demotes them to artist",
		run: ({ tenant, other, membership }) =>
			members.changeRole(tenant, { userId: other.id }, membership.id, "artist"),
	},
];

/**
 * Runs `fn` in the studio's context and keeps its transaction open, uncommitted,
 * after `fn` is done, until `release()`.
 */
function heldOpen<T>(tenant: Tenant, fn: () => Promise<T>) {
	const reached = deferred();
	const release = deferred();
	const outcome = settle(
		inTenant(tenant, async () => {
			const value = await fn().finally(() => reached.resolve());
			await release.promise;
			return value;
		}),
	);
	return { reached: reached.promise, release: release.resolve, outcome };
}

/**
 * One side runs and stays uncommitted; the other starts on a second
 * connection and is given time to run into it (or finish, if nothing stops
 * it); then the first side commits. Resolves with how each ended, and
 * whether the second one had to wait for a lock.
 */
async function raceIssueAndChange(
	world: TwoOwners,
	issue: () => Promise<{ token: string }>,
	change: () => Promise<unknown>,
	first: "issue" | "change",
) {
	const holding = first === "issue" ? issue : change;
	const racing = first === "issue" ? change : issue;
	const held = heldOpen(world.tenant, holding);
	await held.reached;
	const second = await onItsOwnConnection(world.tenant, racing);
	const waited = await waitUntilBlocked(second.pid, second.outcome);
	held.release();
	const [heldEnd, racingEnd] = await Promise.all([
		held.outcome,
		second.outcome,
	]);
	return first === "issue"
		? {
				issued: heldEnd as Settled<{ token: string }>,
				changed: racingEnd,
				waited,
			}
		: {
				issued: racingEnd as Settled<{ token: string }>,
				changed: heldEnd,
				waited,
			};
}

test.group(
	"An owner's link and the same owner's removal or demotion (TAT-33)",
	(group) => {
		group.each.teardown(async () => {
			for (const slug of slugs.splice(0)) await forget(slug);
		});

		for (const issue of ISSUES) {
			for (const change of CHANGES) {
				for (const first of ["issue", "change"] as const) {
					const order =
						first === "issue"
							? "the link is made first, uncommitted"
							: "the change is made first, uncommitted";
					test(`an owner who ${issue.name} while another owner ${change.name}: ${order}, and no owner link outlives them`, async ({
						assert,
					}) => {
						const world = await studioWithTwoOwners();
						const step = await issue.prepare(world);

						const { issued, changed, waited } = await raceIssueAndChange(
							world,
							step,
							() => change.run(world),
							first,
						);

						assert.isUndefined(
							errorOf(changed),
							"the owner is removed or demoted",
						);
						if (first === "change") {
							assert.instanceOf(
								errorOf(issued),
								lucidErrors.E_ROW_NOT_FOUND,
								"someone who is no longer an owner makes no link",
							);
						}
						assert.lengthOf(
							await inTenant(world.tenant, () =>
								TenantInvitation.query()
									.where("tenant_id", world.tenant.id)
									.where("invited_by_user_id", world.owner.id)
									.where("role", "owner"),
							),
							0,
							"no owner invitation sent by the departed owner is left",
						);
						// Whatever link they made, using it must not make an owner.
						const token = "value" in issued ? issued.value.token : undefined;
						if (token) {
							await invitations
								.accept(world.alternate, token, invitationFlow(token))
								.catch((error: unknown) => {
									if (!(error instanceof InvitationRuleError)) throw error;
								});
						}
						assert.isNull(
							await liveMembership(world.tenant, world.alternate),
							"the owner's alternate address did not join",
						);
						assert.isTrue(
							waited,
							"the second request waited for the first one's locks",
						);
					}).timeout(20000);
				}
			}
		}
	},
);
