import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import User from "#models/user";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { MemberRuleError } from "#modules/tenancy/errors";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";

type TenantRef = { id: string };

/**
 * Removing members and changing their roles (TAT-33), owners only (the
 * routes are OWNERS in TENANT_ROUTE_ROLES; this service doesn't check who
 * acts, only that it isn't the target). Every removal and every demotion of
 * an owner calls TenancyService.assertKeepsAnOwner in its transaction,
 * which locks the owner rows, so a studio is never left without an owner.
 */
@inject()
export default class MemberService {
	constructor(
		private tenancy: TenancyService,
		private artists: ArtistService,
	) {}

	/** The studio's live membership `id`, or E_ROW_NOT_FOUND (a 404, like another studio's). */
	async findFor(tenant: TenantRef, id: string): Promise<TenantMembership> {
		return TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * Removes the member: their access ends on their next request (the
	 * tenant middleware reads the membership every time), every profile of
	 * the studio linked to them is unlinked (it stays with the studio, with
	 * its projects and sessions) and the membership is soft-deleted, in one
	 * transaction. LastOwnerError when they are the last owner;
	 * MemberRuleError("self") for the actor's own membership.
	 */
	async remove(
		tenant: TenantRef,
		actor: { userId: string },
		membershipId: string,
	): Promise<{ name: string }> {
		return withTransaction(async (trx) => {
			const target = await this.target(trx, tenant, actor, membershipId);
			await this.tenancy.assertKeepsAnOwner(trx, tenant.id, target.id);
			const live = await this.lock(trx, tenant, target.id);
			await this.artists.unlinkUser(tenant, live.userId);
			await live.softDelete(trx);
			return { name: await nameOf(live.userId) };
		});
	}

	/**
	 * Makes the member an owner or an artist. Demoting an owner needs
	 * another owner (LastOwnerError); the profile link stays.
	 * MemberRuleError("self") for the actor's own membership.
	 */
	async changeRole(
		tenant: TenantRef,
		actor: { userId: string },
		membershipId: string,
		role: MembershipRole,
	): Promise<{ name: string }> {
		const demotes = (current: MembershipRole) =>
			current === "owner" && role !== "owner";
		return withTransaction(async (trx) => {
			const target = await this.target(trx, tenant, actor, membershipId);
			if (demotes(target.role)) {
				await this.tenancy.assertKeepsAnOwner(trx, tenant.id, target.id);
			}
			const live = await this.lock(trx, tenant, target.id);
			// Made an owner by someone else while this request waited.
			if (demotes(live.role) && !demotes(target.role)) {
				await this.tenancy.assertKeepsAnOwner(trx, tenant.id, live.id);
			}
			if (live.role !== role) {
				live.role = role;
				await live.save();
			}
			return { name: await nameOf(live.userId) };
		});
	}

	/** The live membership to act on, not the actor's own. */
	private async target(
		trx: TransactionClientContract,
		tenant: TenantRef,
		actor: { userId: string },
		id: string,
	): Promise<TenantMembership> {
		const target = await TenantMembership.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
		if (!target) throw new lucidErrors.E_ROW_NOT_FOUND(TenantMembership);
		if (target.userId === actor.userId) throw new MemberRuleError("self");
		return target;
	}

	/**
	 * The membership locked until the transaction ends. Taken after
	 * assertKeepsAnOwner's owner locks, so two owners acting on each other
	 * lock in the same order. Gone meanwhile: a 404.
	 */
	private async lock(
		trx: TransactionClientContract,
		tenant: TenantRef,
		id: string,
	): Promise<TenantMembership> {
		const live = await TenantMembership.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("id", id)
			.forUpdate()
			.first();
		if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(TenantMembership);
		return live;
	}
}

/** How the flashes name a member: their name, else their address. */
async function nameOf(userId: string): Promise<string> {
	const user = await User.find(userId);
	return user?.fullName ?? user?.email ?? "The member";
}
