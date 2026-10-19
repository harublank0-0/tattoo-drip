import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

/**
 * @tattoo-drip/react is consumed from source with its own node_modules. A
 * second copy of React or TanStack Query there would give its hooks a
 * context without the app's QueryClient ("No QueryClient set"). If this
 * fails, align the versions (pnpm why @tanstack/react-query); don't alias.
 */
test("@tattoo-drip/react resolves the storefront's React and TanStack Query", () => {
	for (const name of ["react", "@tanstack/react-query"]) {
		const app = realpathSync(
			new URL(`../../node_modules/${name}`, import.meta.url),
		);
		const sdk = realpathSync(
			new URL(
				`../../../../packages/react/node_modules/${name}`,
				import.meta.url,
			),
		);
		assert.equal(sdk, app, name);
	}
});
