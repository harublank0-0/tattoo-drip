import { router } from "@inertiajs/react";
import { ArrowRightLeft, Eye, EyeOff, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	BULK_BUSY,
	type BulkAction,
	deleteQuestion,
	type PortfolioArtist,
	type PortfolioPhoto,
	selectedText,
	stillUnchanged,
} from "~/components/portfolio";
import { Button } from "~/components/ui/button";

/**
 * The bar of the portfolio's selection (Studio OS): how many are selected,
 * select the whole page or none, and what can be done to them: Publish or
 * Unpublish (each only when some selected photo would change), Move to
 * another artist (owners, with two or more artists) and Delete, which asks
 * in the bar first ("Keep them" takes focus; Escape keeps them). One
 * request (`tenant.portfolio.bulk`) checks and changes each photo on its own
 * and answers with what it did, as a toast; when some photos were not
 * changed the bar says so too (`role="alert"`) and they stay selected
 * (`stillUnchanged`), so they can be tried again. It sticks to the bottom
 * of the screen, above the phone's tab bar and the home indicator. Every
 * control is a real button, 44 px tall below `lg`.
 */
export default function PortfolioBulkBar({
	tenantSlug,
	selectedIds,
	photos,
	artists,
	isOwner,
	back,
	held,
	onSelectAll,
	onClear,
	onDone,
}: {
	tenantSlug: string;
	selectedIds: string[];
	photos: PortfolioPhoto[];
	artists: PortfolioArtist[];
	isOwner: boolean;
	back: string;
	/** An upload is going: a request here would cancel its visit. */
	held: boolean;
	onSelectAll: () => void;
	onClear: () => void;
	/** What stays selected after a change: the photos it didn't change. */
	onDone: (remaining: string[]) => void;
}) {
	const id = useId();
	const [busy, setBusy] = useState<BulkAction | null>(null);
	const [asking, setAsking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [moveTo, setMoveTo] = useState("");
	const keep = useRef<HTMLButtonElement>(null);
	const deleteButton = useRef<HTMLButtonElement>(null);

	const chosen = photos.filter((photo) => selectedIds.includes(photo.id));
	const anyUnpublished = chosen.some((photo) => !photo.published);
	const anyPublished = chosen.some((photo) => photo.published);
	const canMove = isOwner && artists.length > 1;
	const count = selectedIds.length;
	const off = busy !== null || held || count === 0;

	useEffect(() => {
		if (asking) keep.current?.focus();
	}, [asking]);
	// A new selection is a new question.
	useEffect(() => {
		if (count === 0) setAsking(false);
	}, [count]);

	const run = (action: BulkAction) => {
		if (off) return;
		// Publish sends only the unpublished ones and Unpublish the published
		// ones, so the answer counts what really changed.
		const ids =
			action === "publish"
				? chosen.filter((photo) => !photo.published).map(({ id }) => id)
				: action === "unpublish"
					? chosen.filter((photo) => photo.published).map(({ id }) => id)
					: action === "reassign"
						? chosen
								.filter((photo) => photo.artistId !== moveTo)
								.map(({ id }) => id)
						: [...selectedIds];
		if (ids.length === 0) return;
		const artistId = action === "reassign" ? moveTo : null;
		setError(null);
		router.post(
			urlFor("tenant.portfolio.bulk", { tenant: tenantSlug }),
			{ action, ids, back, ...(artistId ? { artistId } : {}) },
			{
				preserveScroll: true,
				preserveState: true,
				onStart: () => setBusy(action),
				onSuccess: (page) => {
					const flash = page.flash as { error?: string } | undefined;
					const next =
						(page.props as { photos?: PortfolioPhoto[] }).photos ?? [];
					setError(flash?.error ?? null);
					onDone(stillUnchanged(action, ids, next, artistId));
				},
				onError: (errors) => {
					setError(
						errors.artistId ??
							errors.ids ??
							errors.action ??
							"That didn't work. Try again.",
					);
				},
				onFinish: () => {
					setBusy(null);
					setAsking(false);
				},
			},
		);
	};

	return (
		<section
			aria-label="Selected photos"
			className="sticky bottom-[calc(var(--shell-tab-bar)+env(safe-area-inset-bottom)+0.5rem)] z-30 flex flex-col gap-3 rounded-lg border bg-elevated p-3 shadow-lg lg:bottom-4"
		>
			<div className="flex flex-wrap items-center gap-2">
				<output className="text-sm font-medium tabular-nums" aria-live="polite">
					{selectedText(count)}
				</output>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy !== null}
					onClick={onSelectAll}
				>
					Select page
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy !== null || count === 0}
					onClick={onClear}
				>
					<X aria-hidden="true" />
					Clear
				</Button>
			</div>

			{asking ? (
				<fieldset
					className="flex min-w-0 flex-col gap-2"
					onKeyDown={(event) => {
						if (event.key === "Escape" && busy === null) {
							event.stopPropagation();
							setAsking(false);
							requestAnimationFrame(() => deleteButton.current?.focus());
						}
					}}
				>
					<legend id={`${id}-question`} className="mb-2 text-sm font-medium">
						{deleteQuestion(count)}
					</legend>
					<div className="flex flex-wrap gap-2">
						<Button
							type="button"
							variant="destructive"
							aria-describedby={`${id}-question`}
							disabled={off}
							onClick={() => run("delete")}
						>
							{busy === "delete"
								? BULK_BUSY.delete
								: `Delete ${count === 1 ? "photo" : `${count} photos`}`}
						</Button>
						<Button
							ref={keep}
							type="button"
							variant="outline"
							disabled={busy !== null}
							onClick={() => {
								setAsking(false);
								requestAnimationFrame(() => deleteButton.current?.focus());
							}}
						>
							Keep {count === 1 ? "it" : "them"}
						</Button>
					</div>
				</fieldset>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					{anyUnpublished && (
						<Button
							type="button"
							size="sm"
							disabled={off}
							onClick={() => run("publish")}
						>
							<Eye aria-hidden="true" />
							{busy === "publish" ? BULK_BUSY.publish : "Publish"}
						</Button>
					)}
					{anyPublished && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={off}
							onClick={() => run("unpublish")}
						>
							<EyeOff aria-hidden="true" />
							{busy === "unpublish" ? BULK_BUSY.unpublish : "Unpublish"}
						</Button>
					)}
					{canMove && (
						<div className="flex items-center gap-1.5">
							<label htmlFor={`${id}-move`} className="sr-only">
								Move the selected photos to
							</label>
							<select
								id={`${id}-move`}
								value={moveTo}
								disabled={busy !== null}
								onChange={(event) => setMoveTo(event.currentTarget.value)}
								className="h-8 min-w-0 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11"
							>
								<option value="">Move to artist…</option>
								{artists.map((artist) => (
									<option key={artist.id} value={artist.id}>
										{artist.name} ({artist.photoCount})
									</option>
								))}
							</select>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={off || moveTo === ""}
								onClick={() => run("reassign")}
							>
								<ArrowRightLeft aria-hidden="true" />
								{busy === "reassign" ? BULK_BUSY.reassign : "Move"}
							</Button>
						</div>
					)}
					<Button
						ref={deleteButton}
						type="button"
						size="sm"
						variant="ghost"
						className="text-muted-foreground hover:text-destructive sm:ml-auto"
						disabled={off}
						onClick={() => setAsking(true)}
					>
						<Trash2 aria-hidden="true" />
						Delete
					</Button>
				</div>
			)}

			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error} The photos that weren&apos;t changed are still selected.
				</p>
			)}
		</section>
	);
}
