import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * A platform takedown on Discover (Discover D04,
 * docs/discover/publication-controls.md): the operator's way to take a
 * business's listing, or one of its photos, off Discover. Nothing is
 * deleted and the studio page is unchanged; the owner can't lift it. The
 * reason is stored for operators only (no dashboard page shows it).
 *
 *   node ace discover:suspend black-needle --reason "Copyright complaint #12"
 *   node ace discover:suspend black-needle --photo <photo id> --reason "..."
 *   node build/ace.js discover:suspend ...                     (production)
 */
export default class DiscoverSuspend extends BaseCommand {
	static commandName = "discover:suspend";
	static description =
		"Take a studio's Discover listing, or one of its photos, off Discover";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The studio's current or an old slug" })
	declare slug: string;

	@flags.string({ description: "A photo's id: take only this photo off" })
	declare photo?: string;

	@flags.string({ description: "Why (stored for operators; required)" })
	declare reason?: string;

	async run() {
		const reason = this.reason?.trim() ?? "";
		if (reason === "" || reason.length > 500) {
			this.logger.error("Give a --reason of 1 to 500 characters.");
			this.exitCode = 1;
			return;
		}
		const { default: PublicationService, OperatorTargetError } = await import(
			"#modules/discovery/services/publication_service"
		);
		const publication = await this.app.container.make(PublicationService);
		try {
			if (this.photo) {
				await publication.suspendPhoto(this.slug, this.photo, reason);
				this.logger.success(
					"The photo is off Discover. It stays on the studio page.",
				);
			} else {
				await publication.suspendStudio(this.slug, reason);
				this.logger.success(
					"The listing is off Discover. The studio page and bookings are unchanged.",
				);
			}
			this.logger.info("Public caches can keep it for up to two minutes.");
		} catch (error) {
			if (!(error instanceof OperatorTargetError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
