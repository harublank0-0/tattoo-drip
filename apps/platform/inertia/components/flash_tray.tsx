import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { useRef, useState } from "react";
import { urlFor } from "~/client";
import { ignoreHeldEnter } from "~/components/confirm";
import {
	designNote,
	editDesignLabel,
	FLASH_FULL,
	FLASH_SHEET_HELP,
	type FlashDesignProps,
	flashCount,
	MAX_FLASH_DESIGNS,
	NAME_HELP,
	NO_FLASH,
	PICTURE_LABEL,
	PRICE_HELP,
	PRICE_LABEL,
	REMOVE_FLASH_CONFIRM,
	REMOVE_FLASH_KEEP,
	REMOVE_FLASH_QUESTION,
	removeDesignLabel,
	SHOWN_HELP,
	SHOWN_LABEL,
	SIZE_HELP,
} from "~/components/flash";
import {
	FormSheetActions,
	FormSheetPanel,
	type FormSheetState,
	useFormSheet,
} from "~/components/form_sheet";
import InlineConfirm from "~/components/inline_confirm";
import { PHOTO_ACCEPT } from "~/components/photos";
import { Button } from "~/components/ui/button";
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

/**
 * An artist's flash designs (TAT-129), on the artist form: the add form (a
 * picture, a name, a size and an optional price), then the designs newest
 * first as a list. A row's Edit opens the tray's one sheet, mounted once
 * with the design in state; its Remove asks in the page (`InlineConfirm`),
 * outside the sheet. Every word is in `components/flash.ts`; the server
 * decides everything else (FlashService), so a refused change comes back as a
 * field error next to its control, with what was typed still in it.
 */
