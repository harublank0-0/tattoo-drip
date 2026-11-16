import { test } from "@japa/runner";
import {
	capabilityOf,
	ROUTE_CAPABILITIES,
} from "#modules/packages/route_capabilities";
import { TENANT_ROUTE_ROLES } from "#modules/tenancy/access";

/**
 * The route capability map (studio packages, phase 3): every tenant route
 * says what the package must allow, next to TENANT_ROUTE_ROLES.
 */
test.group("Packages: route capabilities", () => {
	test("every tenant route has a capability, and only these routes are restricted", ({
		assert,
	}) => {
		assert.deepEqual(
			Object.keys(ROUTE_CAPABILITIES).sort(),
			Object.keys(TENANT_ROUTE_ROLES).sort(),
		);
		const restricted = Object.fromEntries(
			Object.entries(ROUTE_CAPABILITIES).filter(
				([, capability]) => capability !== "open",
			),
		);
		assert.deepEqual(restricted, {
			"tenant.inbox.accept": "new_work",
			"tenant.projects.create": "new_work",
			"tenant.projects.store": "new_work",
			"tenant.design_lab.generate": "design_lab",
			"tenant.design_lab.retry": "design_lab",
			"tenant.artists.store": "artist_activation",
			"tenant.artists.restore": "artist_activation",
		});
	});

	test("capabilityOf answers undefined for an unknown route", ({ assert }) => {
		assert.isUndefined(capabilityOf(undefined));
		assert.isUndefined(capabilityOf("tenant.nope"));
		assert.isUndefined(capabilityOf("constructor"));
		assert.equal(capabilityOf("tenant.inbox.accept"), "new_work");
		assert.equal(capabilityOf("tenant.projects.show"), "open");
	});
});
