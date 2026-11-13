/**
 * Video angles: the rules for a tattoo's short videos, as plain functions
 * (no I/O, no imports), so a unit test runs them. VideoService stores and
 * reads the files, video_tools.ts runs ffprobe and ffmpeg, the artists module
 * owns the rows.
 *
 * What comes in: MP4, MOV or WebM, at most 100 MB and 60 seconds, at most 4K.
 * What is kept: H.264 MP4 renditions (720p and 1080p by the short side, only
 * those not larger than the clip, at least one), no audio and no metadata,
 * and a JPEG poster, a frame about 1 s in.
 */

/** The largest upload: the browser's PUT is signed for its exact length, at most this. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** The longest video kept, in milliseconds (ffmpeg is given `-t 60` too). */
export const MAX_VIDEO_MS = 60_000;

/**
 * How much longer than 60 s a measured clip may be and still be taken (and
 * cut at 60 s): a phone's "one minute" clip often measures 60.03 s.
 */
const LENGTH_TOLERANCE_MS = 500;

/** The types an upload may declare, and the containers ffprobe must then find. */
export const VIDEO_TYPES = [
	"video/mp4",
	"video/quicktime",
	"video/webm",
] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];

export function isVideoType(value: unknown): value is VideoType {
	return (VIDEO_TYPES as readonly unknown[]).includes(value);
}

/** The longest side of a video taken (4K), and its shortest. */
export const MAX_VIDEO_SIDE = 4096;
export const MAX_VIDEO_SHORT_SIDE = 2160;
/** A video smaller than this on its short side is not worth showing. */
const MIN_VIDEO_SIDE = 64;

/** The renditions made, by the short side, smallest first. */
export const RENDITION_SIZES = [720, 1080] as const;

/** Why a video is refused: the studio reads these in the dashboard, on the video's row. */
export const VIDEO_REFUSALS = {
	format: "It isn't a video we can use. Use an MP4, MOV or WebM file.",
	noPicture: "It has no picture.",
	tooLong: "It's longer than 60 seconds.",
	tooLarge: "It's larger than 4K.",
	tooSmall: "It's too small to show.",
	missing: "The upload didn't arrive. Remove it and upload it again.",
	broken: "We couldn't read it. Remove it and upload it again.",
	/** ffmpeg failed or ran out of time on it: final, never retried. */
	failed: "This video couldn't be processed.",
} as const;

/** What a video still processing after STUCK_AFTER_MINUTES is told (the stuck-video sweep). */
export const VIDEO_STUCK = "Took too long to process. Upload it again.";
/** How long a video may stay `processing` before the sweep fails it. */
export const STUCK_AFTER_MINUTES = 60;

/** The highest frame rate kept: a faster clip is brought down to it. */
export const MAX_VIDEO_FPS = 60;
/** The most pixels a decoded frame may have (ffmpeg's `-max_pixels`): the 4K rule's. */
export const MAX_VIDEO_PIXELS = MAX_VIDEO_SIDE * MAX_VIDEO_SHORT_SIDE;

/** What a failed upload is told when every try went wrong (not the video's fault, as far as we know). */
export const VIDEO_GAVE_UP =
	"We couldn't process it. Remove it and upload it again.";

/**
 * The containers taken (ffprobe's `format_name`) and the picture codecs
 * taken in each. MP4 and MOV are one family to ffprobe
 * (`mov,mp4,m4a,3gp,3g2,mj2`); WebM is Matroska's (`matroska,webm`), with
 * WebM's codecs only. The declared type is the browser's guess and binds
 * only the upload; what the file really is decides here.
 */
const FAMILIES = [
	{
		format: "mov,mp4,m4a,3gp,3g2,mj2",
		codecs: ["h264", "hevc", "mpeg4", "av1", "vp9", "prores"],
	},
	{
		format: "matroska,webm",
		codecs: ["vp8", "vp9", "av1"],
	},
] as const;

/** A probed video that may be processed: its displayed size (after rotation) and how long it plays. */
export type ProbedVideo = {
	ok: true;
	width: number;
	height: number;
	durationMs: number;
	/** Frames per second as the stream says (`avg_frame_rate`, else `r_frame_rate`), or null when it doesn't. */
	frameRate: number | null;
};
export type ProbeRefusal = { ok: false; reason: string };

