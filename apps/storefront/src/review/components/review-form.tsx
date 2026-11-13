import {
	useAddReviewPhoto,
	useAddReviewVideo,
	useDeleteReview,
	useDeleteReviewPost,
	useRemoveReviewMedia,
	useSignReviewVideo,
	useSubmitReview,
} from "@tattoo-drip/react";
import { REVIEW_CHALLENGE_ACTION, type ReviewPage } from "@tattoo-drip/sdk";
import { useEffect, useRef, useState } from "react";
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
	FIELD_IDS,
	type Field,
	type FormValues,
	formatDay,
	initialValues,
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
	reviewEditable,
	submissionOf,
	uploadUrl,
	validate,
	videoProblem,
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

/**
 * The review form (Reviews and Fresh ink): the rating and review, the Fresh
 * ink tray, the styles, placement and caption, the two consents and the
 * shown name, then Save; once saved, the same form edits it, and each part
 * can be deleted. Photos and videos upload as they are picked; Save sends
 * the rest, with the bot challenge. After Save, focus moves to the message
 * that says what happened; after a refusal, to the summary of problems.
 */
export function ReviewForm({
	token,
	page,
	studioName,
	apiUrl,
	mediaUrl,
	challengeSiteKey,
	onGone,
	onSaved,
}: {
	token: string;
	page: ReviewPage;
	studioName: string;
	apiUrl: string;
	mediaUrl: string;
	challengeSiteKey: string | null;
	onGone: () => void;
	onSaved: () => void;
}) {
	const [values, setValues] = useState<FormValues>(() => initialValues(page));
	const [problems, setProblems] = useState<readonly Problem[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [status, setStatus] = useState<string>("");
	const [pending, setPending] = useState<readonly PendingUpload[]>([]);
	const [saving, setSaving] = useState(false);
	const [confirming, setConfirming] = useState<Confirming>(null);
	const summaryRef = useRef<HTMLDivElement>(null);
	const statusRef = useRef<HTMLParagraphElement>(null);
	const challengeBox = useRef<HTMLDivElement>(null);
	const nextKey = useRef(0);
	const [focusSummary, setFocusSummary] = useState(false);

	const submit = useSubmitReview(token);
	const deleteReview = useDeleteReview(token);
	const deletePost = useDeleteReviewPost(token);
	const addPhoto = useAddReviewPhoto(token);
	const signVideo = useSignReviewVideo(token);
	const addVideo = useAddReviewVideo(token);
	const removeMedia = useRemoveReviewMedia(token);

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

	useEffect(() => {
		if (!focusSummary) return;
		setFocusSummary(false);
		summaryRef.current?.focus();
	}, [focusSummary]);

	const errorOf = (field: Field) =>
		problems.find((problem) => problem.field === field)?.message ?? null;
	const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
		setValues((current) => ({ ...current, [key]: value }));

	/** A write's refusal: the dead link, field errors (with the summary focused), or one notice. */
	const refused = (error: unknown) => {
		const outcome = writeOutcome(error);
		if (outcome.kind === "gone") return onGone();
		if (outcome.kind === "fields") {
			setProblems(outcome.problems);
			setNotice(null);
		} else {
			setProblems([]);
			setNotice(outcome.message);
		}
		setFocusSummary(true);
	};

	const busy = saving || pending.length > 0 || removeMedia.isPending;
	const media = page.post?.media ?? [];
	const items = mediaViews(media, mediaUrl);

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
				await addPhoto.mutateAsync(prepared.file);
				setStatus(copy.photoAdded);
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
			await addVideo.mutateAsync(signed.token);
			setStatus(copy.videoAdded);
		} catch (error) {
			if (error instanceof Error && /^upload /.test(error.message)) {
				setProblems([{ field: "media", message: copy.errors.upload }]);
				setFocusSummary(true);
			} else {
				refused(error);
			}
		} finally {
			dropPending(key);
		}
	};

	const remove = async (item: MediaView) => {
		try {
			await removeMedia.mutateAsync(item.id);
			setStatus(copy.deleted);
		} catch (error) {
			refused(error);
		}
	};

	const makeMain = async (item: MediaView) => {
		const order = orderWithLead(media, item.id);
		if (!order) return;
		await save(order);
	};

	async function save(order?: string[]) {
		if (saving) return;
		const found = validate(values, page);
		if (found.length > 0) {
			setProblems(found);
			setNotice(null);
			setFocusSummary(true);
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
					setFocusSummary(true);
					return;
				}
				challengeToken = result.token;
			}
			const input = submissionOf(values, page);
			if (order && input.post) input.post.order = order;
			const saved = await submit.mutateAsync({ ...input, challengeToken });
			setValues(initialValues(saved));
			setStatus(
				fill(
					saved.post && saved.post.status === "waiting"
						? copy.savedPostWaiting
						: copy.saved,
					{ studio: studioName },
				),
			);
			onSaved();
			statusRef.current?.focus();
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
			setStatus(copy.deleted);
			if (what === "review") {
				setValues((current) => ({ ...current, rating: 0, body: "" }));
			}
			statusRef.current?.focus();
		} catch (error) {
			refused(error);
		}
	};

	const reviewOpen = reviewEditable(page);
	const postOpen = postEditable(page);
	const summaryItems = notice ? [] : problems;

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
				{reviewOpen ? (
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
							onChange={(body) => set("body", body)}
						/>
					</>
				) : page.review ? (
					<p className="review-readonly" dir="auto">
						{page.review.body}
					</p>
				) : null}
				{page.review ? (
					<DeleteButton
						label={copy.deleteReview}
						confirming={confirming === "review"}
						onAsk={() => setConfirming("review")}
						onCancel={() => setConfirming(null)}
						onConfirm={() => void confirmDelete("review")}
					/>
				) : null}
			</section>

			<section className="review-section" aria-labelledby="review-post-title">
				<h2 id="review-post-title">{copy.postTitle}</h2>
				<p className="deposit-muted" id="review-media-hint">
					<Fill template={copy.postHint} values={{ studio: studioName }} />
				</p>
				{page.post && page.post.status !== "draft" ? (
					<p className="review-post-status">
						<Fill
							template={postStatusTemplate(page.post)}
							values={{ studio: studioName }}
						/>
					</p>
				) : null}
				{page.post?.takenDown ? (
					<p className="deposit-note">{page.post.takenDown.sentence}</p>
				) : null}
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
							onChange={(caption) => set("caption", caption)}
						/>
					</>
				) : null}
				{page.post ? (
					<DeleteButton
						label={copy.deletePost}
						confirming={confirming === "post"}
						onAsk={() => setConfirming("post")}
						onCancel={() => setConfirming(null)}
						onConfirm={() => void confirmDelete("post")}
					/>
				) : null}
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
				{page.studio.onDiscover ? (
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
					aria-disabled={busy ? true : undefined}
				>
					{saving ? copy.saving : copy.save}
				</button>
				<p
					ref={statusRef}
					className="deposit-send-status"
					tabIndex={-1}
					aria-live="polite"
				>
					{status}
				</p>
				<p className="deposit-muted">
					<Fill template={copy.privacy} values={{ studio: studioName }} />
				</p>
			</div>
		</form>
	);
}

/** Delete, then an inline "Delete it for good?" with Yes and Keep it (no browser dialog). */
function DeleteButton({
	label,
	confirming,
	onAsk,
	onCancel,
	onConfirm,
}: {
	label: string;
	confirming: boolean;
	onAsk: () => void;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	if (!confirming) {
		return (
			<button
				type="button"
				className="review-small-button review-danger"
				onClick={onAsk}
			>
				{label}
			</button>
		);
	}
	return (
		<fieldset className="review-confirm">
			<legend className="sr-only">{label}</legend>
			<p>{copy.confirmDelete}</p>
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
