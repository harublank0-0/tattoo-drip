import { Link } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { cn } from "cn";
import {
	CalendarDays,
	ExternalLink,
	Eye,
	EyeOff,
	Images,
	Inbox,
	KeyRound,
	Pencil,
	Plus,
	UserPlus,
} from "lucide-react";
import { type RefObject, useRef } from "react";
import { urlFor } from "~/client";
import type { ArtistListRow } from "~/components/artists";
import Initials from "~/components/initials";
import InlineConfirm from "~/components/inline_confirm";
import Page from "~/components/page";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The studio's artists (Studio OS): a team workspace, people first. A card
 * per artist with their portrait, styles, whether they're on the studio page
 * and taking requests, whether a member's login is linked to them, and their
 * sessions in the next `upcomingDays` days, with the ways into their profile,
 * their week in the calendar and their public page. An artist profile is not
 * an account: a member logs in (Settings, Members, where invitations live)
 * and may be linked to one profile; many artists have no login. Owners only.
 */
export default function Artists({
	artists,
	upcomingDays,
}: {
	artists: ArtistListRow[];
	upcomingDays: number;
}) {
	const tenant = useTenant();
	const heading = useRef<HTMLHeadingElement>(null);
	const params = { tenant: tenant.slug };
	const onPage = artists.filter(({ visible }) => visible).length;
	const taking = artists.filter(
		({ visible, acceptingInquiries }) => visible && acceptingInquiries,
	).length;
	const logins = artists.filter(({ hasLogin }) => hasLogin).length;

	return (
		<Page
			title="Artists"
			titleRef={heading}
			description="Your artists, their sessions and their pages."
			actions={
				<>
					<Link
						route="tenant.settings.members"
						routeParams={params}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<UserPlus aria-hidden="true" />
						Invite a member
					</Link>
					<Link
						route="tenant.artists.create"
						routeParams={params}
						className={buttonVariants({ size: "sm" })}
					>
						<Plus aria-hidden="true" />
						Add an artist
					</Link>
				</>
			}
		>
			{artists.length === 0 ? (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-5 py-8">
					<h2 className="text-base font-semibold">No artists yet</h2>
					<p className="max-w-prose text-sm text-muted-foreground">
						Add the artists who work here, each with their own photo, bio and
						page. Sessions are booked with an artist, so add one before your
						first booking.
					</p>
					<Link
						route="tenant.artists.create"
						routeParams={params}
						className={buttonVariants({ size: "sm" })}
					>
						<Plus aria-hidden="true" />
						Add an artist
					</Link>
				</div>
			) : (
				<>
					<p className="border-y py-2.5 text-sm text-muted-foreground">
						{artists.length} artist{artists.length === 1 ? "" : "s"}, {onPage}{" "}
						on your page, {taking} taking requests, {logins} with a login.
					</p>
					<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{artists.map((artist) => (
							<ArtistCard
								key={artist.id}
								artist={artist}
								tenantSlug={tenant.slug}
								upcomingDays={upcomingDays}
								fallback={heading}
							/>
						))}
					</ul>
				</>
			)}
		</Page>
	);
}

Artists.layout = [AppLayout];

