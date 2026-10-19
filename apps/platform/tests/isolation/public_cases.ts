import DepositLink from "#modules/payments/models/deposit_link";
import Payment from "#modules/payments/models/payment";
import Tenant from "#modules/tenancy/models/tenant";
import { type ProofPart, proofPart } from "#tests/helpers/deposits";
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
	/**
	 * Values for the pattern's parameters other than :tenant, built for one
	 * studio (TAT-65: a deposit link's token). With them, the harness also
	 * sends B's values under A's slug, which must be the 404 and leave B as
	 * it was.
	 */
	params?: (studio: Studio) => Record<string, string>;
	/** File parts of a multipart write, built for the studio sending it (TAT-65: the proof). */
	files?: (own: Studio) => Promise<ProofPart[]>;
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

const depositRows = (target: Studio) =>
	inTenant(target.tenant, async () => ({
		links: (await DepositLink.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
		payments: (await Payment.query().orderBy("id")).map((row) =>
			row.serialize(),
		),
	}));

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
	{
		method: "GET",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		ownStatus: 200,
		ownMarkers: (own) => [own.tenant.name, own.depositReferenceCode],
		snapshot: depositRows,
	},
	{
		method: "POST",
		pattern: "/api/v1/tenants/:tenant/deposits/:token",
		params: (studio) => ({ token: studio.depositToken }),
		encoding: "multipart",
		body: () => ({ method: "esewa", expectedAmount: "300000" }),
		files: async () => [await proofPart()],
		ownStatus: 201,
		// The answer is the page in `submitted`, with A's reference code.
		ownMarkers: (own) => [own.depositReferenceCode],
		snapshot: depositRows,
	},
];
