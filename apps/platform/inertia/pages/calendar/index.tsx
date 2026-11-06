import { Link, router, usePage } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, Inbox, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	type CalendarDay,
	type CalendarPageProps,
	type CalendarQuery,
	type CalendarSession,
	calendarHref,
	STATUS_CHOICES,
	studioDate,
	VIEW_CHOICES,
} from "~/components/calendar";
import { MonthGrid, TimeGrid } from "~/components/calendar_views";
import { DayAgenda, useNow } from "~/components/day_agenda";
import Page from "~/components/page";
import SessionDrawer from "~/components/session_drawer";
import NavBadge from "~/components/shell/nav_badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** The calendar's unit names, for the step buttons' names. */
const UNITS = { day: "day", week: "week", month: "month", agenda: "two weeks" };

/**
 * The calendar (TAT-50, Studio OS): the studio's sessions as a day or a week
 * on a time grid, a month, or a list of two weeks, for the whole studio or
 * one artist, by status. Owners pick the artist; artists see their own. A
 * session opens the drawer, where the member reschedules it or records its
 * outcome by the project page's own rules; requests stay in the Inbox, and
 * booking is "Book session". Below `lg` the day and the week are lists: a
 * seven-column grid doesn't fit a phone, and a tablet's touch targets stay
 * 44px (TAT-103), which a half-hour block on the grid is not.
 */
