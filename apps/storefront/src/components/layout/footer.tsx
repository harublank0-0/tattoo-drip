import { ArrowUpRight } from "lucide-react";
import { artist } from "#/data/mock/artist";

export function Footer() {
	return (
		<footer className="border-t border-border py-12 md:py-16">
			<div className="page-container">
				<div className="flex flex-col justify-between gap-10 sm:flex-row">
					<div>
						<a href="#top" className="eyebrow">
							{artist.studio}
						</a>
						<p className="mt-3 text-sm text-muted-foreground">
							{artist.location}
						</p>
					</div>
					<nav
						aria-label="Footer navigation"
						className="flex flex-wrap items-start gap-7"
					>
						<a className="text-link" href={artist.instagramUrl}>
							Instagram
							<ArrowUpRight aria-hidden="true" className="size-3.5" />
						</a>
						<a className="text-link" href={`mailto:${artist.email}`}>
							Email
							<ArrowUpRight aria-hidden="true" className="size-3.5" />
						</a>
						<a className="text-link" href="#booking">
							Booking
							<ArrowUpRight aria-hidden="true" className="size-3.5" />
						</a>
					</nav>
				</div>
				<div className="mt-16 flex flex-wrap justify-between gap-4 text-[10px] tracking-wide text-muted-foreground">
					<p>© 2026 Sangi Tattoo Studio</p>
					<p>Made with intention. Worn for a lifetime.</p>
				</div>
			</div>
		</footer>
	);
}
