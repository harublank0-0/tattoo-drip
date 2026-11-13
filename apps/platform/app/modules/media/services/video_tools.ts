import { spawn } from "node:child_process";
import { setPriority } from "node:os";
import { limitConcurrency } from "#modules/media/concurrency";
import {
	MAX_VIDEO_FPS,
	MAX_VIDEO_MS,
	MAX_VIDEO_PIXELS,
} from "#modules/media/video";

/**
 * ffprobe and ffmpeg (video angles), run as child processes with hard
 * limits: each has a wall-clock timeout after which it is killed (SIGKILL),
 * stops when the job's signal aborts, runs at a lower CPU priority than the
 * web server, and only one transcode runs at a time per process
 * (`transcodeSlot`). Never call these inside a database transaction: a
 * transcode takes minutes, and production ends a transaction idle for 3.
 */

/** The binaries, from PATH (the platform image installs Debian's ffmpeg). */
export const FFMPEG = "ffmpeg";
export const FFPROBE = "ffprobe";

/** ffprobe on one file: a few seconds at most. */
const PROBE_TIMEOUT_MS = 30_000;
/** One transcode of a clip of at most 60 s into its renditions. */
export const TRANSCODE_TIMEOUT_MS = 4 * 60_000;
/** One poster frame. */
const POSTER_TIMEOUT_MS = 30_000;
/** What a failed run keeps of stderr for the log (never shown to a user). */
const STDERR_LIMIT = 4000;

/**
 * Threads per transcode, for the decoder and the encoder each, and one for
 * the filter graph: the video worker is one job at a time on a shared
 * server (deploy.md, the worker's CPU).
 */
export const VIDEO_THREADS = 2;

/**
 * What every ffprobe and ffmpeg input may be (input options, before `-i`):
 * a local file only (`-protocol_whitelist file`) read by the MP4/MOV or
 * Matroska/WebM demuxer only (`-format_whitelist`, matched against each
 * demuxer's names: `mov,mp4,m4a,3gp,3g2,mj2` and `matroska,webm`). Without
 * them a file uploaded as video/mp4 that is really a DASH or HLS manifest, or
 * an ffconcat list, would make ffprobe fetch URLs or read other files on the
 * worker (server-side request forgery).
 */
export const INPUT_GUARD = [
	"-protocol_whitelist",
	"file",
	"-format_whitelist",
	"mov,matroska",
] as const;

/** One transcode at a time per process, the others wait their turn. */
export const transcodeSlot = limitConcurrency(1);

/** ffmpeg or ffprobe is not installed: a setup error, retried, never the video's fault. */
export class VideoToolMissingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "VideoToolMissingError";
	}
}

/** A run that exited non-zero, timed out or was stopped: the video's refusal, final. */
export class VideoToolError extends Error {
	constructor(
		message: string,
		readonly stderr = "",
	) {
		super(message);
		this.name = "VideoToolError";
	}
}

/**
 * Runs `binary` with `args` (never a shell) and resolves with its stdout, or
 * rejects with VideoToolError when it exits non-zero, is killed on its
 * timeout, or the signal aborts. A missing binary says so plainly.
 */
export function runTool(
	binary: string,
	args: readonly string[],
	{ timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new VideoToolError(`${binary} was not started: the job stopped`));
			return;
		}
		const child = spawn(binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		try {
			if (child.pid) setPriority(child.pid, 10);
		} catch {
			// Not allowed here: run at the normal priority.
		}
		let stdout = "";
		let stderr = "";
		let ended: string | null = null;
		const stop = (why: string) => {
			if (ended) return;
			ended = why;
			child.kill("SIGKILL");
		};
		const timer = setTimeout(
			() => stop(`${binary} took longer than ${timeoutMs / 1000} s`),
			timeoutMs,
		);
		const onAbort = () => stop(`${binary} was stopped: the job stopped`);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			if (stderr.length < STDERR_LIMIT) stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(
				error.code === "ENOENT"
					? new VideoToolMissingError(
							`${binary} is not installed: video angles need ffmpeg and ffprobe on the worker's PATH`,
						)
					: new VideoToolError(`${binary} could not start: ${error.message}`),
			);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (ended) reject(new VideoToolError(ended, stderr));
			else if (code !== 0) {
				reject(new VideoToolError(`${binary} exited with ${code}`, stderr));
			} else resolve(stdout);
		});
	});
}

