import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	contactValidator,
	toContactVia,
} from "#modules/notifications/validators/contact";
import {
	ProjectRuleError,
	type ProjectRuleReason,
} from "#modules/projects/errors";
import { type FinishStep, finishedFlash } from "#modules/projects/finish";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type { ManualMove } from "#modules/projects/moves";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	artistValidator,
	finishValidator,
	moveValidator,
	notesValidator,
} from "#modules/projects/validators/project";

/** What each manual move tells the user when it's done. */
const MOVE_DONE: Record<ManualMove, string> = {
	hold: "Put on hold.",
	resume: "Back to quoted.",
	decline: "Project declined.",
	withdraw: "Client withdrew: project cancelled.",
};

/** What a refused move tells the user. */
const RULE_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed:
		"This project can't make that change in its current status.",
	session_scheduled: "Record or cancel the scheduled session first.",
	balance_changed:
		"The balance changed since this page loaded. Check it and try again.",
};

/**
 * The project page's changes that aren't quotes: status moves, finishing
 * (TAT-111), notes, the contact time and the artist (TAT-46). Every :id loads through
 * ProjectService.findFor first, so another tenant's or another artist's
 * project is a 404 even with a bad body.
 */
@inject()
export default class ProjectChangesController {
	constructor(private projects: ProjectService) {}

	async move(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { move } = await ctx.request.validateUsing(moveValidator);
		try {
			await this.projects.move(tenant, membership, project, move);
			const outcomeNext =
				move === "withdraw" &&
				(await this.projects.depositHeld(tenant, project));
			ctx.session.flash(
				"success",
				outcomeNext
					? `${MOVE_DONE[move]} Record what happened to the deposit under Payments.`
					: MOVE_DONE[move],
			);
		} catch (error) {
			if (!(error instanceof ProjectRuleError)) throw error;
			ctx.session.flash("error", RULE_MESSAGES[error.reason]);
		}
		return backTo(ctx, tenant, project);
	}

	async notes(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { notes } = await ctx.request.validateUsing(notesValidator);
		await this.projects.updateNotes(tenant, membership, project, notes);
		ctx.session.flash("success", "Notes saved.");
		return backTo(ctx, tenant, project);
	}

	async contacted(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const via = toContactVia(await ctx.request.validateUsing(contactValidator));
		await this.projects.markContacted(tenant, membership, project, via);
		ctx.session.flash("success", "Marked as contacted.");
		return backTo(ctx, tenant, project);
	}

	async artist(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const { artistId } = await ctx.request.validateUsing(artistValidator);
		await this.projects.assignArtist(tenant, membership, project, artistId);
		ctx.session.flash(
			"success",
			artistId ? "Artist assigned." : "Artist removed.",
		);
		return backTo(ctx, tenant, project);
	}

	/**
	 * "Mark the tattoo finished" (TAT-111). Owners only: findFor gives anyone
	 * who can't open the project a 404, and requireOwner gives the assigned
	 * artist the same 404 before the body is read.
	 */
	async finish(ctx: HttpContext) {
		return this.finishStep(ctx, "finish");
	}

	/** "Healing check done" (TAT-111), with the same checks as finish. */
	async complete(ctx: HttpContext) {
		return this.finishStep(ctx, "complete");
	}

	/**
	 * One finish step: the service decides under the project's lock; a
	 * refusal (a stale page, a session left, a changed balance) is a flash.
	 */
	private async finishStep(ctx: HttpContext, step: FinishStep) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		this.projects.requireOwner(membership);
		const { confirmedDue } = await ctx.request.validateUsing(finishValidator);
		const confirmed =
			typeof confirmedDue === "string" ? BigInt(confirmedDue) : null;
		try {
			const done =
				step === "finish"
					? await this.projects.finish(tenant, membership, project, confirmed)
					: await this.projects.completeHealingCheck(
							tenant,
							membership,
							project,
							confirmed,
						);
			ctx.session.flash("success", finishedFlash(step, done));
		} catch (error) {
			if (!(error instanceof ProjectRuleError)) throw error;
			ctx.session.flash("error", RULE_MESSAGES[error.reason]);
		}
		return backTo(ctx, tenant, project);
	}
}

function backTo(
	ctx: HttpContext,
	tenant: { slug: string },
	project: TattooProject,
) {
	return ctx.response
		.redirect()
		.toRoute("tenant.projects.show", { tenant: tenant.slug, id: project.id });
}