export default function FlashTray({
	tenantSlug,
	artistId,
	designs,
}: {
	tenantSlug: string;
	artistId: string;
	designs: FlashDesignProps[];
}) {
	const count = designs.length;
	const sheet = useFormSheet();
	// The design the sheet shows. It stays set when the sheet closes, so the
	// sheet keeps its content for its exit animation; a design that is gone
	// from `designs` (removed) makes the panel unavailable, which closes it.
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Where focus goes when a removed design took its row with it.
	const countLine = useRef<HTMLOutputElement>(null);

	const selected = designs.find((design) => design.id === selectedId) ?? null;

	return (
		<div className="flex flex-col gap-4">
			{count < MAX_FLASH_DESIGNS ? (
				<AddDesign tenantSlug={tenantSlug} artistId={artistId} />
			) : (
				<p className="text-sm text-muted-foreground">{FLASH_FULL}</p>
			)}

			<output
				ref={countLine}
				tabIndex={-1}
				className="text-sm font-medium outline-none"
			>
				{flashCount(count)}
			</output>

			{count === 0 ? (
				<p className="text-sm text-muted-foreground">{NO_FLASH}</p>
			) : (
				<ul className="flex flex-col gap-3">
					{designs.map((design) => (
						<li key={design.id} className="flex gap-3 rounded-md border p-2">
							<img
								src={design.thumbnailUrl}
								alt={design.name}
								width={96}
								height={96}
								loading="lazy"
								decoding="async"
								className="size-24 shrink-0 rounded-md border bg-muted object-contain"
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<div>
									<p className="font-medium wrap-anywhere" dir="auto">
										{design.name}
									</p>
									<p className="text-sm text-muted-foreground wrap-anywhere">
										{designNote(design)}
									</p>
								</div>
								<div className="flex flex-wrap items-start gap-2">
									<Button
										type="button"
										variant="outline"
										aria-label={editDesignLabel(design.name)}
										aria-haspopup="dialog"
										onKeyDown={ignoreHeldEnter}
										onClick={(event) => {
											sheet.trigger.current = event.currentTarget;
											setSelectedId(design.id);
											sheet.onOpenChange(true);
										}}
									>
										Edit
									</Button>
									<InlineConfirm
										label="Remove"
										ariaLabel={removeDesignLabel(design.name)}
										question={REMOVE_FLASH_QUESTION}
										confirmLabel={REMOVE_FLASH_CONFIRM}
										keepLabel={REMOVE_FLASH_KEEP}
										busyLabel="Removing…"
										fallback={countLine}
										onConfirm={(finished) =>
											router.delete(
												urlFor("tenant.artists.flash.destroy", {
													tenant: tenantSlug,
													id: design.id,
												}),
												{ preserveScroll: true, onFinish: finished },
											)
										}
									/>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}

			<FormSheetPanel
				sheet={sheet}
				title={selected ? editDesignLabel(selected.name) : "Edit design"}
				description={FLASH_SHEET_HELP}
				fallback={countLine}
				available={selected !== null}
			>
				{selected && (
					<DesignDetails
						tenantSlug={tenantSlug}
						sheet={sheet}
						design={selected}
					/>
				)}
			</FormSheetPanel>
		</div>
	);
}

/**
 * The add form: a picture, a name, a size and an optional price. A saved
 * design clears the form (the file input too); a refusal shows under its field
 * and keeps what was typed.
 */
function AddDesign({
	tenantSlug,
	artistId,
}: {
	tenantSlug: string;
	artistId: string;
}) {
	return (
		<Form
			route="tenant.artists.flash.store"
			routeParams={{ tenant: tenantSlug, id: artistId }}
			options={{ preserveScroll: true, preserveState: "errors" }}
			resetOnSuccess
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<Field data-invalid={!!errors.picture}>
						<FieldLabel htmlFor="flash-picture">{PICTURE_LABEL}</FieldLabel>
						<Input
							id="flash-picture"
							name="picture"
							type="file"
							accept={PHOTO_ACCEPT}
							required
							aria-invalid={!!errors.picture}
						/>
						{errors.picture && <FieldError>{errors.picture}</FieldError>}
					</Field>
					<DesignFields idPrefix="flash-add" errors={errors} />
					<Button type="submit" className="self-start" disabled={processing}>
						{processing ? "Adding…" : "Add design"}
					</Button>
				</FieldGroup>
			)}
		</Form>
	);
}

/** The words of a design: its name, size and price, with their help and errors. */
function DesignFields({
	idPrefix,
	errors,
	design,
}: {
	idPrefix: string;
	errors: Partial<Record<string, string>>;
	design?: FlashDesignProps;
}) {
	return (
		<>
			<Field data-invalid={!!errors.name}>
				<FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
				<Input
					id={`${idPrefix}-name`}
					name="name"
					dir="auto"
					maxLength={80}
					required
					autoComplete="off"
					placeholder="Moth"
					defaultValue={design?.name}
					aria-invalid={!!errors.name}
				/>
				<FieldDescription>{NAME_HELP}</FieldDescription>
				{errors.name && <FieldError>{errors.name}</FieldError>}
			</Field>
			<Field data-invalid={!!errors.size}>
				<FieldLabel htmlFor={`${idPrefix}-size`}>Size</FieldLabel>
				<Input
					id={`${idPrefix}-size`}
					name="size"
					dir="auto"
					maxLength={60}
					required
					autoComplete="off"
					placeholder="About 3 in"
					defaultValue={design?.size}
					aria-invalid={!!errors.size}
				/>
				<FieldDescription>{SIZE_HELP}</FieldDescription>
				{errors.size && <FieldError>{errors.size}</FieldError>}
			</Field>
			<Field data-invalid={!!errors.price}>
				<FieldLabel htmlFor={`${idPrefix}-price`}>{PRICE_LABEL}</FieldLabel>
				<Input
					id={`${idPrefix}-price`}
					name="price"
					inputMode="numeric"
					autoComplete="off"
					defaultValue={design?.price ?? ""}
					aria-invalid={!!errors.price}
				/>
				<FieldDescription>{PRICE_HELP}</FieldDescription>
				{errors.price && <FieldError>{errors.price}</FieldError>}
			</Field>
		</>
	);
}

/**
 * The sheet's body: the design's one form. The form is keyed by the design and
 * its stored values, so a save shows what was kept and a refusal (same key)
 * keeps what was typed.
 */
function DesignDetails({
	tenantSlug,
	sheet,
	design,
}: {
	tenantSlug: string;
	sheet: FormSheetState;
	design: FlashDesignProps;
}) {
	return (
		<>
			<img
				src={design.thumbnailUrl}
				alt={design.name}
				width={192}
				height={192}
				decoding="async"
				className="size-40 self-center rounded-md border bg-muted object-contain sm:size-48"
			/>
			<Form
				key={`${design.id}:${design.name}:${design.size}:${design.price ?? ""}:${design.hidden}`}
				route="tenant.artists.flash.update"
				routeParams={{ tenant: tenantSlug, id: design.id }}
				options={{ preserveScroll: true }}
				onStart={sheet.onStart}
				onSuccess={sheet.onSuccess}
				onError={sheet.onError}
				onFinish={sheet.onFinish}
			>
				{({ errors, processing }) => (
					<FieldGroup>
						<DesignFields
							idPrefix={`flash-${design.id}`}
							errors={errors}
							design={design}
						/>
						<Field
							orientation="horizontal"
							className="min-h-11 items-center"
							data-invalid={!!errors.shown}
						>
							<Checkbox
								id={`flash-${design.id}-shown`}
								name="shown"
								value="1"
								defaultChecked={!design.hidden}
								aria-invalid={!!errors.shown}
							/>
							<FieldContent>
								<FieldLabel
									htmlFor={`flash-${design.id}-shown`}
									className="font-normal"
								>
									{SHOWN_LABEL}
								</FieldLabel>
								<FieldDescription>{SHOWN_HELP}</FieldDescription>
								{errors.shown && <FieldError>{errors.shown}</FieldError>}
							</FieldContent>
						</Field>
						<FormSheetActions submit="Save design" processing={processing} />
					</FieldGroup>
				)}
			</Form>
		</>
	);
}
