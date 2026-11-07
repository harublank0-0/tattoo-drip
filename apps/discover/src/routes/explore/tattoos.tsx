import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "#/components/discovery/layout";
import { FoundationNotice } from "#/components/discovery/states";
import { buttonVariants } from "#/components/ui/button";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/** `/explore/tattoos`: planned for D09, minimal until then (D05). Never indexed while unfinished. */
export const Route = createFileRoute("/explore/tattoos")({
	head: () => ({
		meta: pageMeta({ title: "Tattoo inspiration", noindex: true }),
	}),
	component: Page,
});

function Page() {
	return (
		<>
			<PageHeader
				title="Tattoo inspiration"
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Tattoo inspiration" },
				]}
			/>
			<FoundationNotice
				action={
					<Link
						to={paths.studios()}
						className={buttonVariants({ variant: "primary" })}
					>
						Explore studios
					</Link>
				}
			>
				A gallery of published work from listed studios and artists is on its
				way.
			</FoundationNotice>
		</>
	);
}
