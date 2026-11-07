import { MenuIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ResolvedCountry } from "#/lib/country";
import { businessNav, PRIMARY_NAV } from "#/lib/routes";
import { Button, buttonVariants } from "../ui/button.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
	SheetTrigger,
} from "../ui/sheet.tsx";
import { MobileCountryGroup } from "./country-selector.tsx";
import { NavLink } from "./nav-link.tsx";

/** The `lg` breakpoint, where the header shows every link itself. */
const DESKTOP = "(min-width: 64rem)";

/**
 * The phone and tablet menu (D05): a modal sheet from the right (Radix
 * Dialog: focus moves in and is trapped, Escape and the close button close
 * it and focus returns to the menu button, the page behind is inert). It
 * closes when a link is followed and when the window grows to the desktop
 * header (a rotated tablet), and after a country switch (D06.5: the
 * Country group, after Discover's links).
 */
export function MobileNav({
	studioOsUrl,
	country,
	markets,
}: {
	studioOsUrl: string;
	country: ResolvedCountry;
	markets: readonly string[];
}) {
	const [open, setOpen] = useState(false);
	const business = businessNav(studioOsUrl);
	const close = () => setOpen(false);

	useEffect(() => {
		if (!open) return;
		const query = window.matchMedia(DESKTOP);
		const onChange = () => {
			if (query.matches) setOpen(false);
		};
		onChange();
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [open]);

	const rowClass =
		"flex min-h-12 items-center border-b border-line text-lg font-medium data-[status=active]:text-accent";

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button variant="ghost" size="icon" aria-label="Open menu">
					<MenuIcon className="size-5" aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent side="right" className="w-full max-w-sm gap-0 bg-paper p-0">
				<div className="page-gutter flex h-16 items-center border-b border-line">
					<SheetTitle className="font-display text-xl font-bold">
						Menu
					</SheetTitle>
				</div>
				<SheetDescription className="sr-only">
					Discover's pages, your country and Studio OS for businesses.
				</SheetDescription>
				<div className="page-gutter flex flex-1 flex-col gap-10 overflow-y-auto py-8">
					<nav aria-label="Discover">
						<p className="eyebrow mb-3 text-ink-muted">Discover</p>
						<ul>
							{PRIMARY_NAV.map((item) => (
								<li key={item.to}>
									<NavLink
										item={item}
										className={rowClass}
										onNavigate={close}
									/>
								</li>
							))}
						</ul>
					</nav>
					<MobileCountryGroup
						country={country}
						markets={markets}
						onSwitched={close}
					/>
					<nav aria-label="For businesses">
						<p className="eyebrow mb-3 text-ink-muted">For businesses</p>
						<ul>
							<li>
								<NavLink
									item={business.forStudios}
									className={rowClass}
									onNavigate={close}
								/>
							</li>
							<li>
								<NavLink
									item={business.pricing}
									className={rowClass}
									onNavigate={close}
								/>
							</li>
						</ul>
						<div className="mt-6 grid grid-cols-2 gap-3">
							<NavLink
								item={business.signIn}
								onNavigate={close}
								className={buttonVariants({ variant: "outline", size: "lg" })}
							/>
							<NavLink
								item={business.getStarted}
								onNavigate={close}
								className={buttonVariants({ variant: "primary", size: "lg" })}
							/>
						</div>
					</nav>
				</div>
			</SheetContent>
		</Sheet>
	);
}
