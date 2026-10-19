import type {
	ApiError,
	Artist,
	BodyPlacement,
	DepositPage,
	DepositPaymentMethod,
	InquiryInput,
	InquiryReceipt,
	ListAvailabilityQuery,
	ListPortfolioQuery,
	ListServicesQuery,
	PortfolioPage,
	Service,
	Slot,
	Studio,
	TattooStyle,
} from "@tattoo-drip/types";
import { TattooApiError } from "./errors.js";

const API_VERSION = "v1";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Uploads on a slow mobile connection need longer than a read (TAT-51). */
const UPLOAD_TIMEOUT_MS = 120_000;

export interface TattooClientOptions {
	/** API origin, e.g. `https://api.example.com`. The SDK appends `/api/v1`. */
	baseUrl: string;
	/** Tenant slug, e.g. `blackneedle`. Every tenant request is scoped to it. */
	tenant: string;
	/**
	 * Secret server key. Server-side only: it identifies the caller for rate
	 * limiting and grants no extra data access. Rejected in browsers.
	 */
	key?: string;
	/** Custom fetch for tests, edge runtimes or request forwarding. */
	fetch?: typeof fetch;
	/**
	 * Milliseconds before a call gives up with a `timeout` TattooApiError.
	 * Defaults to 10 000.
	 */
	timeoutMs?: number;
}

/** Options for one call. */
export interface RequestOptions {
	/** Cancels the call; it then rejects with the signal's reason (an `AbortError`). */
	signal?: AbortSignal;
	/**
	 * Milliseconds before this call gives up with `timeout`, instead of the
	 * client's `timeoutMs` (or the 2 minutes an upload gets).
	 */
	timeoutMs?: number;
}

/** An inquiry and its reference images, sent as one multipart request. */
export interface CreateInquiryInput extends InquiryInput {
	/** Up to 5 JPEG, PNG or WebP images, 10 MB each and 20 MB together. */
	referenceImages?: Blob[];
	/** Bot-challenge token (TAT-55); the API ignores it until then. */
	challengeToken?: string;
}

/** A deposit proof: the screenshot, how the client paid, and the `deposit.due` the page showed. */
export interface SubmitDepositProofInput {
	/** A JPEG, PNG or WebP of 10 MB at most. */
	proof: Blob;
	/** One of the page's `paymentMethods` kinds. */
	method: DepositPaymentMethod["kind"];
	/** The page's `deposit.due`, in paisa. */
	expectedAmount: number;
}

type Query = Record<string, string | number | undefined>;

type ResponseBody = { data?: unknown; error?: Partial<ApiError> };

export type TattooClient = ReturnType<typeof createTattooClient>;

