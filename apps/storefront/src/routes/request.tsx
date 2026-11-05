import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The request page's old address: `/request` moved to `/book` (Prompt 6). A
 * permanent redirect with the query as it was (`?artist=`, `?flash=`, an
 * ad's `utm_*`), so shared links and old buttons still land; `/book` checks
 * them. The target is always this site's own path.
 */
export const Route = createFileRoute("/request")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `/book${location.searchStr}`,
			statusCode: 301,
		});
	},
});
