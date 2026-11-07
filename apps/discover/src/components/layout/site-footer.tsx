import { footerGroups } from "#/lib/routes";
import { NavLink } from "./nav-link.tsx";
import { Wordmark } from "./wordmark.tsx";

/**
 * The global footer (D05): a dark editorial band with the wordmark large,
 * then only destinations that exist. The privacy policy and terms are not
 * written yet (D06, after the product owner's review), so they are named
 * as coming, never linked to a page that would look approved.
 */
export function SiteFooter({ studioOsUrl }: { studioOsUrl: string }) {
	const groups = footerGroups(studioOsUrl);
	return (
		<footer className="night">
			<div className="page-gutter mx-auto max-w-[90rem] py-16 lg:py-24">
				<div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr]">
					<div className="flex flex-col gap-4">
						<Wordmark size="lg" />
						<p className="max-w-sm text-night-muted">
							Tattoo studios and independent artists, their published work, and
							a direct way to book with them.
						</p>
					</div>
					{groups.map((group) => (
						<nav key={group.title} aria-label={group.title}>
							<h2 className="eyebrow mb-4 text-night-muted">{group.title}</h2>
							<ul className="flex flex-col">
								{group.links.map((item) => (
									<li key={item.label}>
										<NavLink
											item={item}
											className="inline-flex min-h-11 items-center text-night-ink underline-offset-4 decoration-accent-bright hover:underline lg:min-h-9"
										/>
									</li>
								))}
							</ul>
						</nav>
					))}
				</div>
				<div className="mt-16 flex flex-col gap-3 border-t border-night-line pt-6 text-sm text-night-muted sm:flex-row sm:items-center sm:justify-between">
					<p>© {new Date().getFullYear()} Tattoo Drip</p>
					<p>Privacy policy and terms are coming before launch.</p>
				</div>
			</div>
		</footer>
	);
}
