import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type User from "#models/user";
import {
	FLOW_FIELD,
	INVITATION_TOKEN_KEY,
} from "#modules/identity/account_tokens";
import { InvitationRuleError } from "#modules/tenancy/errors";
import { expiryText } from "#modules/tenancy/invitations";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InvitationService, {
	type InvitationPreview,
	type Joined,
} from "#modules/tenancy/services/invitation_service";

/**
 * Invitation links (TAT-33). The link's GET only moves its token into the
 * session and opens /invitations, whose URL holds no token; joining is that
 * page's POST, which needs a signed-in account with the invited, confirmed
 * address (verifiedEmail, then InvitationService.accept). Open to guests and
 * to whoever is signed in; it signs nobody in or out.
 */
@inject()
export default class InvitationsController {
	constructor(private invitations: InvitationService) {}

	async link({ params, session, response }: HttpContext) {
		session.put(INVITATION_TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("invitations.show");
	}

	async show({ session, auth, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const viewer = auth.user ?? null;
		const token = session.get(INVITATION_TOKEN_KEY);
		const preview: InvitationPreview =
			typeof token === "string"
				? await this.invitations.preview(token, viewer)
				: { state: "invalid" };
		return inertia.render("invitations/show", pageProps(preview, viewer));
	}

	/**
	 * Joins and lands on the role's own page (straight there: a flash doesn't
	 * survive the studio home's second redirect). A refusal changes nothing
	 * and goes back to the page, which says why.
	 */
	async accept({ request, session, response, auth }: HttpContext) {
		const user = auth.getUserOrFail();
		const token = session.get(INVITATION_TOKEN_KEY);
		// The page's hidden field: the invitation it showed.
		const flow = request.input(FLOW_FIELD);
		if (typeof token !== "string" || typeof flow !== "string") {
			return response.redirect().toRoute("invitations.show");
		}
		let joined: Joined;
		try {
			joined = await this.invitations.accept(user, token, flow);
		} catch (error) {
			if (error instanceof InvitationRuleError) {
				return response.redirect().toRoute("invitations.show");
			}
			throw error;
		}
		session.forget(INVITATION_TOKEN_KEY);
		session.flash("success", joinedMessage(joined));
		return response
			.redirect()
			.toRoute(
				joined.role === "owner"
					? "tenant.inbox.index"
					: "tenant.projects.index",
				{ tenant: joined.studio.slug },
			);
	}
}

function joinedMessage({ studio, claimed }: Joined): string {
	if (claimed === true) {
		return `You joined ${studio.name}. Your artist profile is linked to you.`;
	}
	if (claimed === false) {
		return `You joined ${studio.name}. The artist profile in the invitation was taken or removed: ask an owner to link one.`;
	}
	return `You joined ${studio.name}.`;
}

/**
 * What the page gets: never the token. The flow id only when the visitor
 * can join, the studio's slug only for one who is already a member.
 */
function pageProps(preview: InvitationPreview, viewer: User | null) {
	const none = {
		studioName: null,
		studioSlug: null,
		email: null,
		role: null,
		profileName: null,
		expiresText: null,
		flow: null,
		step: null,
		viewerEmail: viewer?.email ?? null,
	};
	if (preview.state === "invalid")
		return { ...none, state: "invalid" as const };
	if (preview.state === "expired") {
		return {
			...none,
			state: "expired" as const,
			studioName: preview.studioName,
		};
	}
	return {
		...none,
		state: "ready" as const,
		studioName: preview.studio.name,
		studioSlug: preview.step === "already_member" ? preview.studio.slug : null,
		email: preview.email,
		role: preview.role,
		profileName: preview.profileName,
		expiresText: expiryText(preview.expiresAt, preview.studio.timezone),
		flow: preview.step === "accept" ? preview.flow : null,
		step: preview.step,
	};
}
