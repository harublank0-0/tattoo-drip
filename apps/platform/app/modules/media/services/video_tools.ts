import { spawn } from "node:child_process";
import { cpus, setPriority } from "node:os";
import { limitConcurrency } from "#modules/media/concurrency";
import { MAX_VIDEO_MS } from "#modules/media/video";

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
 * Encoder threads per transcode: half the machine's CPUs, at least one and at
 * most four, so the web server keeps the rest (deploy.md, the worker's CPU).
 */
export const ENCODER_THREADS = Math.min(
	4,
	Math.max(1, Math.floor(cpus().length / 2)),
);

/** One transcode at a time per process, the others wait their turn. */
export const transcodeSlot = limitConcurrency(1);

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
				new VideoToolError(
					error.code === "ENOENT"
						? `${binary} is not installed: video angles need ffmpeg and ffprobe on the worker's PATH`
						: `${binary} could not start: ${error.message}`,
				),
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
 * once, then split): at most 60 s read (`-t 60`, an input option), the first
 * picture stream only, rotated upright by ffmpeg's autorotate (which leaves
 * no rotation on the output), scaled to each size, H.264 in yuv420p, no
 * audio, subtitles, data or chapters, no metadata (`-map_metadata -1`, the
 * stream's too, and bitexact so not even the encoder's name), moov atom
 * first (`+faststart`) so a browser starts playing before the end arrives.
 */
export async function transcode(
	input: string,
	outputs: readonly { path: string; width: number; height: number }[],
	signal?: AbortSignal,
): Promise<void> {
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
		"-t",
		String(MAX_VIDEO_MS / 1000),
		"-i",
		input,
		"-filter_complex",
		`[0:v:0]split=${outputs.length}${split};${scales}`,
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
			String(ENCODER_THREADS),
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
	await runTool(FFMPEG, args, { timeoutMs: TRANSCODE_TIMEOUT_MS, signal });
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