/** ffprobe's JSON for one file: the container and every stream. */
export async function probe(
	path: string,
	signal?: AbortSignal,
): Promise<unknown> {
	const out = await runTool(
		FFPROBE,
		[
			"-v",
			"error",
			...INPUT_GUARD,
			"-print_format",
			"json",
			"-show_format",
			"-show_streams",
			path,
		],
		{ timeoutMs: PROBE_TIMEOUT_MS, signal },
	);
	return JSON.parse(out);
}

/**
 * Makes every rendition in one ffmpeg run (the input is read and decoded
 * once, then split): the input guarded (INPUT_GUARD), at most 60 s read
 * (`-t 60`), frames over 4K's pixels refused by the decoder (`-max_pixels`),
 * two decoder threads and one filter thread; the first picture stream that
 * is not cover art (`0:V:0`), rotated upright by ffmpeg's autorotate (which
 * leaves no rotation on the output), brought down to 60 fps when it is
 * faster (`frameRate`), scaled to each size, H.264 in yuv420p, no audio,
 * subtitles, data or chapters, no metadata (`-map_metadata -1`, the stream's
 * too, and bitexact so not even the encoder's name), moov atom first
 * (`+faststart`) so a browser starts playing before the end arrives.
 */
export async function transcode(
	input: string,
	outputs: readonly { path: string; width: number; height: number }[],
	{ frameRate, signal }: { frameRate: number | null; signal?: AbortSignal },
): Promise<void> {
	await runTool(FFMPEG, transcodeArgs(input, outputs, frameRate), {
		timeoutMs: TRANSCODE_TIMEOUT_MS,
		signal,
	});
}

/** transcode's arguments (pure, so a unit test reads them). */
export function transcodeArgs(
	input: string,
	outputs: readonly { path: string; width: number; height: number }[],
	frameRate: number | null,
): string[] {
	const fps =
		frameRate !== null && frameRate > MAX_VIDEO_FPS
			? `fps=${MAX_VIDEO_FPS},`
			: "";
	const split = outputs.map((_, index) => `[s${index}]`).join("");
	const scales = outputs
		.map(
			({ width, height }, index) =>
				`[s${index}]scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p[v${index}]`,
		)
		.join(";");
	const args = [
		"-nostdin",
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		...INPUT_GUARD,
		"-threads",
		String(VIDEO_THREADS),
		"-max_pixels",
		String(MAX_VIDEO_PIXELS),
		"-t",
		String(MAX_VIDEO_MS / 1000),
		"-i",
		input,
		"-filter_complex_threads",
		"1",
		"-filter_complex",
		`[0:V:0]${fps}split=${outputs.length}${split};${scales}`,
	];
	for (const [index, output] of outputs.entries()) {
		args.push(
			"-map",
			`[v${index}]`,
			"-an",
			"-sn",
			"-dn",
			"-map_metadata",
			"-1",
			"-map_metadata:s:v",
			"-1",
			"-map_chapters",
			"-1",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"23",
			"-profile:v",
			"high",
			"-pix_fmt",
			"yuv420p",
			"-threads",
			String(VIDEO_THREADS),
			"-movflags",
			"+faststart",
			"-fflags",
			"+bitexact",
			"-flags:v",
			"+bitexact",
			"-f",
			"mp4",
			output.path,
		);
	}
	return args;
}

/** One JPEG frame `at` seconds into `input` (a rendition: already upright and clean). */
export async function posterFrame(
	input: string,
	at: number,
	output: string,
	signal?: AbortSignal,
): Promise<void> {
	await runTool(
		FFMPEG,
		[
			"-nostdin",
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			...INPUT_GUARD,
			"-ss",
			String(at),
			"-i",
			input,
			"-frames:v",
			"1",
			"-map_metadata",
			"-1",
			"-q:v",
			"2",
			"-f",
			"image2",
			output,
		],
		{ timeoutMs: POSTER_TIMEOUT_MS, signal },
	);
}

/**
 * The worker's boot check: ffmpeg and ffprobe answer `-version`, or this
 * throws a clear error (the worker then refuses to start rather than fail
 * every video later).
 */
export async function assertVideoTools(): Promise<void> {
	for (const binary of [FFMPEG, FFPROBE]) {
		try {
			await runTool(binary, ["-version"], { timeoutMs: 10_000 });
		} catch (error) {
			throw new Error(
				`The worker needs ${binary} for video angles: install ffmpeg (apt-get install ffmpeg; the platform image does). ${
					error instanceof Error ? error.message : ""
				}`.trim(),
			);
		}
	}
}
