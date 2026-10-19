import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const SCRIPT = new URL("../../scripts/check-client-bundle.mjs", import.meta.url)
	.pathname;

/** What the SDK's code, always in the browser bundle, says on a timeout. */
const SDK_TEXT = 'message:"The Tattoo Drip API did not answer in time."';

const scratch = mkdtempSync(join(tmpdir(), "client-bundle-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
/** A fake browser output folder with the given files. */
function bundle(files: Record<string, string>): string {
	const dir = join(scratch, `bundle-${count++}`);
	for (const [name, content] of Object.entries(files)) {
		const path = join(dir, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
	return dir;
}

function check(dir: string) {
	const result = spawnSync(process.execPath, [SCRIPT, dir], {
		encoding: "utf8",
	});
	return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("check-client-bundle", () => {
	test("passes a browser output that shows the SDK and nothing server-only", () => {
		const { code, out } = check(
			bundle({
				"assets/index-abc.js": `export const a = {${SDK_TEXT}};`,
				"assets/app.css": "body{margin:0}",
			}),
		);
		assert.equal(code, 0, out);
	});

	test("fails on each server-only name, in any text file, and names the file", () => {
		const names = [
			"STOREFRONT_SERVER_KEY",
			"serverKey",
			"requestStudio",
			"storefrontConfig",
			"tenantMiddleware",
			"API_URL",
			"process.env",
			"Studio lookup failed",
			"Studio not found",
			"handleTenantRequest",
		];
		for (const name of names) {
			for (const file of [
				"assets/index.js",
				"index.html",
				"assets/app.js.map",
			]) {
				const { code, out } = check(
					bundle({
						"assets/index-abc.js": SDK_TEXT,
						[file]: `x = "${name}";`,
					}),
				);
				assert.equal(code, 1, `${name} in ${file}: ${out}`);
				assert.ok(out.includes(name), out);
			}
		}
	});

	test("lets a route's cache header through: page routes set s-maxage in code the browser also gets", () => {
		const { code, out } = check(
			bundle({
				"assets/index-abc.js": `${SDK_TEXT}; h = "public, max-age=0, s-maxage=60";`,
			}),
		);
		assert.equal(code, 0, out);
	});

	test("never prints what surrounds a match", () => {
		const secret = "SECRETCONTEXT0123456789";
		const { code, out } = check(
			bundle({
				"assets/index-abc.js": SDK_TEXT,
				"assets/leak.js": `${secret} STOREFRONT_SERVER_KEY ${secret}`,
			}),
		);
		assert.equal(code, 1);
		assert.ok(!out.includes(secret), out);
	});

	test("fails when the SDK's text is missing: it didn't look at a real browser build", () => {
		const { code, out } = check(bundle({ "assets/index.js": "export {};" }));
		assert.equal(code, 1);
		assert.match(out, /did not answer in time/);
	});

	test("fails when there is no output to look at", () => {
		const { code, out } = check(join(scratch, "does-not-exist"));
		assert.equal(code, 1);
		assert.match(out, /pnpm build/);
	});
});
