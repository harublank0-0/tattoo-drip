import { createFileRoute } from "@tanstack/react-router";
import { discoverConfig } from "#/lib/config";
import { countryPreferenceResponse } from "#/lib/preference";

/**
 * `/preferences/country` (D06.5): the country selector's target. POST saves
 * the preference cookie (`countryPreferenceResponse`); a GET (a bookmarked
 * or typed address) goes home.
 */
export const Route = createFileRoute("/preferences/country")({
	server: {
		handlers: {
			GET: () =>
				new Response(null, {
					status: 303,
					headers: { Location: "/", "Cache-Control": "no-store" },
				}),
			POST: ({ request }) =>
				countryPreferenceResponse(request, discoverConfig()),
		},
	},
});
