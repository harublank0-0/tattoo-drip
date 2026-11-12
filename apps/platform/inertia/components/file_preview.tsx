import { cn } from "cn";
import {
	type ComponentProps,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { fileProblem, fileSizeText } from "~/components/portfolio";
import { Input } from "~/components/ui/input";

/**
 * Previews of files chosen for upload, before they are sent: the browser's
 * own copy of each file (an object URL), never a request. Every upload field
 * in the dashboard shows what was picked this way, so an owner sees the
 * photo, its name and size, and a wrong file (format or size, `fileProblem`)
 * at once, not after Save. The server checks every file again.
 */

/**
 * Object URLs for chosen files, each let go when it is no longer shown and
 * all of them when the component goes, so a long session leaks no memory.
 * Create them outside state updaters (an updater may run twice in
 * StrictMode, and the second URL would never be revoked).
 */
export function useObjectUrls() {
	const urls = useRef(new Set<string>());
	useEffect(() => {
		const all = urls.current;
		return () => {
			for (const url of all) URL.revokeObjectURL(url);
			all.clear();
		};
	}, []);
	const create = useCallback((file: Blob) => {
		const url = URL.createObjectURL(file);
		urls.current.add(url);
		return url;
	}, []);
	const revoke = useCallback((url: string | null | undefined) => {
		if (!url || !urls.current.has(url)) return;
		URL.revokeObjectURL(url);
		urls.current.delete(url);
	}, []);
	return { create, revoke };
}

/** How a preview sits in its box: a photo fills it, a logo or a QR code is seen whole. */
export type PreviewFit = "cover" | "contain";

/**
 * A chosen file's picture: decoration beside its name (`alt=""`), or an empty
 * box for a file that has none to show (a wrong one).
 */
export function FileThumb({
	url,
	fit = "cover",
	className,
}: {
	url: string | null;
	fit?: PreviewFit;
	className?: string;
}) {
	// A file that passes the first check but can't be drawn (text renamed .jpg)
	// shows the empty box, never the browser's broken-image icon.
	const [broken, setBroken] = useState<string | null>(null);
	return (
		<div
			className={cn(
				"size-16 shrink-0 overflow-hidden rounded-md border bg-muted",
				className,
			)}
		>
			{url && broken !== url ? (
				<img
					src={url}
					alt=""
					onError={() => setBroken(url)}
					className={cn(
						"size-full",
						fit === "cover" ? "object-cover" : "object-contain",
					)}
				/>
			) : null}
		</div>
	);
}

/** A chosen file's name and size, as the queue rows and the single-file fields show them. */
export function FileLabel({ file }: { file: { name: string; size: number } }) {
	return (
		<span className="min-w-0">
			<span className="font-medium wrap-anywhere">{file.name}</span>{" "}
			<span className="text-muted-foreground tabular-nums">
				{fileSizeText(file.size)}
			</span>
		</span>
	);
}

/** What a field shows about the file it holds now: none, or the file with its preview and, for a wrong one, why. */
type Chosen = { file: File; url: string | null; problem: string | null };

/**
 * A single-image upload field's input with the chosen image shown under it
 * before the form is sent (the cover, the logo, an artist's photo, a payment
 * QR code, a flash design's picture). Uncontrolled, as the forms are: the
 * input itself is what the form sends. The preview goes when the file is
 * cleared or the whole form is reset: Inertia's `resetOnSuccess` (with no
 * field list) dispatches the form's `reset` event after a save; a reset of
 * named fields only does not, so don't use one on a form with this field. A
 * wrong file says why at once, marks the field invalid and is never sent
 * (the input's custom validity stops the form's submit), as the server would
 * refuse it in the same words. `previewClassName` and `fit` shape the
 * preview like the image it will become (the cover's 4:3 crop, a logo or QR
 * seen whole). The field keeps its own ref, so it takes none.
 */
export function ImageFileInput({
	fit = "cover",
	previewClassName,
	replaces = false,
	onChange,
	...props
}: Omit<ComponentProps<typeof Input>, "type" | "ref"> & {
	fit?: PreviewFit;
	previewClassName?: string;
	/** True when the field replaces an image already saved: the preview says so. */
	replaces?: boolean;
}) {
	const { create, revoke } = useObjectUrls();
	const input = useRef<HTMLInputElement>(null);
	const [chosen, setChosen] = useState<Chosen | null>(null);
	const noteId = useId();

	const show = useCallback(
		(file: File | null) => {
			setChosen((current) => {
				revoke(current?.url);
				return null;
			});
			input.current?.setCustomValidity("");
			if (!file) return;
			const problem = fileProblem(file);
			input.current?.setCustomValidity(problem ?? "");
			const url = problem ? null : create(file);
			setChosen({ file, url, problem });
		},
		[create, revoke],
	);

	// A form reset (after a save) empties the input without a change event.
	useEffect(() => {
		const form = input.current?.form;
		if (!form) return;
		const cleared = () => show(null);
		form.addEventListener("reset", cleared);
		return () => form.removeEventListener("reset", cleared);
	}, [show]);

	const describedBy = [props["aria-describedby"], chosen ? noteId : null]
		.filter(Boolean)
		.join(" ");

	return (
		<>
			<Input
				{...props}
				ref={input}
				type="file"
				aria-invalid={props["aria-invalid"] || !!chosen?.problem}
				aria-describedby={describedBy || undefined}
				onChange={(event) => {
					show(event.currentTarget.files?.[0] ?? null);
					onChange?.(event);
				}}
			/>
			{chosen ? (
				<div className="flex items-start gap-3">
					<FileThumb url={chosen.url} fit={fit} className={previewClassName} />
					<p id={noteId} className="flex min-w-0 flex-col gap-1 text-sm">
						<span className="text-muted-foreground">
							{replaces ? "Replaces the current one when you save:" : "Chosen:"}
						</span>
						<FileLabel file={chosen.file} />
						{chosen.problem ? (
							<span role="alert" className="text-destructive">
								{chosen.problem}
							</span>
						) : null}
					</p>
				</div>
			) : null}
		</>
	);
}
