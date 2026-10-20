import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import type { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	InvitationRuleError,
	LastOwnerError,
	MemberRuleError,
} from "#modules/tenancy/errors";
import {
	expiryText,
	INVITATION_LINK_FLASH,
	invitationUrl,
	inviteMessage,
	type NewInvitationLink,
	ROLE_WORDS,
	whatsappShareUrl,
} from "#modules/tenancy/invitations";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InvitationService from "#modules/tenancy/services/invitation_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MemberService from "#modules/tenancy/services/member_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	inviteValidator,
	memberRoleValidator,
} from "#modules/tenancy/validators/members";
import env from "#start/env";

/**
 * Settings, Members (TAT-33): the studio's members and pending invitations,
 * for owners (TENANT_ROUTE_ROLES). A new invitation's link is shown once,
 * on the page after the request that made it, from a session flash that the
 * Inertia middleware puts in the page object's `flash` field (not a prop, so
 * browser history never keeps it); it is not stored outside the session or
 * shown again. Every :id loads through the services, scoped
 * to the studio, so another studio's id is a 404.
 */
@inject()
export default class MembersController {
	constructor(
		private tenancy: TenancyService,
		private members: MemberService,
		private invitations: InvitationService,
		private artists: ArtistService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const members = await this.tenancy.members(tenant);
		const pending = await this.invitations.pending(tenant);
		const profiles = (await this.artists.list(tenant)).filter(
			({ userId }) => userId === null,
		);

		// The response may carry a link: the browser must not keep it.
		ctx.response.header("Cache-Control", "no-store");
		return ctx.inertia.render("settings/members", {
			members: members.map((member) => ({
				id: member.membershipId,
				name: member.fullName,
				email: member.email,
				role: member.role,
				isYou: member.userId === membership.userId,
			})),
			invitations: pending.map((invitation) => ({
				id: invitation.id,
				email: invitation.email,
				role: invitation.role,
				profileName: invitation.profileName,
				expired: invitation.expired,
				expiresText: expiryText(invitation.expiresAt, tenant.timezone),
			})),
			profiles: profiles.map(({ id, name }) => ({ id, name })),
		});
	}

	async invite(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const data = await ctx.request.validateUsing(inviteValidator);
		let made: { token: string; replaced: boolean; expiresAt: DateTime };
		try {
			made = await this.invitations.invite(tenant, ctx.auth.getUserOrFail(), {
				email: data.email,
				role: data.role,
				artistId: data.artistId ?? null,
			});
		} catch (error) {
			if (error instanceof InvitationRuleError) {
				if (error.reason === "already_member") {
					throw fieldError(
						"email",
						`${data.email} is already a member of this studio.`,
						"member",
					);
				}
				if (error.reason === "profile_unavailable") {
					throw fieldError(
						"artistId",
						"That profile already belongs to someone, or was removed. Choose another, or none.",
						"available",
					);
				}
			}
			throw error;
		}

		flashLink(ctx, tenant, data.email, made.token, made.expiresAt);
		ctx.session.flash(
			"success",
			made.replaced
				? `New invitation link ready for ${data.email}. The earlier link no longer works.`
				: `Invitation link ready: send it to ${data.email}.`,
		);
		return toMembers(ctx, tenant);
	}

	async renew(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { email, token, expiresAt } = await this.invitations.renew(
			tenant,
			ctx.auth.getUserOrFail(),
			ctx.params.id,
		);
		flashLink(ctx, tenant, email, token, expiresAt);
		ctx.session.flash(
			"success",
			`New link ready for ${email}. The old one no longer works.`,
		);
		return toMembers(ctx, tenant);
	}

	async revoke(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const { email } = await this.invitations.revoke(tenant, ctx.params.id);
		ctx.session.flash(
			"success",
			`Invitation for ${email} cancelled. Its link no longer works.`,
		);
		return toMembers(ctx, tenant);
	}

	async role(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		// Load first: another studio's id is a 404 even with a bad body.
		await this.members.findFor(tenant, ctx.params.id);
		const { role } = await ctx.request.validateUsing(memberRoleValidator);
		const done = await refusalsAsFlash(ctx, () =>
			this.members.changeRole(tenant, membership, ctx.params.id, role),
		);
		if (done) {
			ctx.session.flash("success", `${done.name} is now ${ROLE_WORDS[role]}.`);
		}
		return toMembers(ctx, tenant);
	}

	async remove(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const done = await refusalsAsFlash(ctx, () =>
			this.members.remove(tenant, membership, ctx.params.id),
		);
		if (done) {
			ctx.session.flash(
				"success",
				`${done.name} removed. Their access to ${tenant.name} ended.`,
			);
		}
		return toMembers(ctx, tenant);
	}
}

function toMembers(ctx: HttpContext, tenant: Tenant) {
	return ctx.response
		.redirect()
		.toRoute("tenant.settings.members", { tenant: tenant.slug });
}

/**
 * Puts a new link in the one-time flash the Members page shows (the
 * Inertia middleware moves it to the page's `flash` field).
 */
function flashLink(
	ctx: HttpContext,
	tenant: Tenant,
	email: string,
	token: string,
	expiresAt: DateTime,
) {
	const url = invitationUrl(env.get("APP_URL"), token);
	const message = inviteMessage(tenant.name, url);
	const link: NewInvitationLink = {
		email,
		url,
		message,
		whatsappUrl: whatsappShareUrl(message),
		expiresText: expiryText(expiresAt, tenant.timezone),
	};
	ctx.session.flash(INVITATION_LINK_FLASH, link);
}

/**
 * Runs a member change; the last-owner and self refusals become an error
 * toast (null is returned), anything else goes on up. The last-owner one is
 * only reachable through a race: an owner acting on someone else always
 * remains an owner themselves.
 */
async function refusalsAsFlash<T>(
	ctx: HttpContext,
	work: () => Promise<T>,
): Promise<T | null> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof LastOwnerError) {
			ctx.session.flash(
				"error",
				"A studio needs at least one owner: make someone else an owner first.",
			);
			return null;
		}
		if (error instanceof MemberRuleError) {
			ctx.session.flash(
				"error",
				"You can't remove yourself or change your own role here.",
			);
			return null;
		}
		throw error;
	}
}

function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}
