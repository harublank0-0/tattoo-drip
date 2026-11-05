import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The gallery's old address: `/work` moved to `/gallery` (Prompt 5). A
 * permanent redirect with the query as it was (the filters, `cursor`, an ad's
 * `utm_*`), so shared and indexed links still land; `/gallery` checks them.
 * The target is always this site's own path.
 */
export const Route = createFileRoute("/work")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `/gallery${location.searchStr}`,
			statusCode: 301,
		});
	},
});
