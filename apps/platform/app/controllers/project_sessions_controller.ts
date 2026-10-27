import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService from "#modules/projects/services/booking_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
import {
	SessionOverlapError,
	SessionRuleError,
	type SessionRuleReason,
} from "#modules/scheduling/errors";
import type ProjectSession from "#modules/scheduling/models/project_session";
import type { SessionOutcome } from "#modules/scheduling/outcomes";
import { scheduledNote } from "#modules/scheduling/schedule_rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService, {
	type Scheduled,
} from "#modules/scheduling/services/session_service";
import { sessionTimeText } from "#modules/scheduling/times";
import {
	outcomeValidator,
	scheduleValidator,
	sessionTimeValidator,
	toNewSession,
	toSessionTimes,
} from "#modules/scheduling/validators/session";

/** What each recorded outcome tells the user. */
const OUTCOME_DONE: Record<SessionOutcome, string> = {
	completed: "Session marked done.",
	no_show: "Marked as a no-show. The time is free again.",
	cancelled: "Session cancelled. The time is free again.",
};

/** What a refused outcome tells the user. */
const OUTCOME_REFUSED: Record<SessionRuleReason, string> = {
	not_scheduled:
		"This session already has an outcome, and outcomes can't be changed.",
	not_started:
		"This session hasn't started yet: mark it done or a no-show once it has.",
	not_booked:
		"This project isn't booked yet, so its tattoo session can't be marked done.",
	project_closed: "This session can't be changed.",
	invalid_range: "This session can't be changed.",
	project_finished: "This session can't be changed.",
	touch_ups_only: "This session can't be changed.",
};

/** What a refused schedule tells the user. */
const SCHEDULE_REFUSED: Record<SessionRuleReason, string> = {
	project_closed: "This project is closed: it takes no new sessions.",
	project_finished: "This project is finished: it takes no new sessions.",
	touch_ups_only: "The healing check takes touch-up sessions only.",
	not_scheduled: "This session can't be scheduled.",
	not_started: "This session can't be scheduled.",
	not_booked: "This session can't be scheduled.",
	invalid_range: "This session can't be scheduled.",
};

/**
 * A session's outcome and its time (TAT-85), from the project page's
 * Sessions card. Owners change any session; an artist only their own on a
 * project assigned to them. Every :id loads through
 * SessionService.findChangeable before the form is read, so anyone else,
 * another tenant's id included, gets a 404 even with a bad body.
 */
@inject()
export default class ProjectSessionsController {
	constructor(
		private sessions: SessionService,
		private artists: ArtistService,
		private projects: ProjectService,
		private bookings: BookingService,
		private quotes: QuoteService,
		private deposits: DepositService,
	) {}

	async outcome(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const session = await this.sessions.findChangeable(
			tenant,
			membership,
			ctx.params.id,
		);
		const { status } = await ctx.request.validateUsing(outcomeValidator);
		try {
			const { projectMoved } = await this.sessions.recordOutcome(
				tenant,
				membership,
				session,
				status,
			);
			ctx.session.flash(
				"success",
				`${OUTCOME_DONE[status]}${projectMoved ? " The project is now in progress." : ""}`,
			);
		} catch (error) {
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash("error", OUTCOME_REFUSED[error.reason]);
		}
		return backTo(ctx, tenant, session.projectId);
	}

	async move(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const session = await this.sessions.findChangeable(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(sessionTimeValidator);
		const times = toSessionTimes(form, tenant.timezone);
		let moved: ProjectSession;
		try {
			moved = await this.sessions.move(tenant, membership, session, times);
		} catch (error) {
			// The move's savepoint already rolled back, so this read is safe and
			// nothing was saved.
			if (error instanceof SessionOverlapError) {
				const artist = (await this.artists.list(tenant)).find(
					({ id }) => id === session.artistId,
				);
				throw fieldError(
					"startTime",
					`${artist?.name ?? "The artist"} already has a session at that time. Pick another time.`,
					"overlap",
				);
			}
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash(
				"error",
				"This session already has an outcome, so it can't be moved.",
			);
			return backTo(ctx, tenant, session.projectId);
		}
		ctx.session.flash(
			"success",
			`Session moved: ${sessionTimeText(moved.startsAt, moved.endsAt, tenant.timezone)}.`,
		);
		return backTo(ctx, tenant, session.projectId);
	}

	/**
	 * Schedules a session on the project (TAT-85 part 2). The project loads
	 * through ProjectService.findFor before the form is read (a 404 for
	 * another studio's, a deleted one, or one an artist can't open). The
	 * artist must be one the member may book (BookingService.bookableArtists:
	 * owners any live artist, an artist only themselves), else a field error.
	 * A tattoo session books the project when it can; the flash says so, or
	 * what is still missing.
	 */
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const form = await ctx.request.validateUsing(scheduleValidator);
		const input = toNewSession(form, tenant.timezone);
		const artist = (
			await this.bookings.bookableArtists(tenant, membership)
		).find(({ id }) => id === input.artistId);
		if (!artist) {
			throw fieldError(
				"sessionArtistId",
				"Choose an artist from the list.",
				"exists",
			);
		}
		let scheduled: Scheduled;
		try {
			scheduled = await this.sessions.scheduleFor(
				tenant,
				membership,
				project,
				input,
			);
		} catch (error) {
			// The savepoint already rolled back: nothing was saved.
			if (error instanceof SessionOverlapError) {
				throw fieldError(
					"startTime",
					`${artist.name} already has a session at that time. Pick another time.`,
					"overlap",
				);
			}
			if (!(error instanceof SessionRuleError)) throw error;
			ctx.session.flash("error", SCHEDULE_REFUSED[error.reason]);
			return backTo(ctx, tenant, project.id);
		}
		const { session, projectStatus, booked } = scheduled;
		const quote =
			projectStatus === "deposit_pending"
				? await this.quotes.current(tenant, project)
				: null;
		const depositDue = quote
			? await this.deposits.remaining(tenant, project, quote)
			: 0;
		ctx.session.flash(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, tenant.timezone)}.${scheduledNote({ kind: session.kind, booked, projectStatus, depositDue, withAmount: membership.role === "owner" })}`,
		);
		return backTo(ctx, tenant, project.id);
	}
}

/** A field error shown next to `field`, like the validator's own. */
function fieldError(field: string, message: string, rule: string) {
	return new errors.E_VALIDATION_ERROR([{ field, message, rule }]);
}

function backTo(ctx: HttpContext, tenant: { slug: string }, projectId: string) {
	return ctx.response
		.redirect()
		.toRoute("tenant.projects.show", { tenant: tenant.slug, id: projectId });
}
