import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDiscoverClient } from "@tattoo-drip/react";
import type {
	DiscoverFreshInkPage,
	DiscoverFreshInkPost,
	DiscoverReview,
	DiscoverReviewsPage,
} from "@tattoo-drip/sdk";
import { StarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MoreLink } from "#/components/directory/hub";
import { useMounted } from "#/components/directory/pagination";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
import { FreshInkColumns, USER_TEXT } from "#/components/gallery/fresh-ink";
import { Button } from "#/components/ui/button";
import { tattooProfile } from "#/lib/destinations";
import {
	averageText,
	dayText,
	filledStars,
	mergePages,
	profileReviewQueries,
	type ReviewSubject,
	ratingSummary,
	ratingWords,
	subjectKey,
} from "#/lib/reviews";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";

/*
 * A profile's Reviews and Fresh ink (Reviews and Fresh ink, slice 4): the
 * studio's clients' reviews (newest first, never "best first") with the
 * average only from 3 (ruling 10), and their Fresh ink. Both come from
 * optional reads: a failed or empty one renders nothing (no heading, no
 * "no reviews yet"). "Show
 * more" reads the next page in the browser (it appears after hydration);
 * the sections are keyed by the profile, so moving to another profile on
 * the same route (an artist to a colleague) starts them again.
 */

/** Five stars, `filled` of them filled: decoration only, the words say the rating. */
export function Stars({
	filled,
	className,
}: {
	filled: number;
	className?: string;
}) {
	return (
		<span aria-hidden="true" className={cn("inline-flex gap-0.5", className)}>
			{[0, 1, 2, 3, 4].map((index) => (
				<StarIcon
					key={index}
					className={cn(
						"size-4",
						index < filled
							? "fill-accent text-accent"
							: "fill-transparent text-line-strong",
					)}
				/>
			))}
		</span>
	);
}

type MoreState = "idle" | "loading" | "failed";

/**
 * "Show more": the first page comes from the loader (always the current
 * one); only the pages read here are state. After a page arrives, focus
 * moves to its first new item (`itemId`, which takes focus) and a polite
 * message says how many were added, also when it was the last page and the
 * button goes away.
 */
function useMore<
	T extends { id: string },
	P extends { data: T[]; nextCursor: string | null },
>(
	first: P,
	read: (cursor: string) => Promise<P>,
	itemId: (item: T) => string,
	noun: (count: number) => string,
) {
	const [extra, setExtra] = useState<P[]>([]);
	const [state, setState] = useState<MoreState>("idle");
	const [message, setMessage] = useState("");
	const focusNext = useRef<string | null>(null);
	const pages = [first, ...extra];
	const last = pages[pages.length - 1] as P;
	useEffect(() => {
		if (!focusNext.current) return;
		document.getElementById(focusNext.current)?.focus();
		focusNext.current = null;
	});
	const more = async () => {
		if (state === "loading" || !last.nextCursor) return;
		setState("loading");
		try {
			const page = await read(last.nextCursor);
			const shown = new Set(mergePages(pages).map((item) => item.id));
			const added = page.data.filter((item) => !shown.has(item.id));
			focusNext.current = added[0] ? itemId(added[0]) : null;
			setExtra((current) => [...current, page]);
			setMessage(
				added.length > 0
					? `${added.length} more ${noun(added.length)} shown${page.nextCursor ? "" : ", that's all of them"}.`
					: `No more ${noun(2)}.`,
			);
			setState("idle");
		} catch {
			setState("failed");
		}
	};
	return {
		items: mergePages(pages),
		more,
		state,
		message,
		hasMore: Boolean(last.nextCursor),
	};
}

