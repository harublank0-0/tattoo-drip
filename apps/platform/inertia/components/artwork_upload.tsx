import { router } from "@inertiajs/react";
import { cn } from "cn";
import { ChevronDown, ImagePlus, RotateCcw, X } from "lucide-react";
import {
	type DragEvent,
	type FormEvent,
	type RefObject,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { urlFor } from "~/client";
import { FileLabel, FileThumb, useObjectUrls } from "~/components/file_preview";
import {
	HEALED_HELP,
	HEALED_LABEL,
	MAX_PHOTO_ALT,
	MAX_PHOTO_STYLES,
	PHOTO_ACCEPT,
	trackUpload,
	type UploadOutcome,
} from "~/components/photos";
import {
	ADD_TO_TATTOO_INTRO,
	DROP_HINT,
	fileKey,
	fileProblem,
	MAX_TATTOO_PHOTOS,
	type PortfolioArtist,
	type PortfolioPhoto,
	photoTotal,
	STYLES_LIMIT_NOTE,
	tattooUploadProblem,
	UPLOAD_INTRO,
	uploadButton,
	uploadProblem,
} from "~/components/portfolio";
import StylePicker from "~/components/style_picker";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "~/components/ui/sheet";

/** One chosen file and where it is. Only `ready` and `failed` ones are sent. */
type Item = {
	key: string;
	file: File;
	previewUrl: string;
	alt: string;
	/**
	 * `unsure`: its request was cut off, and the server may have stored it
	 * anyway (a cancelled visit only stops the browser waiting), so it is not
	 * sent again unless asked ("Send again"), which would add it twice.
	 */
	state: "ready" | "invalid" | "sending" | "failed" | "unsure";
	message?: string;
	percentage?: number;
};

/**
 * Sends one photo as its own request with the upload's details and says how
 * it ended (`trackUpload`: anything but a clear answer is a refusal). The
 * visit keeps the page's state, so this sheet and its list stay as they are
 * while the gallery's props change under them.
 */
function sendPhoto(
	url: string,
	data: Record<string, string | string[] | File>,
	onPercentage: (percentage: number | undefined) => void,
): Promise<UploadOutcome> {
	return new Promise((resolve) => {
		const upload = trackUpload();
		router.post(url, data, {
			forceFormData: true,
			preserveScroll: true,
			preserveState: true,
			onProgress: (event) => onPercentage(event?.percentage),
			...upload.callbacks,
			onFinish: () => resolve(upload.outcome()),
		});
	});
}

/**
 * The portfolio's upload (Studio OS), in a panel from the right (the whole
 * screen on a phone): drop photos or choose them, see each one, give each a
 * description if you like, pick whose work it is and, under "Styles and
 * healed", the styles and the healed mark for all of them. The photos go one
 * request each, in order, to the artist's work photo route (the server
 * checks the file, the artist and the room again): one photo per request
 * keeps each under the 20 MB limit, and Inertia would cancel overlapping
 * visits anyway. A wrong file is named before anything is sent and never
 * goes; a refused one stays in the list with the server's reason and goes
 * again with the next Upload; an added one leaves the list. Nothing typed
 * is lost by a refusal. Each answer is the portfolio for that artist, newest
 * first (`back`), so the new work is at the top. The panel can't be closed
 * while a photo is going, and `onBusyChange` holds the details panel's
 * writes, which would cancel the upload's visit.
 *
 * With `lead` (angles: the details panel's "Add photos to this tattoo") the
 * same panel adds the photos to that tattoo instead: its artist is fixed, the
 * styles, healed and publish fields are gone (the tattoo's apply), each
 * request carries `lead`, the room is the tattoo's (eight photos) and the
 * artist's, and every answer is the portfolio as it was (`lead.back`), so
 * the details panel behind stays on the tattoo, its new photos listed.
 */
export default function ArtworkUpload({
	open,
	onOpenChange,
	tenantSlug,
	artists,
	defaultArtistId,
	styleOptions,
	maxPhotos,
	backFor,
	lead = null,
	onBusyChange,
	returnFocus,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tenantSlug: string;
	artists: PortfolioArtist[];
	defaultArtistId: string | null;
	styleOptions: { slug: string; name: string }[];
	maxPhotos: number;
	/** The portfolio's address that shows `artistId`'s newest work. */
	backFor: (artistId: string) => string;
	/** The tattoo to add photos to, with the address to come back to; null for new work. */
	lead?: (PortfolioPhoto & { back: string }) | null;
	onBusyChange: (busy: boolean) => void;
	/** The button that opened the panel ("Upload artwork", or the tattoo's "Add photos"): focus goes back to it. */
	returnFocus?: RefObject<HTMLElement | null>;
}) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [items, setItems] = useState<Item[]>([]);
	const [artistId, setArtistId] = useState<string>(defaultArtistId ?? "");
	const [styles, setStyles] = useState<string[]>([]);
	const [healed, setHealed] = useState(false);
	const [publish, setPublish] = useState(true);
	const [sending, setSending] = useState<{
		index: number;
		total: number;
		percentage?: number;
	} | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	const [summary, setSummary] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);

	// Opening again with another artist filter picks that artist, unless a list is waiting.
	useEffect(() => {
		if (open && items.length === 0 && defaultArtistId) {
			setArtistId(defaultArtistId);
		}
	}, [open, defaultArtistId, items.length]);

	// The previews are object URLs: let go with each item and with the panel.
	const previews = useObjectUrls();

	const artist =
		artists.find((row) => row.id === (lead ? lead.artistId : artistId)) ?? null;
	const sendable = items.filter(
		(item) => item.state === "ready" || item.state === "failed",
	);
	const busy = sending !== null;

	const add = (files: FileList | File[] | null) => {
		if (!files || busy) return;
		setSummary(null);
		setProblem(null);
		// Built outside the state updater: it may run twice (StrictMode), and
		// each run would make object URLs that nothing revokes.
		const known = new Set(items.map(({ key }) => key));
		const added: Item[] = [];
		for (const file of Array.from(files)) {
			const key = fileKey(file);
			if (known.has(key)) continue;
			known.add(key);
			const wrong = fileProblem(file);
			const previewUrl = wrong ? "" : previews.create(file);
			added.push({
				key,
				file,
				previewUrl,
				alt: "",
				state: wrong ? "invalid" : "ready",
				message: wrong ?? undefined,
			});
		}
		setItems((current) => [...current, ...added]);
	};

	const drop = (key: string) => {
		setItems((current) => {
			previews.revoke(current.find((item) => item.key === key)?.previewUrl);
			return current.filter((item) => item.key !== key);
		});
		setProblem(null);
	};

	const update = (key: string, change: Partial<Item>) =>
		setItems((current) =>
			current.map((item) => (item.key === key ? { ...item, ...change } : item)),
		);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		const blocked = lead
			? tattooUploadProblem(
					sendable.length,
					photoTotal(lead),
					artist,
					maxPhotos,
				)
			: uploadProblem(artist, sendable.length, maxPhotos);
		setProblem(blocked);
		setSummary(null);
		if (blocked || !artist) return;

		const url = urlFor("tenant.artists.photos.store", {
			tenant: tenantSlug,
			id: artist.id,
		});
		const back = lead ? lead.back : backFor(artist.id);
		const queue = [...sendable];
		let added = 0;
		let refused = 0;
		onBusyChange(true);
		for (const [index, item] of queue.entries()) {
			const position = { index: index + 1, total: queue.length };
			setSending(position);
			update(item.key, { state: "sending", message: undefined, percentage: 0 });
			const data: Record<string, string | string[] | File> = {
				photo: item.file,
				back,
			};
			if (item.alt.trim()) data.alt = item.alt.trim();
			if (lead) {
				// The tattoo's state applies: only the photo and its description go.
				data.lead = lead.id;
			} else {
				if (styles.length > 0) data.styles = styles;
				if (healed) data.healed = "1";
				if (!publish) data.hidden = "1";
			}
			const outcome = await sendPhoto(url, data, (percentage) => {
				setSending({ ...position, percentage });
				update(item.key, { percentage });
			});
			if (outcome.kind === "added") {
				added += 1;
				drop(item.key);
			} else if (outcome.kind === "cancelled") {
				// The cut-off file may have gone through; the ones after it didn't.
				update(item.key, {
					state: "unsure",
					message:
						"The upload was interrupted while this photo was going, so it may have been added. Check the gallery before sending it again.",
					percentage: undefined,
				});
				for (const unsent of queue.slice(index + 1)) {
					update(unsent.key, {
						state: "failed",
						message: "Not sent: the upload was interrupted.",
						percentage: undefined,
					});
				}
				refused += queue.length - index;
				break;
			} else {
				refused += 1;
				update(item.key, {
					state: "failed",
					message: outcome.message,
					percentage: undefined,
				});
			}
		}
		onBusyChange(false);
		setSending(null);
		setSummary(
			[
				added > 0 ? `${added} ${added === 1 ? "photo" : "photos"} added.` : "",
				refused > 0
					? `${refused} ${refused === 1 ? "photo wasn't" : "photos weren't"} added: see the list, then upload again.`
					: "",
			]
				.filter(Boolean)
				.join(" "),
		);
		if (refused === 0 && added > 0) {
			// Everything went: the summary says so (the server sends no toast per
			// photo for the portfolio) and the gallery behind already shows them.
			// The next upload starts fresh, the artist kept.
			setStyles([]);
			setHealed(false);
		}
	};

	const onDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		setDragging(false);
		add(event.dataTransfer.files);
	};

	const artistField = `${id}-artist`;
	return (
		<Sheet
			open={open}
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
					if (busy) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					// Opened from code, not a Radix trigger: send focus back by hand.
					const from = returnFocus?.current;
					if (from?.isConnected) {
						event.preventDefault();
						from.focus();
					}
				}}
			>
				<div className="flex flex-col gap-1 border-b px-5 pt-5 pr-14 pb-4">
					<SheetTitle className="text-lg font-semibold">
						{lead ? "Add photos to this tattoo" : "Upload artwork"}
					</SheetTitle>
					<SheetDescription className="text-sm text-muted-foreground">
						{lead ? ADD_TO_TATTOO_INTRO : UPLOAD_INTRO}
					</SheetDescription>
				</div>

				<form
					className="flex flex-col gap-6 px-5 py-5"
					onSubmit={submit}
					noValidate
				>
					{lead ? (
						<div className="flex items-center gap-3 rounded-lg border p-3">
							<img
								src={lead.src}
								alt=""
								width={lead.width}
								height={lead.height}
								className="size-14 shrink-0 rounded-md bg-muted object-contain"
							/>
							<p className="min-w-0 text-sm">
								<span className="block font-medium wrap-anywhere">
									{lead.alt ?? `Work by ${lead.artistName}`}
								</span>
								<span className="text-muted-foreground">
									{lead.artistName}, {photoTotal(lead)} of {MAX_TATTOO_PHOTOS}{" "}
									photos
								</span>
							</p>
						</div>
					) : (
						<Field data-invalid={problem !== null && !artist}>
							<FieldLabel htmlFor={artistField}>Artist</FieldLabel>
							<select
								id={artistField}
								value={artistId}
								disabled={busy}
								onChange={(event) => {
									setArtistId(event.currentTarget.value);
									setProblem(null);
								}}
								className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11"
							>
								<option value="" disabled>
									Choose whose work this is
								</option>
								{artists.map((row) => (
									<option key={row.id} value={row.id}>
										{row.name} ({row.photoCount} of {maxPhotos})
										{row.visible ? "" : ", hidden"}
									</option>
								))}
							</select>
							<FieldDescription>
								Each photo belongs to one artist, and shows on their page.
							</FieldDescription>
						</Field>
					)}

					{/* The drop zone. The button is the way in for a keyboard and a
					    screen reader; dropping is a shortcut for a mouse. */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: drag and drop only; the button inside is the control */}
					<div
						onDragOver={(event) => {
							event.preventDefault();
							if (!busy) setDragging(true);
						}}
						onDragLeave={() => setDragging(false)}
						onDrop={onDrop}
						className={cn(
							"flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-150",
							dragging ? "border-brand bg-accent/60" : "bg-muted/30",
						)}
					>
						<ImagePlus
							aria-hidden="true"
							className="size-6 text-muted-foreground"
						/>
						<p className="hidden text-sm font-medium pointer-fine:block">
							Drop photos here
						</p>
						<input
							ref={input}
							type="file"
							multiple
							accept={PHOTO_ACCEPT}
							className="sr-only"
							tabIndex={-1}
							aria-hidden="true"
							onChange={(event) => {
								add(event.currentTarget.files);
								event.currentTarget.value = "";
							}}
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							aria-describedby={`${id}-hint`}
							onClick={() => input.current?.click()}
						>
							Choose photos
						</Button>
						<p id={`${id}-hint`} className="text-xs text-muted-foreground">
							{DROP_HINT}
						</p>
					</div>

					{items.length > 0 && (
						<ul
							aria-label="Photos to upload"
							className="flex flex-col divide-y rounded-lg border"
						>
							{items.map((item) => (
								<QueueRow
									key={item.key}
									item={item}
									busy={busy}
									onAlt={(alt) => update(item.key, { alt })}
									onRemove={() => drop(item.key)}
									onRetry={() =>
										update(item.key, {
											state: "failed",
											message: "Goes again with the next upload.",
										})
									}
								/>
							))}
						</ul>
					)}

					{!lead && (
						<details className="group rounded-lg border">
							<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
								<span>
									Styles and healed{" "}
									<span className="font-normal text-muted-foreground">
										(optional
										{styles.length > 0 || healed
											? `, ${[styles.length > 0 ? `${styles.length} ${styles.length === 1 ? "style" : "styles"}` : "", healed ? "healed" : ""].filter(Boolean).join(", ")}`
											: ""}
										)
									</span>
								</span>
								<ChevronDown
									aria-hidden="true"
									className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
								/>
							</summary>
							<div className="flex flex-col gap-4 border-t px-4 py-4">
								<StylePicker
									idPrefix={`${id}-style`}
									options={styleOptions}
									value={styles}
									onChange={setStyles}
									max={MAX_PHOTO_STYLES}
									help={STYLES_LIMIT_NOTE(MAX_PHOTO_STYLES)}
									disabled={busy}
								/>
								<Field
									orientation="horizontal"
									className="min-h-11 items-center"
								>
									<Checkbox
										id={`${id}-healed`}
										checked={healed}
										disabled={busy}
										onCheckedChange={(next) => setHealed(next === true)}
										aria-describedby={`${id}-healed-help`}
									/>
									<FieldContent>
										<FieldLabel
											htmlFor={`${id}-healed`}
											className="font-normal"
										>
											{HEALED_LABEL}
										</FieldLabel>
										<FieldDescription id={`${id}-healed-help`}>
											{HEALED_HELP}
										</FieldDescription>
									</FieldContent>
								</Field>
							</div>
						</details>
					)}

					{!lead && (
						<Field orientation="horizontal" className="min-h-11 items-center">
							<Checkbox
								id={`${id}-publish`}
								checked={publish}
								disabled={busy}
								onCheckedChange={(next) => setPublish(next === true)}
								aria-describedby={`${id}-publish-help`}
							/>
							<FieldContent>
								<FieldLabel htmlFor={`${id}-publish`} className="font-normal">
									Publish on your page
								</FieldLabel>
								<FieldDescription id={`${id}-publish-help`}>
									{publish
										? artist && !artist.visible
											? `Published, but shown only once ${artist.name} is on your page.`
											: "Clients see these photos on your page and in your gallery."
										: "Only the studio sees them until you publish them."}
								</FieldDescription>
							</FieldContent>
						</Field>
					)}

					<div className="flex flex-col gap-2">
						{problem && <FieldError>{problem}</FieldError>}
						<div className="flex flex-wrap gap-2">
							<Button type="submit" disabled={busy}>
								{uploadButton(sendable.length, sending)}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => onOpenChange(false)}
							>
								{items.length > 0 ? "Close, keep the list" : "Cancel"}
							</Button>
						</div>
						{/* Always on the page, so a screen reader announces what appears in it. */}
						<output className="text-sm">{summary}</output>
					</div>
				</form>
			</SheetContent>
		</Sheet>
	);
}