export default function CalendarIndex(props: CalendarPageProps) {
	const {
		view,
		date,
		timezone,
		rangeText,
		scope,
		status,
		artistFilter,
		canBook,
		days,
		total,
		selected,
	} = props;
	const tenant = useTenant();
	const { inboxCount } = usePage().props;
	const now = useNow();
	// The studio's date, moving with the clock (a tab left open past midnight).
	const today = studioDate(now, timezone);
	const isOwner = tenant.role === "owner";
	const showArtist = scope === "studio";
	const base = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const query: CalendarQuery = {
		view,
		date,
		artist: artistFilter?.selected ?? null,
		status,
	};
	const hrefWith = (change: Partial<CalendarQuery>) =>
		calendarHref(base, { ...query, session: null, ...change });
	const sessionHref = (session: CalendarSession) =>
		hrefWith({ session: session.id });
	const back = hrefWith({});
	const loading = useVisiting();

	if (scope === "unlinked") {
		return (
			<Page title="Calendar" description="Your sessions">
				<p className="max-w-prose text-sm text-muted-foreground">
					Your calendar shows the sessions booked with your artist profile, and
					your account isn&apos;t linked to one yet.
				</p>
			</Page>
		);
	}

	const filtered = status !== "active" || Boolean(artistFilter?.selected);
	const agenda = (day: CalendarDay) => (
		<DayAgenda
			day={day}
			isToday={day.date === today}
			now={now}
			timezone={timezone}
			showArtist={showArtist}
			isOwner={isOwner}
			tenantSlug={tenant.slug}
			hrefFor={sessionHref}
		/>
	);

	return (
		<Page
			title="Calendar"
			description={
				isOwner
					? "Every session in the studio, by day, week or month."
					: "Your sessions, by day, week or month."
			}
			actions={
				<>
					{isOwner && (
						<Link
							href={urlFor("tenant.inbox.index", { tenant: tenant.slug })}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<Inbox aria-hidden="true" />
							Requests
							{inboxCount ? <NavBadge count={inboxCount} /> : null}
						</Link>
					)}
					{canBook && (
						<Link
							href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?date=${date}`}
							className={buttonVariants({ size: "sm" })}
						>
							<Plus aria-hidden="true" />
							Book session
						</Link>
					)}
				</>
			}
		>
			<div className="flex min-w-0 flex-col gap-4">
				<Toolbar
					{...props}
					today={today}
					hrefWith={hrefWith}
					base={base}
					query={query}
				/>
				{artistFilter && artistFilter.artists.length === 0 && (
					<p className="text-sm text-muted-foreground">
						Every session belongs to an artist.{" "}
						<Link
							href={urlFor("tenant.artists.create", { tenant: tenant.slug })}
							className="font-medium text-foreground underline"
						>
							Add an artist
						</Link>{" "}
						to start booking.
					</p>
				)}

				<section
					aria-labelledby="calendar-range"
					aria-busy={loading}
					className={cn(
						"flex min-w-0 flex-col gap-3 transition-opacity duration-150",
						loading && "opacity-60",
					)}
				>
					<h2
						id="calendar-range"
						aria-live="polite"
						className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-lg font-semibold"
					>
						{rangeText}
						<span className="text-sm font-normal text-muted-foreground tabular-nums">
							{total === 0
								? filtered
									? "Nothing matches these filters"
									: "No sessions"
								: `${total} session${total === 1 ? "" : "s"}`}
						</span>
					</h2>

					{view === "month" ? (
						<MonthGrid
							days={days}
							today={today}
							dayHref={(day) => hrefWith({ view: "day", date: day })}
							hrefFor={sessionHref}
							showArtist={showArtist}
							isOwner={isOwner}
						/>
					) : view === "agenda" ? (
						<AgendaList days={days} agenda={agenda} today={today} />
					) : (
						<>
							<div className="hidden lg:block">
								<TimeGrid
									days={days}
									today={today}
									now={now}
									timezone={timezone}
									showArtist={showArtist}
									isOwner={isOwner}
									hrefFor={sessionHref}
								/>
							</div>
							<div className="lg:hidden">
								{view === "day" ? (
									agenda(days[0])
								) : (
									<AgendaList days={days} agenda={agenda} today={today} all />
								)}
							</div>
						</>
					)}
				</section>
			</div>

			<SessionDrawer
				selected={selected}
				back={back}
				onClose={() =>
					router.get(back, {}, { preserveScroll: true, preserveState: true })
				}
			/>
		</Page>
	);
}

CalendarIndex.layout = [AppLayout];

/** Whether an Inertia visit is out: the calendar dims while the next range loads. */
function useVisiting(): boolean {
	const [visiting, setVisiting] = useState(false);
	useEffect(() => {
		const offStart = router.on("start", () => setVisiting(true));
		const offFinish = router.on("finish", () => setVisiting(false));
		return () => {
			offStart();
			offFinish();
		};
	}, []);
	return visiting;
}

/**
 * Days as lists, each under its heading: the list view's days with sessions
 * (or a sentence when there are none), and a phone's week (`all`: every
 * day, an empty one saying so).
 */
function AgendaList({
	days,
	agenda,
	today,
	all = false,
}: {
	days: CalendarDay[];
	agenda: (day: CalendarDay) => React.ReactNode;
	today: string;
	all?: boolean;
}) {
	const shown = all ? days : days.filter((day) => day.sessions.length > 0);
	if (shown.length === 0) {
		return (
			<p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
				No sessions in these two weeks.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			{shown.map((day) => (
				<section
					key={day.date}
					aria-labelledby={`day-${day.date}`}
					className="flex flex-col gap-1"
				>
					<h3
						id={`day-${day.date}`}
						className="flex items-center gap-2 border-b pb-1.5 text-sm font-semibold"
					>
						{day.label}
						{day.date === today && (
							<span className="rounded-sm bg-primary px-1.5 text-xs text-primary-foreground">
								Today
							</span>
						)}
						{day.closure && (
							<span className="text-xs font-normal text-muted-foreground">
								Closed{day.closure.note ? `: ${day.closure.note}` : ""}
							</span>
						)}
					</h3>
					{agenda(day)}
				</section>
			))}
		</div>
	);
}

/**
 * The calendar's controls: the view, one step back, today, one step on, and
 * the filters (owners pick the artist; every member the status). On a phone
 * they wrap into two rows, the filters full width.
 */
function Toolbar({
	view,
	previous,
	next,
	today,
	artistFilter,
	status,
	hrefWith,
	base,
	query,
}: CalendarPageProps & {
	today: string;
	hrefWith: (change: Partial<CalendarQuery>) => string;
	base: string;
	query: CalendarQuery;
}) {
	const unit = UNITS[view];
	const step = buttonVariants({ variant: "outline", size: "icon-sm" });
	const visit = (change: Partial<CalendarQuery>) =>
		router.get(
			calendarHref(base, { ...query, session: null, ...change }),
			{},
			{ preserveScroll: true, preserveState: true },
		);

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y py-2.5">
			<nav aria-label="Calendar dates" className="flex items-center gap-1.5">
				<Link
					href={hrefWith({ date: today })}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					Today
				</Link>
				<Link
					href={hrefWith({ date: previous })}
					aria-label={`Previous ${unit}`}
					className={step}
				>
					<ChevronLeft aria-hidden="true" />
				</Link>
				<Link
					href={hrefWith({ date: next })}
					aria-label={`Next ${unit}`}
					className={step}
				>
					<ChevronRight aria-hidden="true" />
				</Link>
			</nav>

			{/* No overflow-hidden: it would clip the links' focus rings. */}
			<nav
				aria-label="Calendar view"
				className="inline-flex rounded-md border bg-background p-0.5"
			>
				{VIEW_CHOICES.map((option) => (
					<Link
						key={option.value}
						href={hrefWith({ view: option.value })}
						aria-current={option.value === view ? "page" : undefined}
						className="relative inline-flex min-h-8 items-center rounded-sm px-3 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-foreground max-lg:min-h-11"
					>
						{option.label}
					</Link>
				))}
			</nav>

			<div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
				{artistFilter && artistFilter.artists.length > 0 && (
					<FilterSelect
						id="artist"
						label="Artist"
						value={artistFilter.selected ?? ""}
						options={[
							{ value: "", label: "All artists" },
							...artistFilter.artists.map(({ id, name }) => ({
								value: id,
								label: name,
							})),
						]}
						onApply={(value) => visit({ artist: value || null })}
					/>
				)}
				<FilterSelect
					id="status"
					label="Status"
					value={status}
					options={STATUS_CHOICES}
					onApply={(value) =>
						visit({ status: value as CalendarQuery["status"] })
					}
				/>
			</div>
		</div>
	);
}

/**
 * A filter (TAT-103): a pick with the mouse or a finger applies at once,
 * with no button, keeping the rest of the calendar's address; the visit
 * keeps the page's state, so the select stays mounted and keeps focus. A
 * closed native select also changes its value on every arrow key, and
 * loading the calendar at each step would be a change of context the person
 * didn't ask for (WCAG 3.2.2): a change made with the keyboard waits for
 * Enter or for focus to leave. Its label is visually hidden: the first
 * option names the filter's default.
 */
function FilterSelect({
	id,
	label,
	value,
	options,
	onApply,
}: {
	id: string;
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onApply: (value: string) => void;
}) {
	const select = useRef<HTMLSelectElement>(null);
	// What the last key press means: arrows move the value, Enter confirms.
	const viaKeys = useRef(false);
	const waiting = useRef(false);
	// A back or forward step changes the prop, not what the person chose.
	useEffect(() => {
		if (select.current) select.current.value = value;
		waiting.current = false;
	}, [value]);

	const apply = (next: string) => {
		waiting.current = false;
		onApply(next);
	};
	// Enter or blur: apply a keyboard change that is still waiting.
	const confirm = (element: HTMLSelectElement) => {
		if (waiting.current && element.value !== value) apply(element.value);
		waiting.current = false;
	};

	return (
		<div className="min-w-0 flex-1 sm:flex-none">
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<select
				ref={select}
				id={id}
				defaultValue={value}
				onPointerDown={() => {
					viaKeys.current = false;
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && waiting.current) {
						// Chromium opens the picker on Enter, which would also
						// swallow the key's release: apply the choice instead.
						event.preventDefault();
						confirm(event.currentTarget);
					} else if (event.key !== "Enter" && event.key !== "Tab") {
						viaKeys.current = true;
					}
				}}
				onChange={(event) => {
					if (viaKeys.current) waiting.current = true;
					else apply(event.currentTarget.value);
				}}
				// An Enter that picks an option in the open list changes the value
				// after its keydown, so that one is confirmed on release.
				onKeyUp={(event) => {
					if (event.key === "Enter") confirm(event.currentTarget);
				}}
				onBlur={(event) => confirm(event.currentTarget)}
				className="h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11 sm:w-auto"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}
