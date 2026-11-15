import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { DateTime } from "luxon";
import { ImageDeleteError } from "#modules/media/errors";
import {
	reportReasonLabel,
	TAKEDOWN_REASON_OPTIONS,
	type TakedownKind,
} from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewOperatorService, {
	ReviewOperatorError,
} from "#modules/reviews/services/review_operator_service";
import { takedownValidator } from "#validators/admin";

const at = (value: DateTime) =>
	value.toUTC().toFormat("yyyy-MM-dd HH:mm 'UTC'");

/**
 * TattooDrip's operator actions on reviews, replies and Fresh ink posts
 * (platformAdmin middleware), with the same sentences as the `reviews:*`
 * commands. Each action redirects back, so it works from the Reports page
 * and from a studio's page.
 */
@inject()
export default class AdminReviewsController {
	constructor(private operator: ReviewOperatorService) {}

	async reports({ inertia }: HttpContext) {
		const reports = await this.operator.openReports();
		return inertia.render("admin/reports", {
			reports: reports.map((report) => ({
				studioSlug: report.studioSlug,
				studioName: report.studioName,
				reviewId: report.reviewId,
				reportedText: at(report.reportedAt),
				reason: report.reason,
				reasonLabel: reportReasonLabel(report.reason),
				note: report.note,
				rating: report.rating,
				shownName: report.shownName,
				body: report.body,
			})),
			takedownReasons: TAKEDOWN_REASON_OPTIONS,
		});
	}

	takedownReview(ctx: HttpContext) {
		return this.takedown(ctx, "review");
	}

	takedownReply(ctx: HttpContext) {
		return this.takedown(ctx, "reply");
	}

	takedownPost(ctx: HttpContext) {
		return this.takedown(ctx, "post");
	}

	restoreReview(ctx: HttpContext) {
		return this.restore(ctx, "review");
	}

	restoreReply(ctx: HttpContext) {
		return this.restore(ctx, "reply");
	}

	restorePost(ctx: HttpContext) {
		return this.restore(ctx, "post");
	}

	dismiss(ctx: HttpContext) {
		return this.run(ctx, async () => {
			await this.operator.dismiss(ctx.params.id as string);
			return "Report closed. The review stays up.";
		});
	}

	private async takedown(ctx: HttpContext, kind: TakedownKind) {
		const { reason, note } = await ctx.request.validateUsing(takedownValidator);
		return this.run(ctx, async () => {
			await this.operator.takedown(kind, ctx.params.id as string, reason, note);
			return kind === "post"
				? "The post is off every public surface and its public copies are deleted."
				: `The ${kind} is off every public surface.`;
		});
	}

	private restore(ctx: HttpContext, kind: TakedownKind) {
		return this.run(ctx, async () => {
			await this.operator.restore(kind, ctx.params.id as string);
			return `Takedown lifted. The ${kind} follows the client's and the studio's choices again.`;
		});
	}

	/** Runs an action; the service's refusals become an error flash, never a 500. */
	private async run(ctx: HttpContext, action: () => Promise<string>) {
		try {
			ctx.session.flash("success", await action());
		} catch (error) {
			if (error instanceof ImageDeleteError) {
				ctx.session.flash(
					"error",
					"Storage couldn't delete the post's public copies, so nothing changed. Try again once storage recovers.",
				);
			} else if (error instanceof ReviewOperatorError) {
				ctx.session.flash("error", error.message);
			} else {
				throw error;
			}
		}
		return ctx.response.redirect().back();
	}
}
