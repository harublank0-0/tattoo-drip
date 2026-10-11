import { glob } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import { Job } from "@adonisjs/queue";
import { test } from "@japa/runner";
import { jobsOutsideTenantScope } from "#tests/helpers/jobs";

/**
 * Jobs allowed to run with no tenant, and why. Anything else that touches
 * tenant data must extend TenantJob (app/services/tenant_job.ts).
 */
const ALLOWLIST = {
	SendMailJob: "sends one email; reads and writes no tenant table",
};

async function jobClasses() {
	const classes: { name: string; prototype: object }[] = [];
	for (const pattern of ["app/jobs/**/*.ts", "app/modules/*/jobs/**/*.ts"]) {
		for await (const file of glob(pattern, { cwd: app.makePath() })) {
			const module = await import(app.makeURL(file).href);
			if (typeof module.default === "function") classes.push(module.default);
		}
	}
	return classes;
}

test.group("Job classes", () => {
	test("every job extends TenantJob or is allowlisted", async ({ assert }) => {
		const classes = await jobClasses();
		assert.isNotEmpty(classes);
		assert.deepEqual(jobsOutsideTenantScope(classes, ALLOWLIST), []);
	});

	test("the guard flags a plain job that is not allowlisted", ({ assert }) => {
		class StrayJob extends Job<{ label: string }> {
			async execute() {}
		}
		assert.deepEqual(jobsOutsideTenantScope([StrayJob], ALLOWLIST), [
			"StrayJob",
		]);
	});
});
