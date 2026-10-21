import { test } from "@japa/runner";
import { rolesFor, TENANT_ROUTE_ROLES } from "#modules/tenancy/access";
import { MEMBERSHIP_ROLES } from "#modules/tenancy/models/tenant_membership";

test.group("TENANT_ROUTE_ROLES", () => {
	test("owners may use every route, and only known roles are listed", ({
		assert,
	}) => {
		for (const [name, roles] of Object.entries(TENANT_ROUTE_ROLES)) {
			assert.include(roles, "owner", name);
			for (const role of roles) assert.include(MEMBERSHIP_ROLES, role, name);
			assert.equal(new Set(roles).size, roles.length, name);
		}
	});

	test("rolesFor gives the entry of a route the table names", ({ assert }) => {
		assert.deepEqual(rolesFor("tenant.inbox.index"), ["owner"]);
		assert.deepEqual(rolesFor("tenant.projects.show"), ["owner", "artist"]);
	});

	test("rolesFor knows nothing else, prototype names included", ({
		assert,
	}) => {
		for (const name of [
			undefined,
			"",
			"tenant.unknown",
			"constructor",
			"__proto__",
			"toString",
			"hasOwnProperty",
		]) {
			assert.isUndefined(rolesFor(name), String(name));
		}
	});
});
