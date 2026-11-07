import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "#/components/discovery/layout";
import { FoundationNotice } from "#/components/discovery/states";
import { buttonVariants } from "#/components/ui/button";
import { paths, studioOsLinks } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/** `/for-studios`: planned for D06, minimal until then (D05). Never indexed while unfinished. */
export const Route = createFileRoute("/for-studios")({
	head: () => ({ meta: pageMeta({ title: "For studios", noindex: true }) }),
	component: Page,
});

function Page() {
	const { discover } = Route.useRouteContext();
	const { getStarted } = studioOsLinks(discover.settings.studioOsUrl);
	return (
		<>
			<PageHeader
				title="For studios"
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "For studios" },
				]}
			/>
			<FoundationNotice
				action={
					<a
						href={getStarted}
						className={buttonVariants({ variant: "primary" })}
					>
						Get started with Studio OS
					</a>
				}
			>
				What Studio OS does for studios and artists, and how listing on Discover
				works, is being written. You can already set up your studio on Studio
				OS.
			</FoundationNotice>
		</>
	);
}
