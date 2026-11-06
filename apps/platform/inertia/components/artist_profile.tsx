import { Link } from "@adonisjs/inertia/react";
import { CalendarDays, ExternalLink, Eye, EyeOff, Inbox } from "lucide-react";
import { urlFor } from "~/client";
import type { ArtistProps, ArtistSchedule } from "~/components/artists";
import Initials from "~/components/initials";
import { UpcomingList } from "~/components/overview";
import { buttonVariants } from "~/components/ui/button";

const DAY_NAMES: Record<string, string> = {
	sun: "Sunday",
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
};

/**
 * An artist profile's header (Studio OS): the portrait (larger than a
 * client's initials: an artist's page is about them), the name, whether they
 * are on the studio page and taking requests (in words, with a mark), and the
 * ways out: their week in the calendar and their public page.
 */
export default function ArtistProfileHeader({
	artist,
	owner,
	tenantSlug,
	title,
}: {
	artist: ArtistProps;
	owner: boolean;
	tenantSlug: string;
	title: string;
}) {
	return (
		<header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
			<div className="flex min-w-0 items-center gap-4">
				{artist.photoUrl ? (
					<img
						src={artist.photoUrl}
						alt=""
						className="size-20 shrink-0 rounded-lg border object-cover"
					/>
				) : (
					<Initials name={artist.name} className="size-20 rounded-lg text-xl" />
				)}
				<div className="flex min-w-0 flex-col gap-1.5">
					<h1 className="text-[1.625rem] leading-[1.35] font-semibold text-balance wrap-anywhere sm:text-[1.75rem]">
						{title}
					</h1>
					{!owner && (
						<p className="text-sm text-muted-foreground wrap-anywhere">
							{artist.name}
						</p>
					)}
					<p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
						<span className="inline-flex items-center gap-1.5">
							{artist.visible ? (
								<Eye aria-hidden="true" className="size-4" />
							) : (
								<EyeOff aria-hidden="true" className="size-4" />
							)}
							{artist.visible ? "On the studio page" : "Hidden from the page"}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<Inbox aria-hidden="true" className="size-4" />
							{artist.acceptingInquiries
								? "Taking requests"
								: "Not taking requests"}
						</span>
					</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				<Link
					href={`${urlFor("tenant.calendar.index", { tenant: tenantSlug })}?view=week&artist=${artist.id}`}
					className={buttonVariants({ variant: "outline", size: "sm" })}
				>
					<CalendarDays aria-hidden="true" />
					Calendar
				</Link>
				{artist.pageUrl && (
					<a
						href={artist.pageUrl}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<ExternalLink aria-hidden="true" />
						Public page
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
				)}
			</div>
		</header>
	);
}

/**
 * The profile's schedule: the next days' sessions through the calendar's
 * read (the same rows as Today's "Next 7 days", each opening its project, or
 * nothing for a session on a project the member can't open), and the
 * studio's opening hours. There are no per-artist hours: the studio's are
 * what clients see, and a booking is checked only against the artist's
 * other sessions, so the hours are shown as context, with the way to change
 * them for owners.
 */
export function ArtistScheduleView({
	artistId,
	schedule,
	owner,
	tenantSlug,
}: {
	artistId: string;
	schedule: ArtistSchedule;
	owner: boolean;
	tenantSlug: string;
}) {
	return (
		<div className="flex flex-col gap-6">
			{schedule.sessions.length === 0 ? (
				<p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
					Nothing booked in the next {schedule.days} days.
				</p>
			) : (
				<UpcomingList
					rows={schedule.sessions}
					showArtist={false}
					isOwner={owner}
					slug={tenantSlug}
				/>
			)}
			<Link
				href={`${urlFor("tenant.calendar.index", { tenant: tenantSlug })}?view=agenda&artist=${artistId}`}
				className="self-start text-sm font-medium text-brand-text underline-offset-4 hover:underline max-lg:min-h-11 max-lg:inline-flex max-lg:items-center"
			>
				All their sessions in the calendar
			</Link>

			<div className="flex flex-col gap-2">
				<h3 className="text-sm font-semibold">Studio hours</h3>
				{schedule.hours.length === 0 ? (
					<p className="text-sm text-muted-foreground">No opening hours set.</p>
				) : (
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
						{Object.keys(DAY_NAMES).map((day) => {
							const open = schedule.hours.find((entry) => entry.day === day);
							return (
								<div key={day} className="contents">
									<dt className="text-muted-foreground">{DAY_NAMES[day]}</dt>
									<dd className="tabular-nums">
										{open ? `${open.opens} to ${open.closes}` : "Closed"}
									</dd>
								</div>
							);
						})}
					</dl>
				)}
				<p className="text-xs text-muted-foreground">
					The studio's hours, shown to clients. A booking is checked against
					this artist's other sessions, not these hours.
				</p>
				{owner && (
					<Link
						route="tenant.settings.good_to_know"
						routeParams={{ tenant: tenantSlug }}
						className="self-start text-sm font-medium text-brand-text underline-offset-4 hover:underline max-lg:min-h-11 max-lg:inline-flex max-lg:items-center"
					>
						Change the studio's hours
					</Link>
				)}
			</div>
		</div>
	);
}
