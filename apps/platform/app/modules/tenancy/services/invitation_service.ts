import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { RawQueryBindings } from "@adonisjs/lucid/types/querybuilder";
import { DateTime } from "luxon";
import User from "#models/user";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	hashAccountToken,
	invitationFlowId,
	isFlowId,
	newAccountToken,
} from "#modules/identity/account_tokens";
import { canonicalEmail } from "#modules/identity/email_address";
import { InvitationRuleError } from "#modules/tenancy/errors";
import { INVITATION_DAYS } from "#modules/tenancy/invitations";
import TenantInvitation from "#modules/tenancy/models/tenant_invitation";
import TenantMembership, {
	type MembershipRole,
} from "#modules/tenancy/models/tenant_membership";
import { dbClient, withDbContext, withTransaction } from "#services/db_context";

type TenantRef = { id: string };

/** What an owner fills in. The address is canonicalized here too. */
export type InvitationInput = {
	email: string;
	role: MembershipRole;
	artistId: string | null;
};

/** A pending invitation as Settings, Members lists it. */
export type PendingInvitation = {
	id: string;
	email: string;
	role: MembershipRole;
	/** The offered profile's name, null without one (or when it was deleted). */
	profileName: string | null;
	expiresAt: DateTime;
	expired: boolean;
};

/** What the invitation page offers its visitor (spec, Screens). */
export type InvitationStep =
	| "sign_in"
	| "switch_account"
	| "confirm_email"
	| "already_member"
	| "accept";

export type InvitationPreview =
	| { state: "invalid" }
	| { state: "expired"; studioName: string }
	| {
			state: "live";
			/**
			 * For the page's hidden `flow` field (TAT-18): changes with every
			 * replacement or renewal, so a form acts only on the terms it showed.
			 */
			flow: string;
			studio: { name: string; slug: string; timezone: string };
			email: string;
			role: MembershipRole;
			/** The offered profile while it can still be claimed, else null. */
			profileName: string | null;
			expiresAt: DateTime;
			step: InvitationStep;
	  };

/** A finished join. `claimed` is null when no profile was offered. */
export type Joined = {
	studio: { name: string; slug: string };
	role: MembershipRole;
	claimed: boolean | null;
};

type IssuedRow = {
	id: string;
	email: string;
	expires_at: Date;
	inserted?: boolean;
};

type PreviewRow = {
	id: string;
	email: string;
	role: MembershipRole;
	artist_id: string | null;
	expires_at: Date;
	live: boolean;
	name: string;
	slug: string;
	timezone: string;
};

type LockedRow = {
	id: string;
	email: string;
	role: MembershipRole;
	artist_id: string | null;
	live: boolean;
};

/**
 * One statement, so two owners inviting the same address at once end with
 * one invitation. `xmax = 0` is true for a row this statement inserted and
 * false for one it updated (a replaced invitation). Expiry by the
 * database's clock.
 */
const UPSERT = `insert into tenant_invitations (tenant_id, email, role, artist_id, token_hash, invited_by_user_id, expires_at, created_at, updated_at)
values (?, ?, ?, ?, ?, ?, now() + make_interval(days => ?), now(), now())
on conflict (tenant_id, email) do update
set role = excluded.role, artist_id = excluded.artist_id, token_hash = excluded.token_hash,
    invited_by_user_id = excluded.invited_by_user_id, expires_at = excluded.expires_at,
    created_at = excluded.created_at, updated_at = excluded.updated_at
returning id, email, expires_at, (xmax = 0) as inserted`;

/**
 * Makes sending an invitation to an address and that address joining the
 * studio take turns: the lock is held until the transaction ends, and a
 * second request for the same studio and canonical address waits for it.
 * Without it, an invitation sent again while its address accepts could pass
 * the membership check just before the membership exists, then insert a new
 * invitation once accept had deleted the old one: a link for someone who is
 * already a member, which would restore them if they were removed later.
 *
 * Taken first in invite() and accept(), before any row lock, so both lock in
 * one order. renew() and revoke() are single statements on one existing row
 * and cannot create an invitation, so they don't need it.
 *
 * Lock order of the whole feature: this advisory lock, then the inviter's
 * membership (lockInviter), then the invitation row. MemberService takes
 * the studio's owner memberships, then the target's, then the invitation
 * rows, and never this lock. A transaction that holds the inviter's
 * membership shares the owner locks of a removal, so the two never wait for
 * each other while each holds what the other needs: no cycle.
 */
