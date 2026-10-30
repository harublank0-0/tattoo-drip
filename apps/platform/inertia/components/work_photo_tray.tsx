import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useId, useRef, useState } from "react";
import { urlFor } from "~/client";
import type { StyleOption } from "~/components/artists";
import { ignoreHeldEnter } from "~/components/confirm";
import {
	FormSheetPanel,
	type FormSheetState,
	useFormSheet,
} from "~/components/form_sheet";
import {
	canAddPhoto,
	editLabel,
	HEALED_HELP,
	HEALED_LABEL,
	MAX_PHOTO_ALT,
	MAX_WORK_PHOTOS,
	NO_PHOTOS,
	photoAlt,
	photoCount,
	REMOVE_PHOTO_QUESTION,
	SHEET_HELP,
	STYLES_HELP,
	TRAY_FULL,
	tileNote,
	type WorkPhotoProps,
} from "~/components/photos";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import WorkPhotoUpload from "~/components/work_photo_upload";

/**
 * An artist's work photos (TAT-116, TAT-126), on the artist form: the upload
 * (several photos at once), then the photos newest first as a grid of tiles.
 * A tile opens the tray's one sheet, mounted once with the photo in state,
 * holding its description, styles and healed mark and the remove button.
 * Every word is in `components/photos.ts`; the server decides everything
 * else (WorkPhotoService), so a refused change comes back as a field error
 * next to its control, with what was typed still in it.
 */
export default function WorkPhotoTray({
	tenantSlug,
	artistId,
	photos,
	styleOptions,
}: {
	tenantSlug: string;
	artistId: string;
	photos: WorkPhotoProps[];
	styleOptions: StyleOption[];
}) {
	const count = photos.length;
	const sheet = useFormSheet();
	// The photo the sheet shows. It stays set when the sheet closes, so the
	// sheet keeps its content for its exit animation; a photo that is gone
	// from `photos` (removed) makes the panel unavailable, which closes it.
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Where focus goes when a removed photo took its tile with it.
	const countLine = useRef<HTMLOutputElement>(null);
	const noteId = useId();

	const selectedIndex = photos.findIndex((photo) => photo.id === selectedId);
	const selected = selectedIndex === -1 ? null : photos[selectedIndex];

	return (
		<div className="flex flex-col gap-4">
			{canAddPhoto(count) ? (
				<WorkPhotoUpload
					tenantSlug={tenantSlug}
					artistId={artistId}
					room={MAX_WORK_PHOTOS - count}
				/>
			) : (
				<p className="text-sm text-muted-foreground">{TRAY_FULL}</p>
			)}

			<output
				ref={countLine}
				tabIndex={-1}
				className="text-sm font-medium outline-none"
			>
				{photoCount(count)}
			</output>

			{count === 0 ? (
				<p className="text-sm text-muted-foreground">{NO_PHOTOS}</p>
			) : (
				<ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
					{photos.map((photo, index) => {
						const note = tileNote(photo.styles.length, photo.healed);
						return (
							<li key={photo.id}>
								<Button
									type="button"
									variant="ghost"
									className="h-auto w-full flex-col items-stretch gap-1 p-1 font-normal whitespace-normal"
									aria-label={editLabel(index + 1, photo.alt)}
									aria-describedby={note ? `${noteId}-${photo.id}` : undefined}
									aria-haspopup="dialog"
									onKeyDown={ignoreHeldEnter}
									onClick={(event) => {
										sheet.trigger.current = event.currentTarget;
										setSelectedId(photo.id);
										sheet.onOpenChange(true);
									}}
								>
									<img
										src={photo.thumbnailUrl}
										alt={photoAlt(photo.alt, index + 1, count)}
										width={96}
										height={96}
										loading="lazy"
										decoding="async"
										className="aspect-square w-full rounded-md border object-cover"
									/>
									{note && (
										<span
											id={`${noteId}-${photo.id}`}
											className="text-center text-xs text-muted-foreground"
										>
											{note}
										</span>
									)}
								</Button>
							</li>
						);
					})}
				</ul>
			)}

			<FormSheetPanel
				sheet={sheet}
				title={`Edit photo ${selectedIndex + 1}`}
				description={SHEET_HELP}
				fallback={countLine}
				available={selected !== null}
			>
				{selected && (
					<PhotoDetails
						tenantSlug={tenantSlug}
						sheet={sheet}
						photo={selected}
						n={selectedIndex + 1}
						count={count}
						styleOptions={styleOptions}
					/>
				)}
			</FormSheetPanel>
		</div>
	);
}

