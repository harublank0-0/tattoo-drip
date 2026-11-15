import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	type CoveragePeriod,
	type Entitlement,
	type EntitlementInput,
	entitlementText,
	type PilotCoverage,
	resolveEntitlement,
} from "#modules/packages/entitlement";
import type { PackageKey } from "#modules/packages/packages";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const created = at("2026-11-01T00:00:00Z");
const longAgo = at("2025-01-01T00:00:00Z");

const period = (
	pkg: PackageKey,
	from: string,
	to: string,
	revoked: string | null = null,
): CoveragePeriod => ({
	startsAt: at(from),
	endsAt: at(to),
	revokedAt: revoked ? at(revoked) : null,
	package: pkg,
	bundleId: `${pkg}-bundle`,
});

const pilot = (pkg: PackageKey, from: string, to: string): PilotCoverage => ({
	startsAt: at(from),
	endsAt: at(to),
	package: pkg,
	bundleId: `${pkg}-pilot-bundle`,
});

const resolve = (when: string, input: Partial<EntitlementInput> = {}) =>
	resolveEntitlement({
		at: at(when),
		workspaceCreatedAt: created,
		trial: { package: "solo", bundleId: "solo-trial-bundle" },
		pilots: [],
		periods: [],
		...input,
	});

const iso = (value: DateTime | null) => value?.toUTC().toISO() ?? null;

