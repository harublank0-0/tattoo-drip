import { Form, Link } from "@adonisjs/inertia/react";
import { router, usePage } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, ImageOff, Play, Star } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import FilterSelect from "~/components/filter_select";
import InlineConfirm from "~/components/inline_confirm";
import Page from "~/components/page";
import {
	nextPollDelay,
	pollGivesUp,
	STILL_PROCESSING,
} from "~/components/portfolio";
import {
	DECLINE_QUESTION,
	emptyText,
	MEDIA_UNAVAILABLE,
	mediaLabel,
	POST_FILTER_LABELS,
	type PostFilterName,
	type PostRow,
	postsProcessing,
	REPORT_HINT,
	REVIEW_FILTER_LABELS,
	REVIEWS_INTRO,
	type ReviewFilterName,
	type ReviewMediaRow,
	type ReviewProjectRef,
	type ReviewRow,
	type ReviewsAddress,
	type ReviewsPageProps,
	replyHint,
	reportLine,
	reviewsHref,
	UNPUBLISH_QUESTION,
	viewTabs,
} from "~/components/reviews";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { QUIET_VISIT_HEADER } from "~/components/visits";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/** Focus to move once a write's answer is on the page: an element's id, else the page heading. */
type FocusRequest = { id: string } | null;

/**
 * Reviews (Reviews and Fresh ink, slice 2): the clients' Fresh ink posts to approve, decline or
 * unpublish, and their reviews to reply to or report to TattooDrip. Owners see every one, an
 * artist those of their own projects. The server decides every row, status and toast; the
 * address holds the view, the filter, the artist and the page (`reviewsHref`), and every write
 * comes back to it (`back`). Nothing here edits or hides a review, or edits a post (rulings 6
 * and 7). Photos and videos are the private files through 5-minute signed URLs: a tile that
 * fails says to reload, and while a video is processing the page asks again quietly (the
 * Portfolio's poll). One write at a time (`writing`), one reply or report form at a time
 * (`open`), and focus after a write moves in an effect once its answer is committed.
 */