async function lockAddress(
	trx: TransactionClientContract,
	tenantId: string,
	email: string,
) {
	await trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`tattoo-drip:invitation:${tenantId}:${email}`,
	]);
}

/**
 * Locks the inviter's live owner membership against removal and demotion
 * until the transaction ends, and refuses (E_ROW_NOT_FOUND, the 404 a
 * request of a removed member gets) when it is gone. An owner link is only
 * made by someone who is an owner, and removing or demoting an owner deletes
 * the owner invitations they sent (MemberService.dropInvitations): that
 * DELETE cannot see an invitation another transaction has inserted and not
 * yet committed, so without this lock a link made at the same moment would
 * outlive the owner. MemberService locks the owner memberships FOR UPDATE
 * before it deletes anything: it waits for the invitation to commit, then
 * deletes it, or, if it came first, this finds the membership gone (the
 * lock waits, then re-reads the row as the other transaction left it).
 * Shared, so owners inviting at once don't wait for each other.
 */
async function lockInviter(
	trx: TransactionClientContract,
	tenant: TenantRef,
	inviter: { id: string },
): Promise<void> {
	const live = await TenantMembership.query({ client: trx })
		.where("tenant_id", tenant.id)
		.where("user_id", inviter.id)
		.where("role", "owner")
		.forShare()
		.first();
	if (!live) throw new lucidErrors.E_ROW_NOT_FOUND(TenantMembership);
}

/**
 * Invitations to join a studio (TAT-33). A token is TAT-18's: 256 random
 * bits, only its SHA-256 stored, single use. The owner's methods run in the
 * studio's context (a request on /t/:tenant); preview and accept start from
 * a token alone, find its studio through invitation_tenant() and then work
 * in that studio's context.
 */
@inject()
export default class InvitationService {
	constructor(private artists: ArtistService) {}

	/** The studio's invitations, newest first. */
	async pending(tenant: TenantRef): Promise<PendingInvitation[]> {
		// Expired by the database's clock, like preview() and accept().
		const rows = await TenantInvitation.query()
			.select("*")
			.select(dbClient().raw("expires_at <= now() as expired"))
			.where("tenant_id", tenant.id)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
		const names = new Map(
			(await this.artists.list(tenant)).map(({ id, name }) => [id, name]),
		);
		return rows.map((row) => ({
			id: row.id,
			email: row.email,
			role: row.role,
			profileName: row.artistId ? (names.get(row.artistId) ?? null) : null,
			expiresAt: row.expiresAt,
			expired: row.$extras.expired === true,
		}));
	}

	/**
	 * Invites `input.email` (canonical) with a new link. Refuses a live
	 * member's address ("already_member") and a profile that isn't one of
	 * the studio's live, unlinked ones ("profile_unavailable"). An address
	 * with a pending invitation gets it replaced (`replaced`), whose old link
	 * dies at once. The answer is the same whether or not the address has an
	 * account. Returns the raw token: show it once, never store it.
	 */
	async invite(
		tenant: TenantRef,
		inviter: { id: string },
		input: InvitationInput,
	): Promise<{
		id: string;
		token: string;
		replaced: boolean;
		expiresAt: DateTime;
	}> {
		const email = canonicalEmail(input.email);
		return withTransaction(async (trx) => {
			await lockAddress(trx, tenant.id, email);
			await lockInviter(trx, tenant, inviter);
			if (await this.isMember(tenant, email)) {
				throw new InvitationRuleError("already_member");
			}
			if (
				input.artistId !== null &&
				!(await this.claimable(tenant, input.artistId))
			) {
				throw new InvitationRuleError("profile_unavailable");
			}
			const token = newAccountToken();
			const { rows } = await dbClient().rawQuery(UPSERT, [
				tenant.id,
				email,
				input.role,
				input.artistId,
				hashAccountToken(token),
				inviter.id,
				INVITATION_DAYS,
				// A null artist_id binds as SQL NULL; Lucid's binding type leaves null out.
			] as RawQueryBindings);
			const row = rows[0] as IssuedRow;
			return {
				id: row.id,
				token,
				replaced: row.inserted === false,
				expiresAt: DateTime.fromJSDate(row.expires_at),
			};
		});
	}

