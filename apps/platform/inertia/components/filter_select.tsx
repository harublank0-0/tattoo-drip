import { useEffect, useRef } from "react";

/**
 * A filter (TAT-103; the calendar's, and the portfolio's since Studio OS): a
 * pick with the mouse or a finger applies at once, with no button, keeping
 * the rest of the page's address; the visit keeps the page's state, so
 * the select stays mounted and keeps focus. A closed native select also
 * changes its value on every arrow key, and loading the page at each step
 * would be a change of context the person didn't ask for (WCAG 3.2.2): a
 * change made with the keyboard waits for Enter or for focus to leave. Its label is visually hidden: the first
 * option names the filter's default.
 */
export default function FilterSelect({
	id,
	label,
	value,
	options,
	onApply,
}: {
	id: string;
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onApply: (value: string) => void;
}) {
	const select = useRef<HTMLSelectElement>(null);
	// What the last key press means: arrows move the value, Enter confirms.
	const viaKeys = useRef(false);
	const waiting = useRef(false);
	// A back or forward step changes the prop, not what the person chose.
	useEffect(() => {
		if (select.current) select.current.value = value;
		waiting.current = false;
	}, [value]);

	const apply = (next: string) => {
		waiting.current = false;
		onApply(next);
	};
	// Enter or blur: apply a keyboard change that is still waiting.
	const commit = (element: HTMLSelectElement) => {
		if (waiting.current && element.value !== value) apply(element.value);
		waiting.current = false;
	};

	return (
		<div className="min-w-0 flex-1 sm:flex-none">
			<label htmlFor={id} className="sr-only">
				{label}
			</label>
			<select
				ref={select}
				id={id}
				defaultValue={value}
				onPointerDown={() => {
					viaKeys.current = false;
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && waiting.current) {
						// Chromium opens the picker on Enter, which would also
						// swallow the key's release: apply the choice instead.
						event.preventDefault();
						commit(event.currentTarget);
					} else if (event.key !== "Enter" && event.key !== "Tab") {
						viaKeys.current = true;
					}
				}}
				onChange={(event) => {
					if (viaKeys.current) waiting.current = true;
					else apply(event.currentTarget.value);
				}}
				// An Enter that picks an option in the open list changes the value
				// after its keydown, so that one is confirmed on release.
				onKeyUp={(event) => {
					if (event.key === "Enter") commit(event.currentTarget);
				}}
				onBlur={(event) => commit(event.currentTarget)}
				className="h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-lg:min-h-11 sm:w-auto"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}