/**
 * The sheet's body: the larger thumbnail and the photo's one form. The form
 * is keyed by the photo and its stored values, so a save shows what was kept
 * and a refusal (same key) keeps what was typed.
 */
function PhotoDetails({
	tenantSlug,
	sheet,
	photo,
	n,
	count,
	styleOptions,
}: {
	tenantSlug: string;
	sheet: FormSheetState;
	photo: WorkPhotoProps;
	n: number;
	count: number;
	styleOptions: StyleOption[];
}) {
	const params = { tenant: tenantSlug, id: photo.id };

	const remove = () => {
		if (!window.confirm(REMOVE_PHOTO_QUESTION)) return;
		router.delete(urlFor("tenant.artists.photos.destroy", params), {
			preserveScroll: true,
			onStart: sheet.onStart,
			onSuccess: sheet.onSuccess,
			onError: sheet.onError,
			onFinish: sheet.onFinish,
		});
	};

	return (
		<>
			<img
				src={photo.thumbnailUrl}
				alt={photoAlt(photo.alt, n, count)}
				width={192}
				height={192}
				decoding="async"
				className="size-40 self-center rounded-md border bg-muted object-contain sm:size-48"
			/>
			<Form
				key={`${photo.id}:${photo.alt ?? ""}:${photo.styles.join(",")}:${photo.healed}`}
				route="tenant.artists.photos.update"
				routeParams={params}
				options={{ preserveScroll: true }}
				onStart={sheet.onStart}
				onSuccess={sheet.onSuccess}
				onError={sheet.onError}
				onFinish={sheet.onFinish}
			>
				{({ errors, processing }) => (
					<FieldGroup>
						<Field data-invalid={!!errors.alt}>
							<FieldLabel htmlFor={`alt-${photo.id}`}>
								Description (optional)
							</FieldLabel>
							<Input
								id={`alt-${photo.id}`}
								name="alt"
								dir="auto"
								maxLength={MAX_PHOTO_ALT}
								defaultValue={photo.alt ?? ""}
								autoComplete="off"
								aria-invalid={!!errors.alt}
							/>
							<FieldDescription>
								What the photo shows, read aloud to clients who can&apos;t see
								it. For example: Koi fish on the forearm, black and grey.
							</FieldDescription>
							{errors.alt && <FieldError>{errors.alt}</FieldError>}
						</Field>

						<FieldSet data-invalid={!!errors.styles}>
							<FieldLegend variant="label">Styles</FieldLegend>
							<FieldDescription>{STYLES_HELP}</FieldDescription>
							<div className="grid gap-x-6 sm:grid-cols-2">
								{styleOptions.map((style) => (
									<Field
										key={style.slug}
										orientation="horizontal"
										className="min-h-11 items-center"
									>
										<Checkbox
											id={`photo-style-${style.slug}`}
											name="styles[]"
											value={style.slug}
											defaultChecked={photo.styles.includes(style.slug)}
										/>
										<FieldLabel
											htmlFor={`photo-style-${style.slug}`}
											className="font-normal"
										>
											{style.name}
										</FieldLabel>
									</Field>
								))}
							</div>
							{errors.styles && <FieldError>{errors.styles}</FieldError>}
						</FieldSet>

						<Field
							orientation="horizontal"
							className="min-h-11 items-center"
							data-invalid={!!errors.healed}
						>
							<Checkbox
								id="photo-healed"
								name="healed"
								value="1"
								defaultChecked={photo.healed}
								aria-invalid={!!errors.healed}
							/>
							<FieldContent>
								<FieldLabel htmlFor="photo-healed" className="font-normal">
									{HEALED_LABEL}
								</FieldLabel>
								<FieldDescription>{HEALED_HELP}</FieldDescription>
								{errors.healed && <FieldError>{errors.healed}</FieldError>}
							</FieldContent>
						</Field>

						<div className="flex flex-wrap gap-2">
							<Button type="submit" disabled={processing}>
								{processing ? "Saving…" : "Save photo"}
							</Button>
							<Button
								type="button"
								variant="outline"
								className="text-destructive hover:text-destructive"
								disabled={sheet.state.saving}
								onClick={remove}
							>
								Remove photo
							</Button>
						</div>
					</FieldGroup>
				)}
			</Form>
		</>
	);
}
