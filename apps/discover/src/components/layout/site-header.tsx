import type { ResolvedCountry } from "#/lib/country";
import { businessNav, PRIMARY_NAV } from "#/lib/routes";
import { cn } from "#/lib/utils";
import { buttonVariants } from "../ui/button.tsx";
import { CountrySelector } from "./country-selector.tsx";
import { MobileNav } from "./mobile-nav.tsx";
import { NavLink } from "./nav-link.tsx";
import { Wordmark } from "./wordmark.tsx";

/** A primary link: quiet until hovered, an underline bar on its own page. */
const PRIMARY_LINK =
	"relative inline-flex min-h-10 items-center text-sm font-medium text-ink-muted transition-colors hover:text-ink data-[status=active]:text-ink after:absolute after:inset-x-0 after:bottom-1 after:h-px after:origin-left after:scale-x-0 after:bg-ink after:transition-transform data-[status=active]:after:scale-x-100";

/**
 * The global header (D05; Pricing D06): the wordmark, the discovery links
 * and the business links (For studios, Pricing, Sign in, Get started) from
 * `lg`; the wordmark and the menu button below it. The visitor's country
 * (D06.5) sits before the business links; on phones it is in the menu.
 * Sticky, on the paper colour, one hairline.
 */
export function SiteHeader({
	studioOsUrl,
	country,
	markets,
}: {
	studioOsUrl: string;
	country: ResolvedCountry;
	markets: readonly string[];
}) {
	const business = businessNav(studioOsUrl);
	return (
		<header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
			<div className="page-gutter mx-auto flex h-16 max-w-[90rem] items-center gap-8 lg:gap-5 xl:gap-8">
				<Wordmark />
				<nav aria-label="Discover" className="hidden lg:block">
					<ul className="flex items-center gap-6 xl:gap-7">
						{PRIMARY_NAV.map((item) => (
							<li key={item.to}>
								<NavLink item={item} className={PRIMARY_LINK} />
							</li>
						))}
					</ul>
				</nav>
				<div className="ml-auto hidden lg:block">
					<CountrySelector country={country} markets={markets} />
				</div>
				<nav aria-label="For businesses" className="hidden lg:block">
					<ul className="flex items-center gap-1">
						<li>
							<NavLink
								item={business.forStudios}
								className={cn(PRIMARY_LINK, "mr-5")}
							/>
						</li>
						<li>
							<NavLink
								item={business.pricing}
								className={cn(PRIMARY_LINK, "mr-5")}
							/>
						</li>
						<li>
							<NavLink
								item={business.signIn}
								className={buttonVariants({ variant: "ghost", size: "sm" })}
							/>
						</li>
						<li>
							<NavLink
								item={business.getStarted}
								className={buttonVariants({ variant: "primary", size: "sm" })}
							/>
						</li>
					</ul>
				</nav>
				<div className="ml-auto lg:hidden">
					<MobileNav
						studioOsUrl={studioOsUrl}
						country={country}
						markets={markets}
					/>
				</div>
			</div>
		</header>
	);
}
