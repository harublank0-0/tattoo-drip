import { Form, Link } from "@adonisjs/inertia/react";
import { router, usePage } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import { type RefObject, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import FilterSelect from "~/components/filter_select";
import InlineConfirm from "~/components/inline_confirm";
import Page from "~/components/page";
import {
	DECLINE_QUESTION,
	emptyText,
	mediaLabel,
	POST_FILTER_LABELS,
	type PostFilterName,
	type PostRow,
	REPORT_HINT,
	REVIEW_FILTER_LABELS,
	REVIEWS_INTRO,
	type ReviewFilterName,
	type ReviewProjectRef,
	type ReviewRow,
	type ReviewsAddress,
	type ReviewsPageProps,
	replyHint,
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
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * Reviews (Reviews and Fresh ink, slice 2): the clients' Fresh ink posts to approve, decline or
 * unpublish, and their reviews to reply to or report to TattooDrip. Owners see every one, an
 * artist those of their own projects. The server decides every row, status and toast; the
 * address holds the view, the filter, the artist and the page (`reviewsHref`), and every write
 * comes back to it (`back`). Nothing here edits or hides a review, or edits a post (rulings 6
 * and 7). Photos and videos are the private files through short-lived signed URLs.
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

			{rows === 0 ? (
				<p className="text-sm text-muted-foreground">
					{emptyText(view, postFilter, reviewFilter)}
				</p>
			) : view === "posts" ? (
				<ul className="flex flex-col gap-4">
					{posts.map((post) => (
						<li key={post.id}>
							<PostCard post={post} back={here} fallback={heading} />
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
								fallback={heading}
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

/** One Fresh ink post: its photos and videos, its words, where it may show, and the decision. */
function PostCard({
	post,
	back,
	fallback,
}: {
	post: PostRow;
	back: string;
	fallback: RefObject<HTMLElement | null>;
}) {
	const tenant = useTenant();
	const params = { tenant: tenant.slug, id: post.id };
	const [busy, setBusy] = useState(false);
	const sending = useRef(false);
	const titleId = useId();

	const approve = () => {
		if (sending.current) return;
		sending.current = true;
		router.post(
			urlFor("tenant.reviews.posts.approve", params),
			{ back },
			{
				preserveScroll: true,
				onStart: () => setBusy(true),
				onFinish: () => {
					sending.current = false;
					setBusy(false);
					// The post usually leaves this list: focus goes to the page heading.
					setTimeout(() => fallback.current?.focus(), 0);
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
				{ preserveScroll: true, onFinish: finished },
			);

	return (
		<Card aria-labelledby={titleId}>
			<CardHeader className="gap-2">
				<CardTitle className="leading-snug">
					<h2 id={titleId} className="wrap-anywhere">
						{post.shownName}
					</h2>
				</CardTitle>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<Badge variant="secondary">{post.statusText}</Badge>
					<span>{post.dateText}</span>
					{post.edited && <span>Changed by the client: approve it again.</span>}
				</div>
				{post.takenDown && (
					<p className="rounded-md border p-3 text-sm">{post.takenDown}</p>
				)}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{post.media.length > 0 && (
					<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
						{post.media.map((item, index) => {
							const label = mediaLabel(item, index, post.media.length);
							const tile = item.thumbUrl ? (
								<img
									src={item.thumbUrl}
									alt=""
									loading="lazy"
									className="aspect-square w-full rounded-md object-cover"
								/>
							) : (
								<span className="flex aspect-square w-full items-center justify-center rounded-md bg-muted p-2 text-center text-xs text-muted-foreground">
									{item.state === "failed" ? "Couldn't process" : "Processing…"}
								</span>
							);
							return (
								<li key={item.id} className="relative">
									{item.openUrl ? (
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
									) : (
										<span role="img" aria-label={label}>
											{tile}
										</span>
									)}
								</li>
							);
						})}
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
							<Button type="button" disabled={busy} onClick={approve}>
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
								disabled={busy}
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
							/>
						)}
					</div>
				)}
				{post.approveNote && (
					<p className="text-sm text-muted-foreground">{post.approveNote}</p>
				)}
			</CardContent>
		</Card>
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

/** One review as the client wrote it, the studio's reply, and the report to TattooDrip. */
function ReviewCard({
	review,
	back,
	fallback,
	open,
	onOpen,
	reasons,
	limits,
}: {
	review: ReviewRow;
	back: string;
	fallback: RefObject<HTMLElement | null>;
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
	const replyTrigger = useRef<HTMLButtonElement>(null);
	const reportTrigger = useRef<HTMLButtonElement>(null);
	const close = (trigger: RefObject<HTMLButtonElement | null>) => {
		onOpen(null);
		setTimeout(() => (trigger.current ?? fallback.current)?.focus(), 0);
	};

	return (
		<Card aria-labelledby={titleId}>
			<CardHeader className="gap-2">
				<CardTitle className="leading-snug">
					<h2 id={titleId} className="wrap-anywhere">
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

				<section aria-label="Your reply" className="flex flex-col gap-2">
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
									close(replyTrigger);
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
										{errors.reply && <FieldError>{errors.reply}</FieldError>}
									</Field>
									<div className="flex flex-wrap gap-2">
										<Button type="submit" disabled={processing}>
											{processing ? "Saving…" : "Save reply"}
										</Button>
										<Button
											type="button"
											variant="ghost"
											onClick={() => close(replyTrigger)}
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
										fallback={fallback}
									/>
								)}
							</div>
						)
					)}
				</section>

				<section
					aria-label="Report to TattooDrip"
					className="flex flex-col gap-2"
				>
					{review.report && (
						<p className="text-sm text-muted-foreground">
							Reported on {review.report.dateText} for{" "}
							{review.report.reasonText.toLowerCase()}.{" "}
							{review.report.note ? `Your note: “${review.report.note}” ` : ""}
							{review.report.open
								? "TattooDrip will decide; the review stays up until then."
								: "TattooDrip kept it up."}
						</p>
					)}
					{open === reportKey ? (
						<Form
							route="tenant.reviews.report.store"
							routeParams={params}
							options={{ preserveScroll: true }}
							onSuccess={(page) => {
								if ((page.flash as { success?: string })?.success) {
									close(reportTrigger);
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
										{errors.reason && <FieldError>{errors.reason}</FieldError>}
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
											onClick={() => close(reportTrigger)}
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
									onClick={() => onOpen(reportKey)}
								>
									Report to TattooDrip
								</Button>
							</div>
						)
					)}
				</section>
			</CardContent>
		</Card>
	);
}

ReviewsIndex.layout = [AppLayout];
