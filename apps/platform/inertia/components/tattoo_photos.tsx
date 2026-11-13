import { router } from "@inertiajs/react";
import {
	ArrowDown,
	ArrowUp,
	Film,
	ImagePlus,
	Pencil,
	Play,
	Star,
	Trash2,
	Ungroup,
} from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import { canMove, focusAfterMove } from "~/components/page_look";
import { MAX_PHOTO_ALT } from "~/components/photos";
import {
	DELETE_ANGLE_QUESTION,
	DELETE_FAILED_VIDEO_QUESTION,
	DELETE_VIDEO_QUESTION,
	followBack,
	MAX_TATTOO_PHOTOS,
	mainFirst,
	moveButton,
	movedOrder,
	movePhotoLabel,
	type PortfolioAngle,
	type PortfolioPhoto,
	photoTotal,
	removeQuery,
	TATTOO_PHOTOS_NOTE,
	VIDEO_NOTE,
	videoLabel,
	videoStateText,
} from "~/components/portfolio";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/** One row of the list: the main photo or one of the others (a photo or a video), as the panel draws it. */
type Row = Pick<
	PortfolioAngle,
	"id" | "kind" | "alt" | "thumbUrl" | "width" | "height" | "video"
>;

/** A row's button, as the focus map knows it. */
const keyOf = (rowId: string, button: string) => `${rowId}-${button}`;

/** Where focus goes once the answer has redrawn the list (a moved node loses focus). */
type Refocus =
	| { id: string; button: "up" | "down" | "edit" }
	| { id: null; button: "heading" };

/**
 * "Photos of this tattoo" in the portfolio's details panel (angles): the main
 * photo first, then the tattoo's other photos in order, each with its
 * thumbnail (whole, never cropped) and description. Every row has the Page
 * look sections' two icon buttons, "Move {name} earlier" and "Move {name}
 * later" (named by the photo, disabled at the ends), and the other photos
 * "Make this the main photo", "Edit description", "Remove from this tattoo"
 * (it becomes a tattoo of its own) and "Delete" (asked in the row first).
 * "Add photos or videos to this tattoo" opens the upload panel for this tattoo, while
 * it has room (eight photos). Every write is one request through the work
 * photo routes with `back`, so the answer is the portfolio as it was and the
 * panel stays open on the tattoo; a write that makes another photo the main
 * one tells the page first (`onFollow`), since the tile's id changes with it.
 * While a request is out the buttons are aria-disabled, not disabled, so the
 * pressed one keeps focus; after the answer has redrawn the list, focus goes
 * back to the pressed button (or the row's other move button when the move
 * left it at an end, `focusAfterMove`), and to the section's heading when the
 * row left the list. Moved in an effect after the commit, like the rest of
 * the panel. Escape closes a row's question or form first (through
 * `escapeInside`, since the sheet hears Escape before its content), and focus
 * returns to the button that opened it.
 */
