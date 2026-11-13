import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `UploadModule` below restates its shape and the inertia project type-checks the real one.
import * as uploadModule from "../../../inertia/components/video_upload.js";

type Staged =
	| { kind: "staged"; token: string }
	| { kind: "refused"; message: string }
	| { kind: "aborted" };
type UploadModule = {
	stageVideo(options: {
		signUrl: string;
		file: Blob;
		type: string;
		onProgress: (percentage: number) => void;
		signal?: AbortSignal;
	}): Promise<Staged>;
};
const { stageVideo } = uploadModule as UploadModule;

/**
 * Video angles: the dashboard's upload of a video straight to storage
 * (video_upload.ts), with the browser stood in: `fetch` for the sign step,
 * an XMLHttpRequest that holds its PUT until told, the page's cookie and
 * address. Leaving the page mid-upload (the panel's signal) stops it and it
 * ends `aborted`, so the panel sends no finish visit.
 */

const ORIGIN = "http://localhost:3333";

class FakeXhr {
	static last: FakeXhr | null = null;
	method = "";
	url = "";
	headers: Record<string, string> = {};
	status = 0;
	aborted = false;
	upload: {
		onprogress:
			| ((event: {
					lengthComputable: boolean;
					loaded: number;
					total: number;
			  }) => void)
			| null;
	} = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	constructor() {
		FakeXhr.last = this;
	}
	open(method: string, url: string) {
		this.method = method;
		this.url = url;
	}
	setRequestHeader(name: string, value: string) {
		this.headers[name] = value;
	}
	send() {}
	abort() {
		this.aborted = true;
		this.onabort?.();
	}
	/** The storage answers. */
	answer(status: number) {
		this.status = status;
		this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
		this.onload?.();
	}
}

const globals = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
let fetched: { url: string; init: RequestInit }[] = [];

function signAnswering(uploadUrl: string) {
	globals.fetch = async (url: string, init: RequestInit) => {
		fetched.push({ url, init });
		return new Response(
			JSON.stringify({
				upload: {
					method: "PUT",
					url: uploadUrl,
					headers: { "Content-Type": "video/mp4" },
				},
				token: "signed-token",
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};
}

/** Lets the pending promises run (the sign answer, then the PUT's start). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const file = new Blob([new Uint8Array(10)], { type: "video/mp4" });

test.group("Video angles: the upload straight to storage", (group) => {
	group.setup(() => {
		for (const key of ["fetch", "XMLHttpRequest", "document", "window"]) {
			saved[key] = globals[key];
		}
		globals.XMLHttpRequest = FakeXhr;
		globals.document = { cookie: "XSRF-TOKEN=abc%3D; other=1" };
		globals.window = {
			location: { href: `${ORIGIN}/t/s/portfolio`, origin: ORIGIN },
		};
		return () => {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete globals[key];
				else globals[key] = value;
			}
		};
	});
	group.each.setup(() => {
		fetched = [];
		FakeXhr.last = null;
	});

	test("signs, PUTs with the bound headers and progress, and gives the token; the CSRF header goes only to this app's own URL", async ({
		assert,
	}) => {
		const progress: number[] = [];
		for (const [url, own] of [
			[`${ORIGIN}/t/s/artists/photos/x/videos/stage?upload=t`, true],
			["https://bucket.r2.cloudflarestorage.com/work_video_upload/x", false],
		] as const) {
			signAnswering(url);
			const staged = stageVideo({
				signUrl: "/t/s/artists/photos/x/videos/sign",
				file,
				type: "video/mp4",
				onProgress: (n) => progress.push(n),
			});
			await settle();
			const xhr = FakeXhr.last as FakeXhr;
			assert.equal(xhr.method, "PUT");
			assert.equal(xhr.url, url);
			assert.equal(xhr.headers["Content-Type"], "video/mp4");
			assert.equal(xhr.headers["X-XSRF-TOKEN"], own ? "abc=" : undefined);
			xhr.answer(200);
			assert.deepEqual(await staged, { kind: "staged", token: "signed-token" });
		}
		assert.include(progress, 50);
		assert.equal(
			(fetched[0].init.headers as Record<string, string>)["X-XSRF-TOKEN"],
			"abc=",
		);
		assert.equal(
			fetched[0].init.body,
			JSON.stringify({ type: "video/mp4", size: 10 }),
		);
	});

	test("leaving the page mid-upload aborts the PUT and ends `aborted`: no finish follows", async ({
		assert,
	}) => {
		signAnswering(`${ORIGIN}/stage`);
		const controller = new AbortController();
		const staged = stageVideo({
			signUrl: "/sign",
			file,
			type: "video/mp4",
			onProgress: () => {},
			signal: controller.signal,
		});
		await settle();
		const xhr = FakeXhr.last as FakeXhr;
		controller.abort();
		assert.isTrue(xhr.aborted);
		assert.deepEqual(await staged, { kind: "aborted" });
	});

	test("a signal already aborted sends nothing at all", async ({ assert }) => {
		signAnswering(`${ORIGIN}/stage`);
		const controller = new AbortController();
		controller.abort();
		assert.deepEqual(
			await stageVideo({
				signUrl: "/sign",
				file,
				type: "video/mp4",
				onProgress: () => {},
				signal: controller.signal,
			}),
			{ kind: "aborted" },
		);
		assert.lengthOf(fetched, 0);
		assert.isNull(FakeXhr.last);
	});

	test("a refused sign says why, in the server's words", async ({ assert }) => {
		globals.fetch = async () =>
			new Response(
				JSON.stringify({
					errors: [{ message: "Use a video of 100 MB or less." }],
				}),
				{ status: 422 },
			);
		assert.deepEqual(
			await stageVideo({
				signUrl: "/sign",
				file,
				type: "video/mp4",
				onProgress: () => {},
			}),
			{ kind: "refused", message: "Use a video of 100 MB or less." },
		);
	});
});
