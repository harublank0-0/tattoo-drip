import {
	type DesignProvider,
	DesignProviderError,
	type PollResult,
	type SubmitRequest,
	type Submitted,
} from "#modules/design_lab/providers/types";

/**
 * Black Forest Labs' hosted FLUX API (docs/design-lab.md, "BFL"). The
 * hosted API only: never self-hosted weights.
 *
 * - Submit: `POST <api>/v1/<model>` with the key in the `x-key` header and a
 *   JSON body; the answer holds the request's `id` and its `polling_url`.
 * - Poll: `GET <polling_url>` exactly as returned (never rebuilt from the
 *   id), with the key; `status` is `Ready` (the image at `result.sample`),
 *   `Pending`, `Request Moderated`, `Content Moderated`, `Error` or
 *   `Task not found`. Any other status is treated as still pending until the
 *   worker's deadline.
 * - Download: `GET <result.sample>` WITHOUT the key (a temporary delivery
 *   URL, valid for minutes).
 *
 * The key travels only to the API's own host or a subdomain of its domain:
 * a polling or sample URL on any other host is refused, so a tampered
 * answer cannot make us send the key, or fetch, elsewhere. Nothing here logs
 * a prompt, a URL or the key.
 *
 * These field names and statuses follow BFL's API reference as known when
 * this was written; check them against https://docs.bfl.ai/ when changing
 * BFL_MODEL (docs/design-lab.md lists what to check).
 */

type Fetch = typeof fetch;

export type BflOptions = {
	apiKey: string;
	apiUrl: string;
	model: string;
	/** BFL's moderation strictness, 0 (strictest) to 6; 2 is BFL's default. */
	safetyTolerance?: number;
	fetch?: Fetch;
	/** Per request; the worker's own deadline bounds the whole generation. */
	timeoutMs?: { submit: number; poll: number; download: number };
};

/** The largest image we download (a 2 MP PNG is well under this). */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const DEFAULT_TIMEOUTS = { submit: 30_000, poll: 15_000, download: 30_000 };

/** Models BFL sizes by `aspect_ratio` instead of `width` and `height`. */
const ASPECT_RATIO_MODELS = /(?:^|-)(?:ultra|kontext)(?:-|$)/;

export default class BflProvider implements DesignProvider {
	readonly name = "bfl";
	readonly model: string;
	private readonly fetch: Fetch;
	private readonly api: URL;
	private readonly timeouts: typeof DEFAULT_TIMEOUTS;

	constructor(private readonly options: BflOptions) {
		this.model = options.model;
		this.fetch = options.fetch ?? fetch;
		this.api = new URL(options.apiUrl);
		this.timeouts = options.timeoutMs ?? DEFAULT_TIMEOUTS;
	}

