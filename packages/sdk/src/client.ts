import type {
	Artist,
	BodyPlacement,
	DepositPage,
	DepositPaymentMethod,
	FlashDesign,
	FlashPage,
	GalleryPhoto,
	InquiryInput,
	InquiryReceipt,
	ListAvailabilityQuery,
	ListFlashQuery,
	ListServicesQuery,
	ListWorkQuery,
	ReviewPage,
	ReviewSubmission,
	ReviewVideoSignInput,
	ReviewVideoUpload,
	Service,
	Slot,
	Studio,
	TattooStyle,
	WorkPage,
} from "@tattoo-drip/types";
import {
	createTransport,
	type RequestOptions,
	withQuery,
} from "./transport.js";

export type { RequestOptions } from "./transport.js";

/** Uploads on a slow mobile connection need longer than a read (TAT-51). */
const UPLOAD_TIMEOUT_MS = 120_000;
/** The action the studio page's Turnstile widget is rendered with for an inquiry (TAT-55). */
export const INQUIRY_CHALLENGE_ACTION = "inquiry";
/** The intake form's honeypot field: people never see it, so they leave it empty (TAT-55). */
export const INQUIRY_HONEYPOT_FIELD = "website";
/** The action the review page's Turnstile widget is rendered with (Reviews and Fresh ink). */
export const REVIEW_CHALLENGE_ACTION = "review";
/**
 * The header a review link's token travels in: never a path or a query
 * string, so the token appears in no URL the API sees or logs.
 */
export const REVIEW_TOKEN_HEADER = "X-Review-Token";

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

