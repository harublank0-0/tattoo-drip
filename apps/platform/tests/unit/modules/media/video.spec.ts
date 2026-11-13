import { test } from "@japa/runner";
import {
	MAX_VIDEO_MS,
	posterSeconds,
	readProbe,
	renditionKey,
	renditionOfKey,
	renditionPlan,
	VIDEO_REFUSALS,
} from "#modules/media/video";

/** ffprobe's JSON for one clip, as `-show_format -show_streams` writes it. */
function probed({
	format = "mov,mp4,m4a,3gp,3g2,mj2",
	codec = "h264",
	width = 1920,
	height = 1080,
	duration = "12.48",
	rotation,
	streams,
}: {
	format?: string;
	codec?: string;
	width?: number;
	height?: number;
	duration?: string;
	rotation?: number;
	streams?: unknown[];
} = {}) {
	return {
		format: { format_name: format, duration },
		streams: streams ?? [
			{ codec_type: "audio", codec_name: "aac" },
			{
				codec_type: "video",
				codec_name: codec,
				width,
				height,
				avg_frame_rate: "30/1",
				...(rotation === undefined
					? {}
					: {
							side_data_list: [{ side_data_type: "Display Matrix", rotation }],
						}),
			},
		],
	};
}

test.group("Video angles: what a probe allows (readProbe)", () => {
	test("an MP4, MOV or WebM of a taken codec, measured, upright", ({
		assert,
	}) => {
		assert.deepEqual(readProbe(probed()), {
			ok: true,
			width: 1920,
			height: 1080,
			durationMs: 12_480,
			frameRate: 30,
		});
		assert.isTrue(
			readProbe(probed({ format: "matroska,webm", codec: "vp9" })).ok,
		);
		assert.isTrue(readProbe(probed({ codec: "hevc" })).ok);
	});

	test("a quarter turn swaps the sides; a half turn doesn't", ({ assert }) => {
		assert.deepEqual(readProbe(probed({ rotation: -90 })), {
			ok: true,
			width: 1080,
			height: 1920,
			durationMs: 12_480,
			frameRate: 30,
		});
		assert.include(readProbe(probed({ rotation: 180 })), {
			width: 1920,
			height: 1080,
		});
	});

	test("refuses another container or codec, a still image, over 60 s, over 4K and a broken file, each with its reason", ({
		assert,
	}) => {
		const refusal = (probe: unknown) => readProbe(probe);
		assert.deepEqual(refusal(probed({ format: "avi" })), {
			ok: false,
			reason: VIDEO_REFUSALS.format,
		});
		assert.deepEqual(
			refusal(probed({ format: "matroska,webm", codec: "h264" })),
			{
				ok: false,
				reason: VIDEO_REFUSALS.format,
			},
		);
		assert.deepEqual(refusal(probed({ format: "image2", codec: "mjpeg" })), {
			ok: false,
			reason: VIDEO_REFUSALS.format,
		});
		assert.deepEqual(
			refusal(
				probed({
					streams: [
						{
							codec_type: "video",
							codec_name: "h264",
							width: 10,
							height: 10,
							disposition: { attached_pic: 1 },
						},
					],
				}),
			),
			{ ok: false, reason: VIDEO_REFUSALS.noPicture },
		);
		assert.deepEqual(refusal(probed({ duration: "61.2" })), {
			ok: false,
			reason: VIDEO_REFUSALS.tooLong,
		});
		assert.deepEqual(refusal(probed({ width: 4097, height: 2160 })), {
			ok: false,
			reason: VIDEO_REFUSALS.tooLarge,
		});
		assert.deepEqual(refusal(probed({ width: 3840, height: 2400 })), {
			ok: false,
			reason: VIDEO_REFUSALS.tooLarge,
		});
		assert.deepEqual(refusal(probed({ duration: "N/A" })), {
			ok: false,
			reason: VIDEO_REFUSALS.broken,
		});
		assert.deepEqual(refusal(null), {
			ok: false,
			reason: VIDEO_REFUSALS.format,
		});
		// A phone's "one minute" (60.03 s) is taken and counted as 60 s.
		assert.include(readProbe(probed({ duration: "60.03" })), {
			ok: true,
			durationMs: MAX_VIDEO_MS,
		});
		// 4K either way up is fine.
		assert.isTrue(readProbe(probed({ width: 2160, height: 3840 })).ok);
	});
});

test.group("Video angles: the frame rate a probe reads", () => {
	test("from avg_frame_rate, else r_frame_rate; 0/0 or nothing is none", ({
		assert,
	}) => {
		const rate = (stream: Record<string, unknown>) => {
			const read = readProbe({
				format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2" },
				streams: [
					{
						codec_type: "video",
						codec_name: "h264",
						width: 640,
						height: 480,
						...stream,
					},
				],
			});
			return read.ok ? read.frameRate : "refused";
		};
		assert.closeTo(
			rate({ avg_frame_rate: "30000/1001" }) as number,
			29.97,
			0.01,
		);
		assert.equal(rate({ avg_frame_rate: "0/0", r_frame_rate: "120/1" }), 120);
		assert.isNull(rate({ avg_frame_rate: "0/0" }));
		assert.isNull(rate({}));
	});
});

test.group("Video angles: renditions and keys", () => {
	test("720p and 1080p by the short side, only those not larger than the clip, at least one, smallest first", ({
		assert,
	}) => {
		assert.deepEqual(renditionPlan(1920, 1080), [
			{ width: 1280, height: 720 },
			{ width: 1920, height: 1080 },
		]);
		assert.deepEqual(renditionPlan(1080, 1920), [
			{ width: 720, height: 1280 },
			{ width: 1080, height: 1920 },
		]);
		assert.deepEqual(renditionPlan(3840, 2160), [
			{ width: 1280, height: 720 },
			{ width: 1920, height: 1080 },
		]);
		assert.deepEqual(renditionPlan(1280, 720), [{ width: 1280, height: 720 }]);
		assert.deepEqual(renditionPlan(640, 480), [{ width: 640, height: 480 }]);
		// Odd sides become even (4:2:0), the shape kept.
		assert.deepEqual(renditionPlan(641, 361), [{ width: 640, height: 360 }]);
		assert.deepEqual(renditionPlan(1000, 1000), [{ width: 720, height: 720 }]);
	});

	test("a rendition's key names its size, and only such a key reads back", ({
		assert,
	}) => {
		const key = renditionKey("tenants/t/work_video/abc", {
			width: 720,
			height: 1280,
		});
		assert.equal(key, "tenants/t/work_video/abc.720x1280.mp4");
		assert.deepEqual(renditionOfKey(key), { key, width: 720, height: 1280 });
		assert.isNull(renditionOfKey("tenants/t/work_video/abc.jpg"));
		assert.isNull(renditionOfKey("tenants/t/work_video/abc.0x1280.mp4"));
	});

	test("the poster is about 1 s in, or the first frame of a clip under 2 s", ({
		assert,
	}) => {
		assert.equal(posterSeconds(42_000), 1);
		assert.equal(posterSeconds(2000), 1);
		assert.equal(posterSeconds(1999), 0);
	});
});
