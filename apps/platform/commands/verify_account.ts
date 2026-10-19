import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * Confirms an account's email address without a link (TAT-18): the
 * operator's way to let a pilot studio in while the platform can't send
 * email yet (TAT-20). It skips the proof the link gives, so check who is
 * asking some other way first. Prints no token, id or link.
 *
 *   node ace account:verify owner@example.com           (development)
 *   node build/ace.js account:verify owner@example.com  (production)
 */
export default class VerifyAccount extends BaseCommand {
	static commandName = "account:verify";
	static description =
		"Mark an account's email address as confirmed, after checking the person yourself";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The account's email address" })
	declare email: string;

	async run() {
		// Imported once the app has started: models need a booted app.
		const { default: AccountService } = await import(
			"#modules/identity/services/account_service"
		);
		const accounts = await this.app.container.make(AccountService);
		const result = await accounts.markVerified(this.email);
		if (result === "unknown") {
			this.logger.error("No account uses that address.");
			this.exitCode = 1;
			return;
		}
		if (result === "already") {
			this.logger.info("That address is already confirmed.");
			return;
		}
		this.logger.success("Confirmed. The account can now set up a studio.");
	}
}
