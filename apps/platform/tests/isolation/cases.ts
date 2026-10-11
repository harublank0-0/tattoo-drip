import PaymentMethod from "#modules/payments/models/payment_method";
import Tenant from "#modules/tenancy/models/tenant";
import { inTenant, type Studio } from "#tests/helpers/tenants";

/**
 * One entry per /t/:tenant route. The cross-tenant spec runs each as studio
 * A's actor against studio B; the route-coverage guard in
 * tenant_routes.spec.ts fails for a route that has neither an entry here
 * nor an exemption with a reason.
 */
export type IsolationCase = {
	method: "GET" | "POST" | "PUT" | "DELETE";
	/** The route as the router prints it, e.g. /t/:tenant/settings/payments/:id */
	pattern: string;
	/** Who sends the request. Every settings route is owner-only. */
	actor: "owner" | "artist";
	/** A valid body for writes, built for the studio sending it. */
	body?: (own: Studio) => Record<string, unknown>;
	/** The status the actor gets on its own studio: the positive control. */
	ownStatus: 200 | 302;
	/** Reads the state of the targeted studio that the route could change. */
	snapshot: (target: Studio) => Promise<unknown>;
};

/**
 * Routes with no isolation case, with the reason. Even pages that read
 * nothing get a case, because the 404 for a foreign slug is still worth
 * proving; only a route that is not part of the app belongs here.
 */
export const EXEMPT_ROUTES: Record<string, string> = {
	"GET /t/:tenant/__test/db/settings":
		"Test-only route (tests/support/test_routes.ts, registered by the functional suite). It echoes the session settings and reads no tenant table; the middleware order test covers it.",
};

const none = async () => null;

const tenantRow = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(await Tenant.findOrFail(target.tenant.id)).serialize(),
	);

const methodRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await PaymentMethod.withTrashed()
				.where("tenant_id", target.tenant.id)
				.orderBy("position")
				.orderBy("id")
		).map((method) => method.serialize()),
	);

const profileBody = (own: Studio) => ({
	name: `${own.tenant.name} renamed`,
	timezone: "Asia/Kathmandu",
	intro: "",
	contactPhone: "",
	contactEmail: "",
	address: "",
	instagramUrl: "",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
});

export const isolationCases: IsolationCase[] = [
	{
		method: "GET",
		pattern: "/t/:tenant",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings",
		actor: "owner",
		ownStatus: 302,
		snapshot: none,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/profile",
		actor: "owner",
		ownStatus: 200,
		snapshot: tenantRow,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/profile",
		actor: "owner",
		body: profileBody,
		ownStatus: 302,
		snapshot: tenantRow,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments",
		actor: "owner",
		ownStatus: 200,
		snapshot: methodRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/deposits",
		actor: "owner",
		body: () => ({
			defaultDepositPercent: "30",
			depositPolicy: "Holds your date.",
		}),
		ownStatus: 302,
		snapshot: tenantRow,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments/new",
		actor: "owner",
		ownStatus: 200,
		snapshot: none,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments",
		actor: "owner",
		body: () => ({ kind: "cash", label: "Another cash" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/payments/:id",
		actor: "owner",
		body: () => ({ label: "Renamed" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/payments/:id/edit",
		actor: "owner",
		ownStatus: 200,
		snapshot: methodRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/settings/payments/:id/move",
		actor: "owner",
		body: () => ({ direction: "down" }),
		ownStatus: 302,
		snapshot: methodRows,
	},
	{
		method: "DELETE",
		pattern: "/t/:tenant/settings/payments/:id",
		actor: "owner",
		ownStatus: 302,
		snapshot: methodRows,
	},
];
