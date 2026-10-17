import { existsSync } from "node:fs";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import type { HttpContext } from "@adonisjs/core/http";
import { test } from "@japa/runner";
import { discardUploads } from "#services/uploads";
import { uploadOf } from "#tests/helpers/images";

/** A parsed upload whose temp file is `tmpPath`, or one already moved (none). */
function fileAt(tmpPath?: string) {
	const file = new MultipartFile(
		{ fieldName: "referenceImages", clientName: "reference.png", headers: {} },
		{},
	);
	if (tmpPath) file.tmpPath = tmpPath;
	return file;
}

const requestWith = (allFiles: () => unknown) =>
	({ allFiles }) as unknown as HttpContext["request"];

test.group("discardUploads", () => {
	test("deletes the temp file of every upload, nested or in lists", async ({
		assert,
	}) => {
		const paths: string[] = [];
		for (let i = 0; i < 4; i++) {
			paths.push((await uploadOf(Buffer.from("x"))).tmpPath);
		}

		await discardUploads(
			requestWith(() => ({
				one: fileAt(paths[0]),
				many: [fileAt(paths[1]), fileAt(paths[2])],
				nested: { deep: [fileAt(paths[3])] },
				moved: fileAt(),
			})),
		);

		for (const path of paths) assert.isFalse(existsSync(path), path);
	});

	test("deletes a file nested in another file's properties, and survives a loop", async ({
		assert,
	}) => {
		// A field named `junk.extra` after `junk` is stored on the first file.
		const [outerPath, innerPath] = [
			(await uploadOf(Buffer.from("x"))).tmpPath,
			(await uploadOf(Buffer.from("x"))).tmpPath,
		];
		const outer = fileAt(outerPath);
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		Object.assign(outer, { extra: fileAt(innerPath), loop });

		await discardUploads(requestWith(() => ({ junk: outer })));

		assert.isFalse(existsSync(outerPath));
		assert.isFalse(existsSync(innerPath));
	});

	test("a file already gone, or no body parser at all, is fine", async () => {
		await discardUploads(
			requestWith(() => ({ gone: fileAt("/nonexistent/td51-upload") })),
		);
		await discardUploads(
			requestWith(() => {
				throw new Error(
					"Cannot read files. Make sure the bodyparser middleware is registered",
				);
			}),
		);
	});
});
