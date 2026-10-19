import limiter from "@adonisjs/limiter/services/main";
import type { ApiCaller } from "#services/api_caller";
import { type ApiLimitName, apiLimitFor } from "#services/api_limits";
import env from "#start/env";

/** Spends a whole budget, so the caller's next request is refused (TAT-38). */
export async function fillApiLimit(
	name: ApiLimitName,
	caller: ApiCaller,
	tenantId?: string,
) {
	const { key, budget } = apiLimitFor(name, caller, tenantId);
	await limiter.use({ ...budget }).increment(key, budget.requests);
}

/** The two STOREFRONT_SERVER_KEYS of .env.test. */
export function testServerKeys(): [string, string] {
	const keys = env.get("STOREFRONT_SERVER_KEYS")?.release() ?? [];
	if (keys.length !== 2) {
		throw new Error(".env.test must set two STOREFRONT_SERVER_KEYS");
	}
	return [keys[0], keys[1]];
}
