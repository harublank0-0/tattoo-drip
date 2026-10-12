import { test } from "@japa/runner";
import { isUniqueViolation } from "#services/db_errors";

test.group("isUniqueViolation", () => {
	test("matches a 23505 error for the named constraint", ({ assert }) => {
		const error = {
			code: "23505",
			constraint: "artists_tenant_slug_live_unique",
		};
		assert.isTrue(isUniqueViolation(error, "artists_tenant_slug_live_unique"));
	});

	test("does not match another constraint, another code or a non-error", ({
		assert,
	}) => {
		assert.isFalse(
			isUniqueViolation({ code: "23505", constraint: "other" }, "mine"),
		);
		assert.isFalse(
			isUniqueViolation({ code: "23503", constraint: "mine" }, "mine"),
		);
		assert.isFalse(isUniqueViolation(null, "mine"));
		assert.isFalse(isUniqueViolation("23505", "mine"));
	});
});
