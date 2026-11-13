import { Fill } from "../../intake/components/fill.tsx";
import { ACCEPT } from "../../intake/images.ts";
import { copy } from "../copy.ts";
import {
	FIELD_IDS,
	MAX_MEDIA,
	type MediaView,
	VIDEO_TYPES,
} from "../view-model.ts";
import { describedBy, FieldError } from "./fields.tsx";

/*
 * The Fresh ink tray (Reviews and Fresh ink): the post's photos and videos
 * in order (the first is the main one), with previews (photos, and videos
 * muted, inline), the uploads still on their way with their progress, and
 * the pickers. Props only.
 */

/** An upload still on its way: a preview from the picked file, and where it is. */
export interface PendingUpload {
	readonly key: number;
	readonly kind: "photo" | "video";
	/** An object URL of the prepared photo or the picked video; revoked when it leaves. */
	readonly preview: string | null;
	readonly phase: "preparing" | "uploading";
	/** The share sent, 0 to 1, when the browser can tell (videos). */
	readonly progress: number | null;
}

export function MediaTray({
	items,
	pending,
	editable,
	busy,
	error,
	onPhotos,
	onVideo,
	onRemove,
	onMakeMain,
}: {
	items: readonly MediaView[];
	pending: readonly PendingUpload[];
	editable: boolean;
	/** An upload or a change is running: the pickers and buttons wait. */
	busy: boolean;
	error: string | null;
	onPhotos: (files: File[]) => void;
	onVideo: (file: File) => void;
	onRemove: (item: MediaView) => void;
	onMakeMain: (item: MediaView) => void;
}) {
	const full = items.length + pending.length >= MAX_MEDIA;
	const hasPhoto = items.some((item) => item.kind === "photo");
	const errorId = "review-media-error";
	return (
		<div className="review-media">
			{items.length + pending.length > 0 ? (
				<ul className="review-tray">
					{items.map((item, index) => (
						<li key={item.id} className="review-tray-item">
							<MediaPreview item={item} />
							{index === 0 ? (
								<p className="review-tray-main">{copy.main}</p>
							) : null}
							{item.state === "processing" ? (
								<p className="deposit-muted" aria-live="polite">
									{copy.processing}
								</p>
							) : null}
							{item.state === "failed" ? (
								<p className="deposit-field-error">
									<Fill
										template={copy.videoFailed}
										values={{ reason: item.failure ?? "" }}
									/>
								</p>
							) : null}
							{editable ? (
								<div className="review-tray-actions">
									{index > 0 && item.kind === "photo" ? (
										<button
											type="button"
											className="review-small-button"
											aria-disabled={busy ? true : undefined}
											onClick={() => {
												if (!busy) onMakeMain(item);
											}}
										>
											{copy.makeMain}
										</button>
									) : null}
									<button
										type="button"
										className="review-small-button"
										aria-label={copy.removeLabel.replace("{item}", item.label)}
										aria-disabled={busy ? true : undefined}
										onClick={() => {
											if (!busy) onRemove(item);
										}}
									>
										{copy.remove}
									</button>
								</div>
							) : null}
						</li>
					))}
					{pending.map((upload) => (
						<li key={`pending-${upload.key}`} className="review-tray-item">
							{upload.preview ? (
								upload.kind === "photo" ? (
									<img className="review-preview" src={upload.preview} alt="" />
								) : (
									<video
										className="review-preview"
										src={upload.preview}
										muted
										playsInline
										preload="metadata"
										aria-label={copy.uploading}
									/>
								)
							) : (
								<span
									className="review-preview review-preview-empty"
									aria-hidden="true"
								/>
							)}
							<p className="deposit-muted">
								{upload.phase === "preparing"
									? copy.preparing
									: upload.progress === null
										? copy.uploading
										: copy.uploadingPercent.replace(
												"{percent}",
												String(Math.round(upload.progress * 100)),
											)}
							</p>
							{upload.phase === "uploading" && upload.progress !== null ? (
								<progress
									className="review-progress"
									max={100}
									value={Math.round(upload.progress * 100)}
									aria-label={copy.uploading}
								/>
							) : null}
						</li>
					))}
				</ul>
			) : null}
			{editable ? (
				<div className="review-pickers">
					<label
						className="deposit-pick"
						data-locked={busy || full ? "" : undefined}
					>
						<input
							id={FIELD_IDS.media}
							className="sr-only"
							type="file"
							accept={ACCEPT}
							multiple
							aria-describedby={describedBy(
								"review-media-hint",
								error && errorId,
							)}
							onChange={(event) => {
								const files = Array.from(event.target.files ?? []);
								event.target.value = "";
								if (!busy && !full && files.length > 0) onPhotos(files);
							}}
						/>
						{copy.addPhotos}
					</label>
					{hasPhoto ? (
						<label
							className="deposit-pick"
							data-locked={busy || full ? "" : undefined}
						>
							<input
								className="sr-only"
								type="file"
								accept={VIDEO_TYPES.join(",")}
								aria-describedby={describedBy(
									"review-video-hint",
									error && errorId,
								)}
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									if (!busy && !full && file) onVideo(file);
								}}
							/>
							{copy.addVideo}
						</label>
					) : null}
					<p className="deposit-muted" id="review-video-hint">
						{copy.videoHint}
					</p>
				</div>
			) : null}
			{full && editable ? (
				<p className="deposit-muted">{copy.postFull}</p>
			) : null}
			<FieldError id={errorId} message={error} />
		</div>
	);
}

/** A photo, or a video muted and inline with its poster (it plays on request, without sound). */
function MediaPreview({ item }: { item: MediaView }) {
	if (item.kind === "photo" && item.image) {
		return (
			<img
				className="review-preview"
				src={item.image.src}
				srcSet={item.image.srcSet}
				sizes="(min-width: 40rem) 12rem, 45vw"
				width={item.image.width}
				height={item.image.height}
				alt={`Your ${item.label}`}
				loading="lazy"
				decoding="async"
				referrerPolicy="no-referrer"
			/>
		);
	}
	if (
		item.kind === "video" &&
		item.state === "ready" &&
		item.sources.length > 0
	) {
		return (
			<video
				className="review-preview"
				poster={item.image?.src}
				muted
				playsInline
				controls
				preload="none"
				aria-label={`Your ${item.label}`}
			>
				{item.sources.map((source) => (
					<source key={source.src} src={source.src} type={source.type} />
				))}
			</video>
		);
	}
	return (
		<span className="review-preview review-preview-empty" aria-hidden="true" />
	);
}