	/**
	 * A new link for the invitation `id` and 7 more days; the old link dies
	 * at once, and the renewer becomes its sender. E_ROW_NOT_FOUND for
	 * another studio's or an unknown id, and for a renewer who is no longer
	 * an owner (lockInviter).
	 */
	async renew(
		tenant: TenantRef,
		inviter: { id: string },
		id: string,
	): Promise<{ email: string; token: string; expiresAt: DateTime }> {
		const token = newAccountToken();
		return withTransaction(async (trx) => {
			await lockInviter(trx, tenant, inviter);
			const { rows } = await trx.rawQuery(
				`update tenant_invitations
				 set token_hash = ?, invited_by_user_id = ?, expires_at = now() + make_interval(days => ?), created_at = now(), updated_at = now()
				 where tenant_id = ? and id = ?
				 returning id, email, expires_at`,
				[hashAccountToken(token), inviter.id, INVITATION_DAYS, tenant.id, id],
			);
			const row = rows[0] as IssuedRow | undefined;
			if (!row) throw new lucidErrors.E_ROW_NOT_FOUND(TenantInvitation);
			return {
				email: row.email,
				token,
				expiresAt: DateTime.fromJSDate(row.expires_at),
			};
		});
	}

	/** Cancels the invitation `id`: its link dies. E_ROW_NOT_FOUND otherwise. */
	async revoke(tenant: TenantRef, id: string): Promise<{ email: string }> {
		const { rows } = await dbClient().rawQuery(
			"delete from tenant_invitations where tenant_id = ? and id = ? returning email",
			[tenant.id, id],
		);
		const row = rows[0] as { email: string } | undefined;
		if (!row) throw new lucidErrors.E_ROW_NOT_FOUND(TenantInvitation);
		return { email: row.email };
	}

	/**
	 * What the invitation page shows for `token` to `viewer` (null: a guest):
	 * invalid (used, cancelled, replaced or never made), expired (with the
	 * studio's name), or live with the step the visitor is at.
	 */
	async preview(
		token: string,
		viewer: User | null,
	): Promise<InvitationPreview> {
		const hash = hashAccountToken(token);
		const tenantId = await this.tenantOf(hash);
		if (!tenantId) return { state: "invalid" };
		const tenant = { id: tenantId };
		return withDbContext(
			{ tenantId },
			async (trx): Promise<InvitationPreview> => {
				const { rows } = await trx.rawQuery(
					`select i.id, i.email, i.role, i.artist_id, i.expires_at, i.expires_at > now() as live, t.name, t.slug, t.timezone
					 from tenant_invitations i join tenants t on t.id = i.tenant_id
					 where i.tenant_id = ? and i.token_hash = ?`,
					[tenantId, hash],
				);
				const row = rows[0] as PreviewRow | undefined;
				if (!row) return { state: "invalid" };
				if (!row.live) return { state: "expired", studioName: row.name };
				return {
					state: "live",
					flow: invitationFlowId(hash),
					studio: { name: row.name, slug: row.slug, timezone: row.timezone },
					email: row.email,
					role: row.role,
					profileName: row.artist_id
						? await this.claimableName(tenant, row.artist_id)
						: null,
					expiresAt: DateTime.fromJSDate(row.expires_at),
					step: await this.stepFor(tenant, row.email, viewer),
				};
			},
		);
	}

