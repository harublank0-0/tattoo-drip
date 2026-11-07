import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * Lifts a Discover takedown (Discover D04): the listing, or the photo, then
 * follows the owner's own choices again. It never lists anything by itself:
 * a business whose owner turned the listing off stays off Discover.
 *
 *   node ace discover:restore black-needle
 *   node ace discover:restore black-needle --photo <photo id>
 */
export default class DiscoverRestore extends BaseCommand {
	static commandName = "discover:restore";
	static description =
		"Lift a Discover takedown of a studio's listing or of one of its photos";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The studio's current or an old slug" })
	declare slug: string;

	@flags.string({ description: "A photo's id: restore only this photo" })
	declare photo?: string;

	async run() {
		const { default: PublicationService, OperatorTargetError } = await import(
			"#modules/discovery/services/publication_service"
		);
		const publication = await this.app.container.make(PublicationService);
		try {
			if (this.photo) {
				await publication.restorePhoto(this.slug, this.photo);
			} else {
				await publication.restoreStudio(this.slug);
			}
			const status = await publication.operatorStatus(this.slug);
			this.logger.success(
				`Takedown lifted. The listing is now: ${status.status}${status.optedIn ? "" : " (the owner's listing is off)"}.`,
			);
		} catch (error) {
			if (!(error instanceof OperatorTargetError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
