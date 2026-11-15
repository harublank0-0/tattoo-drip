import env from "#start/env";

export type PackageEnforcement = "observe" | "enforce";

/**
 * How package rules apply (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * Enforcement switch): `observe` (the default, also when unset) logs what
 * would be refused and allows it; `enforce` refuses. It stays `observe`
 * until every pilot has a grant, prices and quantities are set and the
 * upgrade (phase 4) has shipped.
 */
export function packageEnforcement(): PackageEnforcement {
	return env.get("PACKAGE_ENFORCEMENT") ?? "observe";
}