function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function seconds(value: unknown): number | null {
	const parsed =
		typeof value === "string" || typeof value === "number"
			? Number(value)
			: Number.NaN;
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The rotation a stream asks a player to apply, in degrees (side data first, then the old `rotate` tag). */
function rotationOf(stream: unknown): number {
	const sideData = own(stream, "side_data_list");
	if (Array.isArray(sideData)) {
		for (const item of sideData) {
			const rotation = Number(own(item, "rotation"));
			if (Number.isFinite(rotation) && rotation !== 0) return rotation;
		}
	}
	const tag = Number(own(own(stream, "tags"), "rotate"));
	return Number.isFinite(tag) ? tag : 0;
}

/**
 * ffprobe's JSON (`-show_format -show_streams`) as a video we take, or the
 * reason it is refused. The container must be MP4, MOV or WebM and the
 * first picture stream one of its codecs (a still image is no video);
 * the duration is measured, never the client's word, and over 60 s is
 * refused; the displayed size (a quarter turn swaps the sides) must be at
 * most 4K. Pure.
 */
export function readProbe(probe: unknown): ProbedVideo | ProbeRefusal {
	const format = own(probe, "format");
	const formatName = own(format, "format_name");
	const family = FAMILIES.find((candidate) => candidate.format === formatName);
	if (!family) {
		return { ok: false, reason: VIDEO_REFUSALS.format };
	}
	const streams = own(probe, "streams");
	const video = Array.isArray(streams)
		? streams.find(
				(stream) =>
					own(stream, "codec_type") === "video" &&
					own(own(stream, "disposition"), "attached_pic") !== 1,
			)
		: undefined;
	if (!video) return { ok: false, reason: VIDEO_REFUSALS.noPicture };
	if (
		!(family.codecs as readonly unknown[]).includes(own(video, "codec_name"))
	) {
		return { ok: false, reason: VIDEO_REFUSALS.format };
	}
	const duration =
		seconds(own(format, "duration")) ?? seconds(own(video, "duration"));
	if (duration === null) return { ok: false, reason: VIDEO_REFUSALS.broken };
	const durationMs = Math.round(duration * 1000);
	if (durationMs > MAX_VIDEO_MS + LENGTH_TOLERANCE_MS) {
		return { ok: false, reason: VIDEO_REFUSALS.tooLong };
	}
	const codedWidth = own(video, "width");
	const codedHeight = own(video, "height");
	if (
		!Number.isInteger(codedWidth) ||
		!Number.isInteger(codedHeight) ||
		(codedWidth as number) < 1 ||
		(codedHeight as number) < 1
	) {
		return { ok: false, reason: VIDEO_REFUSALS.broken };
	}
	const quarter = Math.abs(rotationOf(video)) % 180 === 90;
	const width = (quarter ? codedHeight : codedWidth) as number;
	const height = (quarter ? codedWidth : codedHeight) as number;
	const long = Math.max(width, height);
	const short = Math.min(width, height);
	if (long > MAX_VIDEO_SIDE || short > MAX_VIDEO_SHORT_SIDE) {
		return { ok: false, reason: VIDEO_REFUSALS.tooLarge };
	}
	if (short < MIN_VIDEO_SIDE) {
		return { ok: false, reason: VIDEO_REFUSALS.tooSmall };
	}
	return {
		ok: true,
		width,
		height,
		durationMs: Math.min(durationMs, MAX_VIDEO_MS),
		frameRate:
			frameRateOf(own(video, "avg_frame_rate")) ??
			frameRateOf(own(video, "r_frame_rate")),
	};
}

/** ffprobe's "30000/1001" as a number, or null for "0/0", a missing or a malformed rate. */
function frameRateOf(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const match = /^(\d+)\/(\d+)$/.exec(value);
	if (!match) return null;
	const [num, den] = [Number(match[1]), Number(match[2])];
	return num > 0 && den > 0 ? num / den : null;
}

/** Rounded down to an even number (H.264 in 4:2:0 needs even sides). */
function even(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * The renditions of a video shown at `width` x `height`: 720p and 1080p by
 * the short side, only those not larger than the video, smallest first; a
 * video under 720p gets one rendition at its own size. Each side even, the
 * long one scaled to keep the shape. Pure.
 */
export function renditionPlan(
	width: number,
	height: number,
): { width: number; height: number }[] {
	const short = Math.min(width, height);
	const sizes = RENDITION_SIZES.filter((size) => size <= short);
	// Under 720p: its own size, each side made even.
	if (sizes.length === 0) return [{ width: even(width), height: even(height) }];
	return sizes.map((size) => {
		const long = even((Math.max(width, height) * size) / short);
		return width <= height
			? { width: size, height: long }
			: { width: long, height: size };
	});
}

/** Where the poster frame is taken: about 1 s in, or the first frame of a clip under 2 s. */
export function posterSeconds(durationMs: number): number {
	return durationMs >= 2000 ? 1 : 0;
}

/** A rendition's key: its base and size, `<base>.<w>x<h>.mp4`. */
export function renditionKey(
	base: string,
	size: { width: number; height: number },
): string {
	return `${base}.${size.width}x${size.height}.mp4`;
}

const RENDITION_KEY = /\.(\d{1,5})x(\d{1,5})\.mp4$/;

/** A rendition's size from its key, or null for a key that names none. */
export function renditionOfKey(
	key: string,
): { key: string; width: number; height: number } | null {
	const match = RENDITION_KEY.exec(key);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (width < 1 || height < 1) return null;
	return { key, width, height };
}
