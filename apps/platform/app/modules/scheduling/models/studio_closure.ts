import { StudioClosureSchema } from "#database/schema";

/**
 * Days the studio is closed whatever its hours say (TAT-128), first day to
 * last day, both included, in the studio's timezone. `startsOn` / `endsOn`
 * are Luxon dates (compare `yyyy-MM-dd` strings in SQL). Not soft-deleted:
 * removing a closed day deletes the row. Read and save through
 * OpeningHoursService.
 */
export default class StudioClosure extends StudioClosureSchema {}
