import { StudioHourSchema } from "#database/schema";

/**
 * One OPEN weekday of a studio (TAT-128): an opening and a closing time on
 * the studio's wall clock (`tenants.timezone`). A weekday without a row is
 * closed. `weekday` is 0 = Sunday ... 6 = Saturday, like Postgres
 * `extract(dow)`; times are "HH:mm:ss" strings. Not soft-deleted: the week
 * is replaced in place. Read and save through OpeningHoursService.
 */
export default class StudioHour extends StudioHourSchema {}
