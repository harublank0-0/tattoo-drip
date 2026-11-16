import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { S3Driver } from "@adonisjs/drive/drivers/s3";
import drive from "@adonisjs/drive/services/main";
import {
	checkStorageSettings,
	r2DiskOptions,
} from "#services/storage_settings";

const SETTINGS = (() => {
	const checked = checkStorageSettings(
		{
			R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
			R2_ACCESS_KEY_ID: "access-key-id",
			R2_SECRET_ACCESS_KEY: "secret-access-key",
			R2_PUBLIC_BUCKET: "tattoo-drip-public",
			R2_PRIVATE_BUCKET: "tattoo-drip-private",
			R2_PUBLIC_URL: "https://media.tattoodrip.app",
		},
		true,
	);
	if (checked.kind !== "r2") throw new Error("the stand-in settings are R2");
	return checked;
})();

const BUCKETS = {
	public: SETTINGS.publicBucket,
	private: SETTINGS.privateBucket,
} as const;

/**
 * Puts both disks on a stand-in for R2 on this machine (the real endpoint is
 * never called), with production's S3 options (`r2DiskOptions`) and the
 * objects held in memory. Like R2, it refuses a PUT without Content-Length
 * (411 `MissingContentLength`), which is what a chunked upload of a stream of
 * unknown length gets: the folder disks the other tests use accept one, so
 * only this can catch it. `refused` lists the keys it refused;
 * `failNextPuts(n)` answers the next n uploads 500 `InternalError`, as R2
 * now and then does. `restore()` puts the folder disks back, and the test
 * must call it (`cleanup`) because the disks are shared by the whole run.
 */
export async function useR2StandIn() {
	const objects = new Map<string, Buffer>();
	const refused: string[] = [];
	let failing = 0;
	const server = createServer(async (request, response) => {
		const path = decodeURIComponent(
			new URL(request.url ?? "/", "http://stand-in").pathname.slice(1),
		);
		const xmlError = (status: number, code: string, message: string) => {
			response.writeHead(status, { "content-type": "application/xml" });
			response.end(
				`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
			);
		};
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);

		if (request.method === "PUT") {
			if (request.headers["content-length"] === undefined) {
				refused.push(path);
				return xmlError(
					411,
					"MissingContentLength",
					"You must provide the Content-Length HTTP header.",
				);
			}
			if (failing > 0) {
				failing -= 1;
				return xmlError(
					500,
					"InternalError",
					"We encountered an internal error. Please try again.",
				);
			}
			objects.set(path, Buffer.concat(chunks));
			response.writeHead(200, { etag: '"stand-in"' });
			return response.end();
		}
		if (request.method === "DELETE") {
			objects.delete(path);
			response.writeHead(204);
			return response.end();
		}
		const body = objects.get(path);
		if (!body) return xmlError(404, "NoSuchKey", "The key does not exist.");
		response.writeHead(200, {
			"content-length": body.length,
			"content-type": "application/octet-stream",
			"last-modified": new Date().toUTCString(),
			etag: '"stand-in"',
		});
		response.end(request.method === "HEAD" ? undefined : body);
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const { port } = server.address() as AddressInfo;

	const swapped = (["public", "private"] as const).map((visibility) => {
		const disk = drive.use(visibility);
		const original = disk.driver;
		disk.driver = new S3Driver({
			...r2DiskOptions(SETTINGS, visibility),
			endpoint: `http://127.0.0.1:${port}`,
			forcePathStyle: true,
		});
		return () => {
			disk.driver = original;
		};
	});

	return {
		refused,
		/** Answers the next `count` uploads 500 `InternalError`. */
		failNextPuts(count: number) {
			failing = count;
		},
		/** Stores a file on a disk's bucket directly, as an earlier upload did. */
		put(visibility: "public" | "private", key: string, body: Buffer) {
			objects.set(`${BUCKETS[visibility]}/${key}`, body);
		},
		/** A file on a disk's bucket, or undefined. */
		get(visibility: "public" | "private", key: string) {
			return objects.get(`${BUCKETS[visibility]}/${key}`);
		},
		async restore() {
			for (const undo of swapped) undo();
			await new Promise<void>((done) => server.close(() => done()));
		},
	};
}
