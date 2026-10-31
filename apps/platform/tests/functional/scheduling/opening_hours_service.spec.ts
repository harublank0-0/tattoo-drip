import { randomBytes } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { ClosureLimitError } from "#modules/scheduling/errors";
import {
	type ClosureInput,
	MAX_UPCOMING_CLOSURES,
	type OpeningDay,
} from "#modules/scheduling/opening_hours";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const hours = new OpeningHoursService();

// 10:00 on Friday 30 October 2026 in Kathmandu.
const NOW = DateTime.fromISO("2026-10-30T10:00:00", { zone: "Asia/Kathmandu" });
const TODAY = "2026-10-30";

const day = (
	d: OpeningDay["day"],
	opens = "11:00",
	closes = "20:00",
): OpeningDay => ({ day: d, opens, closes });

const closure = (
	startsOn: string,
	endsOn = startsOn,
	note: string | null = null,
): ClosureInput => ({ startsOn, endsOn, note });

test.group("OpeningHoursService (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("replaceWeek stores the open days and week reads them Sunday first as HH:mm", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("hours-week");

		const week = await inTenant(tenant, async () => {
			await hours.replaceWeek(tenant, [
				day("mon"),
				day("sat", "10:30", "18:15"),
				day("sun", "09:00", "13:00"),
			]);
			return hours.week(tenant);
		});

		assert.deepEqual(week, [
			day("sun", "09:00", "13:00"),
			day("mon"),
			day("sat", "10:30", "18:15"),
		]);
	});

	test("replacing the week drops the days left out", async ({ assert }) => {
		const { tenant } = await studioWithOwner("hours-replace");

		const week = await inTenant(tenant, async () => {
			await hours.replaceWeek(tenant, [day("mon"), day("tue"), day("wed")]);
			await hours.replaceWeek(tenant, [day("tue", "12:00", "19:00")]);
			return hours.week(tenant);
		});

		assert.deepEqual(week, [day("tue", "12:00", "19:00")]);
	});

	test("an empty week closes every day", async ({ assert }) => {
		const { tenant } = await studioWithOwner("hours-empty");

		const week = await inTenant(tenant, async () => {
			await hours.replaceWeek(tenant, [day("mon")]);
			await hours.replaceWeek(tenant, []);
			return hours.week(tenant);
		});

		assert.deepEqual(week, []);
	});

	test("another studio's week is not touched", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("hours-iso-a");
		const { tenant: b } = await studioWithOwner("hours-iso-b");
		await inTenant(b, () => hours.replaceWeek(b, [day("mon")]));

		await inTenant(a, () => hours.replaceWeek(a, [day("fri")]));

		assert.deepEqual(await inTenant(b, () => hours.week(b)), [day("mon")]);
		assert.deepEqual(await inTenant(a, () => hours.week(a)), [day("fri")]);
	});

	test("upcomingClosures leaves out the ended ones and lists the rest earliest first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("closures-upcoming");

		const rows = await inTenant(tenant, async () => {
			await hours.addClosure(
				tenant,
				closure("2026-11-06", "2026-11-07", "later"),
				TODAY,
			);
			await hours.addClosure(
				tenant,
				closure("2026-10-30", "2026-10-30", "today"),
				TODAY,
			);
			await hours.addClosure(
				tenant,
				closure("2026-10-27", "2026-10-29", "ended"),
				TODAY,
			);
			await hours.addClosure(
				tenant,
				closure("2026-10-28", "2026-11-02", "running"),
				TODAY,
			);
			return hours.upcomingClosures(tenant, TODAY);
		});

		assert.deepEqual(
			rows.map((row) => row.note),
			["running", "today", "later"],
		);
		assert.equal(rows[0].startsOn.toISODate(), "2026-10-28");
		assert.equal(rows[0].endsOn.toISODate(), "2026-11-02");
	});

	test("addClosure refuses the 21st upcoming one with ClosureLimitError and counts no ended ones", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("closures-limit");

		await inTenant(tenant, async () => {
			// Ended ones do not count against the cap.
			for (let n = 0; n < 5; n++) {
				await hours.addClosure(
					tenant,
					closure("2026-10-01", "2026-10-02"),
					"2026-10-01",
				);
			}
			for (let n = 0; n < MAX_UPCOMING_CLOSURES; n++) {
				await hours.addClosure(tenant, closure("2026-11-02"), TODAY);
			}
			await assert.rejects(
				() => hours.addClosure(tenant, closure("2026-11-03"), TODAY),
				ClosureLimitError as never,
			);
			assert.lengthOf(
				await hours.upcomingClosures(tenant, TODAY),
				MAX_UPCOMING_CLOSURES,
			);
		});
	});

	test("removeClosure deletes one; findClosure of another studio's id is not found", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("closures-remove-a");
		const { tenant: b } = await studioWithOwner("closures-remove-b");
		const mine = await inTenant(a, () =>
			hours.addClosure(a, closure("2026-11-02"), TODAY),
		);
		const theirs = await inTenant(b, () =>
			hours.addClosure(b, closure("2026-11-02"), TODAY),
		);

		await inTenant(a, async () => {
			await assert.rejects(
				() => hours.findClosure(a, theirs.id),
				/Row not found/,
			);
			await hours.removeClosure(a, await hours.findClosure(a, mine.id));
		});

		assert.lengthOf(
			await inTenant(a, () => hours.upcomingClosures(a, TODAY)),
			0,
		);
		assert.lengthOf(
			await inTenant(b, () => hours.upcomingClosures(b, TODAY)),
			1,
		);
	});

	test("findClosure of another studio's id is not found even without the row-level guard", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("closures-scope-a");
		const { tenant: b } = await studioWithOwner("closures-scope-b");
		const theirs = await inTenant(b, () =>
			hours.addClosure(b, closure("2026-11-02"), TODAY),
		);

		// Run in B's context but ask as A: the tenant_id filter alone refuses it.
		await inTenant(b, async () => {
			await assert.rejects(
				() => hours.findClosure(a, theirs.id),
				/Row not found/,
			);
		});
	});

	test("forPage gives the week and the upcoming closures as from, to and note in two queries", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("hours-for-page");
		await inTenant(tenant, async () => {
			await hours.replaceWeek(tenant, [
				day("sun"),
				day("fri", "10:00", "17:00"),
			]);
			await hours.addClosure(
				tenant,
				closure("2026-11-02", "2026-11-04", "दशैं बिदा"),
				TODAY,
			);
			await hours.addClosure(
				tenant,
				closure("2026-10-01", "2026-10-03", "ended"),
				"2026-10-01",
			);
		});
		const baseline = (
			await recordQueries(() => inTenant(tenant, async () => {}))
		).queries.length;

		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () => hours.forPage(tenant, NOW)),
		);

		assert.deepEqual(result, {
			openingHours: [day("sun"), day("fri", "10:00", "17:00")],
			closedDays: [{ from: "2026-11-02", to: "2026-11-04", note: "दशैं बिदा" }],
		});
		assert.equal(queries.length - baseline, 2);
	});
});

