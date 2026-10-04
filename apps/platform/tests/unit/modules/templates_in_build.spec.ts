import { glob } from "node:fs/promises";
import { matchesGlob } from "node:path";
import app from "@adonisjs/core/services/app";
import { test } from "@japa/runner";

/**
 * `node ace build` only copies files matched by `metaFiles` in adonisrc.ts.
 * A module template left out of it is missing in production, and every
 * email using it fails to send.
 */
test("the production build copies every module template", async ({
	assert,
}) => {
	const patterns = app.rcFile.metaFiles.map(({ pattern }) => pattern);
	const templates = await Array.fromAsync(
		glob("app/modules/**/*.edge", { cwd: app.makePath() }),
	);

	assert.isNotEmpty(templates);
	for (const template of templates) {
		assert.isTrue(
			patterns.some((pattern) => matchesGlob(template, pattern)),
			`${template} is not matched by any metaFiles pattern in adonisrc.ts`,
		);
	}
});