	async submit(
		request: SubmitRequest,
		signal?: AbortSignal,
	): Promise<Submitted> {
		const body: Record<string, unknown> = {
			prompt: request.prompt,
			output_format: "png",
			safety_tolerance: this.options.safetyTolerance ?? 2,
		};
		if (ASPECT_RATIO_MODELS.test(this.model)) {
			body.aspect_ratio = request.aspectRatio;
		} else {
			body.width = request.width;
			body.height = request.height;
		}
		let response: Response;
		try {
			response = await this.fetch(new URL(`/v1/${this.model}`, this.api), {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					"x-key": this.options.apiKey,
				},
				body: JSON.stringify(body),
				signal: withTimeout(signal, this.timeouts.submit),
				redirect: "error",
			});
		} catch {
			// Timed out or cut off: BFL may have accepted (and charged) it.
			throw new DesignProviderError("uncertain", "The submit got no answer.");
		}
		if (!response.ok) throw await httpError(response, "submit");
		const json = await readJson(response, "uncertain");
		const id = typeof json.id === "string" ? json.id : null;
		const pollingUrl =
			typeof json.polling_url === "string" ? json.polling_url : null;
		if (!id || !/^[\w.:-]{1,128}$/.test(id) || !pollingUrl) {
			throw new DesignProviderError(
				"uncertain",
				"The submit answer had no usable id or polling URL.",
			);
		}
		this.assertProviderUrl(pollingUrl, "uncertain");
		const cost =
			typeof json.cost === "number" && json.cost >= 0 ? json.cost : undefined;
		return {
			requestId: id,
			pollingUrl,
			...(cost === undefined ? {} : { cost }),
		};
	}

	async poll(pollingUrl: string, signal?: AbortSignal): Promise<PollResult> {
		const url = this.assertProviderUrl(pollingUrl, "invalid_response");
		let response: Response;
		try {
			response = await this.fetch(url, {
				headers: { accept: "application/json", "x-key": this.options.apiKey },
				signal: withTimeout(signal, this.timeouts.poll),
				redirect: "error",
			});
		} catch {
			throw new DesignProviderError("unavailable", "The poll got no answer.");
		}
		if (response.status === 404) return { state: "not_found" };
		if (!response.ok) throw await httpError(response, "poll");
		const json = await readJson(response, "unavailable");
		const status = typeof json.status === "string" ? json.status : "";
		switch (status) {
			case "Ready": {
				const result =
					json.result && typeof json.result === "object"
						? (json.result as Record<string, unknown>)
						: {};
				if (typeof result.sample !== "string") {
					return { state: "error", providerStatus: "Ready without sample" };
				}
				this.assertProviderUrl(result.sample, "invalid_response", false);
				const seed = typeof result.seed === "number" ? result.seed : undefined;
				return {
					state: "ready",
					sampleUrl: result.sample,
					...(seed === undefined ? {} : { seed }),
				};
			}
			case "Request Moderated":
				return { state: "moderated", code: "request_moderated" };
			case "Content Moderated":
				return { state: "moderated", code: "content_moderated" };
			case "Error":
				return { state: "error", providerStatus: status };
			case "Task not found":
				return { state: "not_found" };
			default:
				return { state: "pending", providerStatus: status.slice(0, 40) };
		}
	}

	async download(sampleUrl: string, signal?: AbortSignal): Promise<Buffer> {
		const url = this.assertProviderUrl(sampleUrl, "invalid_response", false);
		let response: Response;
		try {
			// No key: a delivery URL is its own short-lived credential.
			response = await this.fetch(url, {
				signal: withTimeout(signal, this.timeouts.download),
				redirect: "error",
			});
		} catch {
			throw new DesignProviderError(
				"unavailable",
				"The download got no answer.",
			);
		}
		if (!response.ok) {
			throw new DesignProviderError(
				"unavailable",
				"The download was refused.",
				response.status,
			);
		}
		const type = response.headers.get("content-type") ?? "";
		if (
			type &&
			!type.startsWith("image/") &&
			type !== "application/octet-stream"
		) {
			throw new DesignProviderError(
				"invalid_response",
				"The download is not an image.",
			);
		}
		const length = Number(response.headers.get("content-length") ?? 0);
		if (length > MAX_DOWNLOAD_BYTES) {
			throw new DesignProviderError(
				"invalid_response",
				"The image is too large.",
			);
		}
		return readCapped(response, MAX_DOWNLOAD_BYTES);
	}

	/**
	 * `raw` as a URL on the provider's host or a subdomain of its domain
	 * (https, or the API's own scheme for a local mock), else a throw of
	 * `kind`. `forKey`: the URL will carry the key.
	 */
	private assertProviderUrl(
		raw: string,
		kind: "uncertain" | "invalid_response",
		forKey = true,
	): URL {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new DesignProviderError(kind, "The provider gave an unusable URL.");
		}
		const sameOrigin = url.origin === this.api.origin;
		const underDomain =
			url.protocol === "https:" &&
			url.hostname.endsWith(`.${registrableDomain(this.api.hostname)}`);
		if (url.username || url.password || (!sameOrigin && !underDomain)) {
			throw new DesignProviderError(
				kind,
				forKey
					? "The provider's polling URL is off its domain."
					: "The provider's image URL is off its domain.",
			);
		}
		return url;
	}
}

/** The last two labels of a host name ("api.bfl.ai" → "bfl.ai"). */
export function registrableDomain(hostname: string): string {
	return hostname.split(".").slice(-2).join(".");
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(
	response: Response,
	kind: "uncertain" | "unavailable",
): Promise<Record<string, unknown>> {
	try {
		const json: unknown = await response.json();
		if (json && typeof json === "object")
			return json as Record<string, unknown>;
	} catch {
		// Fall through.
	}
	throw new DesignProviderError(kind, "The provider's answer was not JSON.");
}

/** An HTTP refusal sorted into a kind; the body is never kept (it may echo the prompt). */
async function httpError(
	response: Response,
	call: "submit" | "poll",
): Promise<DesignProviderError> {
	await response.body?.cancel().catch(() => {});
	const status = response.status;
	if (status === 429) {
		return new DesignProviderError(
			"rate_limited",
			`The ${call} was rate limited.`,
			status,
		);
	}
	if (status === 402) {
		return new DesignProviderError(
			"credits",
			"The provider account has no credits.",
			status,
		);
	}
	if (status === 401 || status === 403) {
		return new DesignProviderError(
			"auth",
			"The provider refused the API key.",
			status,
		);
	}
	if (status === 404 || status === 405) {
		// A model endpoint that doesn't exist: BFL_MODEL or BFL_API_URL is wrong.
		return new DesignProviderError(
			"config",
			`The ${call} endpoint was not found.`,
			status,
		);
	}
	if (call === "submit" && (status === 400 || status === 422)) {
		return new DesignProviderError(
			"rejected",
			"The provider refused the request.",
			status,
		);
	}
	if (call === "submit" && status !== 503) {
		// Any other server error may have come after the task was created (and
		// charged): unknown, so never resubmitted. A 503 is "not now".
		return new DesignProviderError(
			"uncertain",
			"The submit failed with a server error.",
			status,
		);
	}
	return new DesignProviderError("unavailable", `The ${call} failed.`, status);
}

async function readCapped(response: Response, cap: number): Promise<Buffer> {
	if (!response.body) return Buffer.alloc(0);
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of response.body) {
		size += chunk.byteLength;
		if (size > cap) {
			throw new DesignProviderError(
				"invalid_response",
				"The image is too large.",
			);
		}
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
