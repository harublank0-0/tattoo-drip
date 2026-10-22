import { Link, router } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { urlFor } from "~/client";
import {
	type CalendarDay,
	type CalendarPageProps,
	type CalendarView,
	studioDate,
} from "~/components/calendar";
import { DayAgenda, useNow } from "~/components/day_agenda";
import Page from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** A URL for this page with some of its state changed. */
type HrefFor = (change: { view?: CalendarView; date?: string }) => string;

/**
 * A day or a week of sessions (TAT-50), for the whole studio or one artist:
 * owners pick, artists see their own. Read-only; a session opens its
 * project.
 */
export default function CalendarIndex({
	view,
	date,
	timezone,
	rangeText,
	previous,
	next,
	scope,
	artistFilter,
	canBook,
	days,
}: CalendarPageProps) {
	const tenant = useTenant();
	const now = useNow();
	// Moves with the clock: the `today` prop is only the studio's date at load.
	const today = studioDate(now, timezone);
	const isOwner = tenant.role === "owner";
	const base = urlFor("tenant.calendar.index", { tenant: tenant.slug });
	const hrefFor: HrefFor = (change) => {
		const params = new URLSearchParams({
			view: change.view ?? view,
			date: change.date ?? date,
		});
		if (artistFilter?.selected) params.set("artist", artistFilter.selected);
		return `${base}?${params.toString()}`;
	};

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

	const agenda = (day: CalendarDay) => (
		<DayAgenda
			day={day}
			isToday={day.date === today}
			now={now}
			timezone={timezone}
			showArtist={scope === "studio"}
			isOwner={isOwner}
			tenantSlug={tenant.slug}
		/>
	);

	return (
		<Page
			title="Calendar"
			description={isOwner ? undefined : "Your sessions"}
			actions={
				canBook ? (
					<Link
						href={`${urlFor("tenant.projects.create", { tenant: tenant.slug })}?date=${date}`}
						className={cn(buttonVariants(), "h-11")}
					>
						Book session
					</Link>
				) : undefined
			}
		>
			<div className="flex max-w-3xl flex-col gap-6">
				<Toolbar
					view={view}
					today={today}
					previous={previous}
					next={next}
					hrefFor={hrefFor}
				/>
				{artistFilter &&
					(artistFilter.artists.length > 0 ? (
						<ArtistPicker
							base={base}
							view={view}
							date={date}
							filter={artistFilter}
						/>
					) : (
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
					))}
				<h2
					aria-live="polite"
					className="flex flex-wrap items-center gap-2 text-lg font-semibold"
				>
					{rangeText}
					{view === "day" && date === today && (
						<Badge variant="secondary">Today</Badge>
					)}
				</h2>
				{view === "day"
					? agenda(days[0])
					: days.map((day) => (
							<section
								key={day.date}
								aria-labelledby={`day-${day.date}`}
								className="flex flex-col gap-2"
							>
								<h3
									id={`day-${day.date}`}
									className="flex items-center gap-2 text-sm font-semibold"
								>
									{day.label}
									{day.date === today && (
										<Badge variant="secondary">Today</Badge>
									)}
								</h3>
								{agenda(day)}
							</section>
						))}
			</div>
		</Page>
	);
}

CalendarIndex.layout = [AppLayout];

/** Day or week, and one step back, today, one step on. */
function Toolbar({
	view,
	today,
	previous,
	next,
	hrefFor,
}: {
	view: CalendarView;
	today: string;
	previous: string;
	next: string;
	hrefFor: HrefFor;
}) {
	const unit = view === "day" ? "day" : "week";
	const step = cn(
		buttonVariants({ variant: "outline", size: "icon" }),
		"size-11",
	);

	return (
		<nav
			aria-label="Calendar"
			className="flex flex-wrap items-center justify-between gap-2"
		>
			{/* No overflow-hidden: it would clip the links' focus rings. */}
			<div className="inline-flex rounded-md border bg-background">
				{(["day", "week"] as const).map((option) => (
					<Link
						key={option}
						href={hrefFor({ view: option })}
						aria-current={option === view ? "page" : undefined}
						className={cn(
							buttonVariants({
								variant: option === view ? "secondary" : "ghost",
							}),
							"relative min-h-11 rounded-none px-4 first:rounded-l-sm last:rounded-r-sm focus-visible:z-10 aria-[current=page]:font-semibold",
						)}
					>
						{option === "day" ? "Day" : "Week"}
					</Link>
				))}
			</div>
			<div className="flex items-center gap-2">
				<Link
					href={hrefFor({ date: previous })}
					aria-label={`Previous ${unit}`}
					className={step}
				>
					<ChevronLeft aria-hidden="true" />
				</Link>
				<Link
					href={hrefFor({ date: today })}
					className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
				>
					Today
				</Link>
				<Link
					href={hrefFor({ date: next })}
					aria-label={`Next ${unit}`}
					className={step}
				>
					<ChevronRight aria-hidden="true" />
				</Link>
			</div>
		</nav>
	);
}

/**
 * Owners: one artist or all. A pick with the mouse or a finger applies at
 * once (TAT-103), with no button: it visits the same page with the new
 * `artist`, keeping the view and the date. The visit keeps the page's state,
 * so the select stays mounted and keeps focus. A closed native select also
 * changes its value on every arrow key, and loading the calendar at each step
 * would be a change of context the person didn't ask for (WCAG 3.2.2): a
 * change made with the keyboard waits for Enter or for focus to leave. A page
 * needs scripts to show at all (no server rendering), so there is no form to
 * fall back on.
 */
function ArtistPicker({
	base,
	view,
	date,
	filter,
}: {
	base: string;
	view: CalendarView;
	date: string;
	filter: NonNullable<CalendarPageProps["artistFilter"]>;
}) {
	const select = useRef<HTMLSelectElement>(null);
	const selected = filter.selected ?? "";
	// What the last key press means: arrows move the value, Enter confirms.
	const viaKeys = useRef(false);
	const waiting = useRef(false);
	// A back or forward step changes the prop, not what the person chose.
	useEffect(() => {
		if (select.current) select.current.value = selected;
		waiting.current = false;
	}, [selected]);

	const apply = (value: string) => {
		waiting.current = false;
		router.get(
			base,
			{ view, date, ...(value ? { artist: value } : {}) },
			{ preserveScroll: true, preserveState: true },
		);
	};
	// Enter or blur: apply a keyboard change that is still waiting.
	const confirm = (element: HTMLSelectElement) => {
		if (waiting.current && element.value !== selected) apply(element.value);
		waiting.current = false;
	};

	return (
		<Field>
			<FieldLabel htmlFor="artist">Artist</FieldLabel>
			<select
				ref={select}
				id="artist"
				defaultValue={selected}
				onPointerDown={() => {
					viaKeys.current = false;
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && waiting.current) {
						// Chromium opens the picker on Enter, which would also
						// swallow the key's release: apply the chosen artist instead.
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
				className="h-11 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm"
			>
				<option value="">All artists</option>
				{filter.artists.map(({ id, name }) => (
					<option key={id} value={id}>
						{name}
					</option>
				))}
			</select>
		</Field>
	);
}
