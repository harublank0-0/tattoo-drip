import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
	businessNav,
	footerGroups,
	PRIMARY_NAV,
	paths,
	ROUTE_FILES,
	studioOsLinks,
} from "../src/lib/routes.ts";

const STUDIO_OS = "https://app.tattoodrip.app";
/** The paths nginx sends to Studio OS on Discover's host (docs/discover/domain-migration.md). */
const LEGACY =
	/^\/(login|logout|signup|forgot-password|reset-password|verify-email|confirm-email|invitations|dashboard|onboarding|account|t|api|sw\.js)(\/|$)/;

async function routeTreePaths(): Promise<Set<string>> {
	const tree = await readFile(
		new URL("../src/routeTree.gen.ts", import.meta.url),
		"utf8",
	);
	return new Set(
		[...tree.matchAll(/fullPath: '([^']+)'/g)].map(
			(match) => match[1] as string,
		),
	);
}

describe("Discover routes and navigation", () => {
	test("every path listed as existing has a route in the generated tree", async () => {
		const tree = await routeTreePaths();
		for (const path of ROUTE_FILES)
			assert.ok(tree.has(path), `${path} has no route`);
	});

	test("every internal navigation link points at an existing route, never a legacy path", async () => {
		const internal = [
			...PRIMARY_NAV,
			...Object.values(businessNav(STUDIO_OS)),
			...footerGroups(STUDIO_OS).flatMap((group) => group.links),
		].filter((link) => link.kind === "internal");
		assert.ok(internal.length >= 5);
		for (const link of internal) {
			assert.ok(
				(ROUTE_FILES as readonly string[]).includes(link.to),
				`${link.label}: ${link.to}`,
			);
			assert.doesNotMatch(link.to, LEGACY);
		}
		for (const path of Object.values(paths)) {
			assert.doesNotMatch(path("x", "y"), LEGACY);
		}
	});

	test("Sign in and Get started go to Studio OS's own origin", () => {
		assert.deepEqual(studioOsLinks(STUDIO_OS), {
			signIn: "https://app.tattoodrip.app/login",
			getStarted: "https://app.tattoodrip.app/signup",
		});
		const { signIn, getStarted } = businessNav("http://app.localhost:3333");
		assert.equal(signIn.href, "http://app.localhost:3333/login");
		assert.equal(getStarted.href, "http://app.localhost:3333/signup");
	});

	test("planned paths encode their segments", () => {
		assert.equal(paths.studio("black needle"), "/studios/black%20needle");
		assert.equal(paths.studioArtist("a/b", "c"), "/studios/a%2Fb/artists/c");
	});
});
