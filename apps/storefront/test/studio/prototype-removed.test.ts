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
	assert.ok(!existsSync(new URL("features", SRC)), "src/features");
	assert.ok(existsSync(new URL("public/robots.txt", APP)), "public/robots.txt");
});

test("the storefront has exactly its three routes", () => {
	assert.deepEqual(
		sourceFiles().filter((file) => file.startsWith("routes/")),
		[
			"routes/__root.tsx",
			"routes/artists/$slug.tsx",
			"routes/deposit.tsx",
			"routes/index.tsx",
		],
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
			"features/",
			"booking-form",
		]) {
			assert.ok(
				!text.toLowerCase().includes(banned),
				`${file} mentions ${banned}`,
			);
		}
	}
});

test("the intake form replaced the prototype's booking form", () => {
	assert.ok(existsSync(new URL("intake/components/intake-form.tsx", SRC)));
	const section = readFileSync(
		new URL("studio/components/inquiry.tsx", SRC),
		"utf8",
	);
	assert.match(section, /<IntakeMount\b/);
});
