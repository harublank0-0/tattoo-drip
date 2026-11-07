import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import { EditorialSection, PageContainer } from "#/components/discovery/layout";
import { buttonVariants } from "#/components/ui/button";
import { PRIMARY_NAV, paths } from "#/lib/routes";
import { cn } from "#/lib/utils";

/**
 * `/`: the foundation's front page (D05). The finished homepage, with real
 * studios and work, is D06; this page only introduces Discover and offers
 * the one search that works today, the studio search.
 */
export const Route = createFileRoute("/")({
	component: Home,
});

function Home() {
	return (
		<>
			<section aria-labelledby="home-title" className="border-b border-line">
				<PageContainer className="grid gap-12 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:py-28">
					<div className="flex flex-col gap-6 motion-safe:animate-fade-up">
						<p className="eyebrow text-accent">Tattoo Drip Discover</p>
						<h1
							id="home-title"
							className="font-display text-display-xl font-bold"
						>
							Find the artist behind the work you want.
						</h1>
						<p className="max-w-xl text-lg text-ink-muted">
							Tattoo studios and independent artists, their published work, and
							a direct way to book with them.
						</p>
					</div>
					<DiscoverySearch
						action={paths.studios()}
						label="Search studios by name"
						placeholder="Studio name"
						size="lg"
					/>
				</PageContainer>
			</section>

			<EditorialSection labelledBy="explore-title">
				<h2 id="explore-title" className="eyebrow mb-6 text-ink-muted">
					Explore
				</h2>
				<ul className="border-t border-ink">
					{PRIMARY_NAV.map((item) => (
						<li key={item.to} className="border-b border-line">
							<Link
								to={item.to}
								className="group flex min-h-20 items-center justify-between gap-6 py-4 font-display text-display-md font-bold"
							>
								{item.label}
								<ArrowRightIcon
									className="size-6 shrink-0 transition-transform motion-safe:group-hover:translate-x-1"
									aria-hidden="true"
								/>
							</Link>
						</li>
					))}
				</ul>
			</EditorialSection>

			<EditorialSection tone="night" labelledBy="studios-title">
				<div className="flex flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between">
					<div className="flex max-w-2xl flex-col gap-4">
						<p className="eyebrow text-night-muted">For studios and artists</p>
						<h2
							id="studios-title"
							className="font-display text-display-lg font-bold"
						>
							Run your studio on Studio OS. Get found here.
						</h2>
					</div>
					<Link
						to={paths.forStudios()}
						className={cn(buttonVariants({ variant: "accent", size: "lg" }))}
					>
						For studios
					</Link>
				</div>
			</EditorialSection>
		</>
	);
}
