import limiter from "@adonisjs/limiter/services/main";
import type { ApiCaller } from "#services/api_caller";
import { clientAddress, digest } from "#services/rate_limits";

/**
 * The public API's generic limits (TAT-38): fixed windows on TAT-8's
 * limiter, every request counted, refused ones included. The gate
 * (PublicGateMiddleware) counts every API request per caller before its
 * body; `apiLimit({ name })` counts a studio's reads after publicTenant.
 * Each caller kind has its own budget and keys. A route's own limits
 * (DEPOSIT_LIMITS, INTAKE_LIMITS) stay below these, so they bind first. A
 * later ticket adds an entry and `.use(middleware.apiLimit({ name }))`.
 */
export type Budget = { readonly requests: number; readonly duration: string };

export type ApiLimit = {
	readonly scope: "caller" | "tenant";
	readonly methods: "reads" | "writes";
	readonly anonymous: Budget;
	readonly storefront: Budget;
};

export const API_LIMITS = {
	/** A page costs the storefront 2 keyed reads, a browser none; carrier NAT shares addresses. */
	callerReads: {
		scope: "caller",
		methods: "reads",
		anonymous: { requests: 300, duration: "5 mins" },
		storefront: { requests: 300, duration: "5 mins" },
	},
	/** Above the intake's and the deposit page's own per-address limits. */
	callerWrites: {
		scope: "caller",
		methods: "writes",
		anonymous: { requests: 60, duration: "1 hour" },
		storefront: { requests: 60, duration: "1 hour" },
	},
	/** Containment: a flood aimed at one studio can't take the platform; the pages' bucket is the storefront's. */
	tenantReads: {
		scope: "tenant",
		methods: "reads",
		anonymous: { requests: 1500, duration: "5 mins" },
		storefront: { requests: 6000, duration: "5 mins" },
	},
} as const satisfies Record<string, ApiLimit>;

export type ApiLimitName = keyof typeof API_LIMITS;

/** Storefront calls with no usable visitor address: one budget for all of them. */
export const SHARED_STOREFRONT_BUDGET: Budget = {
	requests: 3000,
	duration: "5 mins",
};

/** The limiter key and budget of one request: digests or a tenant id, never an address. */
export function apiLimitFor(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
): { key: string; budget: Budget } {
	const limit: ApiLimit = API_LIMITS[name];
	const kind = caller.kind === "storefront" ? "sf" : "anon";
	const budget = limit[caller.kind];
	if (limit.scope === "tenant") {
		if (!tenantId) {
			throw new Error(
				`The ${name} limit counts per tenant: pass the tenant id`,
			);
		}
		return { key: `api_${name}_${kind}_${tenantId}`, budget };
	}
	if (caller.ip === null) {
		return { key: "api_storefront_shared", budget: SHARED_STOREFRONT_BUDGET };
	}
	return {
		key: `api_${name}_${kind}_${digest(clientAddress(caller.ip))}`,
		budget,
	};
}

/** Counts one request; over the budget it throws the limiter's E_TOO_MANY_REQUESTS (429 with Retry-After). */
export async function consumeApiLimit(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
): Promise<void> {
	const { key, budget } = apiLimitFor(name, caller, tenantId);
	// limiter.use() parses the duration in place: a copy.
	await limiter.use({ ...budget }).consume(key);
}
