import type { TenantType } from "#modules/tenancy/models/tenant";

/**
 * Tattoo Drip's studio packages (docs/superpowers/specs/2026-11-15-studio-packages-design.md):
 * what separates them is how many artists work in the account and how big
 * the shared allowances are. Allowances live in versioned bundles
 * (`allowance_bundles`); each package names the bundle a trial gets.
 */
export const PACKAGE_KEYS = ["solo", "studio"] as const;
export type PackageKey = (typeof PACKAGE_KEYS)[number];

export type PackageDefinition = {
	name: string;
	/** The customer-facing line. */
	line: string;
	/** Active artists allowed; null for any number. */
	artistLimit: number | null;
	/** The allowance bundle a trial on this package gets. */
	defaultBundleKey: string;
};

export const PACKAGES: Record<PackageKey, PackageDefinition> = {
	solo: {
		name: "Solo",
		line: "One artist, with help running the business.",
		artistLimit: 1,
		defaultBundleKey: "solo-v1",
	},
	studio: {
		name: "Studio",
		line: "Multiple artists working together.",
		artistLimit: null,
		defaultBundleKey: "studio-v1",
	},
};

const RANK: Record<PackageKey, number> = { solo: 0, studio: 1 };

/** The bigger of two packages: Studio over Solo. */
export function higherPackage(a: PackageKey, b: PackageKey): PackageKey {
	return RANK[b] > RANK[a] ? b : a;
}

/** The package a new workspace's type suggests; the owner may choose either. */
export function packageForTenantType(type: TenantType): PackageKey {
	return type === "independent" ? "solo" : "studio";
}
