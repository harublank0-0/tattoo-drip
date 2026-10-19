import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { callerOf } from "#services/api_caller";
import {
	API_LIMITS,
	type ApiLimitName,
	consumeApiLimit,
} from "#services/api_limits";
import { READ_METHODS } from "#services/public_api";

/**
 * One API_LIMITS entry on a route or group (TAT-38): counts the request by
 * caller, or by studio and caller kind, when its method is the entry's
 * (reads: GET and HEAD). The /api/v1/tenants/:tenant group runs
 * `apiLimit({ name: "tenantReads" })` right after publicTenant (a test
 * checks). A later ticket adds an entry and uses this on its route.
 */
export default class ApiLimitMiddleware {
	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: { name: ApiLimitName },
	) {
		const limit = API_LIMITS[options.name];
		const reads = READ_METHODS.has(ctx.request.method());
		if ((limit.methods === "reads") !== reads) return next();
		const tenantId =
			limit.scope === "tenant" ? publicTenantContext(ctx).tenant.id : undefined;
		await consumeApiLimit(options.name, callerOf(ctx), tenantId);
		return next();
	}
}
