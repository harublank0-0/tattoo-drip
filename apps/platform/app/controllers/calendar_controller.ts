import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { tenantContext } from "#middleware/tenant_middleware";
import { todayIn } from "#modules/projects/quotes";
import {
	calendarDays,
	dayBounds,
	dayLabel,
	overlapsDay,
	rangeText,
	sessionRow,
	shiftDate,
	toCalendarDate,
	toCalendarView,
} from "#modules/scheduling/calendar";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CalendarService from "#modules/scheduling/services/calendar_service";

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
		const artistId = artistParam(query.artist);
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
			// An owner needs an artist to book with: with none, the page says to add one.
			canBook:
				(membership.role === "owner" && artists.length > 0) ||
				scope.kind === "artist",
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

/**
 * `?artist=`: no artist when absent or empty, else one id. A repeated
 * parameter (an array) names no artist, so it is a 404 like any malformed id
 * rather than a calendar the link does not name.
 */
function artistParam(value: unknown): string | null {
	if (value === undefined || value === "") return null;
	if (typeof value !== "string") throw new lucidErrors.E_ROW_NOT_FOUND();
	return value;
}
