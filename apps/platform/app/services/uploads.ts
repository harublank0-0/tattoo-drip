import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import type { HttpContext } from "@adonisjs/core/http";
import config from "@adonisjs/core/services/config";
import logger from "@adonisjs/core/services/logger";

/**
 * Reads the multipart body of a public API upload route into temp files and
 * fields (`request.files()`, `request.all()`), as the body parser does for
 * the dashboard, but only now: the route is in `multipart.processManually`
 * (config/bodyparser.ts), so the parser leaves its body alone until the
 * handler runs, after publicTenant has answered 404 for an unknown slug
 * (TAT-32, ruling 16; TAT-51). Same limits as the parser's (`limit`,
 * `fieldsLimit`). A part that fails is deleted, and the call rejects with
 * the parser's error (413, 400). Pair it with `discardUploads` in a
 * `finally`. Call it only when `request.bodyType` is "multipart".
 */
export async function receiveUploads(
	request: HttpContext["request"],
): Promise<void> {
	request.multipart.onFile(
		"*",
		{ deferValidations: true },
		async (part, reporter) => {
			const tmpPath = newTmpPath();
			try {
				part.pause();
				part.on("data", reporter);
				await pipeline(part, createWriteStream(tmpPath));
				return { tmpPath };
			} catch (error) {
				await rm(tmpPath, { force: true }).catch(() => {});
				request.multipart.abort(error);
			}
		},
	);
	await request.multipart.process();
}

/** A new temp file path, named as config/bodyparser.ts says (the OS temp folder by default). */
function newTmpPath(): string {
	const { tmpFileName } = config.get<{
		multipart: { tmpFileName?: () => string };
	}>("bodyparser").multipart;
	const name = tmpFileName?.() ?? randomUUID();
	return isAbsolute(name) ? name : join(tmpdir(), name);
}

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
