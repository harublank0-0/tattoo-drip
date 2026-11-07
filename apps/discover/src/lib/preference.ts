import type { DiscoverConfig } from "./config.ts";
import {
	countryCookie,
	normalizeCountry,
	safeReturnPath,
	switchCountryPath,
} from "./country.ts";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * `POST /preferences/country` (D06.5): saves the visitor's country in the
 * `td_country` cookie. Fields `country` (one of the markets) and `return`
 * (where the visitor was). A plain form post (no JavaScript) gets a 303 back
 * to that same-origin path, with the page's `country` replaced and `city`
 * dropped; the selector's fetch (`Accept: application/json`) gets
 * `{ country }`. A country that isn't a market is never saved (422 for the
 * fetch, back unchanged for the form). A cross-site post is refused: the
 * cookie is only a preference, but another site has no business setting it.
 */
export async function countryPreferenceResponse(
	request: Request,
	config: Pick<DiscoverConfig, "markets" | "siteUrl">,
): Promise<Response> {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== "same-origin" && site !== "none") {
		return new Response("Cross-site requests can't change this preference.", {
			status: 403,
			headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	const json = (request.headers.get("accept") ?? "").includes(
		"application/json",
	);
	let form: FormData | undefined;
	try {
		form = await request.formData();
	} catch {
		form = undefined;
	}
	const back = safeReturnPath(form?.get("return"));
	const country = normalizeCountry(form?.get("country"));
	if (!country || !config.markets.includes(country)) {
		return json
			? Response.json(
					{
						error: {
							code: "validation_failed",
							message: "Choose one of the countries Discover lists.",
						},
					},
					{ status: 422, headers: NO_STORE },
				)
			: new Response(null, {
					status: 303,
					headers: { ...NO_STORE, Location: back },
				});
	}
	const cookie = countryCookie(country, {
		secure: new URL(config.siteUrl).protocol === "https:",
	});
	return json
		? Response.json(
				{ country },
				{ headers: { ...NO_STORE, "Set-Cookie": cookie } },
			)
		: new Response(null, {
				status: 303,
				headers: {
					...NO_STORE,
					"Set-Cookie": cookie,
					Location: switchCountryPath(back, country),
				},
			});
}
