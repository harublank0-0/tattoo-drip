import { Link, useRouterState } from "@tanstack/react-router";
import type { DiscoverFreshInkPost } from "@tattoo-drip/sdk";
import { ArrowUpRightIcon, PlayIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { buttonVariants } from "#/components/ui/button";
import { bookingLinks, generalRequest } from "#/lib/booking";
import { profileDestination, tattooProfile } from "#/lib/destinations";
import {
	dayText,
	freshInkAlt,
	freshInkBooking,
	mediaCount,
	mediaWords,
	videoLabel,
} from "#/lib/reviews";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";
import { ratioOf } from "./artwork-tile.tsx";

/*
 * Fresh ink on Discover (Reviews and Fresh ink, slice 4): a client's
 * healed tattoo as a tile, in columns at true proportions like every photo
 * tile (ArtworkTile), and its viewer. A post has no page of its own: its
 * tile opens a modal viewer (Radix Dialog, like the menu and filter sheets:
 * focus moves in and is trapped, Escape and Close return it to the tile)
 * that shows every photo and ready video in the client's order, each framed
 * as an artwork page frames its photo, with what the post says and the
 * booking hand-off. Videos are never autoplayed and have no sound. The
 * client's words (caption, placement, shown name) are plain text,
 * `dir="auto"` and in `<bdi>`, and break anywhere, so a right-to-left name
 * never reorders the line around it and a long word never overflows.
 */

/** Text that may hold a long unbroken word (a URL, a long name): it wraps anywhere. */
export const USER_TEXT = "break-words [overflow-wrap:anywhere]";

/** The profile a post's studio links to: the studio's, or an independent artist's own. */
export function freshInkStudioPath(post: DiscoverFreshInkPost): string {
	return post.studio.type === "independent"
		? paths.independentArtist(post.studio.slug)
		: profileDestination({
				slug: post.studio.slug,
				storefrontUrl: post.storefrontUrl,
			}).href;
}

/** The caption's credit on the feed: the artist (their profile), then the studio (its profile). */
export function FreshInkCredit({ post }: { post: DiscoverFreshInkPost }) {
	const artist = tattooProfile(post);
	return (
		<span className={USER_TEXT}>
			{artist ? (
				<Link
					to={artist}
					preload={false}
					className="py-1 font-medium text-current underline-offset-4 hover:underline"
				>
					<bdi>{post.artist.name}</bdi>
				</Link>
			) : (
				<bdi>{post.artist.name}</bdi>
			)}
			{post.studio.type === "studio" && (
				<>
					{" · "}
					<Link
						to={freshInkStudioPath(post)}
						preload={false}
						className="py-1 text-current underline-offset-4 hover:underline"
					>
						<bdi>{post.studio.name}</bdi>
					</Link>
				</>
			)}
		</span>
	);
}

/**
 * One post: its lead photo as the button that opens the viewer (its name
 * says what it holds), and a caption.
 */
export function FreshInkTile({
	post,
	tone = "night",
	sizes = "(min-width: 64rem) 22vw, (min-width: 40rem) 33vw, 50vw",
	priority = false,
	eager = false,
	caption,
}: {
	post: DiscoverFreshInkPost;
	tone?: "night" | "paper";
	sizes?: string;
	priority?: boolean;
	eager?: boolean;
	caption?: ReactNode;
}) {
	const count = mediaCount(post);
	return (
		<figure className="flex min-w-0 flex-col gap-2">
			<Dialog.Root>
				<Dialog.Trigger asChild>
					<button
						type="button"
						className="group relative block w-full cursor-zoom-in text-left"
					>
						<ResponsiveImage
							image={post}
							alt={freshInkAlt(post)}
							ratio={ratioOf(post)}
							sizes={sizes}
							priority={priority}
							eager={eager}
							className={tone === "night" ? "bg-night-raised" : undefined}
						/>
						{count && (
							<span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-[2px] bg-ink/80 px-2 py-1 text-xs font-medium text-night-ink">
								{post.angles.some((angle) => angle.kind === "video") && (
									<PlayIcon className="size-3" aria-hidden="true" />
								)}
								{count}
							</span>
						)}
						<span className="sr-only">
							{", open Fresh ink by "}
							<bdi>{post.shownName}</bdi>
						</span>
					</button>
				</Dialog.Trigger>
				<FreshInkViewer post={post} />
			</Dialog.Root>
			<figcaption
				className={cn(
					"min-w-0 text-sm",
					USER_TEXT,
					tone === "night" ? "text-night-muted" : "text-muted-foreground",
				)}
			>
				{caption ?? <FreshInkCredit post={post} />}
			</figcaption>
		</figure>
	);
}

/**
 * Posts in CSS columns at their true proportions, as ArtworkColumns. Each
 * item can take focus (`tabIndex={-1}`, id `itemId(post)`), so "Show more"
 * can move focus to the first new one.
 */
export function FreshInkColumns({
	posts,
	tone = "night",
	sizes,
	eager = 0,
	caption,
	columns = "lg:columns-4",
	itemId,
}: {
	posts: readonly DiscoverFreshInkPost[];
	tone?: "night" | "paper";
	sizes?: string;
	eager?: number;
	caption?: (post: DiscoverFreshInkPost) => ReactNode;
	columns?: string;
	itemId?: (post: DiscoverFreshInkPost) => string;
}) {
	return (
		<ul
			className={cn("columns-2 gap-3 sm:columns-3 sm:gap-4 lg:gap-6", columns)}
		>
			{posts.map((post, index) => (
				<li
					key={post.id}
					id={itemId?.(post)}
					tabIndex={itemId ? -1 : undefined}
					className="mb-6 min-w-0 break-inside-avoid focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				>
					<FreshInkTile
						post={post}
						tone={tone}
						sizes={sizes}
						priority={eager > 0 && index === 0}
						eager={index < eager}
						caption={caption?.(post)}
					/>
				</li>
			))}
		</ul>
	);
}

/**
 * A photo's or video's frame in the viewer, as ArtworkImage frames an
 * artwork: as wide as fits, never taller than 80% of the screen, at its
 * own ratio before anything loads (a failed image keeps the frame).
 */
function MediaFrame({
	width,
	height,
	children,
}: {
	width: number;
	height: number;
	children: ReactNode;
}) {
	const ratio = width > 0 && height > 0 ? width / height : 4 / 5;
	return (
		<div
			className="mx-auto w-full"
			style={{ maxWidth: `min(100%, calc(80svh * ${ratio.toFixed(4)}))` }}
		>
			{children}
		</div>
	);
}

/** A link inside the viewer: following it closes the dialog; the page it is already on is plain text. */
function ViewerLink({ to, children }: { to: string; children: ReactNode }) {
	const here = useRouterState({ select: (state) => state.location.pathname });
	if (here === to) return <>{children}</>;
	return (
		<Dialog.Close asChild>
			<Link
				to={to}
				className="font-medium underline underline-offset-4"
				preload={false}
			>
				{children}
			</Link>
		</Dialog.Close>
	);
}

/**
 * The viewer: every photo and ready video of the post, in order (lazy
 * until opened: the dialog's content mounts on open), then what the post
 * says, who made it and the booking hand-off by the artwork page's rule.
 */
export function FreshInkViewer({ post }: { post: DiscoverFreshInkPost }) {
	const total = post.angles.length + 1;
	const independent = post.studio.type === "independent";
	const links = bookingLinks(post, post.artist.slug);
	const booking = freshInkBooking(post, links.request, generalRequest);
	const owner = independent ? `${post.artist.name}'s` : `${post.studio.name}'s`;
	const artist = tattooProfile(post);
	return (
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-50 bg-ink/70" />
			<Dialog.Content className="fixed inset-x-0 top-0 bottom-0 z-50 mx-auto flex w-full max-w-4xl flex-col overflow-y-auto bg-paper shadow-lg focus:outline-hidden sm:inset-y-6 sm:w-[calc(100%-3rem)]">
				<div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-paper px-4 py-2 sm:px-6">
					<Dialog.Title
						className={cn("min-w-0 font-display text-xl font-bold", USER_TEXT)}
					>
						Fresh ink by <bdi>{post.shownName}</bdi>
					</Dialog.Title>
					<Dialog.Close
						className={cn(
							buttonVariants({ variant: "ghost", size: "md" }),
							"shrink-0",
						)}
					>
						<XIcon aria-hidden="true" />
						Close
					</Dialog.Close>
				</div>
				<Dialog.Description className="sr-only">
					{`A healed tattoo by ${post.artist.name}, posted by a client of ${independent ? "theirs" : post.studio.name}: ${mediaWords(post)}.`}
				</Dialog.Description>
				<div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
					<MediaFrame width={post.width} height={post.height}>
						<ResponsiveImage
							image={post}
							alt={freshInkAlt(post, { index: 0, total })}
							ratio={ratioOf(post)}
							large
							eager
							fit="contain"
							sizes="(min-width: 56rem) 52rem, 100vw"
						/>
					</MediaFrame>
					{post.angles.map((angle, index) =>
						angle.kind === "photo" ? (
							<MediaFrame
								// biome-ignore lint/suspicious/noArrayIndexKey: the post's fixed order.
								key={`photo-${index}`}
								width={angle.width}
								height={angle.height}
							>
								<ResponsiveImage
									image={angle}
									alt={freshInkAlt(
										{ alt: angle.alt, artist: post.artist },
										{ index: index + 1, total },
									)}
									ratio={ratioOf(angle)}
									large
									fit="contain"
									sizes="(min-width: 56rem) 52rem, 100vw"
								/>
							</MediaFrame>
						) : angle.kind === "video" ? (
							<MediaFrame
								// biome-ignore lint/suspicious/noArrayIndexKey: the post's fixed order.
								key={`video-${index}`}
								width={angle.poster.width}
								height={angle.poster.height}
							>
								<video
									controls
									muted
									playsInline
									preload="none"
									poster={angle.poster.url}
									width={angle.poster.width}
									height={angle.poster.height}
									aria-label={angle.alt?.trim() || videoLabel(angle.durationMs)}
									className="block h-auto w-full bg-night object-contain"
									style={{ aspectRatio: ratioOf(angle.poster) }}
								>
									{angle.sources.map((source) => (
										<source
											key={source.url}
											src={source.url}
											type={source.type}
										/>
									))}
								</video>
							</MediaFrame>
						) : null,
					)}
					<div className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
						{post.caption && (
							<p
								className={cn("text-lg whitespace-pre-line", USER_TEXT)}
								dir="auto"
							>
								{post.caption}
							</p>
						)}
						<p className={cn("text-sm text-muted-foreground", USER_TEXT)}>
							<bdi>{post.shownName}</bdi>
							{" · "}
							<time dateTime={post.date}>{dayText(post.date)}</time>
						</p>
						<p className={USER_TEXT}>
							{"Tattoo by "}
							{artist ? (
								<ViewerLink to={artist}>
									<bdi>{post.artist.name}</bdi>
								</ViewerLink>
							) : (
								<bdi>{post.artist.name}</bdi>
							)}
							{!independent && (
								<>
									{" at "}
									<ViewerLink to={freshInkStudioPath(post)}>
										<bdi>{post.studio.name}</bdi>
									</ViewerLink>
								</>
							)}
						</p>
						{post.styles.length > 0 && (
							<p className="text-sm">
								{post.styles.map((style) => style.name).join(" · ")}
							</p>
						)}
						{post.placement && (
							<p className={cn("text-sm", USER_TEXT)} dir="auto">
								<span className="sr-only">Placement: </span>
								{post.placement}
							</p>
						)}
						{booking.closed && <p className="font-medium">{booking.closed}</p>}
						{(booking.request || links.site) && (
							<div className="flex flex-wrap gap-3 pt-2">
								{booking.request && (
									<a
										href={booking.request}
										className={cn(
											buttonVariants({ variant: "accent" }),
											"h-auto max-w-full shrink py-2 text-left whitespace-normal",
										)}
									>
										{booking.label}
										<ArrowUpRightIcon aria-hidden="true" />
										<span className="sr-only">{`(${owner} own booking form)`}</span>
									</a>
								)}
								{links.site && (
									<a
										href={links.site}
										className={buttonVariants({ variant: "outline" })}
									>
										{independent ? "Visit their site" : "Visit studio site"}
										<ArrowUpRightIcon aria-hidden="true" />
										<span className="sr-only">{`(${owner} own site)`}</span>
									</a>
								)}
							</div>
						)}
						<p className="text-sm text-muted-foreground">
							{independent
								? `Posted by a client of ${post.artist.name} through their own review link, and shown with the client's permission.`
								: "Posted by a client of the studio through the studio's own review link, and shown with the client's permission."}
						</p>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	);
}