function ShowMore({
	label,
	more,
	state,
	hasMore,
	message,
}: {
	label: string;
	more: () => void;
	state: MoreState;
	hasMore: boolean;
	message: string;
}) {
	const loading = state === "loading";
	return (
		<div className="mt-8 flex flex-col items-start gap-2">
			{hasMore && (
				<Button
					type="button"
					variant="outline"
					onClick={more}
					aria-disabled={loading || undefined}
					aria-busy={loading || undefined}
					className={loading ? "cursor-progress opacity-70" : undefined}
				>
					{loading ? "Loading…" : label}
				</Button>
			)}
			{/* Polite, and there before it changes, so the count is announced. */}
			<output className="sr-only">{message}</output>
			{state === "failed" && (
				<p role="alert" className="text-sm">
					That didn't load. Try again in a moment.
				</p>
			)}
		</div>
	);
}

/** One review: its stars and words, the client's text, who and when, the artist, the studio's reply. */
function ReviewItem({
	id,
	review,
	showArtist,
}: {
	id: string;
	review: DiscoverReview;
	showArtist: boolean;
}) {
	const artist = tattooProfile(review);
	return (
		<li
			id={id}
			tabIndex={-1}
			className="flex min-w-0 flex-col gap-3 border-b border-line py-6 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<p className="flex flex-wrap items-center gap-2">
				<Stars filled={review.rating} />
				<span className="text-sm font-medium">
					{ratingWords(review.rating)}
				</span>
			</p>
			<p
				className={cn("max-w-prose text-lg whitespace-pre-line", USER_TEXT)}
				dir="auto"
			>
				{review.body}
			</p>
			<p className={cn("text-sm text-muted-foreground", USER_TEXT)}>
				<bdi className="font-medium text-foreground">{review.shownName}</bdi>
				{" · "}
				<time dateTime={review.date}>{dayText(review.date)}</time>
				{showArtist && (
					<>
						{" · Tattoo by "}
						{artist ? (
							<Link
								to={artist}
								preload={false}
								className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4 lg:min-h-0"
							>
								<bdi>{review.artist.name}</bdi>
							</Link>
						) : (
							<bdi>{review.artist.name}</bdi>
						)}
					</>
				)}
			</p>
			{review.reply && (
				<div className="ml-4 flex max-w-prose min-w-0 flex-col gap-1 border-l-2 border-line-strong pl-4">
					<p className={cn("text-sm font-medium", USER_TEXT)}>
						{"Reply from "}
						<bdi>{review.studio.name}</bdi>
						{" · "}
						<time dateTime={review.reply.date} className="font-normal">
							{dayText(review.reply.date)}
						</time>
					</p>
					<p className={cn("whitespace-pre-line", USER_TEXT)} dir="auto">
						{review.reply.body}
					</p>
				</div>
			)}
		</li>
	);
}

/**
 * A profile's reviews: the average and "from N reviews" only when the API
 * gives a rating (from 3), then the reviews, newest first. Nothing at all
 * when there are none.
 */
export function ReviewsSection({
	id,
	subject,
	first,
	name,
	showArtist,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverReviewsPage | undefined;
	/** Whose reviews: "Black Needle", "Maya". */
	name: string;
	/** A studio's reviews name the artist of each tattoo. */
	showArtist: boolean;
}) {
	if (!first || first.data.length === 0) return null;
	return (
		<ReviewsList
			key={subjectKey(subject)}
			id={id}
			subject={subject}
			first={first}
			name={name}
			showArtist={showArtist}
		/>
	);
}

