import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
import { ALERT_EXCERPT_LENGTH, excerpt } from "#modules/notifications/alerts";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import {
	calendarDays,
	dayBounds,
	dayLabel,
	MONTH_CELL_ROWS,
	monthText,
	overlapsDay,
	rangeText,
	STATUSES_OF,
	sessionRow,
	shiftDate,
	toCalendarDate,
	toCalendarStatus,
	toCalendarView,
} from "#modules/scheduling/calendar";
import { WEEKDAYS } from "#modules/scheduling/opening_hours";
import {
	mayChangeSession,
	outcomeRefusal,
	outcomesFor,
} from "#modules/scheduling/outcomes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CalendarService, {
	type CalendarEntry,
} from "#modules/scheduling/services/calendar_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import { sessionFormValues, sessionTimeText } from "#modules/scheduling/times";

/**
 * The calendar (TAT-50, Studio OS): a day or a week on a time grid, a month
 * of whole weeks, or a list of the next AGENDA_DAYS days, in the studio's
 * timezone, for the whole studio or one artist, filtered by status. Owners
 * and artists (the route group); what each member sees is CalendarService's,
 * and the session drawer (`?session=`) shows only a session that read
 * returned. Read-only: the drawer's actions post to the sessions routes.
 */
@inject()
export default class CalendarController {
	constructor(
		private calendar: CalendarService,
		private hours: OpeningHoursService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { timezone } = tenant;
		const query = ctx.request.qs();
		const now = DateTime.now();
		const today = todayIn(timezone, now);
		const view = toCalendarView(query.view);
		const date = toCalendarDate(query.date, today);
		const status = toCalendarStatus(query.status);
		const artistId = artistParam(query.artist);
		const selectedId = sessionParam(query.session);
		const days = calendarDays(view, date);
		const first = days[0];
		const last = days[days.length - 1];
		const { scope, artists, entries } = await this.calendar.load(
			tenant,
			membership,
			{
				artistId,
				from: dayBounds(first, timezone).from,
				to: dayBounds(last, timezone).to,
				statuses: status === "active" ? undefined : STATUSES_OF[status],
			},
		);
		const week = await this.hours.week(tenant);
		const closures = await this.hours.closuresBetween(tenant, first, last);

		const hoursOf = (day: string) => {
			const weekday =
				WEEKDAYS[DateTime.fromISO(day, { zone: "utc" }).weekday % 7];
			const open = week.find(({ day: name }) => name === weekday);
			return open ? { opens: open.opens, closes: open.closes } : null;
		};
		const closureOf = (day: string) => {
			const closure = closures.find(
				({ startsOn, endsOn }) =>
					startsOn.toFormat("yyyy-MM-dd") <= day &&
					endsOn.toFormat("yyyy-MM-dd") >= day,
			);
			return closure ? { note: closure.note } : null;
		};
		const rowsOn = (day: string) =>
			entries
				.filter(({ session }) =>
					overlapsDay(session.startsAt, session.endsAt, day, timezone),
				)
				.map((entry) => sessionRow(entry, day, timezone));
		const month = DateTime.fromISO(date, { zone: "utc" }).month;

		return ctx.inertia.render("calendar/index", {
			view,
			date,
			// No `today`: the page keeps its own date with the clock (TAT-84).
			timezone,
			rangeText: view === "month" ? monthText(date) : rangeText(days),
			previous: shiftDate(view, date, -1),
			next: shiftDate(view, date, 1),
			scope: scope.kind,
			status,
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
			days: days.map((day) => {
				const rows = rowsOn(day);
				return {
					date: day,
					label: dayLabel(day),
					// A month cell lists a few and counts the rest.
					sessions: view === "month" ? rows.slice(0, MONTH_CELL_ROWS) : rows,
					count: rows.length,
					inMonth:
						view !== "month" ||
						DateTime.fromISO(day, { zone: "utc" }).month === month,
					hours: hoursOf(day),
					closure: closureOf(day),
				};
			}),
			selected: (() => {
				const entry = entries.find(({ session }) => session.id === selectedId);
				if (!entry) return null;
				const ownArtistId =
					membership.role === "artist" && scope.kind === "artist"
						? scope.artist.id
						: null;
				return selectedSession(entry, {
					isOwner: membership.role === "owner",
					changeable:
						entry.session.status === "scheduled" &&
						entry.project !== null &&
						mayChangeSession(
							membership,
							ownArtistId,
							entry.session,
							entry.project,
						),
					timezone,
					today,
					now,
				});
			})(),
		});
	}
}

/**
 * The drawer's session: when, who and what, and what this member may do to
 * it (the project page's own rules: outcomesFor, mayChangeSession and the
 * move form's values). Built from the calendar's read, so a session the
 * member can't see never gets here.
 */
function selectedSession(
	{ session, artistName, project }: CalendarEntry,
	{
		isOwner,
		changeable,
		timezone,
		today,
		now,
	}: {
		isOwner: boolean;
		changeable: boolean;
		timezone: string;
		today: string;
		now: DateTime;
	},
) {
	const minutes = Math.round(
		session.endsAt.diff(session.startsAt, "minutes").minutes,
	);
	return {
		id: session.id,
		kind: session.kind,
		status: session.status,
		artistName,
		whenText: sessionTimeText(session.startsAt, session.endsAt, timezone),
		lengthText: lengthText(minutes),
		project: project && {
			id: project.id,
			clientName: project.clientName,
			brief: excerpt(project.brief, ALERT_EXCERPT_LENGTH * 4),
			status: project.status,
			// The client page is owners' (TENANT_ROUTE_ROLES).
			clientId: isOwner ? project.clientId : null,
		},
		outcomes:
			changeable && project ? outcomesFor(session, project.status, now) : [],
		awaitingBooking:
			changeable &&
			project !== null &&
			outcomeRefusal(session, project.status, "completed", now) ===
				"not_booked",
		move: changeable
			? sessionFormValues(
					session.startsAt,
					session.endsAt,
					timezone,
					today,
					lastBookableDay(today),
				)
			: null,
		dates: { today, max: lastBookableDay(today) },
	};
}

/** "3 h", "45 min", "2 h 30 min". */
function lengthText(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours === 0) return `${rest} min`;
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
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

/** `?session=`: the drawer's session id, or none (anything but one string). */
function sessionParam(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}
