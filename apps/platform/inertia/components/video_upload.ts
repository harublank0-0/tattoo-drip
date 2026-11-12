/**
 * Video angles: a video goes straight to storage, never through the app's
 * request body (20 MB at most, and Cloudflare's tunnel cuts a request at
 * 100 MB). First the platform signs the upload (`sign`: the file's type and
 * exact length, checked against the tattoo's room), then the file is PUT to
 * the URL it answers, with the headers its signature binds, reporting
 * progress; the caller then finishes it with the token (an Inertia visit, so
 * the page shows the new video processing). On R2 the URL is a presigned PUT
 * to a private object; in development it is the platform's own PUT route,
 * which needs the CSRF header like any other write. Plain code with no
 * imports.
 */

/** How a signed upload ended: the token to finish it with, or why not. */
export type StagedVideo =
	| { kind: "staged"; token: string }
	| { kind: "refused"; message: string };

const FAILED = "It didn't upload. Try again.";

/** The CSRF token the app's own writes send (the XSRF-TOKEN cookie). */
function xsrfToken(): string | null {
	const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
	return match ? decodeURIComponent(match[1]) : null;
}

/** True for a URL of this page's own origin (the development PUT route), never for R2. */
function sameOrigin(url: string): boolean {
	return new URL(url, window.location.href).origin === window.location.origin;
}

/** The first message of a 422 the platform answered a JSON request with. */
function messageOf(body: unknown): string | null {
	const errors =
		typeof body === "object" && body !== null && "errors" in body
			? (body as { errors: unknown }).errors
			: null;
	if (!Array.isArray(errors)) return null;
	const first = errors.find(
		(error) => typeof error?.message === "string" && error.message,
	);
	return first ? (first.message as string) : null;
}

/**
 * Signs and uploads one video. `onProgress` gets the upload's percentage
 * (0 to 100) as the bytes go. Resolves, never rejects.
 */
export async function stageVideo({
	signUrl,
	file,
	type,
	onProgress,
}: {
	signUrl: string;
	file: Blob;
	type: string;
	onProgress: (percentage: number) => void;
}): Promise<StagedVideo> {
	let signed: {
		upload: { method: string; url: string; headers: Record<string, string> };
		token: string;
	};
	try {
		const xsrf = xsrfToken();
		const response = await fetch(signUrl, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {}),
			},
			body: JSON.stringify({ type, size: file.size }),
		});
		const body: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			return { kind: "refused", message: messageOf(body) ?? FAILED };
		}
		signed = body as typeof signed;
		if (typeof signed?.token !== "string" || !signed.upload?.url) {
			return { kind: "refused", message: FAILED };
		}
	} catch {
		return { kind: "refused", message: FAILED };
	}

	const sent = await new Promise<boolean>((resolve) => {
		const request = new XMLHttpRequest();
		request.open(signed.upload.method || "PUT", signed.upload.url);
		for (const [name, value] of Object.entries(signed.upload.headers ?? {})) {
			request.setRequestHeader(name, value);
		}
		if (sameOrigin(signed.upload.url)) {
			const xsrf = xsrfToken();
			if (xsrf) request.setRequestHeader("X-XSRF-TOKEN", xsrf);
		}
		request.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				onProgress(Math.round((event.loaded / event.total) * 100));
			}
		};
		request.onload = () =>
			resolve(request.status >= 200 && request.status < 300);
		request.onerror = () => resolve(false);
		request.onabort = () => resolve(false);
		request.send(file);
	});
	if (!sent) return { kind: "refused", message: FAILED };
	onProgress(100);
	return { kind: "staged", token: signed.token };
}
