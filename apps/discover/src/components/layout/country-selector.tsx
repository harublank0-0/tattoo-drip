import { useRouter, useRouterState } from "@tanstack/react-router";
import { CheckIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	countryName,
	countryOptions,
	type ResolvedCountry,
	switchCountryPath,
} from "#/lib/country";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";
import { buttonVariants } from "../ui/button.tsx";

/**
 * Switches the visitor's country (D06.5): saves the cookie through
 * `POST /preferences/country`, updates this tab's preference, then shows the
 * page again for the new country: a page whose address names a country gets
 * the new one (its city dropped), any other page is re-read (loaders run
 * again; each country has its own query keys). Resolves false when the save
 * failed, so the caller can fall back to the plain form post.
 */
function useCountrySwitch() {
	const router = useRouter();
	return async (country: string): Promise<boolean> => {
		const href = router.state.location.href;
		try {
			const response = await fetch(paths.countryPreference(), {
				method: "POST",
				headers: { Accept: "application/json" },
				body: new URLSearchParams({ country, return: href }),
				credentials: "same-origin",
			});
			if (!response.ok) return false;
		} catch {
			return false;
		}
		router.options.context.preference.set({ country, source: "cookie" });
		const next = switchCountryPath(href, country);
		if (next !== href) await router.navigate({ href: next });
		else await router.invalidate();
		return true;
	};
}

/**
 * A form of country buttons (`name="country"`): without JavaScript a plain
 * POST that saves the cookie and redirects back here; with it, the same
 * request by fetch and an in-app update. A failed fetch falls back to the
 * plain post.
 */
export function CountryForm({
	children,
	className,
	onSwitched,
}: {
	children: ReactNode;
	className?: string;
	onSwitched?: (country: string) => void;
}) {
	const href = useRouterState({ select: (state) => state.location.href });
	const switchTo = useCountrySwitch();
	const [pending, setPending] = useState(false);

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		const submitter = (event.nativeEvent as SubmitEvent).submitter;
		const country =
			submitter instanceof HTMLButtonElement ? submitter.value : "";
		if (!country) return;
		event.preventDefault();
		if (pending) return;
		const form = event.currentTarget;
		setPending(true);
		const switched = await switchTo(country);
		setPending(false);
		if (switched) {
			onSwitched?.(country);
			return;
		}
		const input = document.createElement("input");
		input.type = "hidden";
		input.name = "country";
		input.value = country;
		form.append(input);
		form.submit();
	};

	return (
		<form
			method="post"
			action={paths.countryPreference()}
			onSubmit={onSubmit}
			aria-busy={pending || undefined}
			className={className}
		>
			<input type="hidden" name="return" value={href} />
			{children}
		</form>
	);
}

/** One country's button; the current one is marked (`aria-current`) with a check. */
function CountryOption({
	code,
	current,
	className,
}: {
	code: string;
	current: boolean;
	className: string;
}) {
	return (
		<button
			type="submit"
			name="country"
			value={code}
			aria-current={current ? "true" : undefined}
			className={className}
		>
			<span>{countryName(code)}</span>
			{current && (
				<CheckIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
			)}
		</button>
	);
}

/**
 * The header's country (desktop, from `lg`). With more than one country to
 * offer: a disclosure button naming the current country, opening a small
 * panel of country buttons (a native `<details>`, so it opens without
 * JavaScript too; Escape and a click outside close it, and focus returns
 * to the button). With a single market: the country's name only, since a
 * picker with one choice is noise.
 */