export function createTattooClient(options: TattooClientOptions) {
	if (options.key && "document" in globalThis) {
		throw new Error(
			"@tattoo-drip/sdk: secret keys must never be used in a browser.",
		);
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const apiRoot = `${options.baseUrl.replace(/\/+$/, "")}/api/${API_VERSION}`;
	const tenantRoot = `${apiRoot}/tenants/${encodeURIComponent(options.tenant)}`;

	async function request<T>(
		url: string,
		init: RequestInit = {},
		call: RequestOptions = {},
	): Promise<T> {
		const { signal } = call;
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		if (options.key) headers.set("Authorization", `Bearer ${options.key}`);

		const timeout = AbortSignal.timeout(call.timeoutMs ?? timeoutMs);
		let response: Response;
		let body: ResponseBody | undefined;
		try {
			response = await fetchImpl(url, {
				...init,
				headers,
				// The API is stateless and cookieless: never send cookies to it.
				credentials: "omit",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});
			body = await readJson(response);
		} catch (error) {
			// The caller cancelled: let its AbortError through (TanStack Query
			// expects it).
			if (signal?.aborted) throw signal.reason;
			if (timeout.aborted) {
				throw new TattooApiError(0, {
					code: "timeout",
					message: "The Tattoo Drip API did not answer in time.",
				});
			}
			throw new TattooApiError(
				0,
				{
					code: "network_error",
					message: "The Tattoo Drip API could not be reached.",
				},
				{ cause: error },
			);
		}

		if (!response.ok) {
			throw new TattooApiError(response.status, body?.error, {
				retryAfter: retryAfterOf(response),
			});
		}
		if (!body || !("data" in body)) {
			throw new TattooApiError(response.status, {
				code: "invalid_response",
				message: "The API returned an unexpected response body.",
			});
		}
		return body as T;
	}

	async function getData<T>(url: string, call?: RequestOptions): Promise<T> {
		return (await request<{ data: T }>(url, {}, call)).data;
	}

	return {
		/** Tenant slug this client is scoped to. */
		tenant: options.tenant,

		studio: {
			/**
			 * The studio's public profile (TAT-44). Under an old slug it answers
			 * like under the current one, and `slug` is the current slug.
			 */
			get: (call?: RequestOptions) => getData<Studio>(tenantRoot, call),
		},
		artists: {
			/** The studio's visible artists, by name. */
			list: (call?: RequestOptions) =>
				getData<Artist[]>(`${tenantRoot}/artists`, call),
			/**
			 * One visible artist by slug, matched exactly. A hidden, deleted or
			 * unknown artist is a 404 TattooApiError (`not_found`).
			 */
			get: (slug: string, call?: RequestOptions) =>
				getData<Artist>(
					`${tenantRoot}/artists/${encodeURIComponent(slug)}`,
					call,
				),
		},
		services: {
			list: (query?: ListServicesQuery, call?: RequestOptions) =>
				getData<Service[]>(withQuery(`${tenantRoot}/services`, query), call),
		},
		portfolio: {
			list: (query?: ListPortfolioQuery, call?: RequestOptions) =>
				request<PortfolioPage>(
					withQuery(`${tenantRoot}/portfolio`, query),
					{},
					call,
				),
		},
		availability: {
			list: (query: ListAvailabilityQuery, call?: RequestOptions) =>
				getData<Slot[]>(withQuery(`${tenantRoot}/availability`, query), call),
		},
		inquiries: {
			/**
			 * Sends an inquiry with its reference images as one multipart
			 * request and returns the new inquiry's id. Waits up to 2 minutes
			 * (an upload) unless `call.timeoutMs` says otherwise. Fails with a
			 * TattooApiError such as `validation_failed` (with `fields` by
			 * input name), `artist_not_accepting`, `studio_not_accepting`,
			 * `too_many_open_inquiries` or `payload_too_large`.
			 */
			create: async (input: CreateInquiryInput, call: RequestOptions = {}) => {
				const { referenceImages = [], challengeToken, ...fields } = input;
				const form = new FormData();
				for (const [name, value] of Object.entries(fields)) {
					if (value !== undefined && value !== null) {
						form.set(name, String(value));
					}
				}
				for (const image of referenceImages) {
					form.append("referenceImages", image);
				}
				if (challengeToken) form.set("challengeToken", challengeToken);

				const body = await request<{ data: InquiryReceipt }>(
					`${tenantRoot}/inquiries`,
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
					{ ...call, timeoutMs: call.timeoutMs ?? UPLOAD_TIMEOUT_MS },
				);
				return body.data;
			},
		},
		deposits: {
			/**
			 * The deposit page of a link's token (the fragment of the link the
			 * studio sent). A link that doesn't work is a 404 TattooApiError
			 * (`not_found`).
			 */
			get: (token: string, call?: RequestOptions) =>
				getData<DepositPage>(
					`${tenantRoot}/deposits/${encodeURIComponent(token)}`,
					call,
				),
			/**
			 * Sends the payment screenshot as one multipart request and returns
			 * the page as it now is (`submitted`). Waits up to 2 minutes (an
			 * upload) unless `call.timeoutMs` says otherwise. Fails with a
			 * TattooApiError such as `validation_failed` (fields `proof`,
			 * `method`, `expectedAmount`), `deposit_not_due`, `deposit_changed`,
			 * `payload_too_large` or `rate_limited`.
			 */
			submitProof: async (
				token: string,
				input: SubmitDepositProofInput,
				call: RequestOptions = {},
			) => {
				const form = new FormData();
				form.set("method", input.method);
				form.set("expectedAmount", String(input.expectedAmount));
				form.append("proof", input.proof);

				const body = await request<{ data: DepositPage }>(
					`${tenantRoot}/deposits/${encodeURIComponent(token)}`,
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
					{ ...call, timeoutMs: call.timeoutMs ?? UPLOAD_TIMEOUT_MS },
				);
				return body.data;
			},
		},

		/** Platform-wide reference lists (not tenant-scoped). */
		styles: {
			list: (call?: RequestOptions) =>
				getData<TattooStyle[]>(`${apiRoot}/styles`, call),
		},
		placements: {
			list: (call?: RequestOptions) =>
				getData<BodyPlacement[]>(`${apiRoot}/placements`, call),
		},
	};
}

function withQuery(url: string, query?: Query): string {
	if (!query) return url;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) params.set(key, String(value));
	}
	const search = params.toString();
	return search ? `${url}?${search}` : url;
}

/**
 * The JSON body, or undefined when there is none, it isn't JSON or it isn't an
 * object (a bare string, number, boolean, null or array is no envelope, and
 * `"data" in body` would throw on it). Reading the body can still fail (a
 * timeout or a dropped connection): that throws.
 */
async function readJson(response: Response): Promise<ResponseBody | undefined> {
	if (!response.headers.get("content-type")?.includes("json")) return undefined;
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as ResponseBody)
		: undefined;
}

/** `Retry-After` in seconds, when the API sent it as a number. */
function retryAfterOf(response: Response): number | undefined {
	const seconds = Number.parseInt(
		response.headers.get("retry-after") ?? "",
		10,
	);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
