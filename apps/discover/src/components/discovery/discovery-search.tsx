import { useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { SEARCH_MAX, SEARCH_MIN } from "#/lib/search";
import { cn } from "#/lib/utils";
import { Button } from "../ui/button.tsx";

/**
 * Discover's search box (D05): a real GET form to `action` with the text in
 * `name` (`?q=…`), so it works before JavaScript loads; with JavaScript it
 * navigates in the app instead (or calls `onSearch`). The API takes 2 to 80
 * characters (docs/discover/api.md), so the form asks for the same.
 *
 * Uncontrolled with `defaultValue`, controlled with `value` and `onValueChange`.
 */
export function DiscoverySearch({
	action,
	name = "q",
	label,
	placeholder,
	defaultValue = "",
	value,
	onValueChange,
	onSearch,
	pending = false,
	size = "md",
	tone = "paper",
	hidden = [],
	className,
}: {
	/** Where the search goes: a Discover path that exists (src/lib/routes.ts). */
	action: string;
	name?: string;
	/** The field's accessible name, shown above it. */
	label: string;
	placeholder?: string;
	defaultValue?: string;
	value?: string;
	onValueChange?: (value: string) => void;
	/** Instead of navigating: called with the trimmed text. */
	onSearch?: (query: string) => void;
	/** A search the page is loading: the button says so and waits. */
	pending?: boolean;
	size?: "md" | "lg";
	tone?: "paper" | "night";
	/**
	 * The rest of the address, as hidden fields, so a search without
	 * JavaScript keeps the page's filters (D07 directories). With
	 * JavaScript, `onSearch` decides.
	 */
	hidden?: readonly [string, string][];
	className?: string;
}) {
	const id = useId();
	const navigate = useNavigate();
	const input = useRef<HTMLInputElement>(null);
	const [own, setOwn] = useState(defaultValue);
	const text = value ?? own;
	const setText = (next: string) => {
		if (value === undefined) setOwn(next);
		onValueChange?.(next);
	};

	const submit = (event: FormEvent<HTMLFormElement>) => {
		if (pending) {
			event.preventDefault();
			return;
		}
		const query = text.trim();
		if (query.length < SEARCH_MIN) return; // the browser shows the minlength message
		event.preventDefault();
		if (onSearch) onSearch(query);
		else navigate({ to: action, search: { [name]: query } as never });
	};

	return (
		<search className={className}>
			<form
				action={action}
				method="get"
				onSubmit={submit}
				className="flex flex-col gap-2"
			>
				{hidden.map(([field, fieldValue]) => (
					<input key={field} type="hidden" name={field} value={fieldValue} />
				))}
				<label
					htmlFor={id}
					className={cn(
						"text-sm font-medium",
						tone === "night" ? "text-night-ink" : "text-ink",
					)}
				>
					{label}
				</label>
				<div className="flex gap-2">
					<div className="relative flex-1">
						<SearchIcon
							className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
							aria-hidden="true"
						/>
						<input
							ref={input}
							id={id}
							name={name}
							type="search"
							value={text}
							onChange={(event) => setText(event.target.value)}
							placeholder={placeholder}
							minLength={SEARCH_MIN}
							maxLength={SEARCH_MAX}
							required
							autoComplete="off"
							enterKeyHint="search"
							className={cn(
								"w-full min-w-0 rounded-[2px] border border-input bg-paper-raised pr-12 pl-12 text-ink placeholder:text-ink-muted [&::-webkit-search-cancel-button]:appearance-none",
								size === "lg"
									? "min-h-14 text-lg"
									: "min-h-12 text-base lg:min-h-11",
							)}
						/>
						{text !== "" && (
							<button
								type="button"
								onClick={() => {
									setText("");
									input.current?.focus();
								}}
								className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center text-ink-muted hover:text-ink"
							>
								<XIcon className="size-4" aria-hidden="true" />
								<span className="sr-only">Clear search</span>
							</button>
						)}
					</div>
					<Button
						type="submit"
						variant={tone === "night" ? "accent" : "primary"}
						size={size === "lg" ? "lg" : "md"}
						aria-disabled={pending || undefined}
						className={size === "lg" ? "min-h-14" : undefined}
					>
						{pending ? (
							<LoaderCircleIcon className="animate-spin" aria-hidden="true" />
						) : null}
						{pending ? "Searching…" : "Search"}
					</Button>
				</div>
			</form>
		</search>
	);
}