/** One chosen file: its preview, name and size, its description, and where it is. */
function QueueRow({
	item,
	busy,
	onAlt,
	onRemove,
	onRetry,
}: {
	item: Item;
	busy: boolean;
	onAlt: (alt: string) => void;
	onRemove: () => void;
	onRetry: () => void;
}) {
	const altId = `queue-alt-${item.key.replace(/[^\w-]/g, "_")}`;
	const sendingNow = item.state === "sending";
	const bad =
		item.state === "invalid" ||
		item.state === "failed" ||
		item.state === "unsure";
	return (
		<li className="flex gap-3 p-3">
			<FileThumb url={item.previewUrl || null} />
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex items-start justify-between gap-2">
					<p className="min-w-0 text-sm">
						<FileLabel file={item.file} />
					</p>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={busy}
						aria-label={`Take ${item.file.name} off the list`}
						onClick={onRemove}
					>
						<X />
					</Button>
				</div>
				{item.state !== "invalid" && (
					<>
						<label htmlFor={altId} className="sr-only">
							Description of {item.file.name} (optional)
						</label>
						<Input
							id={altId}
							value={item.alt}
							dir="auto"
							maxLength={MAX_PHOTO_ALT}
							disabled={busy}
							autoComplete="off"
							placeholder="Description (optional)"
							onChange={(event) => onAlt(event.currentTarget.value)}
						/>
					</>
				)}
				{sendingNow && (
					<div
						role="progressbar"
						aria-label={`Uploading ${item.file.name}`}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={item.percentage ?? 0}
						className="h-1 overflow-hidden rounded-full bg-muted"
					>
						<div
							className="h-full bg-brand transition-[width] duration-150"
							style={{ width: `${item.percentage ?? 0}%` }}
						/>
					</div>
				)}
				{bad && item.message && (
					<p className="flex items-center gap-1.5 text-xs text-destructive">
						{item.state === "failed" && (
							<RotateCcw aria-hidden="true" className="size-3.5" />
						)}
						{item.message}
						{item.state === "failed" &&
						item.message !== "Goes again with the next upload."
							? " It goes again with the next upload."
							: ""}
					</p>
				)}
				{item.state === "unsure" && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
						disabled={busy}
						onClick={onRetry}
					>
						Send again
					</Button>
				)}
			</div>
		</li>
	);
}
