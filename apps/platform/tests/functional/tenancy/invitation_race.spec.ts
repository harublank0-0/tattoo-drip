import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
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
