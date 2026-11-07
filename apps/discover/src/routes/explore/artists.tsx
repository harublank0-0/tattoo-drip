import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "#/components/discovery/layout";
import { FoundationNotice } from "#/components/discovery/states";
import { buttonVariants } from "#/components/ui/button";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/** `/explore/artists`: planned for D07, minimal until then (D05). Never indexed while unfinished. */
export const Route = createFileRoute("/explore/artists")({
	head: () => ({ meta: pageMeta({ title: "Find artists", noindex: true }) }),
	component: Page,
});

function Page() {
	return (
		<>
			<PageHeader
				title="Find artists"
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Find artists" },
				]}
			/>
			<FoundationNotice
				action={
					<Link
						to={paths.studios()}
						className={buttonVariants({ variant: "primary" })}
					>
						Search studios
					</Link>
				}
			>
				Artist profiles and search are on their way. Meanwhile, search studios
				by name to find who works there.
			</FoundationNotice>
		</>
	);
}