function ArtistCard({
	artist,
	tenantSlug,
	upcomingDays,
	fallback,
}: {
	artist: ArtistListRow;
	tenantSlug: string;
	upcomingDays: number;
	/** Where focus goes when the deleted artist's card is gone: the page heading. */
	fallback: RefObject<HTMLElement | null>;
}) {
	const params = { tenant: tenantSlug, id: artist.id };
	return (
		<li className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
			<div className="relative aspect-[4/3] bg-muted">
				{artist.photoUrl ? (
					<img
						src={artist.photoUrl}
						alt=""
						loading="lazy"
						decoding="async"
						className="size-full object-cover"
					/>
				) : (
					<div className="flex size-full items-center justify-center">
						<Initials name={artist.name} className="size-16 text-lg" />
					</div>
				)}
				{artist.isMine && (
					<Badge className="absolute top-2.5 left-2.5">You</Badge>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-3 p-4">
				<div className="flex flex-col gap-0.5">
					<h2 className="text-base leading-snug font-semibold wrap-anywhere">
						<Link
							route="tenant.artists.edit"
							routeParams={params}
							className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							{artist.name}
						</Link>
					</h2>
					<p className="text-sm text-muted-foreground">
						{artist.styleNames.length > 0
							? artist.styleNames.join(", ")
							: "No styles listed"}
					</p>
				</div>

				<ul className="flex flex-col gap-1.5 text-sm">
					<Status
						on={artist.visible}
						icon={artist.visible ? Eye : EyeOff}
						text={artist.visible ? "On your page" : "Hidden from your page"}
					/>
					<Status
						on={artist.visible && artist.acceptingInquiries}
						icon={Inbox}
						text={
							!artist.acceptingInquiries
								? "Not taking requests"
								: artist.visible
									? "Taking requests"
									: "Taking requests once on your page"
						}
					/>
					<Status
						on={artist.hasLogin}
						icon={KeyRound}
						text={artist.hasLogin ? "Logs in to the studio" : "No login"}
					/>
				</ul>

				<p className="border-t pt-3 text-sm">
					{artist.upcomingCount > 0 ? (
						<>
							<span className="font-medium tabular-nums">
								{artist.upcomingCount} session
								{artist.upcomingCount === 1 ? "" : "s"}
							</span>{" "}
							<span className="text-muted-foreground">
								in the next {upcomingDays} days, next {artist.nextText}
							</span>
						</>
					) : (
						<span className="text-muted-foreground">
							Nothing booked in the next {upcomingDays} days
						</span>
					)}
				</p>

				<div className="mt-auto flex flex-wrap items-center gap-1.5">
					<Link
						route="tenant.artists.edit"
						routeParams={params}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						<Pencil aria-hidden="true" />
						Profile
					</Link>
					<Link
						href={`${urlFor("tenant.portfolio", { tenant: tenantSlug })}?artist=${artist.id}`}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<Images aria-hidden="true" />
						Work
						<span className="text-muted-foreground tabular-nums">
							{artist.photoCount}
						</span>
					</Link>
					<Link
						href={`${urlFor("tenant.calendar.index", { tenant: tenantSlug })}?view=week&artist=${artist.id}`}
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<CalendarDays aria-hidden="true" />
						Calendar
					</Link>
					{artist.pageUrl && (
						<a
							href={artist.pageUrl}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							<ExternalLink aria-hidden="true" />
							Their page
							<span className="sr-only"> (opens in a new tab)</span>
						</a>
					)}
				</div>
				{/* Asked in the card, not in the browser's box (Studio OS): its own row,
				    so the question has the card's width. */}
				<div className="border-t pt-3">
					<InlineConfirm
						label="Delete artist"
						ariaLabel={`Delete ${artist.name}`}
						variant="ghost"
						size="sm"
						triggerClassName="-ml-2 text-muted-foreground hover:text-destructive"
						question={`Delete "${artist.name}"? Their link stops working and clients won't see them.`}
						confirmLabel="Delete artist"
						keepLabel="Keep the artist"
						busyLabel="Deleting…"
						fallback={fallback}
						onConfirm={(finished) =>
							router.delete(urlFor("tenant.artists.destroy", params), {
								preserveScroll: true,
								onFinish: finished,
							})
						}
					/>
				</div>
			</div>
		</li>
	);
}

/** A status line: its words always, its mark quieter when it is off. */
function Status({
	on,
	icon: Icon,
	text,
}: {
	on: boolean;
	icon: typeof Eye;
	text: string;
}) {
	return (
		<li
			className={cn(
				"flex items-center gap-2",
				on ? "text-foreground" : "text-muted-foreground",
			)}
		>
			<Icon aria-hidden="true" className="size-4 shrink-0" />
			{text}
		</li>
	);
}
