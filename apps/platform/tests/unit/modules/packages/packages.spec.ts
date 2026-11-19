import { test } from "@japa/runner";
import {
	higherPackage,
	PACKAGES,
	packageForTenantType,
} from "#modules/packages/packages";

test.group(
	"Packages (docs/superpowers/specs/2026-11-15-studio-packages-design.md)",
	() => {
		test("Solo allows one active artist and Studio any number", ({
			assert,
		}) => {
			assert.equal(PACKAGES.solo.artistLimit, 1);
			assert.isNull(PACKAGES.studio.artistLimit);
			assert.equal(
				PACKAGES.solo.line,
				"One artist, with help running the business.",
			);
			assert.equal(PACKAGES.studio.line, "Multiple artists working together.");
			assert.equal(PACKAGES.solo.defaultBundleKey, "solo-v2");
			assert.equal(PACKAGES.studio.defaultBundleKey, "studio-v2");
		});

		test("Studio ranks above Solo", ({ assert }) => {
			assert.equal(higherPackage("solo", "studio"), "studio");
			assert.equal(higherPackage("studio", "solo"), "studio");
			assert.equal(higherPackage("solo", "solo"), "solo");
		});

		test("the account type suggests the package", ({ assert }) => {
			assert.equal(packageForTenantType("independent"), "solo");
			assert.equal(packageForTenantType("studio"), "studio");
		});
	},
);
