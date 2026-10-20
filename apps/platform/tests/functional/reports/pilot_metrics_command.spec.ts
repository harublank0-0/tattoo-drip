import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { makeClient, makeInquiry, makeProject } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
// No #commands alias exists (and package.json stays as it is), so the
// command is imported by path.
import PilotMetrics, { type Studio } from "../../../commands/pilot_metrics.js";

/**
 * The command with the test's studios in place of the owner role's list:
 * the owner connection can't see rows this test's transaction holds.
 */
class TestPilotMetrics extends PilotMetrics {
	static listed: Studio[] = [];

	protected async studios(): Promise<Studio[]> {
		return TestPilotMetrics.listed;
	}
}

const listed = (...tenants: { id: string; slug: string; name: string }[]) =>
	tenants.map(({ id, slug, name }) => ({ id, slug, name }));

test.group("metrics:pilot (TAT-70)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	test("prints each studio's numbers, then all studios together, for the last 42 days by default", async () => {
		const { tenant: a } = await studioWithOwner("metrics-a-70", "Metrics A");
		const { tenant: b } = await studioWithOwner("metrics-b-70", "Metrics B");
		await inTenant(a, async () => {
			const customer = await makeClient(a);
			await makeInquiry(a, customer);
			// 43 days ago: outside the default window.
			await makeInquiry(a, customer, {
				createdAt: DateTime.utc().minus({ days: 43 }),
			});
			await makeProject(a, customer, { status: "booked" });
		});
		TestPilotMetrics.listed = listed(a, b);

		const command = await ace.create(TestPilotMetrics, []);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(
			/Pilot numbers for the last 42 days: \d{4}-\d\d-\d\d \d\d:\d\d to \d{4}-\d\d-\d\d \d\d:\d\d UTC\./,
		);
		command.assertLogMatches(/Metrics A \(metrics-a-70\)/);
		command.assertLogMatches(
			/Through the link: 50% \(1 inquiry through the link, 1 booking at the desk\)/,
		);
		command.assertLogMatches(/Metrics B \(metrics-b-70\)/);
		command.assertLogMatches(
			/Through the link: — \(No inquiries or desk bookings yet\.\)/,
		);
		command.assertLogMatches(/All studios \(2\)/);
	});

	test("counts only the last --days days, and refuses a number outside 1 to 3650", async () => {
		const { tenant } = await studioWithOwner("metrics-days-70", "Metrics Days");
		await inTenant(tenant, async () => {
			await makeInquiry(tenant, await makeClient(tenant), {
				createdAt: DateTime.utc().minus({ days: 10 }),
			});
		});
		TestPilotMetrics.listed = listed(tenant);

		const week = await ace.create(TestPilotMetrics, ["--days=7"]);
		await week.exec();
		week.assertSucceeded();
		week.assertLogMatches(/Pilot numbers for the last 7 days:/);
		week.assertLogMatches(
			/Through the link: — \(No inquiries or desk bookings yet\.\)/,
		);

		for (const days of ["0", "3651", "1.5"]) {
			const refused = await ace.create(TestPilotMetrics, [`--days=${days}`]);
			await refused.exec();
			refused.assertFailed();
			refused.assertLogMatches(/Give --days a whole number from 1 to 3650\./);
		}
	});

	test("says so when there are no studios", async () => {
		TestPilotMetrics.listed = [];

		const command = await ace.create(TestPilotMetrics, []);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(/No studios yet\./);
	});
});
