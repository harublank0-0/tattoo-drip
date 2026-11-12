import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { fill } from "../intake/template.ts";
import {
	indexAfterClose,
	keyStep,
	type Swipe,
	selectIndex,
	stepTo,
	swipeEnd,
	swipeStart,
} from "./angles-model.ts";
import { studioCopy } from "./copy.ts";
import {
	artworkShapeClass,
	type GalleryPhotoView,
	tattooShots,
} from "./gallery.ts";
import { showPhoto } from "./lightbox.ts";

/**
 * Angles: one tattoo shown with several photos (its main photo and up to
 * seven more of the same piece). The stateful islands that step through them,
 * next to paging.tsx's: the components under src/studio/components hold no
 * state, so they hand a tattoo with angles to these and render a tattoo of
 * one photo exactly as before. No DOM access and no listeners here: React's
 * own handlers, and lightbox.ts's showPhoto to open the viewer.
 *
 * The viewer (TattooDialog) is the same browser `<dialog>` as every photo's,
 * with the same Close form and history entry; inside it Previous and Next
 * (48 px, aria-disabled at the ends so focus stays on them), the arrow keys
 * and a horizontal swipe on the photo step through the tattoo (each held at
 * the ends), and the bar
 * says "Photo 2 of 4" in a polite live region, so each step is announced.
 * The tattoo's page (TattooFigure) shows the photo shown in the viewer, in
 * the main photo's own box (artworkShapeClass: an angle of another shape is
 * fitted whole inside it, never cropped, and nothing below it moves), with a
 * row of the tattoo's photos under it: buttons of at least 44 px, each named
 * by its photo's alt (the studio's description, else "Tattoo by Sita Rai,
 * photo 2 of 4"), `aria-current` on the one shown. Nothing moves or
 * fades, so there is nothing for `prefers-reduced-motion` to stop. The
 * rules are plain functions in angles-model.ts, tested without a DOM.
 */

/**
 * A tattoo's viewer: its photos one at a time, in order. `index` and
 * `onIndex` share the photo shown with the tattoo's page (TattooFigure), so
 * the viewer opens on the photo the page shows and the page shows the last
 * one viewed; a grid's viewer keeps its own and goes back to the main photo
 * when it closes, so it always opens on it (indexAfterClose). `facts` are
 * the tattoo's (whose, its styles, healed), the same for every photo; the
 * caption is each photo's own description, and the dialog is named by the
 * photo shown (its alt).
 *
 * The photo sits in a stage of a fixed height (styles.css, `.work-stage`),
 * contained whole inside it, so Previous and Next under it never move
 * whatever the shapes of the photos: repeated taps land on the same place.
 * Only the bare arrow keys step (keyStep: Alt+Left is still Back), and only
 * the primary pointer swipes, so a second finger pinching to zoom
 * (`touch-action: pan-y pinch-zoom`) never steps.
 */
