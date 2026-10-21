/**
 * The words of the alerts page and the bell (TAT-52, TAT-88). No imports: the unit
 * tests load it.
 */

/** What an empty list says: "no alerts yet" only when there are none at all. */
export function emptyAlertsText(total: number): string {
	return total > 0
		? "No alerts on this page."
		: "No alerts yet. New inquiries and deposit screenshots show up here.";
}

/** The bell's accessible name: "Alerts, 3 unread", or "Alerts" with none. */
export function alertsLabel(unread: number): string {
	return unread > 0 ? `Alerts, ${unread} unread` : "Alerts";
}
