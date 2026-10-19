import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MultipartFile } from "@adonisjs/core/bodyparser";
import { Exception } from "@adonisjs/core/exceptions";
import type { HttpContext } from "@adonisjs/core/http";
import config from "@adonisjs/core/services/config";
import logger from "@adonisjs/core/services/logger";

type Request = HttpContext["request"];

/**
 * What `receiveUploads` wrote for one request: every temp path it allocated
 * and every file handler still running. `discardUploads` works from this, not
 * from the parser's file map, which lacks a file whose handler has not
 * finished and any file with an odd field name.
 */
type Received = {
	paths: Set<string>;
	running: Set<Promise<unknown>>;
	parts: Set<Readable>;
};

const received = new WeakMap<object, Received>();

/** How long a public API upload may take to arrive (TAT-38): TAT-57 sends at most about 5 MB. */
export const UPLOAD_DEADLINE_MS = 90_000;

/** A dashboard upload's: it holds no database connection while it arrives. */
export const WEB_UPLOAD_DEADLINE_MS = 120_000;

/** How long `discardUploads` waits for a file handler that has not settled. */
const HANDLER_WAIT_MS = 30_000;

/**
 * Part names the parser would look up on its handler table, a plain object:
 * `constructor`, `toString`, `__proto__`... find a built-in there, and the
 * parser then throws inside an async listener (an unhandled rejection, which
 * ends the process). A handler under each such name makes every lookup land
 * on ours. Setting `__proto__` makes the table inherit from our handler
 * entry, so its two keys are covered as well.
 */
const BUILT_IN_NAMES = [
	...Object.getOwnPropertyNames(Object.prototype),
	"handler",
	"options",
];

/**
 * Reads the multipart body of a public API upload route into temp files and
 * fields (`request.files()`, `request.all()`), for a public API upload route
 * (in its handler) and a signed-in dashboard request (WebMultipartMiddleware).
 * The body parser reads no multipart body itself (`multipart.autoProcess:
 * false`, config/bodyparser.ts), so a public body is left alone until the
 * handler runs, after publicTenant has answered 404 for an unknown slug
 * (TAT-32, ruling 16; TAT-51; TAT-38). Same limits as the parser's (`limit`,
 * `fieldsLimit`). A part that fails is deleted, and the call rejects with
 * the parser's error (413, 400); a client that hangs up is a 400 too. The
 * body must arrive within `deadlineMs` (90 s by default), or the call
 * rejects with a 408 `E_REQUEST_TIMEOUT` (TAT-38). Pair it with
 * `discardUploads` in a `finally`. Call it only when `request.bodyType` is
 * "multipart".
 */
export async function receiveUploads(
	request: Request,
	{ deadlineMs = UPLOAD_DEADLINE_MS }: { deadlineMs?: number } = {},
): Promise<void> {
	const state: Received = {
		paths: new Set(),
		running: new Set(),
		parts: new Set(),
	};
	received.set(request, state);

	const handler = (
		part: Parameters<Parameters<Request["multipart"]["onFile"]>[2]>[0],
		reporter: Parameters<Parameters<Request["multipart"]["onFile"]>[2]>[1],
	) => {
		const tmpPath = newTmpPath();
		state.paths.add(tmpPath);
		const running = (async () => {
			try {
				state.parts.add(part);
				part.pause();
				part.on("data", reporter);
				await pipeline(part, createWriteStream(tmpPath));
				return { tmpPath };
			} catch (error) {
				await rm(tmpPath, { force: true }).catch(() => {});
				request.multipart.abort(error);
			} finally {
				state.parts.delete(part);
			}
		})();
		state.running.add(running);
		return running;
	};

	for (const name of [...BUILT_IN_NAMES, "*"]) {
		request.multipart.onFile(name, { deferValidations: true }, handler);
	}
	// The whole body must arrive within the deadline: a client that trickles
	// it would otherwise hold the request, and on the API its pooled
	// connection, for as long as it likes. Destroying the parts lets their
	// file handlers settle at once, so discardUploads doesn't wait for them.
	let timedOut = false;
	const timeout = new Exception("Request timeout", {
		status: 408,
		code: "E_REQUEST_TIMEOUT",
	});
	const timer = setTimeout(() => {
		timedOut = true;
		for (const part of state.parts) part.destroy(timeout);
		request.multipart.abort(timeout);
	}, deadlineMs);
	try {
		await request.multipart.process();
	} catch (error) {
		if (timedOut) throw timeout;
		throw clientHungUp(error)
			? new Exception("Request aborted", {
					status: 400,
					code: "E_REQUEST_ABORTED",
				})
			: error;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The parser's own error when the client closed the connection mid-body: a
 * plain Error with no status (the JSON parser's equivalent is a 400).
 */
function clientHungUp(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = "code" in error ? error.code : undefined;
	return (
		error.message === "Request aborted" ||
		code === "ECONNRESET" ||
		code === "ECONNABORTED"
	);
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
 * (ImageService.store deletes the ones it reads). `receiveUploads` writes
 * each uploaded file to a temp file, and nothing else removes the ones that
 * aren't stored, so on the public API, where anyone can upload, a route that
 * takes uploads ends with this in a `finally` (TAT-51). It first waits (at
 * most 30 s) for file handlers that are still closing their files, such as
 * the one before a malformed part, then removes every path `receiveUploads`
 * allocated, and finally walks the parser's file map for any other file.
 * Best effort: never throws.
 */
export async function discardUploads(request: Request): Promise<void> {
	const mine = received.get(request);
	const paths = new Set<string>();
	if (mine) {
		await settled(mine.running);
		for (const path of mine.paths) paths.add(path);
	}
	try {
		for (const path of tmpPathsIn(request.allFiles(), new Set())) {
			paths.add(path);
		}
	} catch {
		// The body parser never ran (a URL no route matched): nothing uploaded.
	}
	await Promise.all(
		[...paths].map((path) =>
			rm(path, { force: true }).catch((err) =>
				logger.warn({ err }, "Could not delete an upload's temp file"),
			),
		),
	);
}

/** Resolves when every promise has settled, or after HANDLER_WAIT_MS. */
async function settled(running: Set<Promise<unknown>>): Promise<void> {
	if (running.size === 0) return;
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, HANDLER_WAIT_MS);
		timer.unref();
	});
	await Promise.race([Promise.allSettled([...running]), timeout]);
	clearTimeout(timer);
}

/**
 * Every temp path in the body parser's files: a file (and files nested in
 * its properties, as a field named `a.b` after `a` makes), a list, or nested
 * fields.
 */
function tmpPathsIn(value: unknown, seen: Set<unknown>): string[] {
	if (typeof value !== "object" || value === null || seen.has(value)) return [];
	seen.add(value);
	const nested = (Array.isArray(value) ? value : Object.values(value)).flatMap(
		(item) => tmpPathsIn(item, seen),
	);
	return value instanceof MultipartFile && value.tmpPath
		? [value.tmpPath, ...nested]
		: nested;
}
