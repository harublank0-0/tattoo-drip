import {
	REVIEW_POLL_GIVE_UP_MS,
	useAddReviewPhoto,
	useAddReviewVideo,
	useDeleteReview,
	useDeleteReviewPost,
	useRemoveReviewMedia,
	useReorderReviewPost,
	useSignReviewVideo,
	useSubmitReview,
} from "@tattoo-drip/react";
import { REVIEW_CHALLENGE_ACTION, type ReviewPage } from "@tattoo-drip/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { browserCodec } from "../../intake/browser-codec.ts";
import { Challenge } from "../../intake/challenge.ts";
import { browserChallengeHost } from "../../intake/challenge-host.ts";
import { Fill } from "../../intake/components/fill.tsx";
import { prepareImage, REFERENCE_PROFILE } from "../../intake/images.ts";
import { fill } from "../../intake/template.ts";
import { putWithProgress, videoSeconds } from "../browser.ts";
import { copy } from "../copy.ts";
import { writeOutcome } from "../problems.ts";
import {
	charCount,
	countAnnouncement,
	discoverShown,
	FIELD_IDS,
	type Field,
	type FormValues,
	formatDay,
	initialValues,
	itemLabel,
	MAX_CAPTION,
	MAX_NAME,
	MAX_PLACEMENT,
	MAX_REVIEW,
	MAX_VIDEO_SECONDS,
	type MediaView,
	mediaViews,
	orderWithLead,
	type Problem,
	postEditable,
	postStatusTemplate,
	problemsStillHolding,
	reviewEditable,
	submissionOf,
	uploadUrl,
	validate,
	videoProblem,
	waitText,
} from "../view-model.ts";
import {
	ConsentBox,
	CountedText,
	StarRating,
	StylePicker,
	TextField,
} from "./fields.tsx";
import { MediaTray, type PendingUpload } from "./media-tray.tsx";

/** A photo for the post: the intake's pipeline (upright, no EXIF or GPS, at most 1600 px). */
const PHOTO_PROFILE = { ...REFERENCE_PROFILE, name: "photo.jpg" };

type Confirming = "review" | "post" | null;

/** Which form value is which field, for clearing a field's error once it is right. */
const FIELD_OF: Partial<Record<keyof FormValues, Field>> = {
	rating: "rating",
	body: "body",
	caption: "caption",
	placement: "placement",
	styles: "styles",
	shownName: "shownName",
};

/**
 * The review form (Reviews and Fresh ink): the rating and review, the Fresh
 * ink tray, the styles, placement and caption, the two consents and the
 * shown name, then Save; once saved, the same form edits it, and each part
 * can be deleted. Photos and videos upload as they are picked, and the main
 * photo changes with an order-only write; Save sends the rest, with the bot
 * challenge. After Save focus moves to the status line (which is not a live
 * region, so it is read once); after a refusal, to the summary of problems.
 * Spontaneous news (an upload done, a video ready, a count's threshold) is
 * announced from one `sr-only` polite region.
 */
