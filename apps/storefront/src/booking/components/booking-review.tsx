import type { ReactNode, Ref } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { copy as intakeCopy } from "../../intake/copy.ts";
import { fill } from "../../intake/template.ts";
import { artistsHref } from "../../studio/links.ts";
import {
	BOOKING_WORDS,
	type BookingArtwork,
	type BookingStep,
	type BookingValues,
	ideaText,
	sizeText,
} from "../booking.ts";
import { bookingCopy as copy } from "../copy.ts";

/*
 * The booking flow's review, its running summary and its "received" screen
 * (Prompt 6), for every theme. Everything shown is what the client entered
 * and what will be sent; the dates are always called preferences.
 */

/** What the review and the summary read: the values, and what the form worked out from them. */
export interface RequestSnapshot {
	readonly values: BookingValues;
	/** The artist's name, or null for no preference. */
	readonly artistName: string | null;
	/** The preferred dates exactly as they will be sent; "" while none. */
	readonly dates: string;
	/** The chosen style's name (the slug is what is sent); null for none. */
	readonly styleName: string | null;
	readonly photoCount: number;
	readonly artwork: BookingArtwork | null;
}

/**
 * The last step: each part of the request as it will be sent, each with an
 * Edit button back to its step (named for screen readers: "Edit Dates").
 */
export function BookingReview({
	snapshot,
	studioName,
	steps,
	onEdit,
	disabled = false,
}: {
	snapshot: RequestSnapshot;
	studioName: string;
	steps: readonly BookingStep[];
	onEdit: (step: BookingStep) => void;
	/** While the request is on its way: nothing can be edited. */
	disabled?: boolean;
}) {
	const { values } = snapshot;
	const edit = (step: BookingStep) =>
		steps.includes(step) ? (
			<button
				type="button"
				className="booking-edit"
				onClick={() => onEdit(step)}
				disabled={disabled}
				aria-label={fill(copy.review.editStep, { name: copy.steps[step] })}
			>
				{copy.review.edit}
			</button>
		) : null;
	const channel = values.sourceChannel
		? intakeCopy.channels[values.sourceChannel]
		: "";
	return (
		<div className="booking-review">
			{snapshot.artwork ? <ArtworkLine artwork={snapshot.artwork} /> : null}
			<dl className="booking-review-list">
				{steps.includes("artist") ? (
					<ReviewRow label={copy.review.artist} action={edit("artist")}>
						{snapshot.artistName ?? copy.review.anyArtist}
					</ReviewRow>
				) : null}
				<ReviewRow label={copy.review.dates} action={edit("when")}>
					{snapshot.dates}
				</ReviewRow>
				<ReviewRow
					label={
						<Fill template={copy.review.idea} values={{ studio: studioName }} />
					}
					action={edit("tattoo")}
				>
					<span className="booking-review-idea user-text" dir="auto">
						{ideaText(values)}
					</span>
				</ReviewRow>
				{snapshot.styleName ? (
					<ReviewRow label={copy.review.style} action={null}>
						{snapshot.styleName}
					</ReviewRow>
				) : null}
				{values.colour ? (
					<ReviewRow label={copy.review.colour} action={null}>
						{BOOKING_WORDS.colour[values.colour]}
					</ReviewRow>
				) : null}
				{values.notes.trim() ? (
					<ReviewRow label={copy.review.notes} action={null}>
						<span className="booking-review-idea user-text" dir="auto">
							{values.notes.trim()}
						</span>
					</ReviewRow>
				) : null}
				<ReviewRow label={copy.review.placement} action={null}>
					{values.placement.trim()}
				</ReviewRow>
				<ReviewRow label={copy.review.size} action={null}>
					{sizeText(values)}
				</ReviewRow>
				{values.budget.trim() ? (
					<ReviewRow label={copy.review.budget} action={null}>
						{values.budget.trim()}
					</ReviewRow>
				) : null}
				<ReviewRow label={copy.review.photos} action={null}>
					{snapshot.photoCount === 0
						? copy.review.noPhotos
						: snapshot.photoCount === 1
							? copy.summary.onePhoto
							: fill(copy.summary.photos, { n: snapshot.photoCount })}
				</ReviewRow>
				<ReviewRow label={copy.review.contact} action={edit("details")}>
					<span className="booking-review-contact">
						<span dir="auto">{values.contactName.trim()}</span>
						<span>{values.contactPhone.trim()}</span>
						{values.contactEmail.trim() ? (
							<span>{values.contactEmail.trim()}</span>
						) : null}
					</span>
				</ReviewRow>
				{channel ? (
					<ReviewRow
						label={
							<Fill
								template={copy.review.heard}
								values={{ studio: studioName }}
							/>
						}
						action={null}
					>
						{channel}
					</ReviewRow>
				) : null}
			</dl>
		</div>
	);
}

function ReviewRow({
	label,
	action,
	children,
}: {
	label: ReactNode;
	action: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="booking-review-row">
			<dt>{label}</dt>
			<dd className="user-text" dir="auto">
				{children}
			</dd>
			{action ? <dd className="booking-review-action">{action}</dd> : null}
		</div>
	);
}

