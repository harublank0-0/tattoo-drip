import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `AlertsModule` below restates its shape and the inertia project type-checks the real one.
import * as alertsModule from "../../../inertia/components/alerts.js";

type AlertsModule = {
	emptyAlertsText(total: number): string;
	alertsLabel(unread: number): string;
};
const { emptyAlertsText, alertsLabel } = alertsModule as AlertsModule;

test.group("Alerts copy", () => {
	test("an empty list says there are no alerts yet only when there are none at all", ({
		assert,
	}) => {
		assert.equal(
			emptyAlertsText(0),
			"No alerts yet. New inquiries and deposit screenshots show up here.",
		);
		// A page past the last one: the alerts exist, just not here.
		assert.equal(emptyAlertsText(30), "No alerts on this page.");
	});

	test("the bell's name carries the unread count, with a comma", ({
		assert,
	}) => {
		assert.equal(alertsLabel(0), "Alerts");
		assert.equal(alertsLabel(1), "Alerts, 1 unread");
		assert.equal(alertsLabel(12), "Alerts, 12 unread");
	});
});
