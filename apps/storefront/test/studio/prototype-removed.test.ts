import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const APP = new URL("../../", import.meta.url);
const SRC = new URL("src/", APP);

/** Source files under src/, as paths relative to it. */
function sourceFiles(): string[] {
	return readdirSync(SRC, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx|css)$/.test(file))
		.sort();
}

test("the prototype's mock data, pages and images are gone", () => {
	assert.ok(!existsSync(new URL("data", SRC)), "src/data");
	assert.ok(
		!existsSync(new URL("components/layout", SRC)),
		"src/components/layout",
	);
	assert.ok(!existsSync(new URL("features/home", SRC)), "src/features/home");
	assert.ok(
		!existsSync(new URL("integrations/posthog", SRC)),
		"src/integrations/posthog",
	);
	assert.ok(!existsSync(new URL("public/images", APP)), "public/images");
	assert.ok(
		!existsSync(new URL("public/prisma.svg", APP)),
		"public/prisma.svg",
	);
	assert.ok(existsSync(new URL("public/robots.txt", APP)), "public/robots.txt");
});

test("the studio page has exactly its two routes", () => {
	assert.deepEqual(
		sourceFiles().filter((file) => file.startsWith("routes/")),
		["routes/__root.tsx", "routes/artists/$slug.tsx", "routes/index.tsx"],
	);
});

test("nothing refers to the mock data, the prototype pages or PostHog", () => {
	for (const file of sourceFiles()) {
		const text = readFileSync(new URL(file, SRC), "utf8");
		for (const banned of [
			"data/mock",
			"features/home",
			"posthog",
			"components/layout",
		]) {
			assert.ok(
				!text.toLowerCase().includes(banned),
				`${file} mentions ${banned}`,
			);
		}
	}
});

test("the prototype's booking form waits, unmounted, for the intake form", () => {
	assert.ok(existsSync(new URL("features/intake/booking-form.tsx", SRC)));
	assert.ok(existsSync(new URL("features/intake/booking-schema.ts", SRC)));
	for (const file of sourceFiles()) {
		if (file.startsWith("features/intake/")) continue;
		const text = readFileSync(new URL(file, SRC), "utf8");
		assert.ok(
			!text.includes("booking-form"),
			`${file} mounts the booking form`,
		);
	}
});