export function ReviewForm({
	token,
	page,
	studioName,
	apiUrl,
	mediaUrl,
	challengeSiteKey,
	onGone,
}: {
	token: string;
	page: ReviewPage;
	studioName: string;
	apiUrl: string;
	mediaUrl: string;
	challengeSiteKey: string | null;
	onGone: () => void;
}) {
	const [values, setValues] = useState<FormValues>(() => initialValues(page));
	const [problems, setProblems] = useState<readonly Problem[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [status, setStatus] = useState<string>("");
	const [announcement, setAnnouncement] = useState<string>("");
	const [pending, setPending] = useState<readonly PendingUpload[]>([]);
	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState<Confirming>(null);
	const [blockedUntil, setBlockedUntil] = useState(0);
	const [focusAfter, setFocusAfter] = useState<
		| { kind: "summary" }
		| { kind: "status" }
		| { kind: "remove"; index: number }
		| { kind: "confirm" }
		| { kind: "delete"; what: "review" | "post" }
		| null
	>(null);
	const summaryRef = useRef<HTMLDivElement>(null);
	const statusRef = useRef<HTMLParagraphElement>(null);
	const confirmRef = useRef<HTMLParagraphElement>(null);
	const trayRef = useRef<HTMLDivElement>(null);
	const challengeBox = useRef<HTMLDivElement>(null);
	const nextKey = useRef(0);

	const submit = useSubmitReview(token);
	const deleteReview = useDeleteReview(token);
	const deletePost = useDeleteReviewPost(token);
	const addPhoto = useAddReviewPhoto(token);
	const signVideo = useSignReviewVideo(token);
	const addVideo = useAddReviewVideo(token);
	const removeMedia = useRemoveReviewMedia(token);
	const reorder = useReorderReviewPost(token);

	const [challenge] = useState(() =>
		challengeSiteKey
			? new Challenge(
					challengeSiteKey,
					browserChallengeHost(),
					() => undefined,
					"auto",
					REVIEW_CHALLENGE_ACTION,
				)
			: null,
	);
	useEffect(() => {
		challenge?.attach(challengeBox.current);
		return () => challenge?.dispose();
	}, [challenge]);

	/** One polite announcement; the same words twice are read twice. */
	const announce = useCallback((message: string) => {
		setAnnouncement("");
		requestAnimationFrame(() => setAnnouncement(message));
	}, []);

	// Previews are object URLs: revoked when their upload leaves, and on unmount.
	const previews = useRef(new Set<string>());
	useEffect(() => {
		const urls = previews.current;
		return () => {
			for (const url of urls) URL.revokeObjectURL(url);
		};
	}, []);
	const dropPending = (key: number) =>
		setPending((list) => {
			const gone = list.find((upload) => upload.key === key);
			if (gone?.preview) {
				URL.revokeObjectURL(gone.preview);
				previews.current.delete(gone.preview);
			}
			return list.filter((upload) => upload.key !== key);
		});
	const updatePending = (key: number, change: Partial<PendingUpload>) =>
		setPending((list) =>
			list.map((upload) =>
				upload.key === key ? { ...upload, ...change } : upload,
			),
		);

	const postMedia = page.post?.media;
	const media = postMedia ?? [];

	// A video's processing ends: say so (finding 21).
	const seen = useRef(
		new Map((postMedia ?? []).map((item) => [item.id, item.state])),
	);
	useEffect(() => {
		const media = postMedia ?? [];
		for (const item of media) {
			const before = seen.current.get(item.id);
			if (item.kind === "video" && before === "processing") {
				const label = itemLabel(media, item.id) ?? "";
				const n = label.replace(/\D+/g, "");
				if (item.state === "ready") {
					announce(copy.videoReady.replace("{n}", n));
				} else if (item.state === "failed") {
					announce(copy.videoCouldNot.replace("{n}", n));
				}
			}
		}
		seen.current = new Map(media.map((item) => [item.id, item.state]));
	}, [postMedia, announce]);

	// Polling gives up after 15 minutes (the React hook's REVIEW_POLL_GIVE_UP_MS): say so.
	const processing = media.some((item) => item.state === "processing");
	const processingSince = useRef<number | null>(null);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!processing) {
			processingSince.current = null;
			return;
		}
		processingSince.current ??= Date.now();
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, [processing]);
	const gaveUp =
		processing &&
		processingSince.current !== null &&
		now - processingSince.current >= REVIEW_POLL_GIVE_UP_MS;

	// Focus moves once the page shows what changed.
	useEffect(() => {
		if (!focusAfter) return;
		setFocusAfter(null);
		switch (focusAfter.kind) {
			case "summary":
				summaryRef.current?.focus();
				return;
			case "status":
				statusRef.current?.focus();
				return;
			case "confirm":
				confirmRef.current?.focus();
				return;
			case "delete":
				document
					.querySelector<HTMLButtonElement>(
						`[data-delete="${focusAfter.what}"]`,
					)
					?.focus();
				return;
			case "remove": {
				const buttons =
					trayRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove]");
				const next =
					buttons?.[Math.min(focusAfter.index, (buttons?.length ?? 1) - 1)];
				(next ?? document.getElementById(FIELD_IDS.media))?.focus();
				return;
			}
		}
	}, [focusAfter]);

	const errorOf = (field: Field) =>
		problems.find((problem) => problem.field === field)?.message ?? null;
	const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
		const next = { ...values, [key]: value };
		setValues(next);
		const field = FIELD_OF[key];
		if (field)
			setProblems((list) => problemsStillHolding(list, next, page, field));
	};
	const setCounted = (key: "body" | "caption", value: string, max: number) => {
		const said = countAnnouncement(
			charCount(values[key].trim()),
			charCount(value.trim()),
			max,
		);
		if (said) announce(said);
		set(key, value);
	};

	/** A write's refusal: the dead link, field errors, or one notice; a 429 blocks Save for its wait. */
	const refused = (error: unknown) => {
		const outcome = writeOutcome(error);
		if (outcome.kind === "gone") return onGone();
		if (outcome.kind === "fields") {
			setProblems(outcome.problems);
			setNotice(null);
		} else if (
			outcome.retryAfter !== undefined ||
			outcome.message === copy.errors.limited
		) {
			const seconds = outcome.retryAfter ?? 60;
			setBlockedUntil(Date.now() + seconds * 1000);
			setProblems([]);
			setNotice(waitText(seconds));
		} else {
			setProblems([]);
			setNotice(outcome.message);
		}
		setFocusAfter({ kind: "summary" });
	};

	const busy =
		saving || pending.length > 0 || removeMedia.isPending || reorder.isPending;

	const uploadPhotos = async (files: File[]) => {
		setProblems([]);
		setNotice(null);
		const room = 8 - media.length;
		for (const file of files.slice(0, Math.max(0, room))) {
			const key = nextKey.current++;
			setPending((list) => [
				...list,
				{
					key,
					kind: "photo",
					preview: null,
					phase: "preparing",
					progress: null,
				},
			]);
			const prepared = await prepareImage(file, browserCodec, PHOTO_PROFILE);
			if (!prepared.ok) {
				dropPending(key);
				setProblems([
					{ field: "media", message: copy.errors.photo[prepared.problem] },
				]);
				continue;
			}
			const preview = URL.createObjectURL(prepared.file);
			previews.current.add(preview);
			updatePending(key, { preview, phase: "uploading" });
			try {
				const after = await addPhoto.mutateAsync(prepared.file);
				const photos = (after.post?.media ?? []).filter(
					(item) => item.kind === "photo",
				).length;
				announce(copy.photoAdded.replace("{n}", String(photos)));
			} catch (error) {
				refused(error);
				dropPending(key);
				return;
			}
			dropPending(key);
		}
	};

	const uploadVideo = async (file: File) => {
		setProblems([]);
		setNotice(null);
		const problem = videoProblem(file);
		if (problem) {
			setProblems([{ field: "media", message: problem }]);
			return;
		}
		const seconds = await videoSeconds(file);
		if (seconds !== null && seconds > MAX_VIDEO_SECONDS) {
			setProblems([{ field: "media", message: copy.errors.videoLong }]);
			return;
		}
		const key = nextKey.current++;
		const preview = URL.createObjectURL(file);
		previews.current.add(preview);
		setPending((list) => [
			...list,
			{ key, kind: "video", preview, phase: "uploading", progress: 0 },
		]);
		try {
			const signed = await signVideo.mutateAsync({
				type: file.type as "video/mp4",
				size: file.size,
			});
			await putWithProgress(
				uploadUrl(signed.upload.url, apiUrl),
				file,
				signed.upload.headers,
				(share) => updatePending(key, { progress: share }),
			);
			const after = await addVideo.mutateAsync(signed.token);
			const videos = (after.post?.media ?? []).filter(
				(item) => item.kind === "video",
			).length;
			announce(copy.videoAdded.replace("{n}", String(videos)));
		} catch (error) {
			if (error instanceof Error && /^upload /.test(error.message)) {
				setProblems([{ field: "media", message: copy.errors.upload }]);
				setFocusAfter({ kind: "summary" });
			} else {
				refused(error);
			}
		} finally {
			dropPending(key);
		}
	};

	const remove = async (item: MediaView) => {
		const index = media.findIndex((each) => each.id === item.id);
		try {
			await removeMedia.mutateAsync(item.id);
			announce(copy.removed.replace("{item}", capital(item.label)));
			setFocusAfter({ kind: "remove", index: Math.max(0, index) });
		} catch (error) {
			refused(error);
		}
	};

	/** The main photo: an order-only write from the page's data (finding 13). */
	const makeMain = async (item: MediaView) => {
		const order = orderWithLead(media, item.id);
		if (!order) return;
		try {
			await reorder.mutateAsync(order);
			announce(copy.madeMain.replace("{item}", capital(item.label)));
		} catch (error) {
			refused(error);
		}
	};

	async function save() {
		if (saving) return;
		if (pending.length > 0) {
			setNotice(copy.uploadsPending);
			setFocusAfter({ kind: "summary" });
			return;
		}
		if (Date.now() < blockedUntil) {
			setNotice(waitText((blockedUntil - Date.now()) / 1000));
			setFocusAfter({ kind: "summary" });
			return;
		}
		const found = validate(values, page);
		if (found.length > 0) {
			setProblems(found);
			setNotice(null);
			setFocusAfter({ kind: "summary" });
			return;
		}
		setSaving(true);
		setProblems([]);
		setNotice(null);
		try {
			let challengeToken: string | undefined;
			if (challenge) {
				const result = await challenge.token();
				if (!result.ok) {
					setNotice(copy.errors.challenge);
					setFocusAfter({ kind: "summary" });
					return;
				}
				challengeToken = result.token;
			}
			const input = submissionOf(values, page);
			const saved = await submit.mutateAsync({ ...input, challengeToken });
			setValues(initialValues(saved));
			const shown = saved.review ?? saved.post;
			const nobody =
				shown && !shown.consentStudioPage && !shown.consentDiscover;
			const message = fill(
				saved.post && saved.post.status === "waiting"
					? copy.savedPostWaiting
					: copy.saved,
				{ studio: studioName },
			);
			setStatus(nobody ? `${message} ${copy.savedPrivate}` : message);
			setFocusAfter({ kind: "status" });
		} catch (error) {
			refused(error);
		} finally {
			challenge?.reset();
			setSaving(false);
		}
	}

	const confirmDelete = async (what: "review" | "post") => {
		setConfirming(null);
		try {
			await (what === "review" ? deleteReview : deletePost).mutateAsync();
			setStatus(what === "review" ? copy.deletedReview : copy.deletedPost);
			if (what === "review") {
				setValues((current) => ({ ...current, rating: 0, body: "" }));
			}
			setFocusAfter({ kind: "status" });
		} catch (error) {
			refused(error);
		}
	};

	const reviewOpen = reviewEditable(page);
	const postOpen = postEditable(page);
	const reviewBlocked = !page.review && page.blocks.review !== null;
	const postBlocked = !page.post && page.blocks.post !== null;
	const summaryItems = notice ? [] : problems;
	const items = mediaViews(media, [mediaUrl, apiUrl]);

	const deleteButton = (what: "review" | "post", label: string) => (
		<DeleteControl
			what={what}
			label={label}
			confirming={confirming === what}
			confirmRef={confirmRef}
			onAsk={() => {
				setConfirming(what);
				setFocusAfter({ kind: "confirm" });
			}}
			onCancel={() => {
				setConfirming(null);
				setFocusAfter({ kind: "delete", what });
			}}
			onConfirm={() => void confirmDelete(what)}
		/>
	);

	return (
		<form
			id={FIELD_IDS.form}
			className="review-form"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void save();
			}}
			onFocus={() => challenge?.preload()}
		>
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>
			<p className="deposit-muted">
				<Fill
					template={copy.linkUntil}
					values={{ date: formatDay(page.link.expiresAt) }}
				/>
			</p>

			{summaryItems.length > 0 || notice ? (
				<div
					ref={summaryRef}
					className="deposit-alert"
					role="alert"
					tabIndex={-1}
				>
					{notice ? (
						<p className="deposit-alert-title">{notice}</p>
					) : (
						<>
							<p className="deposit-alert-title">{copy.problemsTitle}</p>
							<ul>
								{summaryItems.map((problem) => (
									<li key={`${problem.field}:${problem.message}`}>
										<button
											type="button"
											className="deposit-summary-link"
											onClick={() =>
												document
													.getElementById(FIELD_IDS[problem.field])
													?.focus()
											}
										>
											{problem.message}
										</button>
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			) : null}

			<section className="review-section" aria-labelledby="review-title">
				<h2 id="review-title">{copy.reviewTitle}</h2>
				{page.review?.takenDown ? (
					<div className="deposit-note" role="note">
						<p className="deposit-state-title">{copy.reviewTakenDown}</p>
						<p>{page.review.takenDown.sentence}</p>
					</div>
				) : null}
				{reviewBlocked ? (
					<p className="deposit-note">{copy.reviewBlocked}</p>
				) : reviewOpen ? (
					<>
						<StarRating
							value={values.rating}
							onChange={(rating) => set("rating", rating)}
							error={errorOf("rating")}
						/>
						<CountedText
							id={FIELD_IDS.body}
							label={copy.bodyLabel}
							hint={copy.bodyHint}
							value={values.body}
							max={MAX_REVIEW}
							error={errorOf("body")}
							onChange={(body) => setCounted("body", body, MAX_REVIEW)}
						/>
					</>
				) : page.review ? (
					<blockquote className="review-readonly" dir="auto">
						{page.review.body}
					</blockquote>
				) : null}
				{page.review ? deleteButton("review", copy.deleteReview) : null}
			</section>

			<section className="review-section" aria-labelledby="review-post-title">
				<h2 id="review-post-title">{copy.postTitle}</h2>
				<p className="deposit-muted" id="review-media-hint">
					<Fill template={copy.postHint} values={{ studio: studioName }} />
				</p>
				{page.post?.takenDown ? (
					<p className="deposit-note">{page.post.takenDown.sentence}</p>
				) : page.post ? (
					<p className="review-post-status">
						<Fill
							template={postStatusTemplate(page.post)}
							values={{ studio: studioName }}
						/>
					</p>
				) : null}
				{page.post?.status === "approved" && !page.post.takenDown ? (
					<p className="deposit-muted">
						<Fill
							template={copy.postApprovedHint}
							values={{ studio: studioName }}
						/>
					</p>
				) : null}
				{postBlocked ? (
					<p className="deposit-note">
						{page.blocks.post === "post_limit"
							? copy.postLimit
							: copy.reviewBlocked}
					</p>
				) : (
					<div ref={trayRef}>
						<MediaTray
							items={items}
							pending={pending}
							editable={postOpen}
							busy={busy}
							error={errorOf("media")}
							onPhotos={(files) => void uploadPhotos(files)}
							onVideo={(file) => void uploadVideo(file)}
							onRemove={(item) => void remove(item)}
							onMakeMain={(item) => void makeMain(item)}
						/>
					</div>
				)}
				{gaveUp ? <p className="deposit-note">{copy.stillProcessing}</p> : null}
				{postOpen && media.length > 0 ? (
					<>
						<StylePicker
							styles={page.styles}
							chosen={values.styles}
							onChange={(styles) => set("styles", styles)}
							error={errorOf("styles")}
						/>
						<TextField
							id={FIELD_IDS.placement}
							label={copy.placementLabel}
							value={values.placement}
							maxLength={MAX_PLACEMENT}
							error={errorOf("placement")}
							onChange={(placement) => set("placement", placement)}
						/>
						<CountedText
							id={FIELD_IDS.caption}
							label={copy.captionLabel}
							value={values.caption}
							max={MAX_CAPTION}
							rows={3}
							error={errorOf("caption")}
							onChange={(caption) =>
								setCounted("caption", caption, MAX_CAPTION)
							}
						/>
					</>
				) : null}
				{page.post ? deleteButton("post", copy.deletePost) : null}
			</section>

			<section className="review-section" aria-labelledby="review-where-title">
				<h2 id="review-where-title">{copy.whereTitle}</h2>
				<p className="deposit-muted">{copy.whereHint}</p>
				<ConsentBox
					id="review-consent-studio"
					label={
						<Fill
							template={copy.consentStudio}
							values={{ studio: studioName }}
						/>
					}
					checked={values.consentStudioPage}
					onChange={(checked) => set("consentStudioPage", checked)}
				/>
				{discoverShown(page) ? (
					<ConsentBox
						id="review-consent-discover"
						label={copy.consentDiscover}
						hint={copy.consentDiscoverHint}
						checked={values.consentDiscover}
						onChange={(checked) => set("consentDiscover", checked)}
					/>
				) : null}
				<TextField
					id={FIELD_IDS.shownName}
					label={copy.nameLabel}
					hint={copy.nameHint}
					value={values.shownName}
					maxLength={MAX_NAME}
					error={errorOf("shownName")}
					onChange={(shownName) => set("shownName", shownName)}
					autoComplete="nickname"
				/>
			</section>

			<div className="deposit-submit">
				<div ref={challengeBox} className="intake-challenge" />
				<button
					type="submit"
					className="action action-primary"
					aria-disabled={busy || Date.now() < blockedUntil ? true : undefined}
					aria-describedby={pending.length > 0 ? "review-save-wait" : undefined}
				>
					{saving ? copy.saving : copy.save}
				</button>
				{pending.length > 0 ? (
					<p className="deposit-muted" id="review-save-wait">
						{copy.uploadsPending}
					</p>
				) : null}
				<p ref={statusRef} className="deposit-send-status" tabIndex={-1}>
					{status}
				</p>
				<p className="deposit-muted">
					<Fill template={copy.privacy} values={{ studio: studioName }} />
				</p>
			</div>
		</form>
	);
}

function capital(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Delete, then an inline "Delete it for good?" that takes focus, with Yes
 * and Keep it (which gives focus back to Delete). No browser dialog.
 */
export function DeleteControl({
	what,
	label,
	confirming,
	confirmRef,
	onAsk,
	onCancel,
	onConfirm,
}: {
	what: "review" | "post";
	label: string;
	confirming: boolean;
	confirmRef: React.RefObject<HTMLParagraphElement | null>;
	onAsk: () => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	if (!confirming) {
		return (
			<button
				type="button"
				className="review-small-button review-danger"
				data-delete={what}
				onClick={onAsk}
			>
				{label}
			</button>
		);
	}
	return (
		<fieldset className="review-confirm">
			<legend className="sr-only">{label}</legend>
			<p ref={confirmRef} tabIndex={-1}>
				{copy.confirmDelete}
			</p>
			<button
				type="button"
				className="review-small-button review-danger"
				onClick={onConfirm}
			>
				{copy.confirmYes}
			</button>
			<button type="button" className="review-small-button" onClick={onCancel}>
				{copy.confirmNo}
			</button>
		</fieldset>
	);
}
