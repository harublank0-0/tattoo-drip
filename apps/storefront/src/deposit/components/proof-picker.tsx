import { ImagePlus, X } from "lucide-react";
import type { Ref } from "react";
import { fill } from "../../intake/copy.ts";
import { ACCEPT } from "../../intake/images.ts";
import { copy } from "../copy.ts";
import type { ProofState } from "../proof.ts";

export interface ProofPickerProps {
	readonly state: ProofState;
	/** The prepared JPEG's object URL; the form makes and revokes it. */
	readonly preview: string | null;
	/** While a send runs: the picker and Remove do nothing. */
	readonly busy: boolean;
	/** "Add a screenshot…", or the API's message about it. */
	readonly error: string | null;
	readonly inputRef?: Ref<HTMLInputElement>;
	onPick(file: File): void;
	onRemove(): void;
}

/** What the picker's polite status says. */
export function proofStatus(state: ProofState): string {
	if (state.kind === "preparing") return copy.form.preparing;
	if (state.kind === "ready") return copy.form.ready;
	if (state.problem) {
		return fill(copy.form.problems[state.problem.kind], {
			name: state.problem.name,
		});
	}
	return "";
}

/**
 * One payment screenshot (spec ruling 15). The file input stays in place
 * whatever the state, so focus never drops; while a screenshot is being
 * prepared or sent, its click is prevented (no second decode, no swap
 * mid-send) and it says so with aria-disabled.
 */
export function ProofPicker({
	state,
	preview,
	busy,
	error,
	inputRef,
	onPick,
	onRemove,
}: ProofPickerProps) {
	const locked = busy || state.kind === "preparing";
	return (
		<fieldset id="proof" className="deposit-proof">
			<legend className="deposit-label">{copy.form.proof}</legend>
			<p id="proof-hint" className="deposit-muted">
				{copy.form.proofHint}
			</p>
			{state.kind === "ready" && preview ? (
				<img
					className="deposit-preview"
					src={preview}
					alt={copy.form.previewAlt}
				/>
			) : null}
			<div className="deposit-proof-actions">
				<label
					className={
						locked ? "deposit-pick deposit-pick-locked" : "deposit-pick"
					}
				>
					<input
						ref={inputRef}
						id="proof-input"
						className="sr-only"
						type="file"
						accept={ACCEPT}
						aria-describedby={error ? "proof-hint proof-error" : "proof-hint"}
						aria-invalid={error ? true : undefined}
						aria-disabled={locked ? true : undefined}
						onClick={(event) => {
							if (locked) event.preventDefault();
						}}
						onChange={(event) => {
							const input = event.currentTarget;
							const picked = input.files?.[0];
							input.value = "";
							if (picked) onPick(picked);
						}}
					/>
					<ImagePlus aria-hidden="true" className="size-5" />
					<span>
						{state.kind === "ready" ? copy.form.replace : copy.form.add}
					</span>
				</label>
				{state.kind === "ready" ? (
					<button
						type="button"
						className="action action-secondary"
						aria-disabled={busy ? true : undefined}
						onClick={() => {
							if (!busy) onRemove();
						}}
					>
						<X aria-hidden="true" className="size-5" />
						{copy.form.remove}
					</button>
				) : null}
			</div>
			<p className="deposit-proof-status" aria-live="polite">
				{proofStatus(state)}
			</p>
			{error ? (
				<p id="proof-error" className="deposit-field-error">
					{error}
				</p>
			) : null}
		</fieldset>
	);
}
