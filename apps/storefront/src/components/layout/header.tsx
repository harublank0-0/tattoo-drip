import { ArrowUpRight } from "lucide-react";
import { artist } from "#/data/mock/artist";
import { MobileNav } from "./mobile-nav";
import { navigation } from "./navigation";

export function Header() {
	return (
		<header className="site-header">
			<div className="page-container flex h-20 items-center justify-between gap-6 md:h-24">
				<a
					href="#top"
					className="studio-wordmark"
					aria-label={`${artist.studio} — home`}
				>
					<span className="font-display text-[32px] leading-none tracking-[0.04em]">
						SANGI<span className="text-accent">.</span>
					</span>
					<span className="text-[8px] leading-relaxed tracking-[0.22em]">
						TATTOO
						<br />
						STUDIO
					</span>
				</a>
				<nav
					aria-label="Main navigation"
					className="hidden items-center gap-10 md:flex"
				>
					{navigation.map((item) => (
						<a
							key={item.label}
							href={item.href}
							className="nav-link eyebrow flex min-h-11 items-center gap-2"
						>
							{item.label}
							{item.label === "Book" ? (
								<ArrowUpRight className="size-3.5" aria-hidden="true" />
							) : null}
						</a>
					))}
				</nav>
				<MobileNav />
			</div>
		</header>
	);
}
