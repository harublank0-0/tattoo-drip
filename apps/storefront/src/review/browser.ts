/*
 * The review page's DOM work (Reviews and Fresh ink): a video's PUT with
 * upload progress (fetch reports none), and its length read from its
 * metadata before anything is uploaded. Only the browser pass covers this
 * file; nothing here reads the page's location, so the token in the
 * fragment never reaches it.
 */

/** PUTs `file` to `url` with exactly `headers`, telling `onProgress` the share sent (0 to 1). */
export function putWithProgress(
	url: string,
	file: Blob,
	headers: Record<string, string>,
	onProgress: (share: number) => void,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		request.open("PUT", url);
		for (const [name, value] of Object.entries(headers)) {
			request.setRequestHeader(name, value);
		}
		request.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) {
				onProgress(event.loaded / event.total);
			}
		};
		request.onload = () =>
			request.status >= 200 && request.status < 300
				? resolve()
				: reject(new Error(`upload refused (${request.status})`));
		request.onerror = () => reject(new Error("upload failed"));
		request.onabort = () => reject(new Error("upload stopped"));
		signal?.addEventListener("abort", () => request.abort(), { once: true });
		request.send(file);
	});
}

/** A video's length in seconds from its metadata, or null when the browser can't tell (the API measures it anyway). */
export function videoSeconds(file: Blob): Promise<number | null> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement("video");
		const done = (seconds: number | null) => {
			URL.revokeObjectURL(url);
			video.removeAttribute("src");
			resolve(seconds);
		};
		const timer = window.setTimeout(() => done(null), 10_000);
		video.preload = "metadata";
		video.muted = true;
		video.onloadedmetadata = () => {
			window.clearTimeout(timer);
			done(Number.isFinite(video.duration) ? video.duration : null);
		};
		video.onerror = () => {
			window.clearTimeout(timer);
			done(null);
		};
		video.src = url;
	});
}
