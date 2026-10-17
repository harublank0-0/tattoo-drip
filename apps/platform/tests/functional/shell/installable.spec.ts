import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import sharp from "sharp";

const publicFile = (path: string) =>
	new URL(`../../../public${path}`, import.meta.url);

test.group("Installable app", () => {
	test("the manifest describes the app, and its icons exist at their sizes", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/manifest.webmanifest");
		response.assertStatus(200);
		assert.include(
			response.header("content-type"),
			"application/manifest+json",
		);

		const manifest = JSON.parse(response.text());
		assert.containsSubset(manifest, {
			name: "Tattoo Drip",
			short_name: "Tattoo Drip",
			id: "/dashboard",
			start_url: "/dashboard",
			scope: "/",
			display: "standalone",
			background_color: "#ffffff",
			theme_color: "#18181b",
		});
		assert.sameMembers(
			manifest.icons.map(({ purpose }: { purpose: string }) => purpose),
			["any", "any", "maskable"],
		);
		for (const icon of manifest.icons) {
			const { width, height } = await sharp(
				await readFile(publicFile(icon.src)),
			).metadata();
			assert.equal(`${width}x${height}`, icon.sizes, icon.src);
		}
	});

	test("the service worker and the offline page are served", async ({
		client,
		assert,
	}) => {
		const worker = await client.get("/sw.js");
		worker.assertStatus(200);
		assert.include(worker.header("content-type"), "javascript");

		const offline = await client.get("/offline.html");
		offline.assertStatus(200);
		assert.include(offline.text(), "You're offline");
		assert.include(
			offline.text(),
			"Tattoo Drip needs a connection to show your studio.",
		);
	});

	test("the service worker stores only the offline page and the icons up front", async ({
		assert,
	}) => {
		const source = await readFile(publicFile("/sw.js"), "utf8");
		const list = source.match(/const PRECACHE = (\[[^\]]*\]);/);
		assert.isNotNull(list, "sw.js declares PRECACHE as a one-line array");
		assert.sameMembers(JSON.parse(list?.[1] ?? "[]"), [
			"/offline.html",
			"/icons/favicon.svg",
			"/icons/icon-192.png",
		]);
		assert.include(source, 'const CACHE = "td-shell-v1";');
	});
});
