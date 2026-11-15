import { PilotGrantSchema } from "#database/schema";
import type { PackageKey } from "#modules/packages/packages";

/** A pilot studio's temporary package, `[startsAt, endsAt)`, set by an operator. */
export default class PilotGrant extends PilotGrantSchema {
	declare package: PackageKey;
}
