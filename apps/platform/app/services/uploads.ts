import { rm } from "node:fs/promises";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import type { HttpContext } from "@adonisjs/core/http";
import logger from "@adonisjs/core/services/logger";

/**
 * Deletes the temp file of every upload in the request that nothing stored
 * (ImageService.store deletes the ones it reads). The body parser writes
 * each uploaded file to a temp file and nothing else removes the ones that
 * aren't stored, so on the public API, where anyone can upload, a route that
 * takes uploads ends with this in a `finally` (TAT-51). Best effort: never
 * throws.
 */
export async function discardUploads(
	request: HttpContext["request"],
): Promise<void> {
	let files: unknown;
	try {
		files = request.allFiles();
	} catch {
		// The body parser never ran (a URL no route matched): nothing uploaded.
		return;
	}
	await Promise.all(
		tmpPathsIn(files).map((path) =>
			rm(path, { force: true }).catch((err) =>
				logger.warn({ err }, "Could not delete an upload's temp file"),
			),
		),
	);
}

/** Every temp path in the body parser's files: a file, a list, or nested fields. */
function tmpPathsIn(value: unknown): string[] {
	if (value instanceof MultipartFile) {
		return value.tmpPath ? [value.tmpPath] : [];
	}
	if (Array.isArray(value)) return value.flatMap(tmpPathsIn);
	if (typeof value === "object" && value !== null) {
		return Object.values(value).flatMap(tmpPathsIn);
	}
	return [];
}
