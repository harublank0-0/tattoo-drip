import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { terminalText } from "#services/terminal_text";

/**
 * A business's Discover state for an operator (Discover D04): the owner's
 * switch, whether the public API returns it, a takedown and its reason, and
 * every photo taken down. Prints no contact detail.
 *
 *   node ace discover:status black-needle
 */
export default class DiscoverStatus extends BaseCommand {
	static commandName = "discover:status";
	static description = "Show a studio's Discover listing and takedowns";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The studio's current or an old slug" })
	declare slug: string;

	async run() {
		const { default: PublicationService, OperatorTargetError } = await import(
			"#modules/discovery/services/publication_service"
		);
		const publication = await this.app.container.make(PublicationService);
		try {
			const status = await publication.operatorStatus(this.slug);
			const line = (label: string, value: string) =>
				this.logger.log(`${label}: ${terminalText(value)}`);
			line("Studio", `${status.name} (${status.slug})`);
			line("Status", status.status);
			line("Owner's listing", status.optedIn ? "on" : "off");
			line("Returned by the public API", status.publiclyVisible ? "yes" : "no");
			line(
				"Takedown",
				status.takedown
					? `since ${status.takedown.at.toISO()}: ${status.takedown.note ?? "(no reason)"}`
					: "none",
			);
			line("Photos taken down", String(status.removedPhotos.length));
			for (const photo of status.removedPhotos) {
				line(
					`  ${photo.id}`,
					`since ${photo.at.toISO()}: ${photo.note ?? "(no reason)"}`,
				);
			}
		} catch (error) {
			if (!(error instanceof OperatorTargetError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
