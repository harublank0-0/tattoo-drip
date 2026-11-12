import { router } from "@inertiajs/react";
import {
	ArrowDown,
	ArrowUp,
	ImagePlus,
	Pencil,
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
	MAX_TATTOO_PHOTOS,
	mainFirst,
	movedOrder,
	movePhotoLabel,
	type PortfolioPhoto,
	photoTotal,
	TATTOO_PHOTOS_NOTE,
	tattooPhotoName,
} from "~/components/portfolio";
import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/** One row of the list: the main photo or one of the others, as the panel draws it. */
type Row = {
	id: string;
	alt: string | null;
	thumbUrl: string;
	width: number;
	height: number;
};

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
 * "Add photos to this tattoo" opens the upload panel for this tattoo, while
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
	/** A photo is about to become the main one: the page follows it. */
	onFollow: (id: string) => void;
	onAddPhotos: () => void;
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
			alt: photo.alt,
			thumbUrl: photo.src,
			width: photo.width,
			height: photo.height,
		},
		...photo.angles,
	];
	const ids = rows.map((row) => row.id);
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
		if (order[0] !== photo.id) onFollow(order[0]);
		refocus.current = focus;
		router.put(
			urlFor("tenant.artists.photos.order", {
				tenant: tenantSlug,
				id: photo.id,
			}),
			{ ids: order, back },
			visit,
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
			`${urlFor("tenant.artists.photos.destroy", { tenant: tenantSlug, id: rowId })}?back=${encodeURIComponent(back)}`,
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
					Photos of this tattoo
					<span className="font-normal text-muted-foreground tabular-nums">
						{" "}
						({rows.length} of {MAX_TATTOO_PHOTOS})
					</span>
				</h3>
				<p className="text-xs text-muted-foreground">{TATTOO_PHOTOS_NOTE}</p>
			</div>
			<ol className="flex flex-col divide-y rounded-lg border">
				{rows.map((row, index) => {
					const n = index + 1;
					const name = tattooPhotoName(row.alt, n);
					const nameId = `${id}-${row.id}-name`;
					return (
						<li key={row.id} className="flex flex-col gap-2 p-3">
							<div className="flex items-start gap-3">
								<img
									src={row.thumbUrl}
									alt=""
									width={row.width}
									height={row.height}
									loading="lazy"
									decoding="async"
									className="size-16 shrink-0 rounded-md bg-muted object-contain"
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-0.5">
									<p id={nameId} className="text-sm font-medium">
										{index === 0 ? "Main photo" : `Photo ${n}`}
									</p>
									<p
										className="text-xs text-muted-foreground wrap-anywhere"
										dir="auto"
									>
										{row.alt ?? "No description"}
									</p>
								</div>
								{rows.length > 1 && (
									<div className="flex shrink-0 gap-1">
										{(["up", "down"] as const).map((direction) => (
											<Button
												key={direction}
												ref={remember(keyOf(row.id, direction))}
												type="button"
												variant="outline"
												size="icon"
												aria-label={movePhotoLabel(name, direction)}
												disabled={!canMove(index, rows.length, direction)}
												aria-disabled={off || undefined}
												onClick={() =>
													sendOrder(movedOrder(ids, index, direction), {
														id: row.id,
														button: direction,
													})
												}
											>
												{direction === "up" ? (
													<ArrowUp aria-hidden="true" />
												) : (
													<ArrowDown aria-hidden="true" />
												)}
											</Button>
										))}
									</div>
								)}
							</div>

							{index > 0 && editing !== row.id && asking !== row.id && (
								<div className="flex flex-wrap gap-1">
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
										Delete
									</Button>
								</div>
							)}

							{editing === row.id && (
								<AltForm
									id={`${id}-${row.id}-alt`}
									label={`Description of photo ${n}`}
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
									<legend id={`${id}-${row.id}-question`} className="sr-only">
										Delete photo {n}
									</legend>
									<p className="text-sm font-medium">{DELETE_ANGLE_QUESTION}</p>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant="destructive"
											size="sm"
											aria-describedby={`${id}-${row.id}-question`}
											aria-disabled={off || undefined}
											onClick={() => remove(row.id)}
										>
											{busy ? "Deleting…" : "Delete photo"}
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
					disabled={room <= 0}
					aria-disabled={held || undefined}
					aria-describedby={room <= 0 ? `${id}-full` : undefined}
					onClick={() => {
						if (!held) onAddPhotos();
					}}
				>
					<ImagePlus aria-hidden="true" />
					Add photos to this tattoo
				</Button>
				{room <= 0 && (
					<p id={`${id}-full`} className="text-xs text-muted-foreground">
						A tattoo has up to {MAX_TATTOO_PHOTOS} photos. Remove one to add
						another.
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
				onSave(value.trim());
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
					disabled={busy}
					aria-disabled={held || undefined}
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
