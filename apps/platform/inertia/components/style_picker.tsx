import { Checkbox } from "~/components/ui/checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "~/components/ui/field";

/**
 * The styles of a work photo as checkboxes (Studio OS, the portfolio's
 * upload and edit): controlled, and once `max` are ticked the others are
 * disabled, so the limit is plain before anything is sent (the server holds
 * it too and its refusal shows under the list). With `name`, each ticked box
 * sends `name[]` in a form. One column on a phone, two from `sm`; every box
 * is 44 px tall.
 */
export default function StylePicker({
	idPrefix,
	options,
	value,
	onChange,
	max,
	help,
	error,
	name,
	disabled = false,
}: {
	idPrefix: string;
	options: { slug: string; name: string }[];
	value: string[];
	onChange: (next: string[]) => void;
	max: number;
	help: string;
	error?: string;
	name?: string;
	disabled?: boolean;
}) {
	const full = value.length >= max;
	const helpId = `${idPrefix}-help`;
	const errorId = `${idPrefix}-error`;
	return (
		<FieldSet
			data-invalid={!!error}
			aria-describedby={error ? `${helpId} ${errorId}` : helpId}
		>
			<FieldLegend variant="label">Styles</FieldLegend>
			<FieldDescription id={helpId}>{help}</FieldDescription>
			<div className="grid gap-x-6 sm:grid-cols-2">
				{options.map((style, index) => {
					const checked = value.includes(style.slug);
					const id = `${idPrefix}-${style.slug}`;
					return (
						<Field
							key={style.slug}
							orientation="horizontal"
							className="min-h-11 items-center"
						>
							<Checkbox
								id={id}
								name={name ? `${name}[]` : undefined}
								value={style.slug}
								checked={checked}
								disabled={disabled || (full && !checked)}
								onCheckedChange={(next) =>
									onChange(
										next === true
											? options
													.map(({ slug }) => slug)
													.filter(
														(slug) =>
															slug === style.slug || value.includes(slug),
													)
											: value.filter((slug) => slug !== style.slug),
									)
								}
								// A refused save puts focus on the first box, which stands for the list.
								aria-invalid={index === 0 && !!error}
								aria-describedby={index === 0 && error ? errorId : undefined}
							/>
							<FieldLabel htmlFor={id} className="font-normal">
								{style.name}
							</FieldLabel>
						</Field>
					);
				})}
			</div>
			{error && <FieldError id={errorId}>{error}</FieldError>}
		</FieldSet>
	);
}
