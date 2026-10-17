import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { todayIn } from "#modules/projects/quotes";
import {
	briefPreview,
	calendarDays,
	dayBounds,
	dayLabel,
	overlapsDay,
	rangeText,
	shiftDate,
	timesOnDay,
	toCalendarDate,
	toCalendarView,
} from "#modules/scheduling/calendar";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CalendarService, {
	type CalendarEntry,
} from "#modules/scheduling/services/calendar_service";

/**
 * The calendar (TAT-50): a day or a week of sessions in the studio's
 * timezone, for the whole studio or one artist. Owners and artists (the
 * route group); what each member sees is CalendarService's. Read-only.
 */
@inject()
export default class CalendarController {
	constructor(private calendar: CalendarService) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { timezone } = tenant;
		const query = ctx.request.qs();
		const today = todayIn(timezone);
		const view = toCalendarView(query.view);
		const date = toCalendarDate(query.date, today);
		const artistId =
			typeof query.artist === "string" && query.artist !== ""
				? query.artist
				: null;
		const days = calendarDays(view, date);
		const { scope, artists, entries } = await this.calendar.load(
			tenant,
			membership,
			{
				artistId,
				from: dayBounds(days[0], timezone).from,
				to: dayBounds(days[days.length - 1], timezone).to,
			},
		);

		return ctx.inertia.render("calendar/index", {
			view,
			date,
			today,
			timezone,
			rangeText: rangeText(days),
			previous: shiftDate(view, date, -1),
			next: shiftDate(view, date, 1),
			scope: scope.kind,
			artistFilter:
				membership.role === "owner"
					? {
							selected: scope.kind === "artist" ? scope.artist.id : null,
							artists: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			canBook: membership.role === "owner" || scope.kind === "artist",
			days: days.map((day) => ({
				date: day,
				label: dayLabel(day),
				sessions: entries
					.filter(({ session }) =>
						overlapsDay(session.startsAt, session.endsAt, day, timezone),
					)
					.map((entry) => sessionRow(entry, day, timezone)),
			})),
		});
	}
}

/** One session as a row on `day`: times on that day, a preview of the brief. */
function sessionRow(
	{ session, artistName, project }: CalendarEntry,
	day: string,
	timezone: string,
) {
	return {
		id: session.id,
		startsAt: session.startsAt.toMillis(),
		endsAt: session.endsAt.toMillis(),
		...timesOnDay(session.startsAt, session.endsAt, day, timezone),
		kind: session.kind,
		status: session.status,
		artistName,
		project: project && {
			id: project.id,
			clientName: project.clientName,
			brief: briefPreview(project.brief),
		},
	};
}
