import { useId, useState } from "react";
import { swatchValue } from "~/components/page_look";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

/**
 * One colour of the page look (TAT-56): a text box for the code (#rrggbb, what
 * the form sends; empty means the theme's own colour), the phone's native
 * colour picker beside it (it has no `name`, so only the box is sent) and a
 * Clear button. The picker and the box share one piece of state; the picker
 * shows the typed colour while it is whole, else `fallback` (the theme's
 * violet), because a native picker cannot show "nothing". The server decides
 * whether a colour is accepted (4.5:1 on the page's paper).
 */
export default function ColourField({
	name,
	label,
	description,
	pickLabel,
	defaultValue,
	fallback,
	error,
}: {
	name: string;
	label: string;
	description: string;
	/** The picker's accessible name. */
	pickLabel: string;
	defaultValue: string;
	/** The theme's own colour: the picker's value while the box is empty, and the box's placeholder. */
	fallback: string;
	error?: string;
}) {
	const [text, setText] = useState(defaultValue);
	const help = useId();
	const problem = useId();

	return (
		<Field data-invalid={!!error}>
			<FieldLabel htmlFor={name}>{label}</FieldLabel>
			<div className="flex items-center gap-2">
				<input
					type="color"
					aria-label={pickLabel}
					value={swatchValue(text, fallback)}
					onChange={(event) => setText(event.target.value)}
					className="h-9 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 max-lg:min-h-11"
				/>
				<Input
					id={name}
					name={name}
					type="text"
					value={text}
					onChange={(event) => setText(event.target.value)}
					maxLength={7}
					autoComplete="off"
					spellCheck={false}
					placeholder={fallback}
					className="max-w-40 font-mono"
					aria-invalid={!!error}
					aria-describedby={error ? `${help} ${problem}` : help}
				/>
				<Button type="button" variant="ghost" onClick={() => setText("")}>
					Clear
				</Button>
			</div>
			<FieldDescription id={help}>{description}</FieldDescription>
			{error && <FieldError id={problem}>{error}</FieldError>}
		</Field>
	);
}
