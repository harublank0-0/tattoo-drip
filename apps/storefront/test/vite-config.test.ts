import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ConfigEnv } from "vite";
import config from "../vite.config.ts";

const SETTINGS = ["API_URL", "STOREFRONT_URL"] as const;
const saved = new Map<string, string | undefined>();

// Run with neither setting present, whatever the machine's environment holds.
beforeEach(() => {
	for (const name of SETTINGS) {
		saved.set(name, process.env[name]);
		delete process.env[name];
	}
});
afterEach(() => {
	for (const name of SETTINGS) {
		const value = saved.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

/** The config function throws synchronously, so wrap it to reject instead. */
async function resolveConfig(env: ConfigEnv) {
	return config(env);
}

describe("vite.config.ts", () => {
	test("the dev server refuses to start without the storefront's settings", async () => {
		await assert.rejects(
			resolveConfig({ command: "serve", mode: "development" }),
			/settings are invalid/,
		);
	});

	test("a build needs no settings", async () => {
		await resolveConfig({ command: "build", mode: "production" });
	});

	test("vite preview needs no settings: it doesn't load .env.local", async () => {
		await resolveConfig({
			command: "serve",
			mode: "production",
			isPreview: true,
		});
	});
});
