import { Form } from "@adonisjs/inertia/react";
import { router } from "@inertiajs/react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { urlFor } from "~/client";
import {
	canAddPhoto,
	MAX_PHOTO_ALT,
	moveLabel,
	moves,
	NO_PHOTOS,
	PHOTO_ACCEPT,
	photoAlt,
	photoCount,
	REMOVE_PHOTO_QUESTION,
	removeLabel,
	TRAY_FULL,
	uploadingText,
	type WorkPhotoProps,
} from "~/components/photos";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/**
 * An artist's work photos (TAT-116), on the artist form: the photos in the
 * studio's order, each with its description, move and remove buttons, then
 * the upload. One photo per upload, so a phone photo (3 to 10 MB) never meets
 * the 20 MB request limit and the dashboard needs no resizing of its own.
 * Every word is in `components/photos.ts`; the server decides everything
 * else (WorkPhotoService), so a refused change comes back as a field error
 * next to its control, with what was typed still in it.
 */
export default function WorkPhotoTray({
	tenantSlug,
	artistId,
	photos,
}: {
	tenantSlug: string;
	artistId: string;
	photos: WorkPhotoProps[];
}) {
	const count = photos.length;

	return (
		<div className="flex flex-col gap-4">
			{count === 0 ? (
				<p className="text-sm text-muted-foreground">{NO_PHOTOS}</p>
			) : (
				<ol className="flex flex-col gap-3">
					{photos.map((photo, index) => (
						<PhotoRow
							key={photo.id}
							tenantSlug={tenantSlug}
							photo={photo}
							n={index + 1}
							count={count}
						/>
					))}
				</ol>
			)}

			<output className="text-sm font-medium">{photoCount(count)}</output>

			{canAddPhoto(count) ? (
				<Form
					route="tenant.artists.photos.store"
					routeParams={{ tenant: tenantSlug, id: artistId }}
					options={{ preserveScroll: true, preserveState: "errors" }}
					resetOnSuccess
				>
					{({ errors, processing, progress }) => (
						<Field data-invalid={!!errors.photo}>
							<FieldLabel htmlFor="work-photo">Add a photo</FieldLabel>
							<Input
								id="work-photo"
								name="photo"
								type="file"
								accept={PHOTO_ACCEPT}
								required
								aria-invalid={!!errors.photo}
							/>
							<FieldDescription>
								JPEG, PNG or WebP, up to 10 MB. Photos from a phone work as they
								are.
							</FieldDescription>
							{errors.photo && <FieldError>{errors.photo}</FieldError>}
							<Button
								type="submit"
								className="self-start"
								disabled={processing}
							>
								{processing
									? uploadingText(progress?.percentage)
									: "Upload photo"}
							</Button>
						</Field>
					)}
				</Form>
			) : (
				<p className="text-sm text-muted-foreground">{TRAY_FULL}</p>
			)}
		</div>
	);
}

function PhotoRow({
	tenantSlug,
	photo,
	n,
	count,
}: {
	tenantSlug: string;
	photo: WorkPhotoProps;
	n: number;
	count: number;
}) {
	const params = { tenant: tenantSlug, id: photo.id };
	const { earlier, later } = moves(n - 1, count);

	const move = (direction: "up" | "down") =>
		router.post(
			urlFor("tenant.artists.photos.move", params),
			{ direction },
			{ preserveScroll: true },
		);
	const remove = () => {
		if (window.confirm(REMOVE_PHOTO_QUESTION)) {
			router.delete(urlFor("tenant.artists.photos.destroy", params), {
				preserveScroll: true,
			});
		}
	};

	return (
		<li className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
			<img
				src={photo.thumbnailUrl}
				alt={photoAlt(photo.alt, n, count)}
				width={96}
				height={96}
				loading="lazy"
				decoding="async"
				className="size-24 shrink-0 rounded-md border object-cover"
			/>
			{/* Keyed by the stored text, so the field shows what was saved. */}
			<Form
				key={`${photo.id}:${photo.alt ?? ""}`}
				route="tenant.artists.photos.update"
				routeParams={params}
				options={{ preserveScroll: true, preserveState: "errors" }}
				className="min-w-48 flex-1"
			>
				{({ errors, processing }) => (
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
							What the photo shows, read aloud to clients who can&apos;t see it.
							For example: Koi fish on the forearm, black and grey.
						</FieldDescription>
						{errors.alt && <FieldError>{errors.alt}</FieldError>}
						<Button
							type="submit"
							variant="outline"
							className="self-start"
							disabled={processing}
						>
							{processing ? "Saving…" : "Save description"}
						</Button>
					</Field>
				)}
			</Form>
			<div className="flex gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={moveLabel("up", n)}
					disabled={!earlier}
					onClick={() => move("up")}
				>
					<ArrowUp />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={moveLabel("down", n)}
					disabled={!later}
					onClick={() => move("down")}
				>
					<ArrowDown />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={removeLabel(n)}
					onClick={remove}
				>
					<Trash2 />
				</Button>
			</div>
		</li>
	);
}
