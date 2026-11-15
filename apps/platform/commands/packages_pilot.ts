import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { DateTime } from "luxon";

/**
 * Gives a pilot studio an explicit, temporary package until its agreed
 * transition date (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * ruling 7), so it is never paused by accident when enforcement ships. A
 * grant still running ends now. The note is stored for operators only.
 *
 *   node ace packages:pilot black-needle --package studio --until 2027-03-31 --note "Design partner"
 *   node build/ace.js packages:pilot ...                                     (production)
 */
export default class PackagesPilot extends BaseCommand {
	static commandName = "packages:pilot";
	static description =
		"Give a pilot studio a package until a date (00:00 UTC that day)";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The studio's current or an old slug" })
	declare slug: string;

	@flags.string({ description: "solo or studio (required)" })
	declare package?: string;

	@flags.string({
		description:
			"The transition date, YYYY-MM-DD: the grant ends at 00:00 UTC that day (required)",
	})
	declare until?: string;

	@flags.string({ description: "Why (stored for operators; required)" })
	declare note?: string;

	async run() {
		const { PACKAGE_KEYS } = await import("#modules/packages/packages");
		const pkg = PACKAGE_KEYS.find((key) => key === this.package);
		if (!pkg) {
			this.logger.error(`Give a --package: ${PACKAGE_KEYS.join(" or ")}.`);
			this.exitCode = 1;
			return;
		}
		const endsAt = DateTime.fromISO(this.until ?? "", { zone: "utc" });
		if (!/^\d{4}-\d{2}-\d{2}$/.test(this.until ?? "") || !endsAt.isValid) {
			this.logger.error("Give an --until date as YYYY-MM-DD.");
			this.exitCode = 1;
			return;
		}
		const { default: PilotGrantService, PilotGrantError } = await import(
			"#modules/packages/services/pilot_grant_service"
		);
		const pilots = await this.app.container.make(PilotGrantService);
		try {
			await pilots.grant(this.slug, {
				package: pkg,
				endsAt,
				note: this.note ?? "",
			});
			this.logger.success(
				`"${this.slug}" is a ${pkg} pilot until ${this.until} (00:00 UTC).`,
			);
		} catch (error) {
			if (!(error instanceof PilotGrantError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