	/**
	 * Joins `user` to the invitation's studio (spec ruling 7), under the
	 * invitation's row lock: `flow` must be the one the page showed for this
	 * very link (invitationFlowId of its hash: a replaced or renewed
	 * invitation has a new one), the row live, the account confirmed, its
	 * address the invited one, and not yet a member. Then the membership, the
	 * claim (ruling 10) and the invitation's deletion, in one transaction.
	 * Throws InvitationRuleError otherwise, with nothing changed.
	 */
	async accept(user: User, token: string, flow: string): Promise<Joined> {
		const hash = hashAccountToken(token);
		// The form must be the one that showed this link's terms (see
		// invitationFlowId), not an older tab's.
		if (!isFlowId(flow) || flow !== invitationFlowId(hash)) {
			throw new InvitationRuleError("invalid");
		}
		const tenantId = await this.tenantOf(hash);
		if (!tenantId) throw new InvitationRuleError("invalid");
		const tenant = { id: tenantId };
		return withDbContext({ tenantId }, async (trx): Promise<Joined> => {
			// Before the row lock, like invite(). The visitor's address is the
			// invitation's when they may join; any other is refused below, and a
			// lock on the wrong key costs nothing.
			await lockAddress(trx, tenantId, user.email);
			// A second tab or a double tap waits on this lock, then finds the
			// row gone.
			const { rows } = await trx.rawQuery(
				"select id, email, role, artist_id, expires_at > now() as live from tenant_invitations where tenant_id = ? and token_hash = ? for update",
				[tenantId, hash],
			);
			const row = rows[0] as LockedRow | undefined;
			if (!row) throw new InvitationRuleError("invalid");
			if (!row.live) throw new InvitationRuleError("expired");
			if (!user.emailVerified) throw new InvitationRuleError("unverified");
			// Both are stored canonical (two database checks), so equal means
			// the same address.
			if (user.email !== row.email) {
				throw new InvitationRuleError("wrong_account");
			}
			if (await this.membershipOf(tenant, user.id)) {
				throw new InvitationRuleError("already_member");
			}

			await TenantMembership.create(
				{ tenantId, userId: user.id, role: row.role },
				{ client: trx },
			);
			const claimed =
				row.artist_id === null
					? null
					: await this.artists.claim(tenant, row.artist_id, user.id);
			await trx.rawQuery("delete from tenant_invitations where id = ?", [
				row.id,
			]);
			const { rows: studios } = await trx.rawQuery(
				"select name, slug from tenants where id = ?",
				[tenantId],
			);
			const studio = studios[0] as { name: string; slug: string };
			return {
				studio: { name: studio.name, slug: studio.slug },
				role: row.role,
				claimed,
			};
		});
	}

	/**
	 * The id of the live studio holding the invitation with this token hash,
	 * or null: invitation_tenant(), a SECURITY DEFINER lookup, the only thing
	 * here that looks across studios.
	 */
	private async tenantOf(hash: string): Promise<string | null> {
		const { rows } = await dbClient().rawQuery(
			"select public.invitation_tenant(?) as id",
			[hash],
		);
		return (rows[0]?.id as string | null | undefined) ?? null;
	}

	/**
	 * The user's live membership. Protected, so a test can stop accept at this
	 * point, after its locks, to stage a race with a real second connection.
	 */
	protected membershipOf(tenant: TenantRef, userId: string) {
		return TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.first();
	}

	/** Whether the account with this canonical address is a live member here. */
	private async isMember(tenant: TenantRef, email: string): Promise<boolean> {
		const user = await User.query().where("email", email).first();
		return user ? (await this.membershipOf(tenant, user.id)) !== null : false;
	}

	/** Whether the profile is one of the studio's live profiles nobody is linked to. */
	private async claimable(tenant: TenantRef, artistId: string) {
		return (await this.claimableName(tenant, artistId)) !== null;
	}

	private async claimableName(
		tenant: TenantRef,
		artistId: string,
	): Promise<string | null> {
		const profile = (await this.artists.list(tenant)).find(
			({ id }) => id === artistId,
		);
		return profile && profile.userId === null ? profile.name : null;
	}

	private async stepFor(
		tenant: TenantRef,
		email: string,
		viewer: User | null,
	): Promise<InvitationStep> {
		if (!viewer) return "sign_in";
		if (viewer.email !== email) return "switch_account";
		if (!viewer.emailVerified) return "confirm_email";
		return (await this.membershipOf(tenant, viewer.id))
			? "already_member"
			: "accept";
	}
}
