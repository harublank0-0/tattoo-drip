import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { inject } from "@adonisjs/core";
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { FSDriver } from "@adonisjs/drive/drivers/fs";
import drive from "@adonisjs/drive/services/main";
import { VideoDeleteError } from "#modules/media/errors";
import ImageService, {
	type ShownImage,
	STORED_CACHE_CONTROL,
} from "#modules/media/services/image_service";
import {
	posterFrame,
	probe,
	transcode,
	transcodeSlot,
	VideoToolError,
	VideoToolMissingError,
} from "#modules/media/services/video_tools";
import {
	MAX_VIDEO_BYTES,
	posterSeconds,
	readProbe,
	renditionKey,
	renditionOfKey,
	renditionPlan,
	VIDEO_REFUSALS,
	type VideoType,
} from "#modules/media/video";
import type Tenant from "#modules/tenancy/models/tenant";
import { currentClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** The poster's purpose; the renditions sit beside it under the same folder. */
export const VIDEO_PURPOSE = "work_video";
/**
 * The purposes a video's poster and renditions are stored under: a work
 * video angle's, and a client's Fresh ink video (Reviews and Fresh ink).
 * Every method takes the purpose, `work_video` when left out; the staging
 * prefix is shared, so the one lifecycle rule expires both.
 */
export const VIDEO_PURPOSES = ["work_video", "client_post_video"] as const;
export type VideoPurpose = (typeof VIDEO_PURPOSES)[number];
/** The private folder the browser uploads into, per tenant (never served). */
const STAGING = "work_video_upload";
/** How long a signed upload may start: a 100 MB file on a slow line takes minutes. */
export const SIGNED_UPLOAD_SECONDS = 15 * 60;

/** A browser's upload: where to PUT the file and the headers its signature binds. */
export type SignedUpload = { url: string; headers: Record<string, string> };

/** A video ready to be kept: the poster (key and size, the largest rendition's) and the renditions, smallest first. */
export type ProcessedVideo = {
	kind: "ready";
	posterKey: string;
	width: number;
	height: number;
	durationMs: number;
	keys: string[];
};
/** A video refused, with the reason the studio reads. */
export type RefusedVideo = { kind: "refused"; reason: string };

/** One size of a ready video, as the public API shows it (`VideoSource`). */
export type ShownVideoSource = {
	url: string;
	type: "video/mp4";
	width: number;
	height: number;
};

/**
 * Video angles' files (the media module owns them, as ImageService owns
 * images). Uploads go straight from the browser to a private staging object
 * (`work_video_upload/tenants/<id>/<uuid>`: one fixed prefix, so an R2
 * lifecycle rule can expire what nobody finished), never through the app's request
 * body: on R2 through a presigned PUT whose signature binds the type and the
 * exact length (`signUpload`), on the local disk (development and tests)
 * through the dashboard's own PUT route, which streams into `writeStaged`.
 * The worker then `process`es the staged file outside any transaction:
 * ffprobe, the renditions and the poster (video_tools.ts), stored on the
 * public disk under `work_video`; the poster through ImageService, so it has
 * a photo's copies. The staged object is deleted once processed or refused.
 */
@inject()
export default class VideoService {
	constructor(private images: ImageService) {}

	/** A new private key for one upload of this tenant. */
	stagingKey(tenant: TenantRef): string {
		return `${STAGING}/tenants/${tenant.id}/${randomUUID()}`;
	}

	/** Defence in depth: a staging key must be this tenant's. A mismatch is a caller bug. */
	assertStagingKeyOf(tenant: TenantRef, key: string): void {
		if (
			!/^work_video_upload\/tenants\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key) ||
			!key.startsWith(`${STAGING}/tenants/${tenant.id}/`)
		) {
			throw new Error("VideoService was given a staging key of another tenant");
		}
	}

	/** True when the private disk is a local folder (development and tests): uploads then go through the dashboard's PUT route. */
	stagesLocally(): boolean {
		return drive.use("private").driver instanceof FSDriver;
	}

	/**
	 * A presigned PUT for one upload to R2, for exactly `size` bytes of
	 * `type`, valid for 15 minutes to start; null on the local disk, where the
	 * dashboard's own route takes the upload (the caller builds its URL).
	 */
	async signUpload(
		tenant: TenantRef,
		key: string,
		{ type, size }: { type: VideoType; size: number },
	): Promise<SignedUpload | null> {
		this.assertStagingKeyOf(tenant, key);
		assertSize(size);
		if (this.stagesLocally()) return null;
		const url = await drive.use("private").getSignedUploadUrl(key, {
			contentType: type,
			expiresIn: SIGNED_UPLOAD_SECONDS,
			ContentLength: size,
		});
		return { url, headers: { "Content-Type": type } };
	}

	/**
	 * The local disk's stand-in for R2's presigned PUT (development and tests
	 * only; never in production): streams `body` to the staging key, at most
	 * `size` bytes, and refuses a body of any other length, leaving nothing
	 * behind. The file is created exclusively, so a key takes one upload.
	 * Returns false when the key already holds one.
	 */
	async writeStaged(
		tenant: TenantRef,
		key: string,
		body: Readable,
		size: number,
	): Promise<boolean> {
		if (app.inProduction || !this.stagesLocally()) {
			throw new Error(
				"Local video uploads exist in development and tests only",
			);
		}
		this.assertStagingKeyOf(tenant, key);
		assertSize(size);
		const { location } = (drive.use("private").driver as FSDriver).options;
		const root =
			typeof location === "string" ? location : fileURLToPath(location);
		const path = join(root, key);
		await mkdir(dirname(path), { recursive: true });
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(path, "wx");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw error;
		}
		let received = 0;
		try {
			const out = handle.createWriteStream();
			body.on("data", (chunk: Buffer) => {
				received += chunk.length;
				if (received > size) {
					body.destroy(new Error("The upload is longer than it said"));
				}
			});
			await pipeline(body, out);
		} catch (error) {
			await rm(path, { force: true });
			throw error;
		}
		if (received !== size) {
			await rm(path, { force: true });
			throw new Error("The upload is shorter than it said");
		}
		return true;
	}

	/** The staged object's length in bytes, or null when there is none. */
	async stagedSize(tenant: TenantRef, key: string): Promise<number | null> {
		this.assertStagingKeyOf(tenant, key);
		const disk = drive.use("private");
		if (!(await disk.exists(key))) return null;
		return (await disk.getMetaData(key)).contentLength;
	}

	/** Deletes a staged upload, best effort: a failure is logged for the orphan sweep (TAT-140). */
	async deleteStaged(tenant: TenantRef, key: string): Promise<void> {
		this.assertStagingKeyOf(tenant, key);
		try {
			await drive.use("private").delete(key);
		} catch (error) {
			logger.error(
				{ err: error, key },
				"could not delete a staged video upload",
			);
		}
	}

	/**
	 * Processes a staged upload into a video ready to keep, or a refusal: the
	 * staged object is copied to a temp folder, probed (readProbe: the
	 * container and codec, the measured length, the size), transcoded into
	 * its renditions and its poster (one at a time per process, transcodeSlot),
	 * and stored on the public disk under `purpose` (`work_video` unless a
	 * client's Fresh ink video says `client_post_video`). Nothing it stored is
	 * left behind when it fails; the temp folder always goes. Throws for what
	 * a retry may fix (storage, a killed ffmpeg); a missing upload or a file
	 * ffprobe can't read is a refusal.
	 *
	 * Never inside a transaction: this takes minutes, and production ends a
	 * transaction idle for 3. It refuses to run in one (the job reads and
	 * writes its row in short transactions around it).
	 */
	async process(
		tenant: TenantRef,
		stagingKey: string,
		signal?: AbortSignal,
		purpose: VideoPurpose = VIDEO_PURPOSE,
	): Promise<ProcessedVideo | RefusedVideo> {
		if (currentClient()) {
			throw new Error(
				"VideoService.process must run outside any database transaction",
			);
		}
		this.assertStagingKeyOf(tenant, stagingKey);
		const disk = drive.use("private");
		if (!(await disk.exists(stagingKey))) {
			return { kind: "refused", reason: VIDEO_REFUSALS.missing };
		}
		const folder = await mkdtemp(join(tmpdir(), "td-video-"));
		const stored: string[] = [];
		let posterKey: string | null = null;
		try {
			const input = join(folder, "input");
			await pipeline(
				await disk.getStream(stagingKey),
				createWriteStream(input),
			);
			if ((await stat(input)).size > MAX_VIDEO_BYTES) {
				return { kind: "refused", reason: VIDEO_REFUSALS.tooLarge };
			}
			let probed: unknown;
			try {
				probed = await probe(input, signal);
			} catch (error) {
				// ffprobe missing is the worker's setup, retried; anything else is the file's.
				if (error instanceof VideoToolMissingError) throw error;
				logger.warn({ err: error }, "ffprobe could not read a video upload");
				return { kind: "refused", reason: VIDEO_REFUSALS.broken };
			}
			const video = readProbe(probed);
			if (!video.ok) return { kind: "refused", reason: video.reason };

			const plan = renditionPlan(video.width, video.height);
			const outputs = plan.map((size, index) => ({
				...size,
				path: join(folder, `rendition-${index}.mp4`),
			}));
			const posterPath = join(folder, "poster.jpg");
			try {
				await transcodeSlot(async () => {
					await this.transcode(input, outputs, video.frameRate, signal);
					await this.posterOf(
						outputs[outputs.length - 1].path,
						posterSeconds(video.durationMs),
						posterPath,
						signal,
					);
				});
			} catch (error) {
				// ffmpeg exited non-zero, ran out of time or was stopped: a final
				// refusal, never retried (a retry would only burn the CPU again).
				if (!(error instanceof VideoToolError)) throw error;
				logger.warn(
					{ err: error, stderr: error.stderr },
					"ffmpeg could not process a video upload",
				);
				return { kind: "refused", reason: VIDEO_REFUSALS.failed };
			}

			const base = `tenants/${tenant.id}/${purpose}/${randomUUID()}`;
			const keys: string[] = [];
			for (const output of outputs) {
				const key = renditionKey(base, output);
				stored.push(key); // before the put: a half-written file goes too
				await drive
					.use("public")
					.putStream(key, createReadStream(output.path), {
						contentType: "video/mp4",
						cacheControl: STORED_CACHE_CONTROL.public,
					});
				keys.push(key);
			}
			const poster = await this.images.storeBytes(await readFile(posterPath), {
				tenant,
				purpose,
			});
			posterKey = poster.key;
			const largest = plan[plan.length - 1];
			return {
				kind: "ready",
				posterKey: poster.key,
				width: largest.width,
				height: largest.height,
				durationMs: video.durationMs,
				keys,
			};
		} catch (error) {
			await this.removeFiles(posterKey, stored, purpose);
			throw error;
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	}

	/** video_tools' transcode, as a method so a test can make ffmpeg fail. */
	protected transcode(
		input: string,
		outputs: readonly { path: string; width: number; height: number }[],
		frameRate: number | null,
		signal?: AbortSignal,
	): Promise<void> {
		return transcode(input, outputs, { frameRate, signal });
	}

	/**
	 * The poster frame at `at` seconds or, when that can't be taken (a clip
	 * whose real length is shorter than its header said), the first frame;
	 * VideoToolError only when neither can.
	 */
	private async posterOf(
		input: string,
		at: number,
		output: string,
		signal?: AbortSignal,
	): Promise<void> {
		const taken = async (seconds: number) => {
			await rm(output, { force: true });
			await posterFrame(input, seconds, output, signal);
			return (await stat(output).catch(() => null))?.size ?? 0;
		};
		if (at > 0) {
			try {
				if ((await taken(at)) > 0) return;
			} catch (error) {
				if (!(error instanceof VideoToolError) || signal?.aborted) throw error;
			}
		}
		if ((await taken(0)) > 0) return;
		throw new VideoToolError("ffmpeg took no poster frame");
	}

	/**
	 * A video's files, the renditions and the poster with its copies, best
	 * effort (what a rollback or a repeated job leaves): each failure is
	 * logged for the orphan sweep (TAT-140), never thrown.
	 */
	async removeFiles(
		posterKey: string | null,
		keys: readonly string[] | null,
		purpose: VideoPurpose = VIDEO_PURPOSE,
	): Promise<void> {
		for (const key of keys ?? []) {
			try {
				await drive.use("public").delete(key);
			} catch (error) {
				logger.error({ err: error, key }, "could not delete a stored video");
			}
		}
		if (posterKey) await this.images.delete(purpose, posterKey);
	}

	/**
	 * Deletes a video's files or throws VideoDeleteError naming those left
	 * (the row must then stay, like a photo's: TAT-116). Every file is tried;
	 * a missing one counts as deleted, so a retry finishes the job.
	 */
	async deleteOrThrow(
		tenant: TenantRef,
		posterKey: string | null,
		keys: readonly string[] | null,
		purpose: VideoPurpose = VIDEO_PURPOSE,
	): Promise<void> {
		const failed: string[] = [];
		for (const key of keys ?? []) {
			assertVideoKeyOf(tenant, key, purpose);
			try {
				await drive.use("public").delete(key);
			} catch (error) {
				failed.push(key);
				logger.error({ err: error, key }, "could not delete a stored video");
			}
		}
		if (posterKey) {
			try {
				await this.images.deleteOrThrow(purpose, posterKey);
			} catch (error) {
				if (!(error instanceof Error && "failed" in error)) throw error;
				failed.push(...(error as VideoDeleteError).failed);
			}
		}
		if (failed.length > 0) throw new VideoDeleteError(failed);
	}

	/** A ready video's poster as the public API shows it (`Image`). */
	poster(
		tenant: TenantRef,
		posterKey: string,
		size: { width: number; height: number },
		purpose: VideoPurpose = VIDEO_PURPOSE,
	): Promise<ShownImage> {
		return this.images.shownImage(purpose, posterKey, tenant, size);
	}

	/** A ready video's renditions as the public API shows them, smallest first; a key that names no size is left out. */
	async sources(
		tenant: TenantRef,
		keys: readonly string[],
		purpose: VideoPurpose = VIDEO_PURPOSE,
	): Promise<ShownVideoSource[]> {
		const shown: ShownVideoSource[] = [];
		for (const key of keys) {
			assertVideoKeyOf(tenant, key, purpose);
			const size = renditionOfKey(key);
			if (!size) continue;
			shown.push({
				url: await drive.use("public").getUrl(key),
				type: "video/mp4",
				width: size.width,
				height: size.height,
			});
		}
		return shown.sort((a, b) => a.width * a.height - b.width * b.height);
	}
}

function assertSize(size: number) {
	if (!Number.isInteger(size) || size < 1 || size > MAX_VIDEO_BYTES) {
		throw new Error(
			`A video upload is 1 to ${MAX_VIDEO_BYTES} bytes, got ${size}`,
		);
	}
}

/** Defence in depth for a rendition's key, like ImageService's: this tenant's, this purpose's. */
function assertVideoKeyOf(
	tenant: TenantRef,
	key: string,
	purpose: VideoPurpose = VIDEO_PURPOSE,
) {
	if (
		!key.startsWith(`tenants/${tenant.id}/${purpose}/`) ||
		key.includes("..")
	) {
		throw new Error("VideoService was given a key of another tenant");
	}
}
