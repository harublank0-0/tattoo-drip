import { test } from "@japa/runner";
import { sql } from "#tests/helpers/sql";

/**
 * The guard functions call built-ins (`to_jsonb`, `jsonb_each`) and run with
 * the caller's search_path unless they pin one. A session with a schema it
 * can write to could then shadow `to_jsonb(payments)` and let a frozen column
 * change. The app role has no CREATE on any schema, so the bypass cannot be
 * staged from a test; this pins the setting that closes it instead, and fails
 * if a later migration replaces a guard without it.
 */
test.group("guard functions", () => {
	test("both pin search_path to the built-ins", async ({ assert }) => {
		const { rows } = await sql(
			{},
			`select proname, proconfig from pg_proc
			 where proname in ('inquiries_guard_update', 'payments_guard')
			 order by proname`,
		);

		assert.deepEqual(rows, [
			{
				proname: "inquiries_guard_update",
				proconfig: ["search_path=pg_catalog, pg_temp"],
			},
			{
				proname: "payments_guard",
				proconfig: ["search_path=pg_catalog, pg_temp"],
			},
		]);
	});
});
