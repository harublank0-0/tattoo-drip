import { createFileRoute, redirect } from "@tanstack/react-router";
import { paths } from "#/lib/routes";

/**
 * `/explore/tattoos`: D05's placeholder address. Since D09 the gallery is
 * `/tattoos`; this is a permanent redirect there, with the query string as
 * it came (the gallery reads what it knows and ignores the rest).
 */
export const Route = createFileRoute("/explore/tattoos")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `${paths.tattoos()}${location.searchStr}`,
			statusCode: 301,
		});
	},
});
