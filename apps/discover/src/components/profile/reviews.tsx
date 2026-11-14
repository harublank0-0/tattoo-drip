import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDiscoverClient } from "@tattoo-drip/react";
import type {
	DiscoverFreshInkPage,
	DiscoverReview,
	DiscoverReviewsPage,
} from "@tattoo-drip/sdk";
import { StarIcon } from "lucide-react";
import { useState } from "react";
import { MoreLink } from "#/components/directory/hub";
import { useMounted } from "#/components/directory/pagination";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
import { FreshInkColumns } from "#/components/gallery/fresh-ink";
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
} from "#/lib/reviews";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";

/*
 * A profile's Reviews and Fresh ink (Reviews and Fresh ink, slice 4): the
 * studio's clients' reviews (newest first, never "best first") with the
 * average only from 3 (ruling 10), and their Fresh ink. Both come from
 * optional reads: a failed or empty one renders nothing (no heading, no
 * "no reviews yet"), and while reviews are switched off on the platform the
 * API answers empty pages, so the profile shows nothing of either. "Show
 * more" reads the next page in the browser (it appears after hydration).
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

/** The next pages of a list, read on demand and kept with the first. */
function useMore<P extends { nextCursor: string | null }>(
	first: P,
	read: (cursor: string) => Promise<P>,
) {
	const [pages, setPages] = useState<P[]>([first]);
	const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
	const last = pages[pages.length - 1];
	const more = async () => {
		if (!last.nextCursor) return;
		setState("loading");
		try {
			const page = await read(last.nextCursor);
			setPages((current) => [...current, page]);
			setState("idle");
		} catch {
			setState("failed");
		}
	};
	return { pages, more, state, hasMore: Boolean(last.nextCursor) };
}

function ShowMore({
	label,
	more,
	state,
}: {
	label: string;
	more: () => void;
	state: "idle" | "loading" | "failed";
}) {
	return (
		<div className="mt-8 flex flex-col items-start gap-2">
			<Button
				type="button"
				variant="outline"
				onClick={more}
				disabled={state === "loading"}
				aria-busy={state === "loading" || undefined}
			>
				{state === "loading" ? "Loading…" : label}
			</Button>
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
	review,
	showArtist,
}: {
	review: DiscoverReview;
	showArtist: boolean;
}) {
	const artist = tattooProfile(review);
	return (
		<li className="flex flex-col gap-3 border-b border-line py-6">
			<p className="flex flex-wrap items-center gap-2">
				<Stars filled={review.rating} />
				<span className="text-sm font-medium">
					{ratingWords(review.rating)}
				</span>
			</p>
			<p className="max-w-prose text-lg whitespace-pre-line" dir="auto">
				{review.body}
			</p>
			<p className="text-sm text-muted-foreground">
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
				<div className="ml-4 flex max-w-prose flex-col gap-1 border-l-2 border-line-strong pl-4">
					<p className="text-sm font-medium">
						{"Reply from "}
						<bdi>{review.studio.name}</bdi>
						{" · "}
						<time dateTime={review.reply.date} className="font-normal">
							{dayText(review.reply.date)}
						</time>
					</p>
					<p className="whitespace-pre-line" dir="auto">
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
	const { pages, more, state, hasMore } = useMore(first, (cursor) =>
		queryClient.fetchQuery(
			profileReviewQueries(client, subject, { reviews: cursor }).reviews,
		),
	);
	const reviews = mergePages(pages);
	const summary = ratingSummary(first.rating);
	return (
		<EditorialSection labelledBy={id} className="lg:py-20">
			<div className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
				<div className="flex flex-col gap-6">
					<SectionHeading
						id={id}
						eyebrow="Reviews"
						title={`Reviews of ${name}`}
						intro="Written by clients through the private link the studio sends after their tattoo. Newest first, never sorted by stars."
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
				<div>
					<ul className="flex flex-col border-t border-ink">
						{reviews.map((review) => (
							<ReviewItem
								key={review.id}
								review={review}
								showArtist={showArtist}
							/>
						))}
					</ul>
					{mounted && hasMore && (
						<ShowMore label="Show more reviews" more={more} state={state} />
					)}
				</div>
			</div>
		</EditorialSection>
	);
}

/** A profile's Fresh ink: a night band of tiles, each opening its viewer. Nothing when there is none. */
export function FreshInkSection({
	id,
	subject,
	first,
	name,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverFreshInkPage | undefined;
	name: string;
}) {
	if (!first || first.data.length === 0) return null;
	return <FreshInkList id={id} subject={subject} first={first} name={name} />;
}

function FreshInkList({
	id,
	subject,
	first,
	name,
}: {
	id: string;
	subject: ReviewSubject;
	first: DiscoverFreshInkPage;
	name: string;
}) {
	const client = useDiscoverClient();
	const queryClient = useQueryClient();
	const mounted = useMounted();
	const { pages, more, state, hasMore } = useMore(first, (cursor) =>
		queryClient.fetchQuery(
			profileReviewQueries(client, subject, { freshInk: cursor }).freshInk,
		),
	);
	const posts = mergePages(pages);
	return (
		<EditorialSection tone="night" labelledBy={id} className="lg:py-20">
			<div className="mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
				<SectionHeading
					id={id}
					eyebrow="Fresh ink"
					title={`Healed work from ${name}'s clients`}
					intro="Photos and short videos clients posted of their healed tattoos, shown with the studio's approval."
				/>
				<MoreLink to={paths.freshInk()}>All Fresh ink</MoreLink>
			</div>
			<FreshInkColumns
				posts={posts}
				columns="lg:columns-3"
				sizes="(min-width: 40rem) 33vw, 50vw"
				caption={(post) => (
					<>
						<bdi>{post.shownName}</bdi>
						{post.styles[0] ? ` · ${post.styles[0].name}` : ""}
					</>
				)}
			/>
			{mounted && hasMore && (
				<ShowMore label="Show more Fresh ink" more={more} state={state} />
			)}
		</EditorialSection>
	);
}