export default function TattooPhotos({
	photo,
	tenantSlug,
	back,
	busy,
	held,
	onBusy,
	onError,
	onFollow,
	onAddPhotos,
	escapeInside,
}: {
	photo: PortfolioPhoto;
	tenantSlug: string;
	back: string;
	busy: boolean;
	/** An upload is going: a write here would cancel its visit. */
	held: boolean;
	onBusy: (busy: boolean) => void;
	onError: (error: string | null) => void;
	/** A photo has become the main one (the write succeeded): the page follows it. */
	onFollow: (id: string) => void;
	/** Open the upload for this tattoo; the button is where focus returns when it closes. */
	onAddPhotos: (from: HTMLElement) => void;
	/**
	 * Set here to what Escape does inside the section: close a row's question
	 * or form (true) or nothing (false). The sheet hears Escape first, on the
	 * document, so it asks this before it closes.
	 */
	escapeInside: RefObject<(() => boolean) | null>;
}) {
	const id = useId();
	const rows: Row[] = [
		{
			id: photo.id,
			kind: "photo",
			alt: photo.alt,
			thumbUrl: photo.thumbUrl,
			width: photo.width,
			height: photo.height,
			video: null,
		},
		...photo.angles,
	];
	const ids = rows.map((row) => row.id);
	const kinds = rows.map((row) => row.kind);
	// Video angles: a video never leads, so some moves and actions don't apply.
	const hasVideo = kinds.includes("video");
	const videoNoteId = `${id}-video-note`;
	const off = busy || held;
	const room = MAX_TATTOO_PHOTOS - photoTotal(photo);
	const [editing, setEditing] = useState<string | null>(null);
	const [asking, setAsking] = useState<string | null>(null);
	const [altError, setAltError] = useState<string | null>(null);

	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const heading = useRef<HTMLHeadingElement>(null);
	const keep = useRef<HTMLButtonElement>(null);
	const refocus = useRef<Refocus | null>(null);
	const remember = (key: string) => (node: HTMLButtonElement | null) => {
		if (node) buttons.current.set(key, node);
		else buttons.current.delete(key);
	};

	// Every answer is new props: the list has been redrawn, so focus can go back.
	useEffect(() => {
		const pending = refocus.current;
		if (!pending) return;
		// A saved description: its Edit button is back once the form has closed.
		if (pending.button === "edit" && editing === pending.id) return;
		refocus.current = null;
		if (pending.id === null) {
			heading.current?.focus();
			return;
		}
		const order = [photo.id, ...photo.angles.map((angle) => angle.id)];
		const index = order.indexOf(pending.id);
		const button =
			pending.button === "edit"
				? "edit"
				: focusAfterMove(index, order.length, pending.button);
		(index === -1
			? heading.current
			: (buttons.current.get(keyOf(pending.id, button)) ?? heading.current)
		)?.focus();
	}, [photo, editing]);

	// The question's safe answer takes focus, so Enter at once changes nothing;
	// a question or a form closed without a write gives focus back to the
	// button that opened it, once that button is drawn again.
	const returnTo = useRef<string | null>(null);
	useEffect(() => {
		if (asking) {
			keep.current?.focus();
			return;
		}
		if (editing) return;
		const key = returnTo.current;
		returnTo.current = null;
		if (key) buttons.current.get(key)?.focus();
	}, [asking, editing]);

	// What Escape closes first: the question, else the form; never while a request is out.
	useEffect(() => {
		escapeInside.current = () => {
			if (busy || (!asking && !editing)) return false;
			if (asking) {
				returnTo.current = keyOf(asking, "delete");
				setAsking(null);
			} else if (editing) {
				returnTo.current = keyOf(editing, "edit");
				setEditing(null);
				setAltError(null);
			}
			return true;
		};
		return () => {
			escapeInside.current = null;
		};
	}, [escapeInside, asking, editing, busy]);

	const visit = {
		preserveScroll: true,
		preserveState: true,
		onStart: () => {
			onBusy(true);
			onError(null);
		},
		onSuccess: (page: { flash?: unknown }) => {
			const flash = page.flash as { error?: string } | undefined;
			onError(flash?.error ?? null);
		},
		onFinish: () => onBusy(false),
	};

	const sendOrder = (order: string[], focus: Refocus) => {
		if (off) return;
		const lead = order[0];
		const leads = lead !== photo.id;
		refocus.current = focus;
		router.put(
			urlFor("tenant.artists.photos.order", {
				tenant: tenantSlug,
				id: photo.id,
			}),
			// A new main photo can move the tattoo off this page: come back
			// asking for it (`open`), so the panel stays on it.
			{ ids: order, back: leads ? followBack(back, lead) : back },
			{
				...visit,
				onSuccess: (page: { flash?: unknown }) => {
					visit.onSuccess(page);
					const flash = page.flash as { error?: string } | undefined;
					// Only once it is so: a refusal leaves the panel where it was.
					if (leads && !flash?.error) onFollow(lead);
				},
			},
		);
	};

	const ungroup = (rowId: string) => {
		if (off) return;
		refocus.current = { id: null, button: "heading" };
		router.post(
			urlFor("tenant.artists.photos.ungroup", {
				tenant: tenantSlug,
				id: rowId,
			}),
			{ back },
			visit,
		);
	};

	const remove = (rowId: string) => {
		if (off) return;
		refocus.current = { id: null, button: "heading" };
		router.delete(
			`${urlFor("tenant.artists.photos.destroy", { tenant: tenantSlug, id: rowId })}${removeQuery({ scope: "photo" }, back)}`,
			{
				...visit,
				onFinish: () => {
					onBusy(false);
					setAsking(null);
				},
			},
		);
	};

	const saveAlt = (rowId: string, alt: string) => {
		if (off) return;
		refocus.current = { id: rowId, button: "edit" };
		router.put(
			urlFor("tenant.artists.photos.update", { tenant: tenantSlug, id: rowId }),
			{ alt, back },
			{
				...visit,
				onSuccess: (page) => {
					visit.onSuccess(page);
					setEditing(null);
					setAltError(null);
				},
				onError: (errors) => {
					refocus.current = null;
					setAltError(errors.alt ?? "That didn't work. Try again.");
				},
			},
		);
	};

	return (
		<section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<h3
					ref={heading}
					id={`${id}-title`}
					tabIndex={-1}
					className="text-sm font-semibold outline-none"
				>
					{hasVideo
						? "Photos and videos of this tattoo"
						: "Photos of this tattoo"}
					<span className="font-normal text-muted-foreground tabular-nums">
						{" "}
						({rows.length} of {MAX_TATTOO_PHOTOS})
					</span>
				</h3>
				<p className="text-xs text-muted-foreground">{TATTOO_PHOTOS_NOTE}</p>
				{hasVideo && (
					<p id={videoNoteId} className="text-xs text-muted-foreground">
						{VIDEO_NOTE}
					</p>
				)}
			</div>
			<ol className="flex flex-col divide-y rounded-lg border">
				{rows.map((row, index) => {
					const n = index + 1;
					const nameId = `${id}-${row.id}-name`;
					const video = row.video;
					const noun = row.kind === "video" ? "video" : "photo";
					return (
						<li key={row.id} className="flex flex-col gap-2 p-3">
							<div className="flex items-start gap-3">
								<div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
									{row.thumbUrl ? (
										<img
											src={row.thumbUrl}
											alt=""
											width={row.width ?? undefined}
											height={row.height ?? undefined}
											loading="lazy"
											decoding="async"
											className="size-full object-contain"
										/>
									) : (
										<Film
											aria-hidden="true"
											className="absolute inset-0 m-auto size-6 text-muted-foreground"
										/>
									)}
									{video && row.thumbUrl ? (
										<span
											aria-hidden="true"
											className="absolute inset-0 m-auto flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
										>
											<Play className="size-3.5 fill-current" />
										</span>
									) : null}
								</div>
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<p id={nameId} className="text-sm font-medium">
										{index === 0
											? "Main photo"
											: video
												? videoLabel(video.durationMs)
												: `Photo ${n}`}
									</p>
									{video ? (
										<output
											className={
												video.state === "failed"
													? "block text-xs text-destructive wrap-anywhere"
													: "block text-xs text-muted-foreground"
											}
										>
											{videoStateText(video)}
										</output>
									) : null}
									<p
										className="text-xs text-muted-foreground wrap-anywhere"
										dir="auto"
									>
										{row.alt ?? "No description"}
									</p>
								</div>
								{rows.length > 1 && (
									<div className="flex shrink-0 gap-1">
										{/* The main photo has nowhere earlier to go: no button there, its place kept. */}
										{index === 0 && (
											<span
												aria-hidden="true"
												className="size-9 max-lg:size-11"
											/>
										)}
										{(["up", "down"] as const)
											.filter((direction) => index > 0 || direction === "down")
											.map((direction) => {
												// A move that would put a video first is aria-disabled, not
												// disabled: focus can land here after another move.
												const state = moveButton(kinds, index, direction);
												const blocked = state.ariaDisabled;
												return (
													<Button
														key={direction}
														ref={remember(keyOf(row.id, direction))}
														type="button"
														variant="outline"
														size="icon"
														aria-label={movePhotoLabel(
															n,
															rows.length,
															direction,
															noun,
														)}
														aria-describedby={blocked ? videoNoteId : undefined}
														disabled={
															state.disabled ||
															!canMove(index, rows.length, direction)
														}
														aria-disabled={off || blocked || undefined}
														onClick={() => {
															if (blocked) return;
															sendOrder(movedOrder(ids, index, direction), {
																id: row.id,
																button: direction,
															});
														}}
													>
														{direction === "up" ? (
															<ArrowUp aria-hidden="true" />
														) : (
															<ArrowDown aria-hidden="true" />
														)}
													</Button>
												);
											})}
									</div>
								)}
							</div>

							{index > 0 && editing !== row.id && asking !== row.id && (
								<div className="flex flex-wrap gap-1">
									{/* A video never leads a tattoo, nor leaves it: no such buttons (VIDEO_NOTE says why). */}
									{video === null && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-describedby={nameId}
											aria-disabled={off || undefined}
											onClick={() =>
												sendOrder(mainFirst(ids, row.id), {
													id: row.id,
													button: "down",
												})
											}
										>
											<Star aria-hidden="true" />
											Make this the main photo
										</Button>
									)}
									<Button
										ref={remember(keyOf(row.id, "edit"))}
										type="button"
										variant="ghost"
										size="sm"
										aria-describedby={nameId}
										onClick={() => {
											setAltError(null);
											setEditing(row.id);
										}}
									>
										<Pencil aria-hidden="true" />
										Edit description
									</Button>
									{video === null && (
										<Button
											type="button"
											variant="ghost"
											size="sm"
											aria-describedby={nameId}
											aria-disabled={off || undefined}
											onClick={() => ungroup(row.id)}
										>
											<Ungroup aria-hidden="true" />
											Remove from this tattoo
										</Button>
									)}
									<Button
										ref={remember(keyOf(row.id, "delete"))}
										type="button"
										variant="ghost"
										size="sm"
										className="text-muted-foreground hover:text-destructive"
										aria-describedby={nameId}
										disabled={held}
										onClick={() => setAsking(row.id)}
									>
										<Trash2 aria-hidden="true" />
										{video?.state === "failed" ? "Remove" : "Delete"}
									</Button>
								</div>
							)}

							{editing === row.id && (
								<AltForm
									id={`${id}-${row.id}-alt`}
									label={`Description of ${noun} ${n}`}
									initial={row.alt ?? ""}
									error={altError}
									busy={busy}
									held={held}
									onSave={(alt) => saveAlt(row.id, alt)}
									onCancel={() => {
										returnTo.current = keyOf(row.id, "edit");
										setEditing(null);
										setAltError(null);
									}}
								/>
							)}

							{asking === row.id && (
								<fieldset className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3">
									<legend className="sr-only">
										Delete {noun} {n}
									</legend>
									<p
										id={`${id}-${row.id}-question`}
										className="text-sm font-medium"
									>
										{video?.state === "failed"
											? DELETE_FAILED_VIDEO_QUESTION
											: video
												? DELETE_VIDEO_QUESTION
												: DELETE_ANGLE_QUESTION}
									</p>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant="destructive"
											size="sm"
											aria-describedby={`${id}-${row.id}-question`}
											aria-disabled={off || undefined}
											onClick={() => remove(row.id)}
										>
											{busy
												? "Deleting…"
												: video?.state === "failed"
													? "Remove video"
													: `Delete ${noun}`}
										</Button>
										<Button
											ref={keep}
											type="button"
											variant="outline"
											size="sm"
											disabled={busy}
											onClick={() => {
												returnTo.current = keyOf(row.id, "delete");
												setAsking(null);
											}}
										>
											Keep it
										</Button>
									</div>
								</fieldset>
							)}
						</li>
					);
				})}
			</ol>
			<div className="flex flex-col items-start gap-1">
				<Button
					type="button"
					variant="outline"
					// aria-disabled, not disabled: it keeps focus when the upload it
					// opened closes on a full tattoo.
					aria-disabled={held || room <= 0 || undefined}
					aria-describedby={room <= 0 ? `${id}-full` : undefined}
					onClick={(event) => {
						if (!held && room > 0) onAddPhotos(event.currentTarget);
					}}
				>
					<ImagePlus aria-hidden="true" />
					Add photos or videos to this tattoo
				</Button>
				{room <= 0 && (
					<p id={`${id}-full`} className="text-xs text-muted-foreground">
						A tattoo has up to {MAX_TATTOO_PHOTOS} photos and videos. Remove one
						to add another.
					</p>
				)}
			</div>
		</section>
	);
}

/** One other photo's description, edited in its row: one line, up to 200 characters. */
function AltForm({
	id,
	label,
	initial,
	error,
	busy,
	held,
	onSave,
	onCancel,
}: {
	id: string;
	label: string;
	initial: string;
	error: string | null;
	busy: boolean;
	held: boolean;
	onSave: (alt: string) => void;
	onCancel: () => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<form
			className="flex flex-col gap-2"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				if (!busy && !held) onSave(value.trim());
			}}
		>
			<label htmlFor={id} className="text-xs font-medium">
				{label} (optional)
			</label>
			<Input
				id={id}
				autoFocus
				value={value}
				dir="auto"
				maxLength={MAX_PHOTO_ALT}
				autoComplete="off"
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? `${id}-error` : undefined}
				onChange={(event) => setValue(event.currentTarget.value)}
			/>
			{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					size="sm"
					// aria-disabled, like the row's other buttons: a refusal must not
					// leave focus on a disabled button, which drops it.
					aria-disabled={busy || held || undefined}
				>
					{busy ? "Saving…" : "Save description"}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