test.group("Entitlement: resolving a studio's package state", () => {
	test("a new workspace is on trial with its chosen package for 14 days, then paused without grace", ({
		assert,
	}) => {
		const trial = resolve("2026-11-10T00:00:00Z");
		assert.equal(trial.state, "trial");
		assert.equal(trial.package, "solo");
		assert.equal(trial.bundleId, "solo-trial-bundle");
		assert.equal(trial.artistLimit, 1);
		assert.equal(iso(trial.until), "2026-11-15T00:00:00.000Z");

		const over = resolve("2026-11-15T00:00:00Z");
		assert.equal(over.state, "paused");
		assert.isNull(over.until);
		assert.equal(over.package, "solo");
	});

	test("a paid period gives its package until the end of continuous coverage", ({
		assert,
	}) => {
		const paid = resolve("2026-11-20T00:00:00Z", {
			periods: [
				period("studio", "2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"),
				period("studio", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
			],
		});
		assert.equal(paid.state, "paid");
		assert.equal(paid.package, "studio");
		assert.equal(paid.bundleId, "studio-bundle");
		assert.isNull(paid.artistLimit);
		assert.equal(iso(paid.until), "2027-01-01T00:00:00.000Z");
	});

	test("an upgrade inside a Solo period gives Studio from its payment, and Solo again if it is reversed", ({
		assert,
	}) => {
		const solo = period("solo", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z");
		const upgrade = period(
			"studio",
			"2026-11-20T00:00:00Z",
			"2026-12-01T00:00:00Z",
		);
		assert.equal(
			resolve("2026-11-10T00:00:00Z", { periods: [solo, upgrade] }).package,
			"solo",
		);
		const upgraded = resolve("2026-11-25T00:00:00Z", {
			periods: [solo, upgrade],
		});
		assert.equal(upgraded.package, "studio");
		assert.equal(iso(upgraded.until), "2026-12-01T00:00:00.000Z");

		const reversed = resolve("2026-11-25T00:00:00Z", {
			periods: [
				solo,
				period(
					"studio",
					"2026-11-20T00:00:00Z",
					"2026-12-01T00:00:00Z",
					"2026-11-22T00:00:00Z",
				),
			],
		});
		assert.equal(reversed.state, "paid");
		assert.equal(reversed.package, "solo");
		assert.equal(iso(reversed.until), "2026-12-01T00:00:00.000Z");
	});

	test("grace follows an ordinary lapse for 7 days with the highest package that ended", ({
		assert,
	}) => {
		const periods = [
			period("solo", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
			period("studio", "2026-11-20T00:00:00Z", "2026-12-01T00:00:00Z"),
		];
		const grace = resolve("2026-12-05T00:00:00Z", { periods });
		assert.equal(grace.state, "grace");
		assert.equal(grace.package, "studio");
		assert.equal(iso(grace.until), "2026-12-08T00:00:00.000Z");

		const over = resolve("2026-12-08T00:00:00Z", { periods });
		assert.equal(over.state, "paused");
		assert.equal(over.package, "studio");
	});

	test("a revoked latest period gives no grace", ({ assert }) => {
		const paused = resolve("2026-12-04T00:00:00Z", {
			periods: [
				period("studio", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
				period(
					"studio",
					"2026-12-01T00:00:00Z",
					"2027-01-01T00:00:00Z",
					"2026-12-03T00:00:00Z",
				),
			],
		});
		assert.equal(paused.state, "paused");
	});

	test("a pilot grant applies while it runs; the higher of pilot and paid wins", ({
		assert,
	}) => {
		const grant = pilot(
			"studio",
			"2026-11-01T00:00:00Z",
			"2027-03-31T00:00:00Z",
		);
		const onPilot = resolve("2026-11-10T00:00:00Z", {
			workspaceCreatedAt: longAgo,
			pilots: [grant],
		});
		assert.equal(onPilot.state, "pilot");
		assert.equal(onPilot.package, "studio");
		assert.equal(onPilot.bundleId, "studio-pilot-bundle");
		assert.equal(iso(onPilot.until), "2027-03-31T00:00:00.000Z");

		const pilotOverSolo = resolve("2026-11-10T00:00:00Z", {
			workspaceCreatedAt: longAgo,
			pilots: [grant],
			periods: [period("solo", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z")],
		});
		assert.equal(pilotOverSolo.state, "pilot");
		assert.equal(pilotOverSolo.package, "studio");

		const studioOverPilot = resolve("2026-11-10T00:00:00Z", {
			workspaceCreatedAt: longAgo,
			pilots: [pilot("solo", "2026-11-01T00:00:00Z", "2027-03-31T00:00:00Z")],
			periods: [
				period("studio", "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
			],
		});
		assert.equal(studioOverPilot.state, "paid");
		assert.equal(studioOverPilot.package, "studio");
		assert.equal(studioOverPilot.bundleId, "studio-bundle");
	});

	test("an ended pilot on an old workspace is paused, not a new trial", ({
		assert,
	}) => {
		const paused = resolve("2026-11-10T00:00:00Z", {
			workspaceCreatedAt: longAgo,
			pilots: [pilot("studio", "2026-01-01T00:00:00Z", "2026-11-01T00:00:00Z")],
		});
		assert.equal(paused.state, "paused");
		assert.equal(paused.package, "studio");
		assert.equal(paused.bundleId, "studio-pilot-bundle");
	});

	test("the status line names the package, the state and the date", ({
		assert,
	}) => {
		const day = (value: DateTime) => value.toUTC().toFormat("d LLL yyyy");
		const entitlement = (
			state: Entitlement["state"],
			pkg: PackageKey,
			until: string | null,
		): Entitlement => ({
			state,
			package: pkg,
			bundleId: "b",
			until: until ? at(until) : null,
			artistLimit: null,
		});
		assert.equal(
			entitlementText(
				entitlement("trial", "solo", "2026-11-15T00:00:00Z"),
				day,
			),
			"Solo trial until 15 Nov 2026",
		);
		assert.equal(
			entitlementText(
				entitlement("paid", "studio", "2027-01-01T00:00:00Z"),
				day,
			),
			"Studio, paid until 1 Jan 2027",
		);
		assert.equal(
			entitlementText(
				entitlement("grace", "studio", "2026-12-08T00:00:00Z"),
				day,
			),
			"Studio, payment overdue: grace until 8 Dec 2026",
		);
		assert.equal(
			entitlementText(
				entitlement("pilot", "studio", "2027-03-31T00:00:00Z"),
				day,
			),
			"Studio, pilot until 31 Mar 2027",
		);
		assert.equal(
			entitlementText(entitlement("paused", "studio", null), day),
			"Paused: pay to start new client work",
		);
	});
});
