import { DateTime } from "luxon";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import {
	hashAccountToken,
	invitationFlowId,
} from "#modules/identity/account_tokens";
import ImageService from "#modules/media/services/image_service";
import InvitationService, {
	type InvitationInput,
} from "#modules/tenancy/services/invitation_service";
import { dbClient } from "#services/db_context";
import { inTenant } from "#tests/helpers/tenants";

/** InvitationService with its real dependencies. */
export const invitationService = () =>
	new InvitationService(new ArtistService(new ImageService()));

/** An account whose address is confirmed: what accepting needs (TAT-18's gate). */
export function confirmedUser(email: string) {
	return User.create({
		email,
		password: "secret-password",
		emailVerifiedAt: DateTime.now(),
	});
}

/** An invitation made by `owner`, as Settings, Members makes it: its id, raw token and expiry. */
export function invite(
	tenant: { id: string },
	owner: { id: string },
	over: Partial<InvitationInput> = {},
) {
	return inTenant(tenant, () =>
		invitationService().invite(tenant, owner, {
			email: "ink@invite-33.example",
			role: "artist",
			artistId: null,
			...over,
		}),
	);
}

/**
 * The flow id the invitation page renders for `token`. Pure: it doesn't
 * look the row up, so it exists for a dead or expired link too (accept
 * refuses those for their own reason).
 */
export function invitationFlow(token: string) {
	return invitationFlowId(hashAccountToken(token));
}

/** Moves an invitation's expiry into the past, as time would. */
export function expireInvitation(tenant: { id: string }, id: string) {
	return inTenant(tenant, () =>
		dbClient().rawQuery(
			"update tenant_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 minute' where id = ?",
			[id],
		),
	);
}
