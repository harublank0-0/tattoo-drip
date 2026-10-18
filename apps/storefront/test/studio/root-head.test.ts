import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	notFound,
} from "@tanstack/react-router";
import { rootMeta, statusHead } from "../../src/studio/seo.ts";

/**
 * The root route's head on the installed router, with the root's own `head`
 * the way src/routes/__root.tsx wires it: a path no page route matches (the
 * prototype's /flash, /admin/bookings) is the not-found page, so its head
 * says so and is noindex, not the studio's name as a page title.
 */
async function rootMetaFor(
	path: string,
	options: { rootLoader?: () => { name: string } } = {},
) {
	const root = createRootRoute({
		loader: options.rootLoader ?? (() => ({ name: "Black Needle" })),
		head: ({ loaderData, match, matches }) => ({
			meta: rootMeta({ loaderData, match, matches }),
		}),
	});
	const index = createRoute({
		getParentRoute: () => root,
		path: "/",
		component: () => null,
	});
	const artist = createRoute({
		getParentRoute: () => root,
		path: "/artists/$slug",
		loader: () => {
			throw notFound();
		},
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([index, artist]),
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	await router.load();
	return router.state.matches[0].meta;
}

describe("the root route's head", () => {
	test("titles a page that sets none with the studio's name", async () => {
		assert.deepEqual(await rootMetaFor("/"), [{ title: "Black Needle" }]);
	});

	test("a path no page route matches is the not-found head, noindex", async () => {
		for (const path of ["/flash", "/admin/bookings", "/portfolio/old-work"]) {
			assert.deepEqual(
				await rootMetaFor(path),
				statusHead("notFound").meta,
				path,
			);
		}
		// Spelled out, so the test says what it means.
		assert.deepEqual(await rootMetaFor("/flash"), [
			{ title: "Page not found" },
			{ name: "robots", content: "noindex" },
		]);
	});

	test("a page route that matched keeps the studio's name for the root", async () => {
		assert.deepEqual(await rootMetaFor("/artists/nobody"), [
			{ title: "Black Needle" },
		]);
	});

	test("a studio that went away is the not-found head, noindex", async () => {
		const meta = await rootMetaFor("/", {
			rootLoader: () => {
				throw notFound();
			},
		});
		assert.deepEqual(meta, statusHead("notFound").meta);
	});

	test("a studio that can't be read is the error head, noindex", async () => {
		const meta = await rootMetaFor("/", {
			rootLoader: () => {
				throw new Error("The studio could not be read.");
			},
		});
		assert.deepEqual(meta, statusHead("error").meta);
	});
});
