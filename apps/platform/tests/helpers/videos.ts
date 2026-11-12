import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { videoUploadToken } from "#modules/artists/video_uploads";
import ImageService from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { inTenant, type Studio } from "#tests/helpers/tenants";

const run = promisify(execFile);

/** What a phone writes into a clip: a title, where it was filmed, when. */
const PHONE_METADATA = [
	"-metadata",
	"title=Secret title",
	"-metadata",
	"location=+27.7172+085.3240/",
	"-metadata",
	"creation_time=2026-01-02T03:04:05Z",
];

/** One temp folder per test run for the generated clips. */
let folder: Promise<string> | null = null;
const clips = () => {
	folder ??= mkdtemp(join(tmpdir(), "td-test-clips-"));
	return folder;
};

/**
 * A short clip made with ffmpeg on the fly (video angles), so no binary
 * fixture lives in the repo: a test pattern with a sine tone as its audio,
 * and the metadata a phone writes (a title, a GPS location, a creation
 * time), so a test can prove the output keeps none of it. `rotate` stores a
 * display rotation the way a phone does for a portrait clip.
 */
export async function makeClip({
	width,
	height,
	seconds,
	format = "mp4",
	audio = true,
	rotate,
}: {
	width: number;
	height: number;
	seconds: number;
	format?: "mp4" | "mov" | "webm";
	audio?: boolean;
	rotate?: number;
}): Promise<{ path: string; type: string; size: number }> {
	const name = `clip-${width}x${height}-${seconds}s-${audio ? "a" : "n"}-${rotate ?? 0}.${format}`;
	const path = join(await clips(), name);
	const made =
		rotate === undefined ? path : join(await clips(), `plain-${name}`);
	const args = [
		"-y",
		"-hide_banner",
		"-loglevel",
		"error",
		"-f",
		"lavfi",
		"-i",
		`testsrc=size=${width}x${height}:rate=25:duration=${seconds}`,
	];
	if (audio) {
		args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
	}
	args.push(...PHONE_METADATA);
	if (format === "webm") {
		args.push("-c:v", "libvpx-vp9", "-b:v", "200k", "-deadline", "realtime");
		if (audio) args.push("-c:a", "libopus");
	} else {
		args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
		if (audio) args.push("-c:a", "aac");
	}
	await run("ffmpeg", [...args, made]);
	if (rotate !== undefined) {
		// A phone's portrait clip: the frames as the sensor wrote them, and a
		// display rotation for the player (stream copy keeps it).
		await run("ffmpeg", [
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-display_rotation",
			String(rotate),
			"-i",
			made,
			"-c",
			"copy",
			...PHONE_METADATA,
			path,
		]);
	}
	const size = (await readFile(path)).length;
	const type =
		format === "webm"
			? "video/webm"
			: format === "mov"
				? "video/quicktime"
				: "video/mp4";
	return { path, type, size };
}

/** ffprobe's JSON for a stored file (a rendition, by its key on the public disk). */
export async function probeStored(key: string): Promise<{
	format: { tags?: Record<string, string>; duration?: string };
	streams: {
		codec_type: string;
		codec_name: string;
		width?: number;
		height?: number;
		pix_fmt?: string;
		tags?: Record<string, string>;
		side_data_list?: { rotation?: number }[];
	}[];
}> {
	const path = app.tmpPath("storage", "public", key);
	const { stdout } = await run("ffprobe", [
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		path,
	]);
	return JSON.parse(stdout);
}

/** The first bytes of a stored file, to check a container's layout (`+faststart`: `moov` before `mdat`). */
export async function storedBytes(key: string): Promise<Buffer> {
	return readFile(app.tmpPath("storage", "public", key));
}

/** VideoService as the app builds it. */
export function videoService(): VideoService {
	return new VideoService(new ImageService());
}

/**
 * A clip staged as the browser's upload would leave it (the local disk's
 * private staging folder) for `studio`'s tattoo `lead`, with the token the
 * sign step would have given.
 */
export async function stageClip(
	studio: Pick<Studio, "tenant">,
	leadId: string,
	clip: { path: string; type: string; size: number },
): Promise<{ key: string; token: string }> {
	const videos = videoService();
	const key = videos.stagingKey(studio.tenant);
	await drive.use("private").put(key, await readFile(clip.path));
	const token = videoUploadToken({
		tenantId: studio.tenant.id,
		leadId,
		key,
		type: clip.type as "video/mp4",
		size: clip.size,
	});
	return { key, token };
}

/** The files a studio has in its private staging folder (the uploads not yet processed). */
export async function stagedFiles(studio: Pick<Studio, "tenant">) {
	try {
		return (
			await readdir(
				app.tmpPath(
					"storage",
					"private",
					"tenants",
					studio.tenant.id,
					"work_video_upload",
				),
			)
		).sort();
	} catch {
		return [];
	}
}

/** The files a studio has under the public `work_video` folder (renditions, posters and their copies). */
export async function videoFiles(studio: Pick<Studio, "tenant">) {
	try {
		return (
			await readdir(
				app.tmpPath(
					"storage",
					"public",
					"tenants",
					studio.tenant.id,
					"work_video",
				),
			)
		).sort();
	} catch {
		return [];
	}
}

/** A studio's video rows, as a snapshot. */
export function videoRows(studio: Pick<Studio, "tenant">) {
	return inTenant(studio.tenant, async () =>
		(
			await ArtistWorkPhoto.query()
				.where("tenant_id", studio.tenant.id)
				.where("kind", "video")
				.orderBy("id")
		).map((row) => row.serialize()),
	);
}
