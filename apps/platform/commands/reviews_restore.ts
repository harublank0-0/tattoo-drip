import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { TAKEDOWN_KINDS, type TakedownKind } from "#modules/reviews/rules";

/**
 * Lifts a TattooDrip takedown (Reviews and Fresh ink, ruling 12): the item
 * then follows the client's and the studio's own choices again. A post is
 * published again only while it is still approved and the client still
 * allows a surface; it is never approved by this.
 *
 *   node ace reviews:restore review <review id>
 *   node ace reviews:restore reply <review id>
 *   node ace reviews:restore post <post id>
 */
export default class ReviewsRestore extends BaseCommand {
	static commandName = "reviews:restore";
	static description =
		"Lift a takedown of a client's review, the studio's reply or a Fresh ink post";
	static options: CommandOptions = { startApp: true };

	@args.string({ description: "review, reply (the review's id) or post" })
	declare kind: string;

	@args.string({ description: "The review's or the post's id" })
	declare id: string;

	async run() {
		if (!(TAKEDOWN_KINDS as readonly string[]).includes(this.kind)) {
			this.logger.error(`Give the kind as ${TAKEDOWN_KINDS.join(", ")}.`);
			this.exitCode = 1;
			return;
		}
		const { default: ReviewOperatorService, ReviewOperatorError } =
			await import("#modules/reviews/services/review_operator_service");
		const operator = await this.app.container.make(ReviewOperatorService);
		try {
			await operator.restore(this.kind as TakedownKind, this.id);
			this.logger.success(
				`Takedown lifted. The ${this.kind} follows the client's and the studio's choices again.`,
			);
		} catch (error) {
			if (!(error instanceof ReviewOperatorError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
