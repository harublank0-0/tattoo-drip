import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { hasRoute } from "../src/lib/routes.ts";

/**
 * Starting the built server as production starts it, against a stub API,
 * and reading its pages (D05–D07 server tests). Skipped without a build.
 */
export const ENTRY = new URL("../.output/server/index.mjs", import.meta.url);
export const built = existsSync(ENTRY);
export const skip = !built && "no build (run pnpm build)";

export const APP = "http://app.localhost:3333";
export const SITE = "http://localhost:3100";
export async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

export async function startDiscover(
	apiUrl: string,
	extra: Record<string, string> = {},
) {
	const port = await freePort();
	const child: ChildProcess = spawn(process.execPath, [ENTRY.pathname], {
		env: {
			...process.env,
			API_URL: apiUrl,
			DISCOVER_URL: SITE,
			APP_URL: APP,
			...extra,
			PORT: String(port),
			NODE_ENV: "production",
		},
		stdio: "ignore",
	});
	const get = (path: string, init?: RequestInit) =>
		fetch(`http://localhost:${port}${path}`, init);
	for (let i = 0; i < 50; i++) {
		try {
			await get("/robots.txt");
			return { child, get };
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	child.kill();
	throw new Error("The built server did not start.");
}

/** The query each request to one list endpoint sent, as objects. */
export function sentTo(
	requests: string[],
	endpoint: string,
): Record<string, string>[] {
	return requests
		.filter((url) =>
			new RegExp(`^/api/v1/discover/${endpoint}(\\?|$)`).test(url),
		)
		.map((url) => Object.fromEntries(new URL(url, "http://stub").searchParams));
}

/**
 * Every internal link on a page points at a route that exists (D07: the
 * style and location pages; D08: profiles; never an artwork page before D09).
 */
export function assertInternalLinksExist(html: string) {
	const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)]
		.map((match) => (match[1] as string).replace(/&amp;/g, "&"))
		.filter(
			(href) => !/^\/(assets\/|favicon)/.test(href) && !href.startsWith("//"),
		);
	assert.ok(hrefs.length > 0);
	for (const href of hrefs) {
		const path = decodeURIComponent(new URL(href, "http://x").pathname);
		assert.ok(
			hasRoute(path) || hasRoute(new URL(href, "http://x").pathname),
			href,
		);
	}
}

/** The visible text of a page, roughly: tags and the dehydrated script removed. */
export function text(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");
}

export type Discover = Awaited<ReturnType<typeof startDiscover>>;
