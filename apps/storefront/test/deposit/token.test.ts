import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	DEPOSIT_TOKEN,
	readDepositToken,
	scrollRestorationKey,
} from "../../src/deposit/token.ts";
import { TOKEN } from "./fixtures.ts";

const CONTRACT = new URL(
	"../../../../packages/types/openapi.yaml",
	import.meta.url,
);

describe("readDepositToken", () => {
	test("reads the 43 base64url characters of the link's fragment", () => {
		assert.equal(TOKEN.length, 43);
		assert.equal(readDepositToken(`#${TOKEN}`), TOKEN);
		assert.equal(readDepositToken(TOKEN), TOKEN);
		const every = `${"AZaz09_-".repeat(5)}abc`;
		assert.equal(every.length, 43);
		assert.equal(readDepositToken(`#${every}`), every);
	});

	test("refuses anything else, so a broken link asks the API for nothing", () => {
		for (const hash of [
			"",
			"#",
			`#${TOKEN.slice(1)}`,
			`#${TOKEN}A`,
			`#${TOKEN.slice(0, 42)}=`,
			`#${TOKEN.slice(0, 42)}+`,
			`#${TOKEN.slice(0, 42)}/`,
			`#${TOKEN.slice(0, 42)}.`,
			`# ${TOKEN.slice(1)}`,
			`#${TOKEN} `,
			`#${TOKEN}&utm_source=whatsapp`,
			`#${TOKEN.slice(0, 40)}%2D`,
			"#inquiry",
		]) {
			assert.equal(readDepositToken(hash), null, JSON.stringify(hash));
		}
	});

	test("is the contract's DepositToken pattern", () => {
		const yaml = readFileSync(CONTRACT, "utf8");
		const pattern = /DepositToken:[\s\S]*?pattern: "([^"]+)"/.exec(yaml)?.[1];
		assert.equal(pattern, DEPOSIT_TOKEN.source);
	});
});

describe("scrollRestorationKey", () => {
	test("is the history entry's own key", () => {
		assert.equal(
			scrollRestorationKey({
				pathname: "/deposit",
				state: { __TSR_key: "k3j2x" },
			}),
			"k3j2x",
		);
	});

	test("falls back to the path, never the href with its fragment", () => {
		assert.equal(
			scrollRestorationKey({ pathname: "/deposit", state: {} }),
			"/deposit",
		);
		assert.equal(
			scrollRestorationKey({ pathname: "/deposit", state: { __TSR_key: "" } }),
			"/deposit",
		);
	});
});
