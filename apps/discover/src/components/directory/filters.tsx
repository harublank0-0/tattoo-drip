import { Link } from "@tanstack/react-router";
import type { DiscoverLocation, DiscoverStyle } from "@tattoo-drip/sdk";
import { ChevronDownIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button, buttonVariants } from "#/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "#/components/ui/sheet";
import { countryName } from "#/lib/country";
import {
	activeFilterCount,
	type DirectoryKind,
	type DirectorySearch,
	draftOf,
	type FilterChip,
	type FilterDraft,
	SORTS,
	searchFields,
	sortLabel,
} from "#/lib/directory";
import { cn } from "#/lib/utils";

/** A labelled native select on Discover's tokens: works without JavaScript, 44px+ tall. */
function SelectField({
	label,
	name,
	value,
	onChange,
	children,
	className,
}: {
	label: string;
	name: string;
	value: string;
	onChange: (value: string) => void;
	children: ReactNode;
	className?: string;
}) {
	const id = useId();
	return (
		<div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
			<label htmlFor={id} className="text-sm font-medium text-ink">
				{label}
			</label>
			<div className="relative">
				<select
					id={id}
					name={name}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className="min-h-12 w-full min-w-0 appearance-none rounded-[2px] border border-input bg-paper-raised pr-10 pl-3 text-base text-ink lg:min-h-11 lg:text-sm"
				>
					{children}
				</select>
				<ChevronDownIcon
					className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
					aria-hidden="true"
				/>
			</div>
		</div>
	);
}

export type FilterLists = {
	styles: readonly DiscoverStyle[] | undefined;
	/** The page's country's places only. */
	places: readonly DiscoverLocation[] | undefined;
};

/**
 * The directory's filter controls: style, city (the page's country's
 * places), sort and, for artists, who (at a studio or independent). Each is
 * a real form field, so the toolbar is a GET form without JavaScript.
 */
function FilterFields({
	kind,
	country,
	draft,
	onChange,
	lists,
	stacked = false,
}: {
	kind: DirectoryKind;
	country: string;
	draft: FilterDraft;
	onChange: (draft: FilterDraft) => void;
	lists: FilterLists;
	stacked?: boolean;
}) {
	const width = stacked ? "w-full" : "w-44 xl:w-52";
	const styles = lists.styles ?? [];
	const places = lists.places ?? [];
	return (
		<>
			<SelectField
				label="Style"
				name="style"
				value={draft.style ?? ""}
				onChange={(value) => onChange({ ...draft, style: value || undefined })}
				className={width}
			>
				<option value="">All styles</option>
				{styles.map((style) => (
					<option key={style.slug} value={style.slug}>
						{style.name}
					</option>
				))}
				{draft.style && !styles.some((each) => each.slug === draft.style) && (
					<option value={draft.style}>{draft.style}</option>
				)}
			</SelectField>
			{(places.length > 0 || draft.city) && (
				<SelectField
					label="City"
					name="city"
					value={draft.city ?? ""}
					onChange={(value) => onChange({ ...draft, city: value || undefined })}
					className={width}
				>
					<option value="">{`All of ${countryName(country)}`}</option>
					{places.map((place) => (
						<option key={place.slug} value={place.slug}>
							{place.name}
						</option>
					))}
					{draft.city && !places.some((each) => each.slug === draft.city) && (
						<option value={draft.city}>{draft.city}</option>
					)}
				</SelectField>
			)}
			{kind === "artists" && (
				<SelectField
					label="Works"
					name="independent"
					value={
						draft.independent === undefined ? "" : String(draft.independent)
					}
					onChange={(value) =>
						onChange({
							...draft,
							independent: value === "" ? undefined : value === "true",
						})
					}
					className={width}
				>
					<option value="">At a studio or independent</option>
					<option value="false">At a studio</option>
					<option value="true">Independent</option>
				</SelectField>
			)}
			<SelectField
				label="Sort"
				name="sort"
				value={draft.sort ?? "newest"}
				onChange={(value) =>
					onChange({
						...draft,
						sort: value === "name" || value === "-name" ? value : undefined,
					})
				}
				className={width}
			>
				{SORTS.map((sort) => (
					<option key={sort} value={sort}>
						{sortLabel(sort, kind)}
					</option>
				))}
			</SelectField>
		</>
	);
}

/**
 * The desktop toolbar above the results (from `lg`; at every width without
 * JavaScript): the controls apply together with Apply, with or without
 * JavaScript, so choosing an option (arrowing through a closed select
 * fires a change per key) never navigates away from it (WCAG 3.2.2). The
 * search text and country ride along as hidden fields (the country always,
 * since a city needs it).
 */
