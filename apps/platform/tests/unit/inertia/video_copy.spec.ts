import { test } from "@japa/runner";
import { MAX_VIDEO_BYTES, MAX_VIDEO_MS } from "#modules/media/video";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `VideoWords` below restates its shape and the inertia project type-checks the real one.
import * as portfolioModule from "../../../inertia/components/portfolio.js";

type Kind = "photo" | "video";
type Angle = { kind: Kind; video: { state: string } | null };
type VideoWords = {
	MAX_VIDEO_BYTES: number;
	MAX_VIDEO_SECONDS: number;
	WRONG_VIDEO_FORMAT: string;
	VIDEO_TOO_LARGE: string;
	VIDEO_TOO_LONG: string;
	TOO_LARGE: string;
	photosMark(photo: { angles: Angle[] }): string | null;
	isVideoFile(file: { name: string; type: string }): boolean;
	videoType(file: { name: string; type: string }): string | null;
	tattooFileProblem(file: {
		name: string;
		type: string;
		size: number;
	}): string | null;
	videoLengthProblem(durationMs: number): string | null;
	durationText(durationMs: number): string;
	videoLabel(durationMs: number | null): string;
	videoStateText(video: { state: string; failure: string | null }): string;
	anyProcessing(photos: { angles: Angle[] }[]): boolean;
	moveMakesVideoLead(
		kinds: Kind[],
		index: number,
		direction: "up" | "down",
	): boolean;
	tattooUploadButton(
		kinds: Kind[],
		sending: { index: number; total: number; percentage?: number } | null,
	): string;
	movePhotoLabel(
		n: number,
		count: number,
		direction: "up" | "down",
		noun?: Kind,
	): string;
};
const p = portfolioModule as VideoWords;

const photo: Angle = { kind: "photo", video: null };
const video = (state = "ready"): Angle => ({ kind: "video", video: { state } });

test.group("Video angles: the dashboard's words and rules", () => {
	test("the limits are the server's", ({ assert }) => {
		assert.equal(p.MAX_VIDEO_BYTES, MAX_VIDEO_BYTES);
		assert.equal(p.MAX_VIDEO_SECONDS * 1000, MAX_VIDEO_MS);
	});

	test("a tile with videos says so", ({ assert }) => {
		assert.equal(p.photosMark({ angles: [photo, photo] }), "3 photos");
		assert.equal(
			p.photosMark({ angles: [photo, video()] }),
			"3 photos and videos",
		);
		assert.isNull(p.photosMark({ angles: [] }));
	});

	test("a chosen video is checked by its type (or extension) and size before anything is sent; anything else by the photos' rule", ({
		assert,
	}) => {
		const mb = 1024 * 1024;
		assert.isNull(
			p.tattooFileProblem({ name: "a.mp4", type: "video/mp4", size: mb }),
		);
		assert.isNull(
			p.tattooFileProblem({ name: "a.MOV", type: "video/quicktime", size: mb }),
		);
		assert.isNull(p.tattooFileProblem({ name: "a.webm", type: "", size: mb }));
		assert.equal(
			p.videoType({ name: "clip.mov", type: "" }),
			"video/quicktime",
		);
		assert.equal(
			p.tattooFileProblem({ name: "a.avi", type: "video/x-msvideo", size: mb }),
			p.WRONG_VIDEO_FORMAT,
		);
		assert.equal(
			p.tattooFileProblem({ name: "a.mp4", type: "video/mp4", size: 101 * mb }),
			p.VIDEO_TOO_LARGE,
		);
		assert.isFalse(p.isVideoFile({ name: "a.jpg", type: "image/jpeg" }));
		assert.equal(
			p.tattooFileProblem({ name: "a.jpg", type: "image/jpeg", size: 11 * mb }),
			p.TOO_LARGE,
		);
	});

	test("the browser's early word on the length, with the server's tolerance", ({
		assert,
	}) => {
		assert.isNull(p.videoLengthProblem(60_000));
		assert.isNull(p.videoLengthProblem(60_400));
		assert.equal(p.videoLengthProblem(61_000), p.VIDEO_TOO_LONG);
		assert.isNull(p.videoLengthProblem(Number.NaN));
	});

	test("a video's row: its label, its state", ({ assert }) => {
		assert.equal(p.durationText(42_000), "0:42");
		assert.equal(p.durationText(60_000), "1:00");
		assert.equal(p.durationText(5_400), "0:05");
		assert.equal(p.videoLabel(42_000), "Video, 0:42");
		assert.equal(p.videoLabel(null), "Video");
		assert.equal(
			p.videoStateText({ state: "processing", failure: null }),
			"Processing…",
		);
		assert.equal(p.videoStateText({ state: "ready", failure: null }), "Ready");
		assert.equal(
			p.videoStateText({
				state: "failed",
				failure: "It's longer than 60 seconds.",
			}),
			"Couldn't process: It's longer than 60 seconds.",
		);
	});

	test("the page polls only while a video is processing", ({ assert }) => {
		assert.isFalse(p.anyProcessing([{ angles: [photo, video()] }]));
		assert.isFalse(p.anyProcessing([{ angles: [video("failed")] }]));
		assert.isTrue(
			p.anyProcessing([{ angles: [] }, { angles: [video("processing")] }]),
		);
	});

	test("a move that would put a video first is not offered", ({ assert }) => {
		const kinds: Kind[] = ["photo", "video", "photo"];
		assert.isTrue(p.moveMakesVideoLead(kinds, 1, "up"));
		assert.isTrue(p.moveMakesVideoLead(kinds, 0, "down"));
		assert.isFalse(p.moveMakesVideoLead(kinds, 1, "down"));
		assert.isFalse(p.moveMakesVideoLead(["photo", "photo", "video"], 1, "up"));
		assert.equal(
			p.movePhotoLabel(2, 3, "down", "video"),
			"Move video 2 of 3 later",
		);
		assert.equal(p.movePhotoLabel(2, 3, "up"), "Move photo 2 of 3 earlier");
	});

	test("the tattoo's upload button names what it sends", ({ assert }) => {
		assert.equal(p.tattooUploadButton(["photo"], null), "Upload photo");
		assert.equal(p.tattooUploadButton(["video"], null), "Upload video");
		assert.equal(
			p.tattooUploadButton(["video", "video"], null),
			"Upload 2 videos",
		);
		assert.equal(
			p.tattooUploadButton(["photo", "video"], null),
			"Upload 2 files",
		);
		assert.equal(
			p.tattooUploadButton(["video"], { index: 1, total: 1, percentage: 40 }),
			"Uploading… 40%",
		);
	});
});
