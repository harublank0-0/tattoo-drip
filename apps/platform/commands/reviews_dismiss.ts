import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * Closes a studio's report of a review without a takedown (Reviews and Fresh
 * ink, rulings 6 and 12): TattooDrip keeps the review up. The report's
 * record stays; the studio may report the review again.
 *
 *   node ace reviews:dismiss <review id>
 */
export default class ReviewsDismiss extends BaseCommand {
	static commandName = "reviews:dismiss";
	static description =
		"Close a studio's report of a review and keep the review up";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "The review's id" })
	declare id: string;

	async run() {
		const { default: ReviewOperatorService, ReviewOperatorError } =
			await import("#modules/reviews/services/review_operator_service");
		const operator = await this.app.container.make(ReviewOperatorService);
		try {
			await operator.dismiss(this.id);
			this.logger.success("Report closed. The review stays up.");
		} catch (error) {
			if (!(error instanceof ReviewOperatorError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