export function FilterToolbar({
	kind,
	action,
	search,
	filters,
	lists,
	onApply,
	resetSearch,
}: {
	kind: DirectoryKind;
	action: string;
	search: DirectorySearch;
	filters: DirectorySearch & { country: string };
	lists: FilterLists;
	onApply: (draft: FilterDraft) => void;
	resetSearch: DirectorySearch | undefined;
}) {
	// The selects keep the visitor's choices until Apply; the page's filters
	// win again once it has loaded them (or after a chip, Reset, back/forward).
	const current = draftOf(filters);
	const [draft, setDraft] = useState<FilterDraft>(current);
	const key = JSON.stringify(current);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the filters' value.
	useEffect(() => setDraft(draftOf(filters)), [key]);
	return (
		<form
			action={action}
			method="get"
			aria-label={`Filter ${kind}`}
			onSubmit={(event) => {
				event.preventDefault();
				onApply(draft);
			}}
			className="hidden flex-wrap items-end gap-4 noscript:flex lg:flex"
		>
			{searchFields({ ...search, country: search.country ?? filters.country }, [
				"city",
				"style",
				"sort",
				"independent",
			]).map(([name, value]) => (
				<input key={name} type="hidden" name={name} value={value} />
			))}
			<FilterFields
				kind={kind}
				country={filters.country}
				draft={draft}
				onChange={setDraft}
				lists={lists}
			/>
			<Button type="submit" className="lg:min-h-11">
				Apply
			</Button>
			{resetSearch && (
				<Link
					to={action}
					search={resetSearch as never}
					className={buttonVariants({ variant: "ghost" })}
				>
					Reset
				</Link>
			)}
		</form>
	);
}

/**
 * Below `lg`: a "Filters (n)" button opening a sheet with the same
 * controls, applied together with Apply (Reset clears them). Radix moves
 * focus in, traps it, closes on Escape and returns focus to the button.
 */
export function MobileFilters({
	kind,
	filters,
	lists,
	onApply,
	onReset,
}: {
	kind: DirectoryKind;
	filters: DirectorySearch & { country: string };
	lists: FilterLists;
	onApply: (draft: FilterDraft) => void;
	onReset: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<FilterDraft>(() => draftOf(filters));
	const count = activeFilterCount(filters);
	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				if (next) setDraft(draftOf(filters));
				setOpen(next);
			}}
		>
			<SheetTrigger asChild>
				<Button
					variant="outline"
					className="min-h-12 noscript:hidden lg:hidden"
				>
					<SlidersHorizontalIcon aria-hidden="true" />
					{count > 0 ? `Filters (${count})` : "Filters"}
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
				<SheetHeader className="border-b border-line pr-16">
					<SheetTitle className="font-display text-2xl font-bold">
						Filters
					</SheetTitle>
					<SheetDescription>
						{`${kind === "studios" ? "Studios" : "Artists"} in ${countryName(filters.country)}`}
					</SheetDescription>
				</SheetHeader>
				<form
					id="directory-filters"
					className="flex flex-col gap-5 px-4"
					onSubmit={(event) => {
						event.preventDefault();
						onApply(draft);
						setOpen(false);
					}}
				>
					<FilterFields
						kind={kind}
						country={filters.country}
						draft={draft}
						onChange={setDraft}
						lists={lists}
						stacked
					/>
				</form>
				<SheetFooter className="border-t border-line">
					<Button
						type="submit"
						form="directory-filters"
						size="lg"
						className="w-full"
					>
						Apply
					</Button>
					<Button
						type="button"
						variant="outline"
						size="lg"
						className="w-full"
						onClick={() => {
							onReset();
							setOpen(false);
						}}
					>
						Reset
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

/** The active filters as removable chips, with Clear all. */
export function ActiveFilters({
	action,
	chips,
	clearAll,
}: {
	action: string;
	chips: FilterChip[];
	clearAll: DirectorySearch;
}) {
	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			<p className="mr-1 text-sm text-ink-muted" id="active-filters-label">
				Filtered by
			</p>
			<ul
				aria-labelledby="active-filters-label"
				className="flex flex-wrap gap-2"
			>
				{chips.map((chip) => (
					<li key={chip.key}>
						<Link
							to={action}
							search={chip.remove as never}
							className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-line-strong bg-paper-raised px-3 text-sm font-medium hover:border-ink lg:min-h-9"
						>
							{chip.label}
							<XIcon className="size-4" aria-hidden="true" />
							<span className="sr-only">(remove this filter)</span>
						</Link>
					</li>
				))}
			</ul>
			{chips.length > 1 && (
				<Link
					to={action}
					search={clearAll as never}
					className="inline-flex min-h-11 items-center px-2 text-sm font-medium underline underline-offset-4 lg:min-h-9"
				>
					Clear all
				</Link>
			)}
		</div>
	);
}
