import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import { verifyAccountValidator } from "#validators/admin";

/**
 * TattooDrip's operator way to confirm an account's address without the
 * link (what `account:verify` does). It skips the proof the link gives, so
 * the page says to check who is asking first.
 */
@inject()
export default class AdminAccountsController {
	constructor(private accounts: AccountService) {}

	index(ctx: HttpContext) {
		return ctx.inertia.render("admin/accounts", {});
	}

	async verify(ctx: HttpContext) {
		const { email } = await ctx.request.validateUsing(verifyAccountValidator);
		const result = await this.accounts.markVerified(email);
		if (result === "unknown") {
			ctx.session.flash("error", "No account uses that address.");
		} else if (result === "already") {
			ctx.session.flash("success", "That address is already confirmed.");
		} else {
			ctx.session.flash(
				"success",
				"Confirmed. The account can now set up a studio.",
			);
		}
		return ctx.response.redirect().back();
	}
}