/** An inquiry and its reference images, sent as one multipart request. */
export interface CreateInquiryInput extends InquiryInput {
	/** Up to 5 JPEG, PNG or WebP images, 10 MB each and 20 MB together. */
	referenceImages?: Blob[];
	/**
	 * The bot-challenge token the studio page's Turnstile widget made for
	 * this submission (rendered with action `INQUIRY_CHALLENGE_ACTION`).
	 * Sent as the `X-Challenge-Token` header, which the API checks before it
	 * reads the upload. Single-use: get a new one for every call, also after
	 * a refusal. The deployed API refuses a call without one
	 * (`challenge_failed`).
	 */
	challengeToken?: string;
	/**
	 * What the form's hidden honeypot input (`INQUIRY_HONEYPOT_FIELD`) holds.
	 * Sent as that field only when it isn't empty; a filled one is refused
	 * as `challenge_failed`.
	 */
	honeypot?: string;
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

/** The review page's submit, with the bot-challenge token for this call. */
export interface SubmitReviewInput extends ReviewSubmission {
	/**
	 * The token the review page's Turnstile widget made for this submit
	 * (action `REVIEW_CHALLENGE_ACTION`), sent as `X-Challenge-Token`.
	 * Single-use: get a new one for every call.
	 */
	challengeToken?: string;
}

export type TattooClient = ReturnType<typeof createTattooClient>;

export function createTattooClient(options: TattooClientOptions) {
	const transport = createTransport(options);
	const { apiRoot } = transport;
	const tenantRoot = `${apiRoot}/tenants/${encodeURIComponent(options.tenant)}`;

	const { request, getData } = transport;
	const reviewRoot = `${tenantRoot}/review`;
	/** A review page call: the link's token in its header, JSON in and `{ data }` out. */
	const reviewCall = async <T>(
		token: string,
		path: string,
		init: RequestInit,
		call?: RequestOptions,
	) => {
		const headers = new Headers(init.headers);
		headers.set(REVIEW_TOKEN_HEADER, token);
		return (
			await request<{ data: T }>(
				`${reviewRoot}${path}`,
				{ ...init, headers },
				call,
			)
		).data;
	};
	const jsonBody = (method: string, body: unknown): RequestInit => ({
		method,
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
	});

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
		work: {
			/**
			 * A page of the studio's work photos, newest first (TAT-126): the
			 * whole body, `{ data, nextCursor, filters }`, one entry per tattoo
			 * (its main photo, with its other photos and ready videos in
			 * `angles`, each with a `kind`). Pass `nextCursor` back
			 * as `cursor`, with the same filters, for the next page. A malformed
			 * parameter or cursor is a 422 TattooApiError (`validation_failed`).
			 */
			list: (query?: ListWorkQuery, call?: RequestOptions) =>
				request<WorkPage>(withQuery(`${tenantRoot}/work`, query), {}, call),
			/**
			 * One tattoo by a photo's `id`, as the gallery lists it, with its
			 * other photos and videos in `angles`. The id of one of those
			 * answers with the tattoo itself, whose `id` is its main photo's. A
			 * hidden or deleted artist's, a removed photo, an unknown id and
			 * another studio's are a 404 TattooApiError (`not_found`).
			 */
			get: (id: string, call?: RequestOptions) =>
				getData<GalleryPhoto>(
					`${tenantRoot}/work/${encodeURIComponent(id)}`,
					call,
				),
		},
		flash: {
			/**
			 * A page of the studio's flash designs, newest first (TAT-129): the
			 * whole body, `{ data, nextCursor, filters }`. Pass `nextCursor` back
			 * as `cursor`, with the same `artist`, for the next page. A malformed
			 * parameter or cursor is a 422 TattooApiError (`validation_failed`).
			 */
			list: (query?: ListFlashQuery, call?: RequestOptions) =>
				request<FlashPage>(withQuery(`${tenantRoot}/flash`, query), {}, call),
			/**
			 * One shown flash design by id. A hidden design, a hidden artist's, an
			 * unknown id and another studio's are a 404 TattooApiError
			 * (`not_found`).
			 */
			get: (id: string, call?: RequestOptions) =>
				getData<FlashDesign>(
					`${tenantRoot}/flash/${encodeURIComponent(id)}`,
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
			 * request and returns the new inquiry's id and its reference, the code
			 * the client quotes. Waits up to 2 minutes
			 * (an upload) unless `call.timeoutMs` says otherwise. Fails with a
			 * TattooApiError such as `validation_failed` (with `fields` by
			 * input name), `artist_not_accepting`, `studio_not_accepting`,
			 * `too_many_open_inquiries`, `flash_unavailable` (a request for a flash
			 * design that is no longer offered), `flash_claimed` (a one-of-a-kind
			 * design that someone has claimed), `payload_too_large`,
			 * `challenge_failed` (403: get a new token), `challenge_unavailable`
			 * (503) or `rate_limited` (429, with `retryAfter`). Never retried.
			 */
			create: async (input: CreateInquiryInput, call: RequestOptions = {}) => {
				const {
					referenceImages = [],
					challengeToken,
					honeypot,
					...fields
				} = input;
				const form = new FormData();
				for (const [name, value] of Object.entries(fields)) {
					if (value !== undefined && value !== null) {
						form.set(name, String(value));
					}
				}
				for (const image of referenceImages) {
					form.append("referenceImages", image);
				}
				if (honeypot) form.set(INQUIRY_HONEYPOT_FIELD, honeypot);

				const body = await request<{ data: InquiryReceipt }>(
					`${tenantRoot}/inquiries`,
					// No Content-Type: fetch sets multipart's boundary itself. The
					// token goes in a header, so the API checks it before it reads
					// the upload (TAT-55); the request then preflights.
					{
						method: "POST",
						body: form,
						headers: challengeToken
							? { "X-Challenge-Token": challengeToken }
							: undefined,
					},
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

		/**
		 * The client's review page (Reviews and Fresh ink), through the token
		 * of the link the studio sent (the link's fragment). The token goes in
		 * the `X-Review-Token` header, never the URL. A link that doesn't work,
		 * and every call while reviews are off, is a 404 TattooApiError
		 * (`not_found`). Every write answers with the page as it now is.
		 */
		reviews: {
			get: (token: string, call?: RequestOptions) =>
				reviewCall<ReviewPage>(token, "", {}, call),
			/**
			 * Writes the review, the post or both, with the shown name and the
			 * consents. Fails with `validation_failed` (fields such as
			 * `review.body`, `post.styles`), `review_locked`, `post_needs_photo`,
			 * `challenge_failed` (get a new token), `challenge_unavailable` or
			 * `rate_limited`. Never retried.
			 */
			submit: (
				token: string,
				{ challengeToken, ...input }: SubmitReviewInput,
				call?: RequestOptions,
			) => {
				const init = jsonBody("PUT", input);
				if (challengeToken) {
					(init.headers as Record<string, string>)["X-Challenge-Token"] =
						challengeToken;
				}
				return reviewCall<ReviewPage>(token, "", init, call);
			},
			deleteReview: (token: string, call?: RequestOptions) =>
				reviewCall<ReviewPage>(token, "/review", { method: "DELETE" }, call),
			deletePost: (token: string, call?: RequestOptions) =>
				reviewCall<ReviewPage>(token, "/post", { method: "DELETE" }, call),
			/**
			 * Adds one photo (a JPEG, PNG or WebP of 10 MB at most) to the post.
			 * Waits up to 2 minutes unless `call.timeoutMs` says otherwise.
			 * `post_full` with 8 already.
			 */
			addPhoto: (token: string, photo: Blob, call: RequestOptions = {}) => {
				const form = new FormData();
				form.append("photo", photo, "photo.jpg");
				return reviewCall<ReviewPage>(
					token,
					"/photos",
					// No Content-Type: fetch sets multipart's boundary itself.
					{ method: "POST", body: form },
					{ ...call, timeoutMs: call.timeoutMs ?? UPLOAD_TIMEOUT_MS },
				);
			},
			/**
			 * Where to PUT a video: `upload.url` (resolve it against the API's
			 * origin) with `upload.headers`, then `addVideo` with `token`.
			 */
			signVideo: (
				token: string,
				input: ReviewVideoSignInput,
				call?: RequestOptions,
			) =>
				reviewCall<ReviewVideoUpload>(
					token,
					"/videos/sign",
					jsonBody("POST", input),
					call,
				),
			/** Adds the uploaded video (`processing`) once its PUT has finished. */
			addVideo: (token: string, upload: string, call?: RequestOptions) =>
				reviewCall<ReviewPage>(
					token,
					"/videos",
					jsonBody("POST", { upload }),
					call,
				),
			/** Removes one photo or video of the post (its files go first). */
			removeMedia: (token: string, mediaId: string, call?: RequestOptions) =>
				reviewCall<ReviewPage>(
					token,
					`/media/${encodeURIComponent(mediaId)}`,
					{ method: "DELETE" },
					call,
				),
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
