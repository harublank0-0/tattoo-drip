import Tenant from "#modules/tenancy/models/tenant";
import { intakeFields, intakeRows } from "#tests/helpers/intake";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /api/v1/tenants/:tenant route (TAT-32). public_api.spec.ts
 * requests each under studio A's slug and fails if the answer mentions
 * studio B (publicMarkers) or B's snapshot changes; the guard in
 * api_routes.spec.ts fails for a route without an entry. These are not in
 * cases.ts: the public API has no signed-in actor, and another studio's slug
 * is simply another tenant.
 */
export type PublicIsolationCase = {
	method: "GET" | "POST";
	/** The route as the router prints it, e.g. /api/v1/tenants/:tenant */
	pattern: string;
	/** A valid body for writes, built for the studio sending it. */
	body?: (own: Studio) => Record<string, unknown>;
	/** How `body` is sent: JSON (the default) or multipart form fields. */
	encoding?: "json" | "multipart";
	/** The status of A's own request: the positive control. */
	ownStatus: 200 | 201;
	/** Strings A's own answer must contain, so an empty answer can't pass. */
	ownMarkers: (own: Studio) => string[];
	/** Reads the state of the studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

export const publicIsolationCases: PublicIsolationCase[] = [
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant",
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.slug, own.tenant.name],
		snapshot: tenantRow,
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/inquiries",
		encoding: "multipart",
		// A's own artist and a returning client of A's: B must stay as it was.
		body: (own) =>
			intakeFields({
				preferredArtistId: own.artistProfile.id,
				contactPhone: own.client.phone ?? "",
			}),
		ownStatus: 201,
		// The answer is only the new inquiry's id; inquiries.spec.ts checks it landed in A.
		ownMarkers: () => [],
		snapshot: intakeRows,
	},
];
