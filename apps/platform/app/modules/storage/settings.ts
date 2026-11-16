import env from "#start/env";

export type StorageEnforcement = "observe" | "enforce";

/**
 * Whether storage limits refuse uploads
 * (docs/superpowers/specs/2026-11-16-storage-meter-design.md, ruling 6): a
 * switch of its own, separate from PACKAGE_ENFORCEMENT, so limits go on only
 * after `storage:reconcile` and a look at real usage. `observe` (the default,
 * also when unset) logs what would be refused and allows it.
 */
export function storageEnforcement(): StorageEnforcement {
	return env.get("STORAGE_ENFORCEMENT") === "enforce" ? "enforce" : "observe";
}
