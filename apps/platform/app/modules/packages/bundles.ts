import AllowanceBundle from "#modules/packages/models/allowance_bundle";

/**
 * The ids of the allowance bundles named by `keys` (`solo-v1`, …), for
 * other modules that store a bundle reference (a plan, a pilot grant).
 * Throws for a key that doesn't exist: a catalogue naming an unknown bundle
 * is a deploy error, not data to skip.
 */
export async function bundleIdsByKey(
	keys: readonly string[],
): Promise<Map<string, string>> {
	const wanted = [...new Set(keys)];
	const bundles = await AllowanceBundle.query().whereIn("key", wanted);
	const ids = new Map(bundles.map((bundle) => [bundle.key, bundle.id]));
	const missing = wanted.filter((key) => !ids.has(key));
	if (missing.length > 0) {
		throw new Error(`Unknown allowance bundle: ${missing.join(", ")}`);
	}
	return ids;
}
