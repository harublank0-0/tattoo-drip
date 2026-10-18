import { StaffAlertSchema } from "#database/schema";
import type { AlertKind } from "#modules/notifications/alerts";

/**
 * One member's alert about one event (TAT-52): ids only, never client data
 * (the list shows a fixed line per kind). Not soft-deleted. Made and read
 * through AlertService.
 */
export default class StaffAlert extends StaffAlertSchema {
	declare kind: AlertKind;
}
