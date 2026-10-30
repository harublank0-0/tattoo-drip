import { router } from "@inertiajs/react";
import { type FormEvent, useRef, useState } from "react";
import { urlFor } from "~/client";
import {
	addedLine,
	failureLine,
	PHOTO_ACCEPT,
	roomNote,
	UPLOAD_FAILED,
	UPLOAD_HELP,
	UPLOAD_INTERRUPTED,
	UPLOAD_LABEL,
	uploadingPhotos,
} from "~/components/photos";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/** How one file's request ended: the server took it, refused it (with its words), or the visit was cancelled. */
type Outcome =
	| { kind: "added" }
	| { kind: "refused"; message: string }
	| { kind: "cancelled" };

/** Where the queue is: photo `index` of `total` (counted from 1) and how much of it has gone. */
type Sending = { index: number; total: number; percentage?: number };

/** What the last queue did: how many were added and the lines for the refused files. */
type Summary = { added: number; failures: { id: number; line: string }[] };

/**
 * Sends one photo as its own request. Anything but a clear answer counts as
 * refused (a dropped connection, a proxy's size limit), never as added.
 */
function sendPhoto(
	url: string,
	file: File,
	onPercentage: (percentage: number | undefined) => void,
): Promise<Outcome> {
	return new Promise((resolve) => {
		let outcome: Outcome = { kind: "refused", message: UPLOAD_FAILED };
		router.post(
			url,
			{ photo: file },
			{
				forceFormData: true,
				preserveScroll: true,
				preserveState: true,
				onProgress: (event) => onPercentage(event?.percentage),
				onSuccess: () => {
					outcome = { kind: "added" };
				},
				onError: (errors) => {
					outcome = {
						kind: "refused",
						message: errors.photo || UPLOAD_FAILED,
					};
				},
				onCancel: () => {
					outcome = { kind: "cancelled" };
				},
				// A lost connection ends the visit through onFinish with the default
				// outcome; nothing else needs to hear about it.
				onNetworkError: () => false,
				onFinish: () => resolve(outcome),
			},
		);
	});
}

/**
 * The tray's upload (TAT-126): choose several photos and they go one request
 * each, in the order chosen, the next only after the previous has finished.
 * One photo per request keeps every request under the 20 MB limit with no
 * resizing, and Inertia cancels a visit when another starts, so they could
 * not overlap anyway. A refused file is named in the summary and the queue
 * goes on; a cancelled visit (the person went elsewhere, or saved a photo in
 * the sheet) stops it, and the file it cut off and every one not yet sent are
 * named as not sent. More files than `room` are not sent at all. `onBusyChange`
 * tells the tray while the queue is going, so the sheet holds Save and Remove
 * (either would cancel the visit that is uploading).
 */
export default function WorkPhotoUpload({
	tenantSlug,
	artistId,
	room,
	onBusyChange,
}: {
	tenantSlug: string;
	artistId: string;
	room: number;
	onBusyChange: (busy: boolean) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const [sending, setSending] = useState<Sending | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [summary, setSummary] = useState<Summary | null>(null);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const files = Array.from(input.current?.files ?? []);
		if (files.length === 0 || sending) return;

		const tooMany = roomNote(room, files.length);
		setError(tooMany);
		setSummary(null);
		if (tooMany) return;

		const url = urlFor("tenant.artists.photos.store", {
			tenant: tenantSlug,
			id: artistId,
		});
		const total = files.length;
		let added = 0;
		const failures: Summary["failures"] = [];
		onBusyChange(true);
		for (const [id, file] of files.entries()) {
			const index = id + 1;
			setSending({ index, total });
			const outcome = await sendPhoto(url, file, (percentage) =>
				setSending({ index, total, percentage }),
			);
			if (outcome.kind === "cancelled") {
				// The cut-off file and every one after it: name them, send nothing more.
				for (const [offset, unsent] of files.slice(id).entries()) {
					failures.push({
						id: id + offset,
						line: failureLine(unsent.name, UPLOAD_INTERRUPTED),
					});
				}
				break;
			}
			if (outcome.kind === "added") added += 1;
			else failures.push({ id, line: failureLine(file.name, outcome.message) });
		}

		onBusyChange(false);
		setSending(null);
		if (added + failures.length > 0) setSummary({ added, failures });
		if (input.current) input.current.value = "";
	};

	return (
		<form className="flex flex-col gap-3" onSubmit={submit}>
			<Field data-invalid={!!error}>
				<FieldLabel htmlFor="work-photos">{UPLOAD_LABEL}</FieldLabel>
				<Input
					ref={input}
					id="work-photos"
					type="file"
					multiple
					required
					accept={PHOTO_ACCEPT}
					disabled={sending !== null}
					aria-invalid={!!error}
					aria-describedby={
						error ? "work-photos-help work-photos-error" : "work-photos-help"
					}
					onChange={() => {
						setError(null);
						setSummary(null);
					}}
				/>
				<FieldDescription id="work-photos-help">{UPLOAD_HELP}</FieldDescription>
				{error && <FieldError id="work-photos-error">{error}</FieldError>}
				<Button
					type="submit"
					className="self-start"
					disabled={sending !== null}
				>
					{sending
						? uploadingPhotos(sending.index, sending.total, sending.percentage)
						: "Upload photos"}
				</Button>
			</Field>

			{/* Always on the page, so a screen reader announces what appears in it.
			    A div, not an <output>: the region holds a list, which <output>
			    (phrasing content only) cannot. */}
			{/* biome-ignore lint/a11y/useSemanticElements: see the note above */}
			<div role="status" className="text-sm">
				{summary && (
					<>
						<p className="font-medium">
							{addedLine(summary.added, summary.failures.length)}
						</p>
						{summary.failures.length > 0 && (
							<ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-destructive wrap-anywhere">
								{summary.failures.map((failure) => (
									<li key={failure.id}>{failure.line}</li>
								))}
							</ul>
						)}
					</>
				)}
			</div>
		</form>
	);
}
