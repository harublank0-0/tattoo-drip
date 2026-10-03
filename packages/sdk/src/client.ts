import type {
	Artist,
	BodyPlacement,
	BookingReceipt,
	BookingRequestInput,
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
}

export interface CreateBookingInput extends BookingRequestInput {
	/** Up to 5 images (JPEG, PNG, WebP or HEIC, 10 MB each). */
	referenceImages?: Blob[];
	/** Bot-challenge token, required for browser submissions. */
	challengeToken?: string;
}

type Query = Record<string, string | number | undefined>;

export type TattooClient = ReturnType<typeof createTattooClient>;

export function createTattooClient(options: TattooClientOptions) {
	if (options.key && "document" in globalThis) {
		throw new Error(
			"@tattoo-drip/sdk: secret keys must never be used in a browser.",
		);
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const apiRoot = `${options.baseUrl.replace(/\/+$/, "")}/api/${API_VERSION}`;
	const tenantRoot = `${apiRoot}/tenants/${encodeURIComponent(options.tenant)}`;

	async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		if (options.key) headers.set("Authorization", `Bearer ${options.key}`);

		const response = await fetchImpl(url, { ...init, headers });
		const body = await readJson(response);

		if (!response.ok) throw new TattooApiError(response.status, body?.error);
		if (!body || !("data" in body)) {
			throw new TattooApiError(response.status, {
				code: "invalid_response",
				message: "The API returned an unexpected response body.",
			});
		}
		return body as T;
	}

	async function getData<T>(url: string): Promise<T> {
		return (await request<{ data: T }>(url)).data;
	}

	return {
		/** Tenant slug this client is scoped to. */
		tenant: options.tenant,

		studio: {
			get: () => getData<Studio>(tenantRoot),
		},
		artists: {
			list: () => getData<Artist[]>(`${tenantRoot}/artists`),
			get: (slug: string) =>
				getData<Artist>(`${tenantRoot}/artists/${encodeURIComponent(slug)}`),
		},
		services: {
			list: (query?: ListServicesQuery) =>
				getData<Service[]>(withQuery(`${tenantRoot}/services`, query)),
		},
		portfolio: {
			list: (query?: ListPortfolioQuery) =>
				request<PortfolioPage>(withQuery(`${tenantRoot}/portfolio`, query)),
		},
		availability: {
			list: (query: ListAvailabilityQuery) =>
				getData<Slot[]>(withQuery(`${tenantRoot}/availability`, query)),
		},
		bookings: {
			create: async (input: CreateBookingInput) => {
				const { referenceImages = [], challengeToken, ...booking } = input;
				const form = new FormData();
				form.set("booking", JSON.stringify(booking));
				for (const image of referenceImages) {
					form.append("referenceImages", image);
				}
				if (challengeToken) form.set("challengeToken", challengeToken);

				const body = await request<{ data: BookingReceipt }>(
					`${tenantRoot}/bookings`,
					{ method: "POST", body: form },
				);
				return body.data;
			},
		},

		/** Platform-wide reference lists (not tenant-scoped). */
		styles: {
			list: () => getData<TattooStyle[]>(`${apiRoot}/styles`),
		},
		placements: {
			list: () => getData<BodyPlacement[]>(`${apiRoot}/placements`),
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

async function readJson(
	response: Response,
): Promise<{ data?: unknown; error?: TattooApiErrorBody } | undefined> {
	if (!response.headers.get("content-type")?.includes("json")) return undefined;
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

type TattooApiErrorBody = ConstructorParameters<typeof TattooApiError>[1];
