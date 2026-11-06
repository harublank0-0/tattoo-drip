import { Form } from "@adonisjs/inertia/react";
import { Link, router } from "@inertiajs/react";
import {
	ExternalLink,
	ImageOff,
	Pencil,
	Trash2,
	UserRound,
} from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { urlFor } from "~/client";
import { focusFirstInvalid } from "~/components/form_sheet";
import {
	HEALED_HELP,
	HEALED_LABEL,
	MAX_PHOTO_ALT,
	MAX_PHOTO_STYLES,
	STYLES_HELP,
} from "~/components/photos";
import {
	detailsTitle,
	HIDDEN_NOTE,
	type PortfolioPhoto,
	REMOVE_QUESTION,
	sizeText,
	statusText,
} from "~/components/portfolio";
import StylePicker from "~/components/style_picker";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "~/components/ui/sheet";

type Mode = "view" | "edit" | "remove";

/**
 * One work photo of the portfolio (Studio OS): a panel from the right on a
 * desktop (36rem), the whole screen on a phone. The large copy at its own
 * proportions (a failed load says so and keeps the link to the stored
 * image), "Open full size" in a new tab, then what the server stores about
 * it (artist, status, styles, healed, added, size, description) and the
 * two things a member may do: edit its details (description, styles and
 * healed, the tray's rules and route) and remove it (asked in the panel,
 * never in the browser's box). Both send `back`, so the server answers with
 * the portfolio as it was and the panel stays open on a save (the visit
 * keeps the page's state); a removed photo leaves the props and the page
 * closes the panel. Escape leaves the edit or the question first, and
 * nothing closes the panel while a request is out.
 */
