import { BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import { excerpt } from "#modules/notifications/alerts";
import { terminalText } from "#services/terminal_text";

/**
 * The studios' open reports of client reviews (Reviews and Fresh ink,
 * rulings 6 and 12), oldest first, at most 500: what TattooDrip still has to
 * decide with `reviews:takedown` or `reviews:dismiss`. The ids come from the
 * SECURITY DEFINER `open_review_reports()` (ids only); each report is read
 * as the app role in its studio's own context. Everything a studio or a
 * client typed (the studio's name, the note, the review and the name shown)
 * is printed through `terminalText`, so it can't drive the terminal.
 *
 *   node ace reviews:reports
 *   node build/ace.js reviews:reports   (production)
 */
export default class ReviewsReports extends BaseCommand {
	static commandName = "reviews:reports";
	static description = "List the studios' open reports of client reviews";
	static options: CommandOptions = { startApp: true };

	async run() {
		const { default: ReviewOperatorService } = await import(
			"#modules/reviews/services/review_operator_service"
		);
		const operator = await this.app.container.make(ReviewOperatorService);
		const reports = await operator.openReports();
		if (reports.length === 0) {
			this.logger.log("No open reports.");
			return;
		}
		this.logger.log(`${reports.length} open report(s), oldest first:`);
		for (const report of reports) {
			this.logger.log("");
			this.logger.log(
				`${terminalText(report.studioName)} (${terminalText(report.studioSlug)}), review ${report.reviewId}`,
			);
			this.logger.log(
				`  Reported ${report.reportedAt.toUTC().toFormat("yyyy-MM-dd HH:mm")} UTC for ${report.reason}${report.note ? `: ${terminalText(report.note)}` : ""}`,
			);
			this.logger.log(
				`  ${report.rating ?? "-"}/5 by ${terminalText(report.shownName)}: ${terminalText(excerpt(report.body, 200))}`,
			);
		}
	}
}