export default function ReviewsIndex(props: ReviewsPageProps) {
	const {
		view,
		postFilter,
		reviewFilter,
		artistId,
		artists,
		waitingCount,
		posts,
		reviews,
		page,
	} = props;
	const tenant = useTenant();
	const { url } = usePage();
	const heading = useRef<HTMLHeadingElement>(null);
	const base = urlFor("tenant.reviews.index", { tenant: tenant.slug });
	const address: ReviewsAddress = { view, postFilter, reviewFilter, artistId };
	const here = url;
	// One reply or report form open at a time: the page shares one error bag.
	const [open, setOpen] = useState<string | null>(null);
	// One decision at a time: a write out holds every card's buttons.
	const [writing, setWriting] = useState(false);
	// Where focus goes once a write's answer is committed: the element if it is still there and
	// usable (a refused Approve), else the page heading (the post left the list).
	const [focusAfter, setFocusAfter] = useState<FocusRequest>(null);
	useEffect(() => {
		if (!focusAfter) return;
		const target = document.getElementById(focusAfter.id);
		const usable =
			target instanceof HTMLElement &&
			!(target as HTMLButtonElement).disabled &&
			target.isConnected;
		(usable ? target : heading.current)?.focus();
		setFocusAfter(null);
	}, [focusAfter]);

	// A video still processing: ask again with a light, quiet partial reload (the posts only), 4 s
	// growing to 30 s, paused while the tab is hidden, never while a write is out; after 30
	// minutes it stops and says so. The Portfolio's poll (nextPollDelay, pollGivesUp).
	const processing = view === "posts" && postsProcessing(posts);
	const [pollGaveUp, setPollGaveUp] = useState(false);
	const polling = useRef<{ startedAt: number | null; inFlight: boolean }>({
		startedAt: null,
		inFlight: false,
	});
	useEffect(() => {
		const state = polling.current;
		if (!processing) {
			state.startedAt = null;
			setPollGaveUp(false);
			return;
		}
		if (writing || pollGaveUp) return;
		state.startedAt ??= Date.now();
		const startedAt = state.startedAt;
		let stopped = false;
		let attempt = 0;
		let timer: number | undefined;
		const schedule = () => {
			if (stopped) return;
			timer = window.setTimeout(tick, nextPollDelay(attempt++));
		};
		const tick = () => {
			if (stopped) return;
			if (pollGivesUp(startedAt, Date.now())) {
				setPollGaveUp(true);
				return;
			}
			if (document.hidden) {
				document.addEventListener("visibilitychange", tick, { once: true });
				return;
			}
			if (state.inFlight) return schedule();
			state.inFlight = true;
			router.reload({
				only: ["posts", "waitingCount"],
				headers: { [QUIET_VISIT_HEADER]: "1" },
				onFinish: () => {
					state.inFlight = false;
					schedule();
				},
			});
		};
		schedule();
		return () => {
			stopped = true;
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", tick);
		};
	}, [processing, writing, pollGaveUp]);

	const filters =
		view === "posts"
			? (Object.keys(POST_FILTER_LABELS) as PostFilterName[]).map((value) => ({
					value,
					label: POST_FILTER_LABELS[value],
					href: reviewsHref(base, { ...address, postFilter: value }),
					current: value === postFilter,
				}))
			: (Object.keys(REVIEW_FILTER_LABELS) as ReviewFilterName[]).map(
					(value) => ({
						value,
						label: REVIEW_FILTER_LABELS[value],
						href: reviewsHref(base, { ...address, reviewFilter: value }),
						current: value === reviewFilter,
					}),
				);
	const rows = view === "posts" ? posts.length : reviews.length;
	return (
		<Page title="Reviews" titleRef={heading} description={REVIEWS_INTRO}>
			<div className="flex flex-col gap-4">
				<nav aria-label="Reviews views" className="flex flex-wrap gap-2">
					{viewTabs(waitingCount).map((tab) => (
						<Link
							key={tab.value}
							href={reviewsHref(base, {
								...address,
								view: tab.value,
								postFilter: "waiting",
								reviewFilter: "all",
							})}
							aria-current={tab.value === view ? "page" : undefined}
							className={buttonVariants({
								variant: tab.value === view ? "default" : "outline",
								size: "sm",
							})}
						>
							{tab.label}
						</Link>
					))}
				</nav>
				<div className="flex flex-wrap items-center gap-2">
					<nav aria-label="Filter" className="flex flex-wrap gap-2">
						{filters.map((filter) => (
							<Link
								key={filter.value}
								href={filter.href}
								aria-current={filter.current ? "true" : undefined}
								className={cn(
									buttonVariants({ variant: "ghost", size: "sm" }),
									"aria-[current=true]:bg-accent aria-[current=true]:font-semibold",
								)}
							>
								{filter.label}
							</Link>
						))}
					</nav>
					{artists.length > 0 && (
						<div className="w-full sm:ml-auto sm:w-56">
							<FilterSelect
								id="reviews-artist"
								label="Artist"
								value={artistId ?? ""}
								options={[
									{ value: "", label: "All artists" },
									...artists.map(({ id, name }) => ({
										value: id,
										label: name,
									})),
								]}
								onApply={(value) =>
									router.get(
										reviewsHref(base, { ...address, artistId: value || null }),
										{},
										{ preserveState: true },
									)
								}
							/>
						</div>
					)}
				</div>
			</div>

			{processing && pollGaveUp && (
				<p className="text-sm text-muted-foreground">{STILL_PROCESSING}</p>
			)}

			{rows === 0 ? (
				<p className="text-sm text-muted-foreground">
					{emptyText(view, postFilter, reviewFilter)}
				</p>
			) : view === "posts" ? (
				<ul className="flex flex-col gap-4">
					{posts.map((post) => (
						<li key={post.id}>
							<PostCard
								post={post}
								back={here}
								fallback={heading}
								writing={writing}
								onWriting={setWriting}
								onFocusAfter={setFocusAfter}
							/>
						</li>
					))}
				</ul>
			) : (
				<ul className="flex flex-col gap-4">
					{reviews.map((review) => (
						<li key={review.id}>
							<ReviewCard
								review={review}
								back={here}
								open={open}
								onOpen={setOpen}
								reasons={props.reportReasons}
								limits={props.limits}
							/>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav
					aria-label="Pages"
					className="flex items-center justify-between gap-2 text-sm"
				>
					{page.current > 1 ? (
						<Link
							href={reviewsHref(base, address, page.current - 1)}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<ChevronLeft aria-hidden="true" />
							Previous
						</Link>
					) : (
						<span />
					)}
					<span className="text-muted-foreground tabular-nums">
						Page {page.current} of {page.last}
					</span>
					{page.current < page.last ? (
						<Link
							href={reviewsHref(base, address, page.current + 1)}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							Next
							<ChevronRight aria-hidden="true" />
						</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

/** The project a row belongs to, linked (its page applies the member's access). */
function ProjectLine({ project }: { project: ReviewProjectRef }) {
	const tenant = useTenant();
	if (!project) return null;
	return (
		<>
			<dt className="text-muted-foreground">Project</dt>
			<dd className="min-w-0 wrap-anywhere">
				<Link
					route="tenant.projects.show"
					routeParams={{ tenant: tenant.slug, id: project.id }}
					className="underline underline-offset-4"
				>
					{project.clientName ?? "Project"}
				</Link>
				{project.piece ? `: ${project.piece}` : ""}
			</dd>
			{project.artistName && (
				<>
					<dt className="text-muted-foreground">Artist</dt>
					<dd className="min-w-0 wrap-anywhere">{project.artistName}</dd>
				</>
			)}
		</>
	);
}

/** One photo or video tile: a link to the full file, or a note when its signed URL fails. */
function MediaTile({ item, label }: { item: ReviewMediaRow; label: string }) {
	const [failed, setFailed] = useState(false);
	const tile = failed ? (
		<span className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md bg-muted p-2 text-center text-xs text-muted-foreground">
			<ImageOff aria-hidden="true" className="size-4" />
			{MEDIA_UNAVAILABLE}
		</span>
	) : item.thumbUrl ? (
		<img
			src={item.thumbUrl}
			alt=""
			loading="lazy"
			onError={() => setFailed(true)}
			className="aspect-square w-full rounded-md object-cover"
		/>
	) : (
		<span className="flex aspect-square w-full items-center justify-center rounded-md bg-muted p-2 text-center text-xs text-muted-foreground">
			{item.state === "failed" ? "Couldn't process" : "Processing…"}
		</span>
	);
	if (item.openUrl && !failed) {
		return (
			<a
				href={item.openUrl}
				target="_blank"
				rel="noreferrer"
				aria-label={label}
				className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>
				{tile}
				{item.kind === "video" && (
					<Play
						aria-hidden="true"
						className="absolute bottom-1.5 left-1.5 size-5 rounded-full bg-background/80 p-1"
					/>
				)}
			</a>
		);
	}
	return (
		<span
			role="img"
			aria-label={failed ? `${label}: ${MEDIA_UNAVAILABLE}` : label}
		>
			{tile}
		</span>
	);
}

/** One Fresh ink post: its photos and videos, its words, where it may show, and the decision. */
function PostCard({
	post,
	back,
	fallback,
	writing,
	onWriting,
	onFocusAfter,
}: {
	post: PostRow;
	back: string;
	fallback: RefObject<HTMLElement | null>;
	writing: boolean;
	onWriting: (writing: boolean) => void;
	onFocusAfter: (request: FocusRequest) => void;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: post.id };
	const [busy, setBusy] = useState(false);
	const sending = useRef(false);
	const titleId = useId();
	const approveId = `approve-${post.id}`;

	const approve = () => {
		if (sending.current || writing) return;
		sending.current = true;
		router.post(
			urlFor("tenant.reviews.posts.approve", params),
			{ back },
			{
				preserveScroll: true,
				onStart: () => {
					setBusy(true);
					onWriting(true);
				},
				onFinish: () => {
					sending.current = false;
					setBusy(false);
					onWriting(false);
					// Back to Approve if a refusal left it, else the heading (the post left the list).
					onFocusAfter({ id: approveId });
				},
			},
		);
	};
	const decide =
		(
			route: "tenant.reviews.posts.decline" | "tenant.reviews.posts.unpublish",
		) =>
		(finished: () => void) =>
			router.post(
				urlFor(route, params),
				{ back },
				{
					preserveScroll: true,
					onStart: () => onWriting(true),
					onFinish: () => {
						onWriting(false);
						finished();
					},
				},
			);

	return (
		<article aria-labelledby={titleId}>
			<Card>
				<CardHeader className="gap-2">
					<CardTitle className="leading-snug">
						<h2 id={titleId} className="wrap-anywhere">
							{post.shownName}
						</h2>
					</CardTitle>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
						<Badge variant="secondary">{post.statusText}</Badge>
						<span>{post.dateText}</span>
						{post.edited && (
							<span>Changed by the client: approve it again.</span>
						)}
					</div>
					{post.takenDown && (
						<p className="rounded-md border p-3 text-sm">{post.takenDown}</p>
					)}
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{post.media.length > 0 && (
						<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
							{post.media.map((item, index) => (
								<li
									key={`${item.id}:${item.thumbUrl ?? item.state}`}
									className="relative"
								>
									<MediaTile
										item={item}
										label={mediaLabel(item, index, post.media.length)}
									/>
								</li>
							))}
						</ul>
					)}
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
						{post.caption && (
							<>
								<dt className="text-muted-foreground">Caption</dt>
								<dd className="min-w-0 whitespace-pre-line wrap-anywhere">
									{post.caption}
								</dd>
							</>
						)}
						{post.styles.length > 0 && (
							<>
								<dt className="text-muted-foreground">Styles</dt>
								<dd className="min-w-0 wrap-anywhere">
									{post.styles.join(", ")}
								</dd>
							</>
						)}
						{post.placement && (
							<>
								<dt className="text-muted-foreground">Placement</dt>
								<dd className="min-w-0 wrap-anywhere">{post.placement}</dd>
							</>
						)}
						<dt className="text-muted-foreground">Client allows</dt>
						<dd className="min-w-0 wrap-anywhere">{post.consentText}</dd>
						<ProjectLine project={post.project} />
					</dl>
					{(post.canApprove || post.canDecline || post.canUnpublish) && (
						<div className="flex flex-wrap items-start gap-2">
							{post.canApprove && (
								<Button
									id={approveId}
									type="button"
									disabled={busy || writing}
									onClick={approve}
								>
									{busy ? "Saving…" : "Approve"}
								</Button>
							)}
							{post.canDecline && (
								<InlineConfirm
									label="Decline"
									question={DECLINE_QUESTION}
									confirmLabel="Decline post"
									keepLabel="Keep it waiting"
									onConfirm={decide("tenant.reviews.posts.decline")}
									fallback={fallback}
									disabled={writing}
								/>
							)}
							{post.canUnpublish && (
								<InlineConfirm
									label="Unpublish"
									question={UNPUBLISH_QUESTION}
									confirmLabel="Unpublish post"
									keepLabel="Keep it shown"
									onConfirm={decide("tenant.reviews.posts.unpublish")}
									fallback={fallback}
									disabled={writing}
								/>
							)}
						</div>
					)}
					{post.approveNote && (
						<p className="text-sm text-muted-foreground">{post.approveNote}</p>
					)}
				</CardContent>
			</Card>
		</article>
	);
}

/** Five stars, the rating's filled: drawn for the eye, read as words. */
function Stars({ rating, text }: { rating: number | null; text: string }) {
	return (
		<span className="flex items-center gap-0.5">
			{[1, 2, 3, 4, 5].map((star) => (
				<Star
					key={star}
					aria-hidden="true"
					className={cn(
						"size-4",
						rating !== null && star <= rating
							? "fill-current text-foreground"
							: "text-muted-foreground",
					)}
				/>
			))}
			<span className="sr-only">{text}</span>
		</span>
	);
}

/**
 * One review as the client wrote it, the studio's reply, and the report to TattooDrip. While a
 * reply or report form is open anywhere, every other trigger waits (one error bag, and a
 * half-written reply must not be dropped). Focus after a save moves in an effect: to Edit reply
 * after a reply, to the report's line after a report, to Reply after a deleted reply.
 */
function ReviewCard({
	review,
	back,
	open,
	onOpen,
	reasons,
	limits,
}: {
	review: ReviewRow;
	back: string;
	open: string | null;
	onOpen: (key: string | null) => void;
	reasons: { value: string; label: string }[];
	limits: { reply: number; reportNote: number };
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: review.id };
	const titleId = useId();
	const replyKey = `reply:${review.id}`;
	const reportKey = `report:${review.id}`;
	// A form open anywhere holds every other trigger, this card's included: opening one would
	// drop what is typed in the other.
	const holdReply = open !== null && open !== replyKey;
	const holdReport = open !== null && open !== reportKey;
	const title = useRef<HTMLHeadingElement>(null);
	const replyTrigger = useRef<HTMLButtonElement>(null);
	const reportTrigger = useRef<HTMLButtonElement>(null);
	const reportNote = useRef<HTMLParagraphElement>(null);
	const [focusAfter, setFocusAfter] = useState<
		"reply" | "report" | "reported" | null
	>(null);
	useEffect(() => {
		if (!focusAfter) return;
		const target =
			focusAfter === "reply"
				? replyTrigger.current
				: focusAfter === "report"
					? reportTrigger.current
					: reportNote.current;
		(target?.isConnected ? target : title.current)?.focus();
		setFocusAfter(null);
	}, [focusAfter]);
	const close = (then: "reply" | "report" | "reported") => {
		onOpen(null);
		setFocusAfter(then);
	};
	const showReport = review.report !== null || review.canReport;

	return (
		<article aria-labelledby={titleId}>
			<Card>
				<CardHeader className="gap-2">
					<CardTitle className="leading-snug">
						<h2
							id={titleId}
							ref={title}
							tabIndex={-1}
							className="wrap-anywhere outline-none"
						>
							{review.shownName}
						</h2>
					</CardTitle>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
						<Stars rating={review.rating} text={review.ratingText} />
						<span>{review.dateText}</span>
					</div>
					{review.takenDown && (
						<p className="rounded-md border p-3 text-sm">{review.takenDown}</p>
					)}
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm whitespace-pre-line wrap-anywhere" dir="auto">
						{review.body}
					</p>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
						<dt className="text-muted-foreground">Client allows</dt>
						<dd className="min-w-0 wrap-anywhere">{review.consentText}</dd>
						<ProjectLine project={review.project} />
					</dl>

					{(review.reply || review.canReply) && (
						<div className="flex flex-col gap-2">
							{review.reply && open !== replyKey && (
								<div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
									<p className="font-medium">
										Your reply
										{review.reply.dateText ? `, ${review.reply.dateText}` : ""}
									</p>
									<p className="whitespace-pre-line wrap-anywhere" dir="auto">
										{review.reply.text}
									</p>
									{review.reply.takenDown && (
										<p className="text-muted-foreground">
											{review.reply.takenDown}
										</p>
									)}
								</div>
							)}
							{open === replyKey ? (
								<Form
									route="tenant.reviews.reply.update"
									routeParams={params}
									options={{ preserveScroll: true }}
									onSuccess={(page) => {
										if ((page.flash as { success?: string })?.success) {
											close("reply");
										}
									}}
								>
									{({ errors, processing }) => (
										<FieldGroup>
											<input type="hidden" name="back" value={back} />
											<Field data-invalid={!!errors.reply}>
												<FieldLabel htmlFor={`reply-${review.id}`}>
													Your public reply
												</FieldLabel>
												<Textarea
													id={`reply-${review.id}`}
													name="reply"
													rows={4}
													dir="auto"
													defaultValue={review.reply?.text ?? ""}
													aria-invalid={!!errors.reply}
													aria-describedby={`reply-${review.id}-hint`}
													autoFocus
												/>
												<FieldDescription id={`reply-${review.id}-hint`}>
													{replyHint(limits.reply)}
												</FieldDescription>
												{errors.reply && (
													<FieldError>{errors.reply}</FieldError>
												)}
											</Field>
											<div className="flex flex-wrap gap-2">
												<Button type="submit" disabled={processing}>
													{processing ? "Saving…" : "Save reply"}
												</Button>
												<Button
													type="button"
													variant="ghost"
													onClick={() => close("reply")}
												>
													Cancel
												</Button>
											</div>
										</FieldGroup>
									)}
								</Form>
							) : (
								review.canReply && (
									<div className="flex flex-wrap items-start gap-2">
										<Button
											ref={replyTrigger}
											type="button"
											variant="outline"
											disabled={holdReply}
											onClick={() => onOpen(replyKey)}
										>
											{review.reply ? "Edit reply" : "Reply"}
										</Button>
										{review.reply && (
											<InlineConfirm
												label="Delete reply"
												question="Delete your reply? It comes off every page."
												confirmLabel="Delete reply"
												keepLabel="Keep the reply"
												busyLabel="Deleting…"
												disabled={holdReply}
												onConfirm={(finished) =>
													router.delete(
														urlFor("tenant.reviews.reply.destroy", params),
														{
															data: { back },
															preserveScroll: true,
															onFinish: finished,
														},
													)
												}
												// The reply is gone: focus goes to Reply, which stays in its place.
												fallback={replyTrigger}
											/>
										)}
									</div>
								)
							)}
						</div>
					)}

					{showReport && (
						<div className="flex flex-col gap-2">
							{review.report && (
								<p
									ref={reportNote}
									tabIndex={-1}
									className="text-sm text-muted-foreground outline-none"
								>
									{reportLine(review.report)}
								</p>
							)}
							{open === reportKey ? (
								<Form
									route="tenant.reviews.report.store"
									routeParams={params}
									options={{ preserveScroll: true }}
									onSuccess={(page) => {
										if ((page.flash as { success?: string })?.success) {
											// The trigger is gone with the open report: its line says what was sent.
											close("reported");
										}
									}}
								>
									{({ errors, processing }) => (
										<FieldGroup>
											<input type="hidden" name="back" value={back} />
											<Field data-invalid={!!errors.reason}>
												<FieldLabel htmlFor={`report-reason-${review.id}`}>
													Why do you report it?
												</FieldLabel>
												<select
													id={`report-reason-${review.id}`}
													name="reason"
													defaultValue=""
													aria-invalid={!!errors.reason}
													className="h-9 w-full min-w-0 rounded-md border bg-transparent px-3 text-sm max-lg:min-h-11 sm:w-72"
													// biome-ignore lint/a11y/noAutofocus: the form opens on the person's tap.
													autoFocus
												>
													<option value="" disabled>
														Choose a reason
													</option>
													{reasons.map((reason) => (
														<option key={reason.value} value={reason.value}>
															{reason.label}
														</option>
													))}
												</select>
												{errors.reason && (
													<FieldError>{errors.reason}</FieldError>
												)}
											</Field>
											<Field data-invalid={!!errors.note}>
												<FieldLabel htmlFor={`report-note-${review.id}`}>
													Note for TattooDrip (optional)
												</FieldLabel>
												<Textarea
													id={`report-note-${review.id}`}
													name="note"
													rows={3}
													dir="auto"
													aria-invalid={!!errors.note}
													aria-describedby={`report-note-${review.id}-hint`}
												/>
												<FieldDescription id={`report-note-${review.id}-hint`}>
													Up to {limits.reportNote} characters. {REPORT_HINT}
												</FieldDescription>
												{errors.note && <FieldError>{errors.note}</FieldError>}
											</Field>
											<div className="flex flex-wrap gap-2">
												<Button type="submit" disabled={processing}>
													{processing ? "Sending…" : "Send report"}
												</Button>
												<Button
													type="button"
													variant="ghost"
													onClick={() => close("report")}
												>
													Cancel
												</Button>
											</div>
										</FieldGroup>
									)}
								</Form>
							) : (
								review.canReport && (
									<div>
										<Button
											ref={reportTrigger}
											type="button"
											variant="ghost"
											size="sm"
											disabled={holdReport}
											onClick={() => onOpen(reportKey)}
										>
											Report to TattooDrip
										</Button>
									</div>
								)
							)}
						</div>
					)}
				</CardContent>
			</Card>
		</article>
	);
}

ReviewsIndex.layout = [AppLayout];
