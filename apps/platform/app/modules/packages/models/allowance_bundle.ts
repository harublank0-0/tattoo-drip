import { AllowanceBundleSchema } from "#database/schema";
import type { PackageKey } from "#modules/packages/packages";

/**
 * One version of a package's allowances (images per month, storage and its
 * reserve in megabytes, SMS per month; null when not metered yet). Platform
 * reference data, immutable: a change is a new bundle.
 */
export default class AllowanceBundle extends AllowanceBundleSchema {
	declare package: PackageKey;
}
