import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { billingPage } from "#modules/billing/billing_page";
import type { BillingOverview } from "#modules/billing/services/billing_service";
import type { Entitlement } from "#modules/packages/entitlement";

const overview: BillingOverview = {
	configured: true,
	mode: "sandbox",
	plans: [],
	subscription: null,
	invoices: [],
	access: { state: "none" },
};

test.group("Billing page props", () => {
	test("the package line names the package and dates it in the studio's time zone", ({
		assert,
	}) => {
		// 20:00 UTC on 14 Nov is 01:45 on 15 Nov in Kathmandu (UTC+5:45).
		const entitlement: Entitlement = {
			state: "trial",
			package: "solo",
			bundleId: "b",
			until: DateTime.fromISO("2026-11-14T20:00:00Z", { zone: "utc" }),
			artistLimit: 1,
		};

		const props = billingPage(
			overview,
			new Map(),
			"Asia/Kathmandu",
			entitlement,
		);

		assert.deepEqual(props.package, {
			state: "trial",
			name: "Solo",
			line: "One artist, with help running the business.",
			text: "Solo trial until 15 Nov 2026",
		});
	});
});