export default function ArtworkDetails({
	photo,
	open,
	onOpenChange,
	tenantSlug,
	back,
	styleOptions,
	styleNames,
	fallbackFocus,
	held,
}: {
	photo: PortfolioPhoto | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tenantSlug: string;
	/** The portfolio's current address: where a write comes back to. */
	back: string;
	styleOptions: { slug: string; name: string }[];
	styleNames: Record<string, string>;
	/** Where focus goes when the photo's tile is gone (it was removed). */
	fallbackFocus: RefObject<HTMLElement | null>;
	/** An upload is going: a write here would cancel its visit. */
	held: boolean;
}) {
	const [mode, setMode] = useState<Mode>("view");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The photo it last showed, so it keeps its content while it closes.
	const [shown, setShown] = useState<PortfolioPhoto | null>(photo);
	useEffect(() => {
		if (photo) setShown(photo);
	}, [photo]);
	// Another photo: start from its details (state adjusted while rendering).
	const photoId = photo?.id;
	const [modeFor, setModeFor] = useState(photoId);
	if (photoId && photoId !== modeFor) {
		setModeFor(photoId);
		setMode("view");
		setError(null);
	}

	const current = photo ?? shown;
	return (
		<Sheet
			open={open && current !== null}
			onOpenChange={(next) => {
				if (!next && busy) return;
				onOpenChange(next);
			}}
		>
			<SheetContent
				side="right"
				busy={busy}
				overlayClassName="bg-background/30"
				className="w-full gap-0 p-0 sm:max-w-lg lg:max-w-xl"
				onEscapeKeyDown={(event) => {
					if (busy) {
						event.preventDefault();
						return;
					}
					if (mode !== "view") {
						event.preventDefault();
						setMode("view");
						setError(null);
					}
				}}
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					// Back to the photo's tile, or, when the photo is gone, the gallery.
					const tile = current
						? document.getElementById(`artwork-${current.id}`)
						: null;
					event.preventDefault();
					(tile ?? fallbackFocus.current)?.focus();
				}}
			>
				{current && (
					<Body
						key={current.id}
						photo={current}
						mode={mode}
						setMode={(next) => {
							setMode(next);
							setError(null);
						}}
						busy={busy}
						setBusy={setBusy}
						error={error}
						setError={setError}
						tenantSlug={tenantSlug}
						back={back}
						styleOptions={styleOptions}
						styleNames={styleNames}
						held={held}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}

function Body({
	photo,
	mode,
	setMode,
	busy,
	setBusy,
	error,
	setError,
	tenantSlug,
	back,
	styleOptions,
	styleNames,
	held,
}: {
	photo: PortfolioPhoto;
	mode: Mode;
	setMode: (mode: Mode) => void;
	busy: boolean;
	setBusy: (busy: boolean) => void;
	error: string | null;
	setError: (error: string | null) => void;
	tenantSlug: string;
	back: string;
	styleOptions: { slug: string; name: string }[];
	styleNames: Record<string, string>;
	held: boolean;
}) {
	const [failed, setFailed] = useState(false);
	const params = { tenant: tenantSlug, id: photo.id };
	const editButton = useRef<HTMLButtonElement>(null);
	const removeButton = useRef<HTMLButtonElement>(null);
	const keep = useRef<HTMLButtonElement>(null);
	const form = useRef<HTMLDivElement>(null);
	// Focus follows the mode: the question's safe answer takes it, so Enter at
	// once changes nothing; the form's first field; and back in the details,
	// the button that opened what just closed (a save, Cancel or Escape).
	const previous = useRef(mode);
	useEffect(() => {
		const was = previous.current;
		previous.current = mode;
		if (mode === "remove") keep.current?.focus();
		else if (mode === "edit") form.current?.querySelector("input")?.focus();
		else if (was === "edit") editButton.current?.focus();
		else if (was === "remove") removeButton.current?.focus();
	}, [mode]);

	const remove = () => {
		router.delete(
			`${urlFor("tenant.artists.photos.destroy", params)}?back=${encodeURIComponent(back)}`,
			{
				preserveScroll: true,
				preserveState: true,
				onStart: () => setBusy(true),
				onSuccess: (page) => {
					const flash = page.flash as { error?: string } | undefined;
					if (flash?.error) setError(flash.error);
				},
				onFinish: () => setBusy(false),
			},
		);
	};

	return (
		<div className="flex flex-col">
			<div className="flex flex-col gap-1 border-b px-5 pt-5 pr-14 pb-4">
				<SheetTitle className="text-lg leading-snug font-semibold wrap-anywhere">
					{detailsTitle(photo)}
				</SheetTitle>
				<SheetDescription className="text-sm text-muted-foreground">
					{photo.artistName}, added {photo.addedText}
				</SheetDescription>
			</div>

			<figure className="flex flex-col gap-2 border-b bg-muted/40 px-5 py-4">
				{failed ? (
					<div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
						<ImageOff aria-hidden="true" className="size-6" />
						This image couldn't load.
					</div>
				) : (
					<img
						src={photo.largeUrl}
						srcSet={photo.srcSet}
						sizes="(min-width: 1024px) 34rem, (min-width: 640px) 30rem, 100vw"
						alt={photo.alt ?? ""}
						width={photo.width}
						height={photo.height}
						decoding="async"
						onError={() => setFailed(true)}
						className="mx-auto max-h-[55dvh] w-auto max-w-full rounded-md object-contain"
					/>
				)}
				<figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
					<span className="tabular-nums">
						{sizeText(photo.width, photo.height)}
					</span>
					<a
						href={photo.fullUrl}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						<ExternalLink aria-hidden="true" />
						Open full size
						<span className="sr-only"> (opens in a new tab)</span>
					</a>
				</figcaption>
			</figure>

			{error && (
				<p
					role="alert"
					className="mx-5 mt-4 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			)}

			{mode === "edit" ? (
				<div ref={form} className="px-5 py-5">
					<EditForm
						photo={photo}
						params={params}
						back={back}
						styleOptions={styleOptions}
						held={held}
						onBusy={setBusy}
						onSaved={() => setMode("view")}
						onInvalid={() => focusFirstInvalid(form.current)}
						onCancel={() => setMode("view")}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-5 px-5 py-5">
					<dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-3 text-sm">
						<dt className="text-muted-foreground">Artist</dt>
						<dd className="font-medium wrap-anywhere">{photo.artistName}</dd>
						<dt className="text-muted-foreground">Status</dt>
						<dd className="flex flex-col items-start gap-1">
							<Badge variant={photo.shown ? "secondary" : "outline"}>
								{statusText(photo.shown)}
							</Badge>
							{!photo.shown && (
								<span className="text-xs text-muted-foreground">
									{HIDDEN_NOTE}
								</span>
							)}
						</dd>
						<dt className="text-muted-foreground">Styles</dt>
						<dd>
							{photo.styles.length > 0 ? (
								photo.styles.map((slug) => styleNames[slug] ?? slug).join(", ")
							) : (
								<span className="text-muted-foreground">None</span>
							)}
						</dd>
						<dt className="text-muted-foreground">Healed</dt>
						<dd>{photo.healed ? "Yes, the photo shows it healed" : "No"}</dd>
						<dt className="text-muted-foreground">Added</dt>
						<dd className="tabular-nums">{photo.addedText}</dd>
						<dt className="text-muted-foreground">Description</dt>
						<dd className="wrap-anywhere" dir="auto">
							{photo.alt ?? (
								<span className="text-muted-foreground">
									None. Your page then calls it &ldquo;Tattoo by{" "}
									{photo.artistName}&rdquo;.
								</span>
							)}
						</dd>
					</dl>

					{mode === "remove" ? (
						<div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4">
							<p className="text-sm font-medium" id="remove-question">
								{REMOVE_QUESTION}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									type="button"
									variant="destructive"
									disabled={busy || held}
									aria-describedby="remove-question"
									onClick={remove}
								>
									{busy ? "Removing…" : "Remove photo"}
								</Button>
								<Button
									ref={keep}
									type="button"
									variant="outline"
									disabled={busy}
									onClick={() => setMode("view")}
								>
									Keep it
								</Button>
							</div>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								ref={editButton}
								type="button"
								onClick={() => setMode("edit")}
							>
								<Pencil aria-hidden="true" />
								Edit details
							</Button>
							<Link
								href={urlFor("tenant.artists.edit", {
									tenant: tenantSlug,
									id: photo.artistId,
								})}
								className={buttonVariants({ variant: "outline" })}
							>
								<UserRound aria-hidden="true" />
								Artist profile
							</Link>
							<Button
								ref={removeButton}
								type="button"
								variant="ghost"
								className="ml-auto text-muted-foreground hover:text-destructive"
								disabled={held}
								onClick={() => setMode("remove")}
							>
								<Trash2 aria-hidden="true" />
								Remove
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * The photo's details, the tray's form and route (`tenant.artists.photos.update`)
 * with `back`. Keyed by the stored values, so a save shows what was kept and
 * a refusal keeps what was typed.
 */
function EditForm({
	photo,
	params,
	back,
	styleOptions,
	held,
	onBusy,
	onSaved,
	onInvalid,
	onCancel,
}: {
	photo: PortfolioPhoto;
	params: { tenant: string; id: string };
	back: string;
	styleOptions: { slug: string; name: string }[];
	held: boolean;
	onBusy: (busy: boolean) => void;
	onSaved: () => void;
	onInvalid: () => void;
	onCancel: () => void;
}) {
	const [styles, setStyles] = useState(photo.styles);
	const [healed, setHealed] = useState(photo.healed);
	const altId = `artwork-alt-${photo.id}`;
	return (
		<Form
			key={`${photo.id}:${photo.alt ?? ""}:${photo.styles.join(",")}:${photo.healed}`}
			route="tenant.artists.photos.update"
			routeParams={params}
			options={{ preserveScroll: true, preserveState: true }}
			onStart={() => onBusy(true)}
			onSuccess={onSaved}
			onError={onInvalid}
			onFinish={() => onBusy(false)}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<input type="hidden" name="back" value={back} />
					<Field data-invalid={!!errors.alt}>
						<FieldLabel htmlFor={altId}>Description (optional)</FieldLabel>
						<Input
							id={altId}
							name="alt"
							dir="auto"
							maxLength={MAX_PHOTO_ALT}
							defaultValue={photo.alt ?? ""}
							autoComplete="off"
							aria-invalid={!!errors.alt}
							aria-describedby={
								errors.alt ? `${altId}-help ${altId}-error` : `${altId}-help`
							}
						/>
						<FieldDescription id={`${altId}-help`}>
							What the photo shows, read aloud to clients who can&apos;t see it.
							For example: Koi fish on the forearm, black and grey.
						</FieldDescription>
						{errors.alt && (
							<FieldError id={`${altId}-error`}>{errors.alt}</FieldError>
						)}
					</Field>

					<StylePicker
						idPrefix={`artwork-style-${photo.id}`}
						name="styles"
						options={styleOptions}
						value={styles}
						onChange={setStyles}
						max={MAX_PHOTO_STYLES}
						help={STYLES_HELP}
						error={errors.styles}
					/>

					<Field orientation="horizontal" className="min-h-11 items-center">
						<Checkbox
							id={`artwork-healed-${photo.id}`}
							name="healed"
							value="1"
							checked={healed}
							onCheckedChange={(next) => setHealed(next === true)}
							aria-describedby={`artwork-healed-help-${photo.id}`}
						/>
						<FieldContent>
							<FieldLabel
								htmlFor={`artwork-healed-${photo.id}`}
								className="font-normal"
							>
								{HEALED_LABEL}
							</FieldLabel>
							<FieldDescription id={`artwork-healed-help-${photo.id}`}>
								{HEALED_HELP}
							</FieldDescription>
						</FieldContent>
					</Field>

					<div className="flex flex-wrap gap-2">
						<Button type="submit" disabled={processing || held}>
							{processing ? "Saving…" : "Save details"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={processing}
							onClick={onCancel}
						>
							Cancel
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}