function ReviewsList({
	id,
	subject,
	first,
	name,
	showArtist,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverReviewsPage;
	name: string;
	showArtist: boolean;
}) {
	const client = useDiscoverClient();
	const queryClient = useQueryClient();
	const mounted = useMounted();
	const itemId = (review: DiscoverReview) => `${id}-${review.id}`;
	const { items, more, state, message, hasMore } = useMore(
		first,
		(cursor) =>
			queryClient.fetchQuery(
				profileReviewQueries(client, subject, { reviews: cursor }).reviews,
			),
		itemId,
		(count) => (count === 1 ? "review" : "reviews"),
	);
	const summary = ratingSummary(first.rating);
	return (
		<EditorialSection labelledBy={id} className="lg:py-20">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
				<div className="flex min-w-0 flex-col gap-6">
					<SectionHeading
						id={id}
						eyebrow="Reviews"
						title={`Reviews of ${name}`}
						className={USER_TEXT}
						intro="Written by clients through the private link sent after their tattoo. Newest first, never sorted by stars."
					/>
					{first.rating && summary && (
						<div className="flex flex-col gap-2 border-t border-ink pt-4">
							<p className="flex items-center gap-3">
								<span className="font-display text-display-md leading-none font-bold">
									{averageText(first.rating.average)}
								</span>
								<Stars
									filled={filledStars(first.rating.average)}
									className="[&_svg]:size-5"
								/>
							</p>
							<p className="text-lg">
								<span className="sr-only">{`Rated ${averageText(first.rating.average)} out of 5, `}</span>
								{`from ${first.rating.count} reviews`}
							</p>
						</div>
					)}
				</div>
				<div className="min-w-0">
					<ul className="flex flex-col border-t border-ink">
						{items.map((review) => (
							<ReviewItem
								key={review.id}
								id={itemId(review)}
								review={review}
								showArtist={showArtist}
							/>
						))}
					</ul>
					{mounted && (
						<ShowMore
							label="Show more reviews"
							more={more}
							state={state}
							hasMore={hasMore}
							message={message}
						/>
					)}
				</div>
			</div>
		</EditorialSection>
	);
}

/**
 * A profile's Fresh ink: a night band of tiles, each opening its viewer.
 * Nothing when there is none. `country` is the profile's own, when it is a
 * market: "All Fresh ink" then opens that country's feed, not the
 * visitor's.
 */
export function FreshInkSection({
	id,
	subject,
	first,
	name,
	country,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverFreshInkPage | undefined;
	name: string;
	country?: string;
}) {
	if (!first || first.data.length === 0) return null;
	return (
		<FreshInkList
			key={subjectKey(subject)}
			id={id}
			subject={subject}
			first={first}
			name={name}
			country={country}
		/>
	);
}

function FreshInkList({
	id,
	subject,
	first,
	name,
	country,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverFreshInkPage;
	name: string;
	country?: string;
}) {
	const client = useDiscoverClient();
	const queryClient = useQueryClient();
	const mounted = useMounted();
	const itemId = (post: DiscoverFreshInkPost) => `${id}-${post.id}`;
	const { items, more, state, message, hasMore } = useMore(
		first,
		(cursor) =>
			queryClient.fetchQuery(
				profileReviewQueries(client, subject, { freshInk: cursor }).freshInk,
			),
		itemId,
		(count) => (count === 1 ? "post" : "posts"),
	);
	return (
		<EditorialSection tone="night" labelledBy={id} className="lg:py-20">
			<div className="mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
				<SectionHeading
					id={id}
					eyebrow="Fresh ink"
					title={`Healed work from ${name}'s clients`}
					className={USER_TEXT}
					intro="Photos and short videos clients posted of their healed tattoos, shown with the studio's approval."
				/>
				<MoreLink
					to={paths.freshInk()}
					search={country ? { country } : undefined}
				>
					All Fresh ink
				</MoreLink>
			</div>
			<FreshInkColumns
				posts={items}
				columns="lg:columns-3"
				sizes="(min-width: 40rem) 33vw, 50vw"
				itemId={itemId}
				caption={(post) => (
					<>
						<bdi>{post.shownName}</bdi>
						{post.styles[0] ? ` · ${post.styles[0].name}` : ""}
					</>
				)}
			/>
			{mounted && (
				<ShowMore
					label="Show more Fresh ink"
					more={more}
					state={state}
					hasMore={hasMore}
					message={message}
				/>
			)}
		</EditorialSection>
	);
}
