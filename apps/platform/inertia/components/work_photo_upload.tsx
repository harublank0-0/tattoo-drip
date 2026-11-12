import { router } from "@inertiajs/react";
import { type FormEvent, useRef, useState } from "react";
import { urlFor } from "~/client";
import { FileLabel, FileThumb, useObjectUrls } from "~/components/file_preview";
import {
	addedLine,
	choiceLine,
	failureLine,
	PHOTO_ACCEPT,
	roomNote,
	trackUpload,
	UPLOAD_HELP,
	UPLOAD_INTERRUPTED,
	UPLOAD_LABEL,
	type UploadOutcome,
	uploadingPhotos,
} from "~/components/photos";
import { fileProblem, planUpload } from "~/components/portfolio";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/** Where the queue is: photo `index` of `total` (counted from 1) and how much of it has gone. */
type Sending = { index: number; total: number; percentage?: number };

/** What the last queue did: how many were added and the lines for the refused files. */
type Summary = { added: number; failures: { id: number; line: string }[] };

/**
 * A chosen file as the list under the field shows it: its preview (none for a
 * wrong file), why it can't go when it is wrong (`fileProblem`, the server's
 * own words), and where it is in the queue.
 */
type Chosen = {
	file: File;
	url: string | null;
	problem: string | null;
	state: "waiting" | "sending" | "added" | "refused";
	percentage?: number;
	message?: string;
};

/**
 * Sends one photo as its own request and says how it ended (trackUpload, in
 * photos.ts, holds the rules: anything but a clear answer is refused).
 */