/**
 * Real concurrency: two requests saving the week at once need two
 * connections and rows the other can see, so this group runs outside the
 * global transaction. Its studios are committed and removed again.
 */
test.group(
	"OpeningHoursService: saves at the same moment (TAT-128)",
	(group) => {
		const slugs: string[] = [];

		group.each.teardown(async () => {
			for (const slug of slugs.splice(0)) {
				await db.connection("owner").transaction(async (trx) => {
					await trx.rawQuery("set local session_replication_role = replica");
					const { rows } = await trx.rawQuery(
						"select id from tenants where slug = ?",
						[slug],
					);
					const { rows: tables } = await trx.rawQuery(
						"select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id'",
					);
					for (const { id } of rows) {
						for (const { table_name: table } of tables) {
							await trx.rawQuery(`delete from "${table}" where tenant_id = ?`, [
								id,
							]);
						}
						await trx.rawQuery("delete from tenants where id = ?", [id]);
					}
					await trx.rawQuery("delete from users where email like ?", [
						`%@${slug}.example`,
					]);
				});
			}
		});

		test("two replaceWeek calls at once both finish and leave one of the two weeks", async ({
			assert,
		}) => {
			const slug = `hours-race-${randomBytes(4).toString("hex")}`;
			slugs.push(slug);
			const { tenant } = await studioWithOwner(slug, "Hours race");
			const first = [
				day("mon"),
				day("tue"),
				day("wed"),
				day("sun", "09:00", "12:00"),
			];
			const second = [day("tue", "12:00", "19:00"), day("thu"), day("sat")];

			// Each call is its own request: its own connection, context and transaction.
			for (let round = 0; round < 6; round++) {
				await Promise.all([
					inTenant(tenant, () => hours.replaceWeek(tenant, first)),
					inTenant(tenant, () => hours.replaceWeek(tenant, second)),
				]);
				const week = await inTenant(tenant, () => hours.week(tenant));

				assert.oneOf(JSON.stringify(week), [
					JSON.stringify(
						[...first].sort((a, b) => order(a.day) - order(b.day)),
					),
					JSON.stringify(second),
				]);
			}
		});

		test("two addClosure calls at the cap give one more and one refusal", async ({
			assert,
		}) => {
			const slug = `closures-race-${randomBytes(4).toString("hex")}`;
			slugs.push(slug);
			const { tenant } = await studioWithOwner(slug, "Closures race");
			await inTenant(tenant, async () => {
				for (let n = 1; n < MAX_UPCOMING_CLOSURES; n++) {
					await hours.addClosure(tenant, closure("2026-11-02"), TODAY);
				}
			});

			const results = await Promise.allSettled([
				inTenant(tenant, () =>
					hours.addClosure(tenant, closure("2026-11-03"), TODAY),
				),
				inTenant(tenant, () =>
					hours.addClosure(tenant, closure("2026-11-04"), TODAY),
				),
			]);

			assert.deepEqual(results.map((result) => result.status).sort(), [
				"fulfilled",
				"rejected",
			]);
			assert.instanceOf(
				(
					results.find(
						(result) => result.status === "rejected",
					) as PromiseRejectedResult
				).reason,
				ClosureLimitError,
			);
			assert.lengthOf(
				await inTenant(tenant, () => hours.upcomingClosures(tenant, TODAY)),
				MAX_UPCOMING_CLOSURES,
			);
		});
	},
);

const WEEK_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const order = (d: string) => WEEK_ORDER.indexOf(d);
