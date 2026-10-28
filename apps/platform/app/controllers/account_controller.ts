import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { LAST_TENANT_KEY } from "#middleware/tenant_middleware";
import type User from "#models/user";
import { forgetStagedTokens } from "#modules/identity/account_tokens";
import { SessionEndedError } from "#modules/identity/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import {
	assertPasswordChangeAllowed,
	throttlePasswordCheck,
} from "#modules/identity/services/auth_limits";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { WRONG_CURRENT_PASSWORD } from "#validators/account_messages";
import { changePasswordValidator } from "#validators/user";

/**
 * The person's own account (TAT-95), outside any studio: the signed-in group
 * (auth, then the request transaction). Every action is on auth.user only.
 * Changing the password and "Sign out of other devices" raise the session
 * version, then sign this session in again, which stores the new version
 * under a new session id: this device stays, every other one is out.
 */
@inject()
export default class AccountController {
	constructor(
		private accounts: AccountService,
		private tenancy: TenancyService,
	) {}

	async show({ auth, inertia }: HttpContext) {
		const hasStudio = await this.tenancy.hasTenant(auth.getUserOrFail());
		return inertia.render("account/show", { hasStudio });
	}

	/**
	 * The hourly cap on successful changes is checked first and spent only by a
	 * success (`AccountService.changePassword`, after the commit), so a
	 * malformed or refused request never uses it up. Then the current password
	 * is checked (and counted) before anything is locked.
	 */
	async changePassword(ctx: HttpContext) {
		const { request, auth, session, response } = ctx;
		const user = auth.getUserOrFail();
		await assertPasswordChangeAllowed(user.id);
		const { currentPassword, password } = await request.validateUsing(
			changePasswordValidator,
		);
		const right = await throttlePasswordCheck(request.ip(), user.id, () =>
			user.verifyPassword(currentPassword),
		);
		if (!right) {
			throw new errors.E_VALIDATION_ERROR([
				{
					field: "currentPassword",
					message: WRONG_CURRENT_PASSWORD,
					rule: "currentPassword",
				},
			]);
		}
		const changed = await this.unlessEnded(ctx, () =>
			this.accounts.changePassword(user, password),
		);
		if (!changed) return;
		await auth.use("web").login(changed);
		session.flash("success", "Password changed. Other devices are signed out.");
		return response.redirect().toRoute("account.show");
	}

	async signOutOthers(ctx: HttpContext) {
		const changed = await this.unlessEnded(ctx, () =>
			this.accounts.signOutOtherSessions(ctx.auth.getUserOrFail()),
		);
		if (!changed) return;
		await ctx.auth.use("web").login(changed);
		ctx.session.flash(
			"success",
			"Signed out of every other device. You're still signed in here.",
		);
		return ctx.response.redirect().toRoute("account.show");
	}

	/**
	 * Runs a write; when another request ended this session meanwhile
	 * (SessionEndedError, its savepoint already rolled back), signs the
	 * session out as logout does and sends it to sign in.
	 */
	private async unlessEnded(
		ctx: HttpContext,
		write: () => Promise<User>,
	): Promise<User | null> {
		try {
			return await write();
		} catch (error) {
			if (!(error instanceof SessionEndedError)) throw error;
			await ctx.auth.use("web").logout();
			ctx.session.forget(LAST_TENANT_KEY);
			forgetStagedTokens(ctx.session);
			ctx.session.flash(
				"error",
				"You were signed out on another device. Sign in again.",
			);
			ctx.response.redirect().toRoute("session.create");
			return null;
		}
	}
}
