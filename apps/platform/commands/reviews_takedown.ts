import { args, BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import {
	MAX_TAKEDOWN_NOTE_LENGTH,
	TAKEDOWN_KINDS,
	TAKEDOWN_REASONS,
	type TakedownKind,
	type TakedownReason,
} from "#modules/reviews/rules";

/**
 * TattooDrip's takedown of a client's review, the studio's reply to it, or a
 * Fresh ink post (Reviews and Fresh ink, ruling 12): off every public
 * surface at once, a post's public copies deleted. The client's page says
 * it was taken down, in the reason's fixed sentence; the note is for
 * operators only. Nothing is deleted, and neither the studio nor the client
 * can lift it (`reviews:restore` does). Taking a reported review down
 * closes its report. A post's takedown deletes its public copies in the same
 * step: while storage can't delete them the takedown fails and changes
 * nothing; run it again once storage recovers.
 *
 *   node ace reviews:takedown review <review id> --reason hate --note "Report #12"
 *   node ace reviews:takedown reply <review id> --reason personal_data
 *   node ace reviews:takedown post <post id> --reason client_request
 *   node build/ace.js reviews:takedown ...                         (production)
 */
export default class ReviewsTakedown extends BaseCommand {
	static commandName = "reviews:takedown";
	static description =
		"Take a client's review, the studio's reply or a Fresh ink post off every public surface";
	static options: CommandOptions = { startApp: true };
	static help = [
		"A post's takedown deletes its public copies in the same step. While storage",
		"can't delete them the takedown fails and changes nothing: run it again once",
		"storage recovers.",
	];

	@args.string({ description: "review, reply (the review's id) or post" })
	declare kind: string;

	@args.string({ description: "The review's or the post's id" })
	declare id: string;

	@flags.string({
		description: `Why (required): ${TAKEDOWN_REASONS.join(", ")}`,
	})
	declare reason?: string;

	@flags.string({
		description: "A note for operators (optional, up to 500 characters)",
	})
	declare note?: string;

	async run() {
		if (!(TAKEDOWN_KINDS as readonly string[]).includes(this.kind)) {
			this.logger.error(`Give the kind as ${TAKEDOWN_KINDS.join(", ")}.`);
			this.exitCode = 1;
			return;
		}
		if (!(TAKEDOWN_REASONS as readonly string[]).includes(this.reason ?? "")) {
			this.logger.error(`Give a --reason: ${TAKEDOWN_REASONS.join(", ")}.`);
			this.exitCode = 1;
			return;
		}
		const note = this.note?.trim() || null;
		if (note !== null && Array.from(note).length > MAX_TAKEDOWN_NOTE_LENGTH) {
			this.logger.error("Keep the --note to 500 characters.");
			this.exitCode = 1;
			return;
		}
		const { default: ReviewOperatorService, ReviewOperatorError } =
			await import("#modules/reviews/services/review_operator_service");
		const { ImageDeleteError } = await import("#modules/media/errors");
		const operator = await this.app.container.make(ReviewOperatorService);
		try {
			await operator.takedown(
				this.kind as TakedownKind,
				this.id,
				this.reason as TakedownReason,
				note,
			);
			this.logger.success(
				this.kind === "post"
					? "The post is off every public surface and its public copies are deleted."
					: `The ${this.kind} is off every public surface.`,
			);
		} catch (error) {
			if (error instanceof ImageDeleteError) {
				this.logger.error(
					"Storage couldn't delete the post's public copies, so nothing changed. Run it again once storage recovers.",
				);
				this.exitCode = 1;
				return;
			}
			if (!(error instanceof ReviewOperatorError)) throw error;
			this.logger.error(error.message);
			this.exitCode = 1;
		}
	}
}
