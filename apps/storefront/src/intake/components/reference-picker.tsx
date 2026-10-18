import { ImagePlus, X } from "lucide-react";
import { copy, fill } from "../copy.ts";
import { ACCEPT, MAX_REFERENCES } from "../images.ts";
import {
	canAdd,
	formatBytes,
	type PhotoNotice,
	type ReferencesState,
	totalBytes,
} from "../references.ts";
import { Fill } from "./fill.tsx";

export interface ReferencePickerProps {
	readonly state: ReferencesState;
	/** Preview URLs by photo id; the form makes and revokes them. */
	readonly previews: ReadonlyMap<string, string>;
	readonly studioName: string;
	/** While a send runs. */
	readonly disabled: boolean;
	onPick(files: File[]): void;
	onRemove(id: string): void;
}

/** Why photos weren't added, and what the API said about sent ones. */
export function photoMessages(state: ReferencesState): string[] {
	const messages = state.notices.map(noticeMessage);
	for (const [index, item] of state.items.entries()) {
		if (item.error) {
			messages.push(
				fill(copy.photos.itemError, { index: index + 1, message: item.error }),
			);
		}
	}
	if (state.error) messages.push(state.error);
	return [...new Set(messages)];
}

function noticeMessage(notice: PhotoNotice): string {
	if (notice.kind === "too-many") {
		return fill(
			notice.count === 1 ? copy.photos.tooManyOne : copy.photos.tooMany,
			{ max: MAX_REFERENCES, count: notice.count },
		);
	}
	return fill(copy.photos.problems[notice.kind], { name: notice.name });
}

/** Up to five reference photos: previews, remove buttons, and the picker while there is room. */
export function ReferencePicker({
	state,
	previews,
	studioName,
	disabled,
	onPick,
	onRemove,
}: ReferencePickerProps) {
	const count = state.items.length;
	const messages = photoMessages(state);
	return (
		<fieldset
			id="references"
			className="intake-photos"
			aria-describedby="references-hint"
		>
			<legend className="intake-label">{copy.photos.legend}</legend>
			<p id="references-hint" className="intake-note">
				{/* The number is plain text; only the studio's name goes in <bdi>. */}
				<Fill
					template={fill(copy.photos.hint, { max: MAX_REFERENCES })}
					values={{ studio: studioName }}
				/>
			</p>
			<ul className="photo-tray">
				{state.items.map((item, index) => {
					const preview = previews.get(item.id);
					return (
						<li
							key={item.id}
							className={item.error ? "photo photo-error" : "photo"}
						>
							{preview ? (
								<img
									src={preview}
									alt={fill(copy.photos.alt, { index: index + 1 })}
									width={96}
									height={96}
								/>
							) : (
								<span className="photo-pending">{copy.photos.preparing}</span>
							)}
							<button
								type="button"
								className="photo-remove"
								aria-label={fill(copy.photos.remove, { index: index + 1 })}
								disabled={disabled}
								onClick={() => onRemove(item.id)}
							>
								<X aria-hidden="true" className="size-5" />
							</button>
						</li>
					);
				})}
				{canAdd(state) ? (
					<li>
						<label className="photo-add">
							<input
								id="references-input"
								className="sr-only"
								type="file"
								accept={ACCEPT}
								multiple
								disabled={disabled}
								onChange={(event) => {
									const input = event.currentTarget;
									const files = Array.from(input.files ?? []);
									input.value = "";
									if (files.length > 0) onPick(files);
								}}
							/>
							<ImagePlus aria-hidden="true" className="size-6" />
							<span>{copy.photos.add}</span>
						</label>
					</li>
				) : null}
			</ul>
			{count > 0 ? (
				<p className="intake-note">
					{count >= MAX_REFERENCES
						? fill(copy.photos.full, { max: MAX_REFERENCES })
						: fill(copy.photos.count, {
								count,
								max: MAX_REFERENCES,
								size: formatBytes(totalBytes(state)),
							})}
				</p>
			) : null}
			<ul className="photo-messages" aria-live="polite">
				{messages.map((message) => (
					<li key={message}>{message}</li>
				))}
			</ul>
		</fieldset>
	);
}
