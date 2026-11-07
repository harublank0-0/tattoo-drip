import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "#/components/discovery/layout";
import { FoundationNotice } from "#/components/discovery/states";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/** `/pricing`: planned for D06, minimal until then (D05). Never indexed while unfinished. */
export const Route = createFileRoute("/pricing")({
	head: () => ({ meta: pageMeta({ title: "Pricing", noindex: true }) }),
	component: Page,
});

function Page() {
	return (
		<>
			<PageHeader
				title="Pricing"
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Pricing" },
				]}
			/>
			<FoundationNotice>
				Studio OS pricing is being prepared. No prices are published yet.
			</FoundationNotice>
		</>
	);
}