export function TattooDialog({
	photo,
	facts,
	index,
	onIndex,
}: {
	photo: GalleryPhotoView;
	facts: ReactNode;
	index?: number;
	onIndex?: (index: number) => void;
}) {
	const [own, setOwn] = useState(0);
	const shots = tattooShots(photo);
	const count = shots.length;
	const shared = index !== undefined;
	const at = selectIndex(index ?? own, count);
	const go = onIndex ?? setOwn;
	const shot = shots[at];
	const swipe = useRef<Swipe>(null);

	const step = (delta: number) => {
		const next = stepTo(at, delta, count);
		if (next !== at) go(next);
	};

	return (
		<dialog
			id={photo.dialogId}
			className="work-dialog work-dialog-tattoo"
			aria-label={shot.alt}
			onKeyDown={(event) => {
				const delta = keyStep(event);
				if (delta === 0) return;
				event.preventDefault();
				step(delta);
			}}
			onClose={() => {
				if (!shared) setOwn(indexAfterClose(at, shared));
			}}
		>
			<form method="dialog" className="work-dialog-bar">
				<p aria-live="polite">
					{fill(studioCopy.work.photoOf, { n: at + 1, count })}
				</p>
				<button type="submit" className="action action-secondary">
					{studioCopy.work.close}
				</button>
			</form>
			<div className="work-stage">
				{/* One element for every step: the browser keeps the last photo up until the next has loaded. */}
				<img
					className="work-large"
					src={shot.largeSrc}
					width={shot.width}
					height={shot.height}
					alt={shot.alt}
					loading="lazy"
					decoding="async"
					// A mouse drag would start the browser's image drag and never end
					// in a pointerup: the swipe is ours.
					draggable={false}
					onPointerDown={(event: PointerEvent<HTMLImageElement>) => {
						swipe.current = swipeStart(event);
					}}
					onPointerUp={(event: PointerEvent<HTMLImageElement>) => {
						const delta = swipeEnd(swipe.current, event);
						swipe.current = null;
						if (delta !== 0) step(delta);
					}}
					onPointerCancel={() => {
						swipe.current = null;
					}}
				/>
			</div>
			<div className="work-steps">
				<button
					type="button"
					className="action action-secondary"
					aria-disabled={at === 0 ? true : undefined}
					onClick={() => step(-1)}
				>
					{studioCopy.work.previous}
				</button>
				<button
					type="button"
					className="action action-secondary"
					aria-disabled={at === count - 1 ? true : undefined}
					onClick={() => step(1)}
				>
					{studioCopy.work.next}
				</button>
			</div>
			{shot.caption ? (
				<p className="work-dialog-caption user-text" dir="auto">
					{shot.caption}
				</p>
			) : null}
			{facts}
		</dialog>
	);
}

/**
 * A tattoo's own page, with angles: the photo shown (the main one first),
 * large and eager in the main photo's box, a button to the viewer as before,
 * then the row of the tattoo's photos, each a button that shows it here
 * (`aria-current` on the one shown). The viewer and the row share the photo
 * shown.
 */
export function TattooFigure({
	photo,
	sizes,
	className,
	facts,
}: {
	photo: GalleryPhotoView;
	sizes: string;
	className: string;
	facts: ReactNode;
}) {
	const [chosen, setChosen] = useState(0);
	const shots = tattooShots(photo);
	const count = shots.length;
	const at = selectIndex(chosen, count);
	const shot = shots[at];
	return (
		<figure className={className}>
			<button
				type="button"
				className="artwork-open"
				id={photo.openId}
				aria-haspopup="dialog"
				aria-controls={photo.dialogId}
				onClick={() => showPhoto(photo.dialogId)}
			>
				<img
					className={`artwork-photo artwork-photo-steady ${artworkShapeClass(photo)}`}
					src={shot.src}
					srcSet={shot.srcSet}
					sizes={shot.srcSet ? sizes : undefined}
					width={photo.width}
					height={photo.height}
					alt={shot.alt}
					loading="eager"
					decoding="async"
					fetchPriority={at === 0 ? "high" : undefined}
				/>
				<span className="artwork-open-hint">{studioCopy.work.enlarge}</span>
			</button>
			{/* biome-ignore lint/a11y/useSemanticElements: a row of buttons outside any form, named by its label; a fieldset would need a legend shown */}
			<div
				className="artwork-angles"
				role="group"
				aria-label={studioCopy.work.tattooPhotos}
			>
				{shots.map((thumb, index) => (
					<button
						// The photos never change order on the page: their place is their key.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						key={index}
						type="button"
						className="artwork-angle"
						aria-current={index === at ? "true" : undefined}
						onClick={() => setChosen(selectIndex(index, count))}
					>
						{/* The photo names its button: its description, else "Tattoo by Sita Rai, photo 2 of 4". */}
						<img
							src={thumb.src}
							srcSet={thumb.srcSet}
							sizes={thumb.srcSet ? "4rem" : undefined}
							width={thumb.width}
							height={thumb.height}
							alt={thumb.alt}
							loading="lazy"
							decoding="async"
						/>
					</button>
				))}
			</div>
			<TattooDialog
				photo={photo}
				facts={facts}
				index={at}
				onIndex={setChosen}
			/>
		</figure>
	);
}