export function CountrySelector({
	country,
	markets,
}: {
	country: ResolvedCountry;
	markets: readonly string[];
}) {
	const [open, setOpen] = useState(false);
	const details = useRef<HTMLDetailsElement>(null);
	const summary = useRef<HTMLElement>(null);
	const labelId = useId();
	const options = countryOptions(markets, country.country);
	const name = countryName(country.country);

	// The <details> is uncontrolled: the browser owns `open` (so a fast
	// Escape then Enter is never undone by a late render) and `open` here only
	// mirrors it, from the toggle event. A press outside an open panel closes
	// it (listening all along, so even a press right after opening counts).
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const element = details.current;
			if (element?.open && !element.contains(event.target as Node))
				element.open = false;
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, []);

	if (options.length < 2) {
		return (
			<p className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-ink-muted">
				<GlobeIcon className="size-4" aria-hidden="true" />
				<span className="sr-only">Country: </span>
				{name}
			</p>
		);
	}

	const close = () => {
		if (details.current) details.current.open = false;
		summary.current?.focus();
	};

	return (
		<details
			ref={details}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			// Tabbing out of the panel closes it, so it never covers the links
			// focus moved to (focus stays where it went; no return to the trigger).
			onBlur={(event) => {
				const next = event.relatedTarget as Node | null;
				if (next && !event.currentTarget.contains(next))
					event.currentTarget.open = false;
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && details.current?.open) {
					event.preventDefault();
					close();
				}
			}}
			className="relative"
		>
			<summary
				ref={summary}
				className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-[2px] px-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden"
			>
				<GlobeIcon className="hidden size-4 xl:block" aria-hidden="true" />
				<span className="sr-only">Country: </span>
				{/* Tight from lg to xl, beside every header link: a long name is cut. */}
				<span className="max-w-20 truncate xl:max-w-none" title={name}>
					{name}
				</span>
				<ChevronDownIcon
					className={cn(
						"hidden size-4 transition-transform xl:block",
						open && "rotate-180",
					)}
					aria-hidden="true"
				/>
			</summary>
			<div className="absolute right-0 top-full z-50 mt-2 w-60 border border-line-strong bg-paper-raised p-2 shadow-lg">
				<p id={labelId} className="eyebrow px-2 pt-1 pb-2 text-ink-muted">
					Browse listings in
				</p>
				<CountryForm onSwitched={close}>
					<ul aria-labelledby={labelId}>
						{options.map((code) => (
							<li key={code}>
								<CountryOption
									code={code}
									current={code === country.country}
									className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[2px] px-2 text-left text-sm font-medium hover:bg-paper-sunk aria-[current=true]:text-ink"
								/>
							</li>
						))}
					</ul>
				</CountryForm>
			</div>
		</details>
	);
}

/**
 * The mobile menu's country group: the same buttons as rows; the sheet
 * closes after a switch (and Radix returns focus to the menu button). With
 * a single market: the country and a note, no picker.
 */
export function MobileCountryGroup({
	country,
	markets,
	onSwitched,
}: {
	country: ResolvedCountry;
	markets: readonly string[];
	onSwitched: () => void;
}) {
	const options = countryOptions(markets, country.country);
	const name = countryName(country.country);
	return (
		<fieldset className="min-w-0">
			<legend className="eyebrow mb-3 text-ink-muted">Country</legend>
			{options.length < 2 ? (
				<div className="border-b border-line pb-3">
					<p className="flex min-h-12 items-center gap-2 text-lg font-medium">
						<GlobeIcon className="size-5" aria-hidden="true" />
						{name}
					</p>
					<p className="text-sm text-ink-muted">
						{`Discover lists studios in ${name} for now.`}
					</p>
				</div>
			) : (
				<CountryForm onSwitched={onSwitched}>
					<ul>
						{options.map((code) => (
							<li key={code}>
								<CountryOption
									code={code}
									current={code === country.country}
									className="flex min-h-12 w-full items-center justify-between border-b border-line text-left text-lg font-medium aria-[current=true]:text-accent"
								/>
							</li>
						))}
					</ul>
				</CountryForm>
			)}
		</fieldset>
	);
}

/**
 * A country with no listings yet (D06.5): says so, and offers the other
 * markets as buttons (the same switch). Never shows another country's
 * listings in its place.
 */
export function EmptyMarket({
	id,
	country,
	markets,
	noun,
	className,
}: {
	id?: string;
	country: string;
	markets: readonly string[];
	noun: "studios" | "artists";
	className?: string;
}) {
	const others = countryOptions(markets, country).filter(
		(code) => code !== country,
	);
	const name = countryName(country);
	return (
		<div className={cn("flex flex-col items-start gap-4", className)}>
			<h2 id={id} className="font-display text-display-md font-bold">
				{`No ${noun} are listed in ${name} yet.`}
			</h2>
			<p className="max-w-xl text-ink-muted">
				{`${noun === "studios" ? "Studios" : "Artists"} appear here once they choose to list on Discover.${others.length > 0 ? " You can browse another country instead." : ""}`}
			</p>
			{others.length > 0 && (
				<CountryForm className="flex flex-wrap gap-3">
					{others.map((code) => (
						<button
							key={code}
							type="submit"
							name="country"
							value={code}
							className={buttonVariants({ variant: "outline" })}
						>
							{`${noun === "studios" ? "Studios" : "Artists"} in ${countryName(code)}`}
						</button>
					))}
				</CountryForm>
			)}
		</div>
	);
}
