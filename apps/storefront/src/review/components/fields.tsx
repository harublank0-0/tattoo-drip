import type { ReactNode } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { copy } from "../copy.ts";
import { charCount, FIELD_IDS } from "../view-model.ts";

/*
 * The review form's controls (Reviews and Fresh ink): every one with a
 * visible label, its hint and its error linked with aria-describedby, and
 * aria-invalid while it has an error. Props only, so the render tests run
 * them with react-dom/server.
 */

/** The ids an input describes itself with: its hint, its counter and its error, those that exist. */
export function describedBy(
	...ids: (string | null | undefined | false)[]
): string | undefined {
	const kept = ids.filter((id): id is string => typeof id === "string");
	return kept.length > 0 ? kept.join(" ") : undefined;
}

/** A field's error line, which its control points to. */
export function FieldError({
	id,
	message,
}: {
	id: string;
	message: string | null;
}) {
	if (!message) return null;
	return (
		<p className="deposit-field-error" id={id}>
			{message}
		</p>
	);
}

/**
 * The rating: a native radio group of five stars, each with its words
 * visible ("4 stars, Very good"), so it works with a keyboard (arrow keys),
 * a screen reader and a 44 px tap. Nothing is chosen until the client picks.
 */
export function StarRating({
	value,
	onChange,
	error,
}: {
	value: number;
	onChange: (rating: number) => void;
	error: string | null;
}) {
	const errorId = "review-rating-error";
	return (
		<fieldset
			className="review-stars"
			aria-describedby={describedBy(error && errorId)}
		>
			<legend className="deposit-label">{copy.ratingLegend}</legend>
			<div className="review-stars-options">
				{[1, 2, 3, 4, 5].map((count) => (
					<label
						key={count}
						className="review-star"
						data-on={value >= count ? "" : undefined}
					>
						<input
							type="radio"
							name="rating"
							id={`review-rating-${count}`}
							value={count}
							checked={value === count}
							aria-invalid={error ? true : undefined}
							onChange={() => onChange(count)}
						/>
						<span className="review-star-glyph" aria-hidden="true">
							★
						</span>
						<span className="review-star-words">
							<Fill
								template={count === 1 ? copy.ratingStar : copy.ratingStars}
								values={{ count }}
							/>
							{`, ${copy.ratingWords[count]}`}
						</span>
					</label>
				))}
			</div>
			<FieldError id={errorId} message={error} />
		</fieldset>
	);
}

/** A text area with its live character count (as the API counts: code points). */
export function CountedText({
	id,
	label,
	hint,
	value,
	max,
	rows = 5,
	error,
	onChange,
	readOnly = false,
}: {
	id: string;
	label: string;
	hint?: string;
	value: string;
	max: number;
	rows?: number;
	error: string | null;
	onChange: (value: string) => void;
	readOnly?: boolean;
}) {
	const count = charCount(value.trim());
	return (
		<div className="review-field">
			<label className="deposit-label" htmlFor={id}>
				{label}
			</label>
			{hint ? (
				<p className="deposit-muted" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<textarea
				id={id}
				className="review-input"
				value={value}
				rows={rows}
				dir="auto"
				readOnly={readOnly}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy(
					hint && `${id}-hint`,
					`${id}-count`,
					error && `${id}-error`,
				)}
				onChange={(event) => onChange(event.target.value)}
			/>
			<p
				className="review-count"
				id={`${id}-count`}
				data-over={count > max ? "" : undefined}
				aria-live="polite"
			>
				<Fill template={copy.count} values={{ count, max }} />
			</p>
			<FieldError id={`${id}-error`} message={error} />
		</div>
	);
}

/** A one-line text field. */
export function TextField({
	id,
	label,
	hint,
	value,
	maxLength,
	error,
	onChange,
	autoComplete = "off",
}: {
	id: string;
	label: string;
	hint?: string;
	value: string;
	maxLength: number;
	error: string | null;
	onChange: (value: string) => void;
	autoComplete?: string;
}) {
	return (
		<div className="review-field">
			<label className="deposit-label" htmlFor={id}>
				{label}
			</label>
			{hint ? (
				<p className="deposit-muted" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
			<input
				id={id}
				className="review-input"
				type="text"
				value={value}
				dir="auto"
				autoComplete={autoComplete}
				// A soft limit in UTF-16 units: the real one (code points) is the check's.
				maxLength={maxLength * 2}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy(
					hint && `${id}-hint`,
					error && `${id}-error`,
				)}
				onChange={(event) => onChange(event.target.value)}
			/>
			<FieldError id={`${id}-error`} message={error} />
		</div>
	);
}

/** One consent: a separate, unticked-by-default checkbox with plain words (ruling 8). */
export function ConsentBox({
	id,
	label,
	hint,
	checked,
	onChange,
}: {
	id: string;
	label: ReactNode;
	hint?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="review-check">
			<input
				type="checkbox"
				id={id}
				checked={checked}
				aria-describedby={hint ? `${id}-hint` : undefined}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<label htmlFor={id}>{label}</label>
			{hint ? (
				<p className="deposit-muted review-check-hint" id={`${id}-hint`}>
					{hint}
				</p>
			) : null}
		</div>
	);
}

/** The style choices: up to three checkboxes of the studio's list. */
export function StylePicker({
	styles,
	chosen,
	onChange,
	error,
}: {
	styles: readonly { slug: string; name: string }[];
	chosen: readonly string[];
	onChange: (styles: string[]) => void;
	error: string | null;
}) {
	const full = chosen.length >= 3;
	return (
		<fieldset
			className="review-styles"
			id={FIELD_IDS.styles}
			tabIndex={-1}
			aria-describedby={describedBy(error && "review-styles-error")}
		>
			<legend className="deposit-label">{copy.stylesLegend}</legend>
			<div className="review-style-options">
				{styles.map((style) => {
					const on = chosen.includes(style.slug);
					return (
						<label key={style.slug} className="review-style">
							<input
								type="checkbox"
								checked={on}
								aria-disabled={!on && full ? true : undefined}
								onChange={() => {
									if (on)
										onChange(chosen.filter((slug) => slug !== style.slug));
									else if (!full) onChange([...chosen, style.slug]);
								}}
							/>
							<span>{style.name}</span>
						</label>
					);
				})}
			</div>
			<FieldError id="review-styles-error" message={error} />
		</fieldset>
	);
}
