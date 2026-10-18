import type { Studio } from "@tattoo-drip/sdk";
import type { StorefrontConfig } from "./config.ts";
import { tenantFromHost } from "./host.ts";
import { lookUpTenant } from "./lookup.ts";
import {
	aliasLocation,
	landingResponse,
	notFoundResponse,
	redirectResponse,
	unavailableResponse,
} from "./responses.ts";

export type TenantOutcome =
	| { type: "studio"; studio: Studio }
	| { type: "respond"; response: Response };

export interface TenantDeps {
	config: StorefrontConfig;
	/** Where an API failure is reported; console.error by default. */
	log?: (
		message: string,
		details: { slug: string; status: number; code: string },
	) => void;
	/** For tests. */
	fetch?: typeof fetch;
	timeoutMs?: number;
}

/**
 * What a request to the storefront gets (TAT-12): its studio, or a response
 * the storefront answers itself. Only the Host header names the studio, never
 * X-Forwarded-Host: the CDN keys its cache by Host, so a page chosen by
 * another header could be cached for the wrong host. `request.url` gives only
 * the path and query.
 */
export async function handleTenantRequest(
	request: Request,
	deps: TenantDeps,
): Promise<TenantOutcome> {
	const target = tenantFromHost(
		request.headers.get("host"),
		deps.config.baseHost,
	);
	if (target.kind === "landing") {
		const atRoot = new URL(request.url).pathname === "/";
		return respond(atRoot ? landingResponse() : notFoundResponse());
	}
	// `foreign` is where custom domains (TAT-79) will look the hostname up.
	if (target.kind !== "tenant") return respond(notFoundResponse());

	const lookup = await lookUpTenant(target.slug, {
		apiUrl: deps.config.apiUrl,
		signal: request.signal,
		timeoutMs: deps.timeoutMs,
		fetch: deps.fetch,
	});
	switch (lookup.type) {
		case "found":
			return { type: "studio", studio: lookup.studio };
		case "moved":
			// Writes need the current slug, as at the API (TAT-32).
			return respond(
				isRead(request)
					? redirectResponse(
							aliasLocation(deps.config, lookup.slug, request.url),
						)
					: notFoundResponse(),
			);
		case "missing":
			return respond(notFoundResponse());
		case "unavailable": {
			const log = deps.log ?? console.error;
			log("Studio lookup failed", {
				slug: target.slug,
				status: lookup.status,
				code: lookup.code,
			});
			return respond(unavailableResponse());
		}
	}
}

function respond(response: Response): TenantOutcome {
	return { type: "respond", response };
}

function isRead(request: Request): boolean {
	return request.method === "GET" || request.method === "HEAD";
}
