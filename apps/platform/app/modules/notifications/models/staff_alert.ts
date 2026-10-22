import { StaffAlertSchema } from "#database/schema";
import type { AlertKind } from "#modules/notifications/alerts";

/**
 * One member's alert about one event (TAT-52): ids only, never client data
 * (the list reads the client's first name and the idea or amount from the
 * inquiry or project when it is built, AlertContentService, TAT-102). Not
 * soft-deleted. Made and read through AlertService.
 */
export default class StaffAlert extends StaffAlertSchema {
	declare kind: AlertKind;
}