/** The piece the request is inspired by: a small picture and its title, a link back to it. */
function ArtworkLine({ artwork }: { artwork: BookingArtwork }) {
	return (
		<a className="booking-artwork" href={artwork.href}>
			<img
				className="booking-artwork-photo"
				src={artwork.src}
				width={artwork.width}
				height={artwork.height}
				alt=""
				loading="lazy"
				decoding="async"
			/>
			<span className="booking-artwork-text">
				<Fill template={copy.artwork} values={{ name: artwork.title }} />
			</span>
		</a>
	);
}

/**
 * The running summary beside the form (under the progress on a phone, folded):
 * the artist, the preferred dates, the tattoo in a line and the photos, each
 * "Not chosen yet" until it is, and the reminder that dates are preferences.
 */
export function BookingSummary({
	snapshot,
	studioName,
	showArtist,
}: {
	snapshot: RequestSnapshot;
	studioName: string;
	showArtist: boolean;
}) {
	const { values } = snapshot;
	const tattoo = [snapshot.styleName, sizeText(values), values.placement.trim()]
		.filter(Boolean)
		.join(" · ");
	const body = (
		<>
			{snapshot.artwork ? <ArtworkLine artwork={snapshot.artwork} /> : null}
			<dl className="booking-summary-list">
				{showArtist ? (
					<div>
						<dt>{copy.summary.artist}</dt>
						<dd dir="auto">{snapshot.artistName ?? copy.review.anyArtist}</dd>
					</div>
				) : null}
				<div>
					<dt>{copy.summary.dates}</dt>
					<dd>{snapshot.dates || copy.summary.empty}</dd>
				</div>
				<div>
					<dt>{copy.summary.tattoo}</dt>
					<dd className="user-text" dir="auto">
						{tattoo || copy.summary.empty}
					</dd>
				</div>
				{snapshot.photoCount > 0 ? (
					<div>
						<dt className="sr-only">{copy.review.photos}</dt>
						<dd>
							{snapshot.photoCount === 1
								? copy.summary.onePhoto
								: fill(copy.summary.photos, { n: snapshot.photoCount })}
						</dd>
					</div>
				) : null}
			</dl>
			<p className="booking-summary-note">
				<Fill
					template={copy.summary.provisional}
					values={{ studio: studioName }}
				/>
			</p>
		</>
	);
	return (
		<aside className="booking-summary" aria-labelledby="booking-summary-title">
			<details className="booking-summary-fold">
				<summary>{copy.summary.show}</summary>
				{body}
			</details>
			<div className="booking-summary-panel">
				<h2 id="booking-summary-title" className="booking-summary-title">
					{copy.summary.title}
				</h2>
				{body}
			</div>
		</aside>
	);
}

/**
 * After the API took the request (and only then): "Your story starts here.",
 * that it was received and is not a confirmed appointment, its reference
 * (the API's: the code the client quotes, which the deposit page shows
 * again), whom and when it asked for, where the studio will reply, and the
 * ways on.
 */
export function BookingSent({
	studioName,
	phone,
	artistName,
	dates,
	reference,
	ref,
}: {
	studioName: string;
	phone: string;
	artistName: string | null;
	dates: string;
	/** The API's reference for the request; null only if none came back. */
	reference: string | null;
	ref?: Ref<HTMLHeadingElement>;
}) {
	return (
		<div className="booking-sent">
			<p className="booking-sent-mark" aria-hidden="true" />
			<h2 ref={ref} className="booking-sent-title" tabIndex={-1}>
				{copy.sent.title}
			</h2>
			<p className="booking-sent-body">
				<Fill template={copy.sent.body} values={{ studio: studioName }} />{" "}
				<Fill template={copy.sent.reply} values={{ phone }} />
			</p>
			{reference ? (
				<p className="booking-sent-reference">
					<ReferenceLine reference={reference} studioName={studioName} />
				</p>
			) : null}
			<dl className="booking-summary-list">
				{artistName ? (
					<div>
						<dt>{copy.sent.artist}</dt>
						<dd dir="auto">{artistName}</dd>
					</div>
				) : null}
				<div>
					<dt>{copy.sent.dates}</dt>
					<dd>{dates}</dd>
				</div>
			</dl>
			<p className="booking-summary-note">
				<Fill template={copy.sent.pending} values={{ studio: studioName }} />
			</p>
			<p className="booking-sent-actions">
				<a className="action action-secondary" href={artistsHref({})}>
					{copy.sent.artists}
				</a>
				<a className="text-link" href="/">
					{copy.sent.home}
				</a>
			</p>
		</div>
	);
}

/** "Your request reference: K7MP3Q. Quote it when …": the code strong, the studio's name in <bdi>. */
function ReferenceLine({
	reference,
	studioName,
}: {
	reference: string;
	studioName: string;
}) {
	const [before, after = ""] = copy.sent.reference.split("{reference}");
	return (
		<>
			{before}
			<strong>{reference}</strong>
			<Fill template={after} values={{ studio: studioName }} />
		</>
	);
}