function sendPhoto(
	url: string,
	file: File,
	onPercentage: (percentage: number | undefined) => void,
): Promise<UploadOutcome> {
	return new Promise((resolve) => {
		const upload = trackUpload();
		router.post(
			url,
			{ photo: file },
			{
				forceFormData: true,
				preserveScroll: true,
				preserveState: true,
				onProgress: (event) => onPercentage(event?.percentage),
				...upload.callbacks,
				onFinish: () => resolve(upload.outcome()),
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
	const { create, revoke } = useObjectUrls();
	const [chosen, setChosen] = useState<Chosen[]>([]);
	const [sending, setSending] = useState<Sending | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [summary, setSummary] = useState<Summary | null>(null);
	/** True once the chosen files have been through an upload: the list is then the last upload's, not a choice waiting to go. */
	const [finished, setFinished] = useState(false);
	const skipped = chosen.filter((row) => row.problem).length;

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const files = Array.from(input.current?.files ?? []);
		if (files.length === 0 || sending) return;

		const plan = planUpload(files);
		const tooMany = roomNote(room, plan.send.length);
		setError(tooMany);
		setSummary(null);
		if (tooMany) return;

		const url = urlFor("tenant.artists.photos.store", {
			tenant: tenantSlug,
			id: artistId,
		});
		// "Uploading 2 of 3" counts the files that go, never the wrong ones.
		const total = plan.send.length;
		let added = 0;
		const failures: Summary["failures"] = [];
		const mark = (id: number, change: Partial<Chosen>) =>
			setChosen((current) =>
				current.map((row, at) => (at === id ? { ...row, ...change } : row)),
			);
		// A wrong file is named, never sent: the server would refuse it in the same words.
		for (const { index: id, reason } of plan.skip) {
			failures.push({ id, line: failureLine(files[id].name, reason) });
			mark(id, { state: "refused", message: reason });
		}
		onBusyChange(true);
		for (const [at, id] of plan.send.entries()) {
			const file = files[id];
			const index = at + 1;
			setSending({ index, total });
			mark(id, { state: "sending", percentage: 0 });
			const outcome = await sendPhoto(url, file, (percentage) => {
				setSending({ index, total, percentage });
				mark(id, { percentage });
			});
			if (outcome.kind === "cancelled") {
				// The cut-off file and every one not yet sent: name them, send nothing more.
				for (const unsent of plan.send.slice(at)) {
					failures.push({
						id: unsent,
						line: failureLine(files[unsent].name, UPLOAD_INTERRUPTED),
					});
					mark(unsent, { state: "refused", message: UPLOAD_INTERRUPTED });
				}
				break;
			}
			if (outcome.kind === "added") {
				added += 1;
				mark(id, { state: "added", percentage: undefined });
			} else {
				failures.push({ id, line: failureLine(file.name, outcome.message) });
				mark(id, { state: "refused", message: outcome.message });
			}
		}
		// The summary lists the refused files in the order they were chosen.
		failures.sort((a, b) => a.id - b.id);
		setFinished(true);

		onBusyChange(false);
		setSending(null);
		if (added + failures.length > 0) setSummary({ added, failures });
		if (input.current) input.current.value = "";
	};

	return (
		<form className="flex flex-col gap-3" onSubmit={submit}>
			<Field data-invalid={!!error}>
				<FieldLabel htmlFor="work-photo-files">{UPLOAD_LABEL}</FieldLabel>
				<Input
					ref={input}
					id="work-photo-files"
					type="file"
					multiple
					required
					accept={PHOTO_ACCEPT}
					disabled={sending !== null}
					aria-invalid={!!error || (!finished && skipped > 0)}
					aria-describedby={[
						"work-photo-files-help",
						error ? "work-photo-files-error" : null,
						chosen.length > 0 && !finished ? "work-photo-files-chosen" : null,
					]
						.filter(Boolean)
						.join(" ")}
					onChange={(event) => {
						setError(null);
						setSummary(null);
						setFinished(false);
						// Built outside the state updater (StrictMode may run it twice).
						const next = Array.from(event.currentTarget.files ?? []).map(
							(file): Chosen => {
								const problem = fileProblem(file);
								return {
									file,
									url: problem ? null : create(file),
									problem,
									state: "waiting",
								};
							},
						);
						setChosen((current) => {
							for (const row of current) revoke(row.url);
							return next;
						});
					}}
				/>
				<FieldDescription id="work-photo-files-help">
					{UPLOAD_HELP}
				</FieldDescription>
				{error && <FieldError id="work-photo-files-error">{error}</FieldError>}
				{/* Said when files are chosen: how many, and how many can't go. */}
				<p
					id="work-photo-files-chosen"
					className="text-sm text-muted-foreground"
					aria-live="polite"
				>
					{chosen.length > 0 && !finished
						? choiceLine(chosen.length, skipped)
						: null}
				</p>
				{chosen.length > 0 && (
					<ul
						aria-label={finished ? "Last upload" : "Chosen photos"}
						className="flex flex-col divide-y rounded-lg border"
					>
						{chosen.map((row, id) => (
							<ChosenRow
								// The list is the input's files, in order, replaced as a whole.
								// biome-ignore lint/suspicious/noArrayIndexKey: see above
								key={id}
								row={row}
							/>
						))}
					</ul>
				)}
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

/** One chosen photo: its preview, name and size, and where it is (waiting, going, added, or why not). */
function ChosenRow({ row }: { row: Chosen }) {
	const status =
		row.state === "sending"
			? `Uploading… ${row.percentage ?? 0}%`
			: row.state === "added"
				? "Added"
				: row.state === "refused"
					? (row.message ?? null)
					: row.problem;
	const bad =
		row.state === "refused" || (row.state === "waiting" && row.problem);
	return (
		<li className="flex items-center gap-3 p-3 text-sm">
			<FileThumb url={row.url} className="size-12" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<FileLabel file={row.file} />
				{status ? (
					<span className={bad ? "text-destructive" : "text-muted-foreground"}>
						{status}
					</span>
				) : null}
				{row.state === "sending" && (
					<div
						role="progressbar"
						aria-label={`Uploading ${row.file.name}`}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={row.percentage ?? 0}
						className="h-1 overflow-hidden rounded-full bg-muted"
					>
						<div
							className="h-full bg-brand transition-[width] duration-150"
							style={{ width: `${row.percentage ?? 0}%` }}
						/>
					</div>
				)}
			</div>
		</li>
	);
}
